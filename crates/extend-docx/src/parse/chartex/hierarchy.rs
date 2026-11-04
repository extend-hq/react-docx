use super::Canvas;
use crate::chart::ChartSeries;
use crate::parse::chart_svg::{font_family, font_size, text_width};
use crate::parse::util::escape_xml_text;
use std::collections::HashMap;
use std::f64::consts::{FRAC_PI_2, PI, TAU};
use std::fmt::Write;

#[derive(Default)]
struct Branch<'a> {
    label: &'a str,
    value: f64,
    first: u32,
    palette: usize,
    children: Vec<usize>,
}

fn hierarchy(series: &ChartSeries) -> (Vec<Branch<'_>>, usize) {
    let mut branches = vec![Branch::default()];
    let levels = series
        .points
        .iter()
        .flat_map(|p| &p.categories)
        .map(|c| c.level)
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    if levels > 64 {
        return (branches, 0);
    }
    let mut path: Vec<Option<&str>> = vec![None; levels];
    let mut lookup = HashMap::new();
    let mut depth = 0;
    for point in &series.points {
        // A new parent starts a new group even if the first child is blank.
        let start = point.categories.iter().map(|c| c.level).max().unwrap_or(0);
        path[..=start].fill(None);
        for category in &point.categories {
            path[category.level] = (!category.label.is_empty()).then_some(category.label.as_str());
        }
        let Some(weight) = point
            .value
            .as_ref()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v > 0.)
        else {
            continue;
        };
        let mut parent = 0;
        let mut count = 0;
        for &label in path.iter().rev().flatten() {
            parent = *lookup.entry((parent, label)).or_insert_with(|| {
                let id = branches.len();
                let palette = if parent == 0 {
                    branches[0].children.len()
                } else {
                    branches[parent].palette
                };
                branches.push(Branch {
                    label,
                    first: point.index,
                    palette,
                    ..Branch::default()
                });
                branches[parent].children.push(id);
                id
            });
            branches[parent].value += weight;
            count += 1;
        }
        if parent != 0 {
            branches[0].value += weight;
            depth = depth.max(count);
        }
    }
    (branches, depth)
}

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

struct Labels {
    font: f64,
    category: bool,
    value: bool,
    parent: bool,
    banner: bool,
}

impl Labels {
    fn label(&self, b: &Branch) -> String {
        match (self.category, self.value) {
            (true, true) => format!("{} {}", b.label, b.value),
            (true, false) => b.label.to_owned(),
            (false, true) => b.value.to_string(),
            _ => String::new(),
        }
    }
}

fn paint<'a>(ctx: &'a Canvas, b: &Branch) -> &'a str {
    if b.children.is_empty() {
        ctx.paint(0, b.first, b.palette)
    } else {
        ctx.colors
            .explicit_fill(ctx.source_indices[0], None)
            .unwrap_or_else(|| ctx.color(b.palette))
    }
}

fn worst_aspect(min: f64, max: f64, sum: f64, side: f64) -> f64 {
    (side * side * max / (sum * sum)).max(sum * sum / (side * side * min))
}

