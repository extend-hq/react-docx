use super::*;
use crate::chart::ChartPoint;

fn visible<'a>(axis: Option<Node<'a, 'a>>) -> Option<Node<'a, 'a>> {
    axis.filter(|&a| {
        !on(val(Some(a), "delete"))
            && matches!(val(Some(a), "tickLblPos"), Some("nextTo" | "low" | "high"))
    })
}

fn category_axis<'a>(plot: Node<'a, 'a>) -> Option<Node<'a, 'a>> {
    visible(child(plot, "catAx").or_else(|| child(plot, "dateAx")))
}

fn label_value(v: f64, axis: Node) -> String {
    let format = child(axis, "numFmt")
        .and_then(|n| n.attribute("formatCode"))
        .unwrap_or("General");
    if v != 0. && (v.abs() >= 1e10 || format.to_ascii_lowercase().contains("e+")) {
        let exp = v.abs().log10().floor() as i32;
        return format!("{}E{:+}", format_tick(v / 10f64.powi(exp)), exp);
    }
    if format.contains('%') {
        return format!("{}%", format_tick(v * 100.));
    }
    if let Some(decimal) = format.strip_prefix("0.") {
        if decimal.bytes().all(|b| b == b'0') && decimal.len() <= 12 {
            return format!("{v:.prec$}", prec = decimal.len());
        }
    }
    format_tick(v)
}

fn category(p: &ChartPoint) -> String {
    p.categories
        .first()
        .map_or_else(|| (u64::from(p.index) + 1).to_string(), |c| c.label.clone())
}

fn rotated(axis: Node, longest: f64, space: f64) -> f64 {
    let explicit = child(axis, "txPr")
        .and_then(|p| p.children().find(|c| c.tag_name().name() == "bodyPr"))
        .and_then(|p| number(p.attribute("rot")))
        .map(|v| (v / 60_000.).clamp(-90., 90.));
    explicit.unwrap_or(if longest + 4. > space { -45. } else { 0. })
}

fn label_metrics(axis: Node, data: &ChartData, size: f64, width: f64) -> (f64, f64) {
    let s = data.series.first();
    let count = s
        .and_then(|s| s.points.last())
        .map_or(1., |p| f64::from(p.index) + 1.);
    let longest = s
        .into_iter()
        .flat_map(|s| &s.points)
        .map(|p| text_width(&category(p), size))
        .fold(0., f64::max);
    let slots = (count - 1.).max(1.);
    (longest, rotated(axis, longest, width / slots))
}

fn axis_title(axis: Node) -> Option<String> {
    let title = child(axis, "title")?;
    let text = title
        .descendants()
        .filter(|n| n.is_element() && matches!(n.tag_name().name(), "t" | "v"))
        .filter_map(|n| n.text())
        .collect::<String>();
    Some(if text.is_empty() {
        "Axis Title".into()
    } else {
        text
    })
}

pub(super) fn margins(
    _root: Node,
    plot: Node,
    data: &ChartData,
    width: f64,
    height: f64,
    _font: &str,
    size: f64,
    horizontal: bool,
) -> (f64, f64, f64, f64) {
    let mut left = 0.;
    let mut bottom = 0.;
    if let Some(axis) = visible(child(plot, "valAx")) {
        let fs = font_size(text_props(Some(axis), false), size);
        let n = data
            .series
            .iter()
            .flat_map(|s| &s.points)
            .filter_map(|p| number(p.value.as_deref()))
            .map(f64::abs)
            .fold(0., f64::max);
        let width = text_width(&label_value(n.ceil(), axis), fs).max(fs);
        if horizontal {
            bottom += fs * 1.8;
        } else {
            left += width + fs;
        }
        if axis_title(axis).is_some() {
            if horizontal {
                bottom += 1.5 * fs
            } else {
                left += 1.5 * fs
            }
        }
    }
    if let Some(axis) = category_axis(plot) {
        let fs = font_size(text_props(Some(axis), false), size);
        let legend = plot.parent().and_then(|c| child(c, "legend")).filter(|l| {
            !on(val(Some(*l), "overlay"))
                && matches!(val(Some(*l), "legendPos"), Some("l" | "r") | None)
        });
        let legend_width = if legend.is_some() {
            data.series
                .iter()
                .filter_map(|s| s.name.as_deref())
                .map(|s| text_width(s, size))
                .fold(0., f64::max)
                + 2.4 * size
        } else {
            0.
        };
        let (max, angle) = label_metrics(axis, data, fs, (width - left - legend_width) * 0.75);
        if horizontal {
            left += max + fs;
        } else {
            bottom += max * angle.to_radians().sin().abs() + fs * 1.2;
        }
        if axis_title(axis).is_some() {
            if horizontal {
                left += fs * 1.5
            } else {
                bottom += fs * 1.5
            }
        }
    }
    (left.min(width * 0.4), 0., 0., bottom.min(height * 0.4))
}

