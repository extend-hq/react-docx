use super::chart_colors::ChartColors;
use super::util::escape_xml_text;
use crate::chart::{cx_child, ChartData, ChartSeries, CHARTEX_NS};
use roxmltree::Node;
use std::fmt::Write;

mod box_plot;
mod drawing;
mod flow;
mod geo_cache;
mod hierarchy;
mod histogram;
mod map_projection;
mod region_map;

struct VisibleData<'a> {
    title: Option<&'a str>,
    series: Vec<&'a ChartSeries>,
}

struct PaletteEntry {
    automatic: String,
    point_fill: Option<String>,
}

struct Canvas<'a, 'input> {
    width: f64,
    height: f64,
    title_bottom: f64,
    root: Node<'a, 'input>,
    data: VisibleData<'a>,
    source_indices: Vec<usize>,
    series_nodes: Vec<Node<'a, 'input>>,
    palette: Vec<PaletteEntry>,
    colors: &'a ChartColors,
}

impl<'a, 'input> Canvas<'a, 'input> {
    fn color(&self, index: usize) -> &str {
        let entry = &self.palette[index % self.palette.len()];
        entry.point_fill.as_deref().unwrap_or(&entry.automatic)
    }

    fn paint(&self, series: usize, point: u32, palette: usize) -> &str {
        self.colors
            .explicit_fill(self.source_indices[series], Some(point))
            .unwrap_or_else(|| self.color(palette))
    }

    fn stroke(&self, series: usize) -> String {
        if let Some(outline) = self.colors.outline(self.source_indices[series], None) {
            return outline.to_owned();
        }
        let automatic = &self.palette[series].automatic;
        self.colors
            .style_stroke("dataPointLine", automatic)
            .unwrap_or_else(|| automatic.clone())
    }

    fn plot_background(&self, out: &mut String, left: f64, top: f64, right: f64, bottom: f64) {
        let props = cx_child(self.root, "chart")
            .and_then(|chart| cx_child(chart, "plotArea"))
            .and_then(|plot| cx_child(plot, "spPr"));
        let fill = props
            .and_then(|p| self.colors.shape_fill(p))
            .or_else(|| self.colors.style_fill("plotArea", "none"));
        let stroke = props
            .and_then(|p| self.colors.shape_stroke(p))
            .or_else(|| self.colors.style_stroke("plotArea", "none"));
        if fill.is_some() || stroke.is_some() {
            write!(
                out,
                r#"<rect x="{left}" y="{top}" width="{}" height="{}" fill="{}" stroke="{}"/>"#,
                (right - left).max(0.),
                (bottom - top).max(0.),
                fill.as_deref().unwrap_or("none"),
                stroke.as_deref().unwrap_or("none")
            )
            .unwrap();
        }
    }

    fn series(&self, index: usize) -> Option<Node<'a, 'input>> {
        self.series_nodes.get(index).copied()
    }
}

