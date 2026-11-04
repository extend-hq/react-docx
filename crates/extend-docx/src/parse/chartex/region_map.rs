use super::{
    drawing::{data_label, format_value, Font},
    geo_cache::{self, GeoRegion},
    map_projection::{longitude_midpoint, Bounds, MapProjection, Transform},
    Canvas,
};
use crate::{
    chart::{cx_child as child, CHARTEX_NS},
    parse::{chart_svg::number, util::escape_xml_text},
};
use roxmltree::Node;
use std::fmt::Write;

mod legend;
mod scale;

struct Rect {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

impl Rect {
    fn width(&self) -> f64 {
        self.right - self.left
    }
    fn height(&self) -> f64 {
        self.bottom - self.top
    }
}

fn dataset_for<'a>(root: Node<'a, 'a>, series: Node) -> Option<Node<'a, 'a>> {
    let id = child(series, "dataId")?
        .attribute("val")?
        .parse::<u32>()
        .ok()?;
    child(root, "chartData")?.children().find(|n| {
        n.has_tag_name((CHARTEX_NS, "data"))
            && n.attribute("id").and_then(|v| v.parse().ok()) == Some(id)
    })
}

fn geo_bounds(region: &GeoRegion) -> Option<[f64; 4]> {
    if let Some(bounds) = region.bounds {
        return Some(bounds);
    }
    let mut bounds = Bounds::new();
    for &p in region.polygons.iter().flatten().flatten() {
        bounds.add(p);
    }
    bounds
        .min_x
        .is_finite()
        .then_some([bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y])
}

fn project(cache: &mut geo_cache::GeoCache, geography: Node) -> Option<Bounds> {
    let regions = &mut cache.regions;
    let mut extent = Bounds::new();
    let mut reference_lon = None;
    for r in regions.iter_mut() {
        let bounds = geo_bounds(r)?;
        r.bounds = Some(bounds);
        if !(r.in_view || r.in_natural_view) {
            continue;
        }
        let [west, south, east, north] = bounds;
        let center = longitude_midpoint(west, east);
        let reference = *reference_lon.get_or_insert(center);
        let midpoint = reference + (center - reference + 180.).rem_euclid(360.) - 180.;
        let span = if east >= west {
            east - west
        } else {
            360. + east - west
        };
        extent.add((midpoint - span * 0.5, south));
        extent.add((midpoint + span * 0.5, north));
    }
    regions.retain(|region| region.in_view);
    if regions.is_empty() {
        return None;
    }
    let world = cache
        .regional
        .map_or_else(|| extent.max_x - extent.min_x >= 350., |regional| !regional);
    let (center_lon, south, north) = if world {
        (0., -90., 90.)
    } else if let Some([west, south, east, north]) = cache.projection_bounds {
        (longitude_midpoint(west, east), south, north)
    } else {
        (
            (extent.center().0 + 180.).rem_euclid(360.) - 180.,
            extent.min_y,
            extent.max_y,
        )
    };
    let projection = MapProjection::new(
        geography.attribute("projectionType"),
        center_lon,
        south,
        north,
        world,
    )
    .with_us_insets(cache.us_only && !world);
    let mut bounds = Bounds::new();
    for region in regions {
        let [west, _, east, _] = region.bounds?;
        let center = longitude_midpoint(west, east);
        for ring in region.polygons.iter_mut().flatten() {
            *ring = projection.project_ring(ring, center);
            for &p in ring.iter() {
                bounds.add(p);
            }
        }
        if let Some(center_point) = region.center {
            region.center = projection
                .project_ring(&[center_point], center)
                .first()
                .copied();
        }
    }
    Some(bounds)
}

fn outline_width(node: Node) -> Option<f64> {
    let line = child(node, "spPr")?
        .children()
        .find(|n| n.tag_name().name() == "ln")?;
    number(line.attribute("w")).map(|v| (v / 9525.).max(0.))
}

fn draw_ring(out: &mut String, ring: &[(f64, f64)], transform: &Transform) {
    let Some((&first, rest)) = ring.split_first() else {
        return;
    };
    let mut previous = transform.apply(first);
    write!(out, "M{:.2} {:.2}", previous.0, previous.1).unwrap();
    // Office decimates projected coastlines at half a display pixel, before stroking them.
    for &p in rest {
        let (x, y) = transform.apply(p);
        if (x - previous.0).powi(2) + (y - previous.1).powi(2) >= 0.25 {
            write!(out, " {x:.2} {y:.2}").unwrap();
            previous = (x, y);
        }
    }
    out.push('Z');
}