fn rotated_text(
    out: &mut String,
    pos: Point,
    angle: f64,
    anchor: &str,
    size: f64,
    font: &str,
    label: &str,
) {
    if angle != 0. {
        write!(
            out,
            r#"<g transform="rotate({angle:.2} {:.2} {:.2})">"#,
            pos.x, pos.y
        )
        .unwrap();
    }
    text(out, pos.x, pos.y, anchor, size, font, label);
    if angle != 0. {
        out.push_str("</g>")
    }
}

fn tick(out: &mut String, axis: Node, p: Point, horizontal: bool, colors: &ChartColors) {
    let kind = val(Some(axis), "majorTickMark").unwrap_or("out");
    if kind == "none" {
        return;
    }
    let stroke = child(axis, "spPr")
        .and_then(|sp| colors.shape_stroke(sp))
        .unwrap_or_else(|| "#868686".into());
    let (outside, inside) = match kind {
        "in" => (0., 4.),
        "cross" => (3., 3.),
        _ => (4., 0.),
    };
    if horizontal {
        line(out, p.x, p.y - inside, p.x, p.y + outside, &stroke)
    } else {
        line(out, p.x - outside, p.y, p.x + inside, p.y, &stroke)
    }
}

fn begin_labels(
    out: &mut String,
    axis: Node,
    colors: &ChartColors,
    default: &str,
    size: f64,
) -> (String, f64) {
    let p = text_props(Some(axis), false);
    let fill = p
        .and_then(|n| colors.shape_fill(n))
        .unwrap_or_else(|| "#000000".into());
    write!(out, r#"<g fill="{fill}">"#).unwrap();
    let family = if p.is_some() {
        font_family(p, default.split(',').next().unwrap_or(default))
    } else {
        default.to_owned()
    };
    (family, font_size(p, size))
}

pub(super) fn draw(
    out: &mut String,
    scene: &Scene,
    plot: Node,
    data: &ChartData,
    horizontal: bool,
    font: &str,
    size: f64,
    colors: &ChartColors,
) {
    let front = if scene.rot_y.to_radians().cos() >= 0. {
        0.
    } else {
        1.
    };
    let point = |x, y| {
        if horizontal {
            scene.project(y, x, front)
        } else {
            scene.project(x, y, front)
        }
    };
    if let Some(axis) = visible(child(plot, "valAx")) {
        let (font, fs) = begin_labels(out, axis, colors, font, size);
        let side = if val(Some(axis), "tickLblPos") == Some("high") {
            1.
        } else {
            0.
        };
        let n = ((scene.high - scene.low) / scene.step)
            .round()
            .clamp(0., 160.) as usize;
        let mut max_width = 0f64;
        for i in 0..=n {
            let v = scene.low + i as f64 * scene.step;
            let p = point(side, scene.value(v));
            tick(out, axis, p, horizontal, colors);
            let value = label_value(v, axis);
            max_width = max_width.max(text_width(&value, fs));
            text(
                out,
                p.x + if horizontal {
                    0.
                } else if side == 0. {
                    -fs * 0.6
                } else {
                    fs * 0.6
                },
                p.y + if horizontal { fs * 1.4 } else { fs * 0.32 },
                if horizontal {
                    "middle"
                } else if side == 0. {
                    "end"
                } else {
                    "start"
                },
                fs,
                &font,
                &value,
            );
        }
        if let Some(title) = axis_title(axis) {
            let mid = point(side, 0.5);
            let inner = child(plot, "layout").and_then(|layout| child(layout, "manualLayout"));
            let fixed_plot = val(inner, "layoutTarget") == Some("inner");
            let p = if horizontal {
                Point {
                    x: mid.x,
                    y: mid.y + 3.0 * fs,
                }
            } else {
                let distance = if fixed_plot { fs } else { max_width + 1.4 * fs };
                Point {
                    x: mid.x - distance,
                    y: mid.y + fs * 0.35,
                }
            };
            out.push_str("<g font-weight=\"bold\">");
            rotated_text(
                out,
                p,
                if horizontal { 0. } else { -90. },
                "middle",
                fs,
                &font,
                &title,
            );
            out.push_str("</g>");
        }
        out.push_str("</g>");
    }
    if let Some((axis, s)) = category_axis(plot).zip(data.series.first()) {
        let (font, fs) = begin_labels(out, axis, colors, font, size);
        let a = point(0., 0.);
        let b = point(1., 0.);
        let (longest, angle) = label_metrics(axis, data, fs, (b.x - a.x).hypot(b.y - a.y));
        let max = s.points.last().map_or(0, |p| p.index);
        let between = val(child(plot, "valAx"), "crossBetween").map_or_else(
            || plot.children().any(|n| chart_node(n, "bar3DChart")),
            |v| v == "between",
        );
        let skip = num(Some(axis), "tickLblSkip").unwrap_or(1.).max(1.) as u32;
        let reversed = val(child(axis, "scaling"), "orientation") == Some("maxMin");
        let side = if val(Some(axis), "tickLblPos") == Some("high") {
            1.
        } else {
            0.
        };
        for p in &s.points {
            let x = if between {
                (f64::from(p.index) + 0.5) / (f64::from(max) + 1.)
            } else if max == 0 {
                0.5
            } else {
                f64::from(p.index) / f64::from(max)
            };
            let pos = point(if reversed { 1. - x } else { x }, side);
            if !between {
                tick(out, axis, pos, !horizontal, colors);
            }
            if p.index % skip != 0 {
                continue;
            }
            let offset = num(Some(axis), "lblOffset")
                .unwrap_or(100.)
                .clamp(0., 1000.)
                / 100.;
            let label = category(p);
            if horizontal {
                text(
                    out,
                    pos.x - fs * 0.65 * offset,
                    pos.y + fs * 0.3,
                    "end",
                    fs,
                    &font,
                    &label,
                )
            } else {
                let origin = Point {
                    x: pos.x + if angle < 0. { fs * 0.4 } else { 0. },
                    y: pos.y + fs * 1.25 * offset,
                };
                let anchor = if angle < 0. {
                    "end"
                } else if angle > 0. {
                    "start"
                } else {
                    "middle"
                };
                rotated_text(out, origin, angle, anchor, fs, &font, &label)
            }
        }
        if let Some(title) = axis_title(axis) {
            let mid = point(0.5, side);
            let pos = if horizontal {
                Point {
                    x: mid.x - longest - 1.5 * fs,
                    y: mid.y,
                }
            } else {
                Point {
                    x: mid.x,
                    y: mid.y + 2.6 * fs + longest * angle.to_radians().sin().abs(),
                }
            };
            out.push_str("<g font-weight=\"bold\">");
            rotated_text(
                out,
                pos,
                if horizontal { -90. } else { 0. },
                "middle",
                fs,
                &font,
                &title,
            );
            out.push_str("</g>");
        }
        out.push_str("</g>");
    }
}