fn treemap(
    ctx: &Canvas,
    tree: &[Branch],
    node: usize,
    mut rect: Rect,
    depth: usize,
    labels: &Labels,
    out: &mut String,
) {
    let b = &tree[node];
    if rect.w <= 0. || rect.h <= 0. {
        return;
    }
    let leaf = b.children.is_empty();
    let color = paint(ctx, b);
    let outline = ctx
        .colors
        .outline(ctx.source_indices[0], leaf.then_some(b.first))
        .unwrap_or("white");
    if leaf || (depth == 1 && labels.banner) {
        let Rect { x, y, w, h } = rect;
        let color = ctx.colors.rectangle_fill(color, b.palette, [x, y, w, h]);
        write!(out,r#"<rect x="{x:.3}" y="{y:.3}" width="{w:.3}" height="{h:.3}" fill="{color}" stroke="{outline}" stroke-width="2"/>"#).unwrap();
    }
    let label = labels.label(b);
    let show_parent = depth == 1 && labels.parent;
    let label_rect = rect;
    if show_parent && labels.banner && !leaf {
        let inset = (labels.font + 7.).min(rect.h);
        rect.y += inset;
        rect.h -= inset;
    }
    if !leaf && rect.h > 0. {
        let area_per_unit = rect.w * rect.h / b.value;
        let mut children = b.children.as_slice();
        while let Some((&first, _)) = children.split_first() {
            let vertical = rect.w >= rect.h;
            let side = if vertical { rect.h } else { rect.w };
            if side <= f64::EPSILON {
                break;
            }
            let largest = tree[first].value * area_per_unit;
            let mut sum = largest;
            let mut count = 1;
            let mut score = worst_aspect(largest, largest, sum, side);
            for &id in &children[1..] {
                let area = tree[id].value * area_per_unit;
                let next = worst_aspect(area, largest, sum + area, side);
                if next > score {
                    break;
                }
                sum += area;
                score = next;
                count += 1;
            }
            let thickness = sum / side;
            let mut pos = if vertical { rect.y } else { rect.x };
            for &id in &children[..count] {
                let extent = tree[id].value * area_per_unit / thickness;
                let cell = if vertical {
                    Rect {
                        x: rect.x,
                        y: pos,
                        w: thickness,
                        h: extent,
                    }
                } else {
                    Rect {
                        x: pos,
                        y: rect.y,
                        w: extent,
                        h: thickness,
                    }
                };
                treemap(ctx, tree, id, cell, depth + 1, labels, out);
                pos += extent;
            }
            if vertical {
                rect.x += thickness;
                rect.w -= thickness;
            } else {
                rect.y += thickness;
                rect.h -= thickness;
            }
            children = &children[count..];
        }
    }
    if (leaf || show_parent)
        && !label.is_empty()
        && label_rect.h > labels.font + 6.
        && label_rect.w > text_width(&label, labels.font) + 9.
    {
        let x = label_rect.x + 5.;
        let y = if leaf {
            label_rect.y + label_rect.h - 7.5
        } else {
            label_rect.y + labels.font + 5.
        };
        write!(
            out,
            r#"<text x="{x:.3}" y="{y:.3}">{}</text>"#,
            escape_xml_text(&label)
        )
        .unwrap();
    }
}

struct Rings {
    cx: f64,
    cy: f64,
    band: f64,
}

impl Rings {
    fn xy(&self, r: f64, theta: f64) -> (f64, f64) {
        (self.cx + r * theta.cos(), self.cy + r * theta.sin())
    }

    fn path(&self, inner: f64, outer: f64, from: f64, to: f64) -> String {
        let (x0, y0) = self.xy(outer, from);
        let (x1, y1) = self.xy(outer, to);
        let (x2, y2) = self.xy(inner, to);
        let (x3, y3) = self.xy(inner, from);
        let (xm, ym) = self.xy(outer, (from + to) / 2.);
        let (xn, yn) = self.xy(inner, (from + to) / 2.);
        format!("M{x0:.3} {y0:.3} A{outer:.3} {outer:.3} 0 0 1 {xm:.3} {ym:.3} A{outer:.3} {outer:.3} 0 0 1 {x1:.3} {y1:.3} L{x2:.3} {y2:.3} A{inner:.3} {inner:.3} 0 0 0 {xn:.3} {yn:.3} A{inner:.3} {inner:.3} 0 0 0 {x3:.3} {y3:.3} Z")
    }
}

struct Arc {
    from: f64,
    to: f64,
    level: usize,
}

fn sunburst(
    ctx: &Canvas,
    tree: &[Branch],
    parent: usize,
    arc: Arc,
    rings: &Rings,
    labels: &Labels,
    out: &mut String,
) {
    let mut angle = arc.from;
    for &id in &tree[parent].children {
        let b = &tree[id];
        let end = angle + (arc.to - arc.from) * (b.value / tree[parent].value);
        let inner = rings.band * arc.level as f64;
        let outer = inner + rings.band;
        let color = paint(ctx, b);
        let outline = ctx
            .colors
            .outline(
                ctx.source_indices[0],
                b.children.is_empty().then_some(b.first),
            )
            .unwrap_or("white");
        let path = rings.path(inner, outer, angle, end);
        write!(
            out,
            r#"<path d="{path}" fill="{color}" stroke="{outline}" stroke-width="2"/>"#
        )
        .unwrap();
        let label = labels.label(b);
        if (b.children.is_empty() || labels.parent) && !label.is_empty() {
            let theta = (angle + end) / 2.;
            let mid = (inner + outer) / 2.;
            if mid * (end - angle) > labels.font && rings.band > labels.font {
                let (x, y) = rings.xy(mid, theta);
                let rotation = if theta.cos() < 0. { theta - PI } else { theta }.to_degrees();
                // Labels run along the radius, so the band thickness bounds each line.
                let mut lines = Vec::new();
                let mut start = 0;
                let mut width = 0.;
                for (i, ch) in label.char_indices() {
                    let mut bytes = [0; 4];
                    let advance = text_width(ch.encode_utf8(&mut bytes), labels.font);
                    if i > start && width + advance > rings.band {
                        lines.push(&label[start..i]);
                        start = i;
                        width = 0.;
                    }
                    width += advance;
                }
                lines.push(&label[start..]);
                if lines.len() as f64 * labels.font < mid * (end - angle) {
                    write!(out,r#"<text transform="translate({x:.3} {y:.3}) rotate({rotation:.3})" text-anchor="middle">"#).unwrap();
                    let offset = (1. - lines.len() as f64) * 0.5 + 0.33;
                    for (i, line) in lines.iter().enumerate() {
                        write!(
                            out,
                            r#"<tspan x="0" y="{:.2}">{}</tspan>"#,
                            (offset + i as f64) * labels.font,
                            escape_xml_text(line)
                        )
                        .unwrap();
                    }
                    out.push_str("</text>");
                }
            }
        }
        sunburst(
            ctx,
            tree,
            id,
            Arc {
                from: angle,
                to: end,
                level: arc.level + 1,
            },
            rings,
            labels,
            out,
        );
        angle = end;
    }
}

pub(super) fn render(ctx: &Canvas, out: &mut String) -> Option<()> {
    let series = ctx.data.series.first()?;
    let sun = match series.chart_type.as_str() {
        "sunburst" => true,
        "treemap" => false,
        _ => return None,
    };
    let (mut tree, depth) = hierarchy(series);
    if depth == 0 || !tree[0].value.is_finite() {
        return Some(());
    }
    let weights: Vec<_> = tree.iter().map(|n| (n.value, n.first)).collect();
    for b in &mut tree {
        b.children.sort_by(|&i, &j| {
            weights[j].0.total_cmp(&weights[i].0).then_with(|| {
                if sun {
                    weights[j].1.cmp(&weights[i].1)
                } else {
                    weights[i].1.cmp(&weights[j].1)
                }
            })
        });
    }
    drop(weights);
    let xml = ctx.series(0)?;
    let data_labels = xml.children().find(|n| n.tag_name().name() == "dataLabels");
    let vis = data_labels.and_then(|l| l.children().find(|n| n.tag_name().name() == "visibility"));
    let enabled = |key| {
        vis.and_then(|v| v.attribute(key))
            .is_some_and(|v| matches!(v, "1" | "true"))
    };
    let layout = xml
        .descendants()
        .find(|n| n.tag_name().name() == "parentLabelLayout")
        .and_then(|n| n.attribute("val"));
    let props = data_labels.and_then(|l| l.descendants().find(|n| n.tag_name().name() == "defRPr"));
    let font = font_size(props, 12.);
    let family = font_family(props, "Cambria");
    let label_fill = props
        .and_then(|p| ctx.colors.shape_fill(p))
        .or_else(|| ctx.colors.style_text("dataLabel", "#ffffff"))
        .unwrap_or_else(|| "#ffffff".into());
    let labels = Labels {
        font,
        category: enabled("categoryName"),
        value: enabled("value"),
        parent: layout != Some("none"),
        banner: layout == Some("banner"),
    };
    let rect = Rect {
        x: 8.,
        y: ctx.title_bottom,
        w: (ctx.width - 16.).max(0.),
        h: (ctx.height - ctx.title_bottom - 8.).max(0.),
    };
    ctx.plot_background(out, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    write!(
        out,
        r#"<g font-family="{family}" font-size="{font:.2}" fill="{label_fill}">"#
    )
    .unwrap();
    if sun {
        let rings = Rings {
            cx: rect.x + rect.w / 2.,
            cy: rect.y + rect.h / 2.,
            band: rect.w.min(rect.h) / 2. / (depth + 1) as f64,
        };
        sunburst(
            ctx,
            &tree,
            0,
            Arc {
                from: -FRAC_PI_2,
                to: TAU - FRAC_PI_2,
                level: 1,
            },
            &rings,
            &labels,
            out,
        );
    } else {
        treemap(ctx, &tree, 0, rect, 0, &labels, out);
    }
    out.push_str("</g>");
    Some(())
}