fn credit_text(out: &mut String, face: &str, x: f64, y: f64, label: &str) {
    let family = escape_xml_text(face);
    write!(
        out,
        r##"<text x="{x:.2}" y="{y:.2}" text-anchor="end" fill="#595959" font-size="8" "##
    )
    .unwrap();
    if face.eq_ignore_ascii_case("Cambria") {
        out.push_str(r#"font-family="Cambria, Caladea, 'Times New Roman', serif""#);
        if let Some(width) = legend::cambria_width(label, 8.) {
            write!(
                out,
                r#" textLength="{width:.2}" lengthAdjust="spacingAndGlyphs""#
            )
            .unwrap();
        }
    } else {
        write!(out, r#"font-family="{family}""#).unwrap();
    }
    write!(out, ">{}</text>", escape_xml_text(label)).unwrap();
}

pub(super) fn render(ctx: &Canvas, face: &str, out: &mut String) -> Option<()> {
    let source = ctx.series(0)?;
    let series = *ctx.data.series.first()?;
    let geography = child(child(source, "layoutPr")?, "geography")?;
    let dataset = dataset_for(ctx.root, source);
    let mut cache = geo_cache::read(child(geography, "geoCache")?, dataset, &series.points)?;
    let dimension = dataset.and_then(crate::chart::map_color_dimension);
    let scale = scale::MapScale::new(ctx, dimension, source, series);
    let format = dimension
        .and_then(|d| child(d, "lvl"))
        .and_then(|l| l.attribute("formatCode"));
    let chart_title = child(ctx.root, "chart").and_then(|c| child(c, "title"));
    let bottom_title = chart_title
        .is_some_and(|n| n.attribute("pos") == Some("b") && n.attribute("overlay") != Some("1"));
    let mut plot = Rect {
        left: 7.,
        right: ctx.width - 7.,
        top: ctx.title_bottom,
        bottom: ctx.height - if bottom_title { 34. } else { 7.2 },
    };
    let mut legend = String::new();
    legend::render(
        ctx,
        &scale.key,
        series.name.as_deref().unwrap_or_default(),
        format,
        face,
        &mut plot,
        &mut legend,
    );
    if plot.width() <= 0. || plot.height() <= 0. {
        return None;
    }
    let bounds = project(&mut cache, geography)?;
    let stroke = ctx
        .colors
        .style_stroke("dataPoint", "#ffffff")
        .unwrap_or_else(|| "#ffffff".into());
    let default_width = outline_width(source)
        .or_else(|| ctx.colors.style_stroke_width("dataPoint"))
        .unwrap_or(1. / 3.);
    let inset = default_width.min(plot.width().min(plot.height()) * 0.25);
    let transform = bounds.fit(
        plot.left + inset,
        plot.top + inset,
        plot.width() - 2. * inset,
        plot.height() - 2. * inset,
    )?;
    write!(out, r##"<defs><clipPath id="mapPlot"><rect x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}"/></clipPath></defs><g clip-path="url(#mapPlot)">"##, plot.left, plot.top, plot.width(), plot.height()).unwrap();
    let point_widths: std::collections::HashMap<u32, f64> = source
        .children()
        .filter(|n| n.has_tag_name((CHARTEX_NS, "dataPt")))
        .filter_map(|n| Some((n.attribute("idx")?.parse().ok()?, outline_width(n)?)))
        .collect();
    let labels = child(source, "dataLabels");
    let label_font = Font::with_defaults(ctx, labels, "#595959", face, 12.);
    let mut label_svg = String::new();
    for region in &cache.regions {
        let idx = region.point_index;
        let fill = idx
            .and_then(|i| scale.fills.get(&i))
            .map_or("#e0e0e0", String::as_str);
        let stroke = idx
            .and_then(|i| ctx.colors.outline(ctx.source_indices[0], Some(i)))
            .unwrap_or(&stroke);
        let width = idx
            .and_then(|i| point_widths.get(&i))
            .copied()
            .unwrap_or(default_width);
        out.push_str("<path");
        if let Some(i) = idx {
            write!(
                out,
                r#" data-docx-series="{}" data-docx-point="{i}""#,
                ctx.source_indices[0]
            )
            .unwrap();
        }
        write!(
            out,
            r#" fill="{fill}" stroke="{stroke}" stroke-width="{width:.3}" fill-rule="evenodd" d=""#
        )
        .unwrap();
        for ring in region.polygons.iter().flatten() {
            draw_ring(out, ring, &transform);
        }
        out.push_str(r#""><title>"#);
        out.push_str(&escape_xml_text(&region.name));
        let point = idx
            .and_then(|i| series.points.binary_search_by_key(&i, |p| p.index).ok())
            .map(|i| &series.points[i]);
        if let Some(value) = point.and_then(|p| p.value.as_deref()) {
            out.push_str(": ");
            out.push_str(&escape_xml_text(value));
            if let Some(pos) = region.center {
                let value = number(Some(value))
                    .map_or_else(|| value.to_owned(), |v| format_value(v, format));
                if let Some(label) =
                    data_label(labels, &region.name, &value, series.name.as_deref())
                {
                    let (x, y) = transform.apply(pos);
                    label_font.text(&mut label_svg, x, y, "middle", &label);
                }
            }
        }
        out.push_str("</title></path>");
    }
    out.push_str(&label_svg);
    let attribution = geography
        .attribute("attribution")
        .unwrap_or_default()
        .trim();
    let mut y = plot.bottom - 2.;
    if !cache.credits.is_empty() {
        credit_text(
            out,
            face,
            plot.right,
            y,
            &format!("© {}", cache.credits.join(", ")),
        );
        y -= 9.28;
    }
    if !attribution.is_empty() {
        credit_text(out, face, plot.right, y, attribution);
    }
    out.push_str("</g>");
    out.push_str(&legend);
    Some(())
}