pub(super) fn render(
    root: Node,
    data: &ChartData,
    colors: &ChartColors,
    width: f64,
    height: f64,
    minor_font: Option<&str>,
) -> Option<String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return None;
    }
    let chart = cx_child(root, "chart")?;
    let plot = cx_child(cx_child(chart, "plotArea")?, "plotAreaRegion")?;
    let series_nodes: Vec<_> = plot
        .children()
        .filter(|s| s.has_tag_name((CHARTEX_NS, "series")) && s.attribute("layoutId").is_some())
        .collect();
    let primary_kind = |nodes: &[Node]| {
        nodes
            .iter()
            .filter_map(|n| n.attribute("layoutId"))
            .find(|kind| *kind != "paretoLine")
            .map(str::to_owned)
    };
    let first_kind = primary_kind(&series_nodes)?;
    let (source_indices, series_nodes): (Vec<_>, Vec<_>) = series_nodes
        .into_iter()
        .enumerate()
        .filter(|(_, s)| !matches!(s.attribute("hidden"), Some("1" | "true")))
        .unzip();
    let visible_kind = primary_kind(&series_nodes);
    let kind = visible_kind.as_deref().unwrap_or(&first_kind);
    if !matches!(
        kind,
        "treemap"
            | "sunburst"
            | "waterfall"
            | "funnel"
            | "clusteredColumn"
            | "boxWhisker"
            | "regionMap"
    ) {
        return None;
    }
    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" font-family="Calibri, Carlito, Arial, sans-serif">"#
    );
    let props = cx_child(root, "spPr");
    let background = props
        .and_then(|p| colors.shape_fill(p))
        .or_else(|| colors.style_fill("chartArea", "#ffffff"))
        .unwrap_or_else(|| "#ffffff".to_owned());
    let border = props
        .and_then(|p| colors.shape_stroke(p))
        .or_else(|| colors.style_stroke("chartArea", "#d9d9d9"))
        .unwrap_or_else(|| "#d9d9d9".to_owned());
    write!(
        svg,
        r#"<rect width="{width}" height="{height}" fill="{background}" stroke="{border}"/>"#
    )
    .unwrap();
    let map_font = (kind == "regionMap").then_some(minor_font.unwrap_or("Cambria"));
    let title_bottom = render_title(&mut svg, chart, data, colors, width, height, map_font);
    let data = VisibleData {
        title: data.title.as_deref(),
        series: source_indices
            .iter()
            .filter_map(|i| data.series.get(*i))
            .collect(),
    };
    if data.series.is_empty()
        || (kind != "regionMap" && data.series.iter().all(|s| s.points.is_empty()))
    {
        svg.push_str("</svg>");
        return Some(svg);
    }
    let mut palette_size = match kind {
        "waterfall" => 4,
        _ => series_nodes.len().max(1),
    };
    if matches!(kind, "treemap" | "sunburst") {
        if let Some(series) = data.series.first() {
            if let Some(top_level) = series
                .points
                .iter()
                .flat_map(|p| p.categories.iter().map(|c| c.level))
                .max()
            {
                palette_size = palette_size.max(
                    series
                        .points
                        .iter()
                        .filter(|p| p.categories.iter().any(|c| c.level == top_level))
                        .count(),
                );
            }
        }
    }
    let palette_indices: Vec<usize> = if matches!(kind, "clusteredColumn" | "boxWhisker") {
        series_nodes
            .iter()
            .zip(&source_indices)
            .map(|(node, source)| {
                node.attribute("formatIdx")
                    .and_then(|value| value.parse::<u32>().ok())
                    .map_or(*source, |index| index as usize)
            })
            .collect()
    } else {
        (0..palette_size).collect()
    };
    let highest = palette_indices.iter().copied().max().unwrap_or(0);
    let palette = palette_indices
        .into_iter()
        .map(|index| {
            let automatic = colors.palette(index, highest);
            let point_fill = colors.style_point_fill(&automatic);
            PaletteEntry {
                automatic,
                point_fill,
            }
        })
        .collect();
    let ctx = Canvas {
        width,
        height,
        root,
        data,
        title_bottom,
        source_indices,
        series_nodes,
        palette,
        colors,
    };
    match kind {
        "treemap" | "sunburst" => hierarchy::render(&ctx, &mut svg),
        "waterfall" | "funnel" => flow::render(&ctx, &mut svg),
        "clusteredColumn" => histogram::render(&ctx, &mut svg),
        "boxWhisker" => box_plot::render(&ctx, &mut svg),
        "regionMap" => region_map::render(&ctx, map_font?, &mut svg),
        _ => return None,
    }?;
    svg.push_str("</svg>");
    Some(svg)
}

fn render_title(
    svg: &mut String,
    chart: Node,
    data: &ChartData,
    colors: &ChartColors,
    width: f64,
    height: f64,
    map_font: Option<&str>,
) -> f64 {
    let inset = if map_font.is_some() { 7. } else { 8. };
    let Some((title, value)) = cx_child(chart, "title").zip(data.title.as_deref()) else {
        return inset;
    };
    let properties = title
        .descendants()
        .filter(|n| matches!(n.tag_name().name(), "rPr" | "defRPr"));
    let size = properties
        .clone()
        .find_map(|n| n.attribute("sz")?.parse::<u32>().ok())
        .map(|v| f64::from(v) / 75.)
        .filter(|p| *p > 0.)
        .or_else(|| map_font.and_then(|_| colors.style_font_size("title")))
        .unwrap_or(56. / 3.)
        .clamp(1., 512.);
    let fill = properties
        .clone()
        .find_map(|n| colors.shape_fill(n))
        .or_else(|| colors.style_text("title", "#595959"))
        .unwrap_or_else(|| "#595959".into());
    let font = properties
        .clone()
        .find_map(|n| {
            n.children()
                .find(|e| e.tag_name().name() == "latin")?
                .attribute("typeface")
        })
        .filter(|font| !font.starts_with('+'))
        .unwrap_or(map_font.unwrap_or("Calibri"));
    let fallback =
        if map_font.is_some() && matches!(font, "Cambria" | "Georgia" | "Times New Roman") {
            "Georgia, Times New Roman, serif"
        } else {
            "Carlito, Arial, sans-serif"
        };
    let bold = properties
        .clone()
        .any(|n| matches!(n.attribute("b"), Some("1" | "true")));
    let italic = properties
        .clone()
        .any(|n| matches!(n.attribute("i"), Some("1" | "true")));
    let bottom = title.attribute("pos") == Some("b");
    let (x, anchor) = match title.attribute("align") {
        Some("l") => (inset, "start"),
        Some("r") => (width - inset, "end"),
        _ => (width / 2., "middle"),
    };
    let y = if bottom {
        height - inset
    } else {
        inset + size * if map_font.is_some() { 0.96 } else { 0.94 }
    };
    write!(svg, r#"<text x="{x:.3}" y="{y:.3}" text-anchor="{anchor}" font-family="{}, {fallback}" font-size="{size:.3}" font-weight="{}" font-style="{}" fill="{fill}">{}</text>"#,
        escape_xml_text(font), if bold {"bold"} else {"normal"}, if italic {"italic"} else {"normal"},escape_xml_text(value)).unwrap();
    if bottom || matches!(title.attribute("overlay"), Some("1" | "true")) {
        inset
    } else {
        inset + size * if map_font.is_some() { 1.44 } else { 1.46 }
    }
}
