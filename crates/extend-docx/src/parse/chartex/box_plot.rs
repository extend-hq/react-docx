use super::drawing::{format_value, legend, Font, Stroke};
use super::Canvas;
use crate::chart::cx_child as child;
use roxmltree::Node;
use std::collections::HashMap;
use std::fmt::Write;

fn flag(node: Option<Node>, name: &str, default: bool) -> bool {
    node.and_then(|n| n.attribute(name))
        .map_or(default, |v| matches!(v, "1" | "true"))
}

fn number(node: Option<Node>, name: &str) -> Option<f64> {
    node?
        .attribute(name)?
        .parse::<f64>()
        .ok()
        .filter(|x| x.is_finite())
}

fn quantile(values: &[f64], p: f64, inclusive: bool) -> f64 {
    let last = (values.len() - 1) as f64;
    let index = if inclusive {
        last * p
    } else {
        (last + 2.) * p - 1.
    };
    let index = index.clamp(0., last);
    let fraction = index.fract();
    values[index.floor() as usize] * (1. - fraction) + values[index.ceil() as usize] * fraction
}

struct Distribution {
    low: f64,
    q1: f64,
    median: f64,
    q3: f64,
    high: f64,
    mean: f64,
}

impl Distribution {
    fn from_sorted(values: &[f64], inclusive: bool) -> Self {
        let n = values.len();
        let q1 = quantile(values, 0.25, inclusive);
        let q3 = quantile(values, 0.75, inclusive);
        let fence = 1.5 * (q3 - q1);
        let low = values[values.partition_point(|&v| v < q1 - fence)];
        let high = values[values.partition_point(|&v| v <= q3 + fence) - 1];
        Self {
            low,
            q1,
            median: quantile(values, 0.5, true),
            q3,
            high,
            mean: values.iter().map(|v| v / n as f64).sum(),
        }
    }
}

fn shaded(color: &str) -> String {
    let mut out = String::from("#");
    for i in [1, 3, 5] {
        let Some(v) = color
            .get(i..i + 2)
            .and_then(|s| u8::from_str_radix(s, 16).ok())
        else {
            return color.to_owned();
        };
        write!(out, "{:02x}", (f64::from(v) * 0.8).round() as u8).unwrap();
    }
    if let Some(alpha) = color.get(7..) {
        out.push_str(alpha);
    }
    out
}

fn line(out: &mut String, x1: f64, y1: f64, x2: f64, y2: f64, color: &str) {
    write!(
        out,
        r#"<path d="M{x1:.3} {y1:.3}L{x2:.3} {y2:.3}" fill="none" stroke="{color}"/>"#
    )
    .unwrap();
}

fn axis_label(v: f64, code: Option<&str>) -> String {
    if code.is_some_and(|s| !s.is_empty() && s != "General") {
        return format_value(v, code);
    }
    if v == 0. {
        return "0".into();
    }
    if v.abs() >= 1.0e10 || v.abs() < 1.0e-6 {
        format!("{v:.2e}")
    } else {
        format!("{v:.8}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    }
}

pub(super) fn render(ctx: &Canvas, out: &mut String) -> Option<()> {
    let mut categories = Vec::new();
    let mut lookup = HashMap::new();
    let mut boxes = Vec::new();
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for (series_index, series) in ctx
        .data
        .series
        .iter()
        .enumerate()
        .filter(|(_, s)| s.chart_type == "boxWhisker")
    {
        let mut groups = HashMap::<usize, Vec<f64>>::new();
        for point in &series.points {
            let Some(v) = point
                .value
                .as_ref()
                .and_then(|s| s.parse::<f64>().ok())
                .filter(|x| x.is_finite())
            else {
                continue;
            };
            let text = point
                .categories
                .first()
                .map(|c| c.label.as_str())
                .unwrap_or("1");
            let group = *lookup.entry(text).or_insert_with(|| {
                categories.push(text);
                categories.len() - 1
            });
            groups.entry(group).or_default().push(v);
            lo = lo.min(v);
            hi = hi.max(v);
        }
        boxes.push((series_index, groups));
    }
    if categories.is_empty() {
        return Some(());
    }
    let axes: Vec<_> = ctx
        .root
        .descendants()
        .filter(|n| {
            n.is_element()
                && n.tag_name().name() == "axis"
                && n.tag_name().namespace() == ctx.root.tag_name().namespace()
        })
        .collect();
    let cat_axis = axes
        .iter()
        .copied()
        .find(|n| child(*n, "catScaling").is_some());
    let val_axis = axes
        .iter()
        .copied()
        .find(|n| child(*n, "valScaling").is_some());
    let scaling = val_axis.and_then(|n| child(n, "valScaling"));
    let hidden_value = flag(val_axis, "hidden", false);
    let show_y_labels = !hidden_value && val_axis.is_some_and(|n| child(n, "tickLabels").is_some());
    let show_x_labels = !flag(cat_axis, "hidden", false)
        && cat_axis.is_some_and(|n| child(n, "tickLabels").is_some());
    let major_grid = val_axis.is_some_and(|n| child(n, "majorGridlines").is_some());
    let explicit_min = number(scaling, "min");
    let explicit_max = number(scaling, "max");
    let magnitude = lo
        .abs()
        .max(hi.abs())
        .max(explicit_min.unwrap_or(0.).abs())
        .max(explicit_max.unwrap_or(0.).abs());
    let scale = if magnitude == 0. {
        1.
    } else {
        10f64.powf(magnitude.log10().floor().clamp(-307., 307.))
    };
    lo /= scale;
    hi /= scale;
    let wanted_min = explicit_min.map_or(lo.min(0.), |v| v / scale);
    let wanted_max = explicit_max.map_or(hi.max(0.), |v| v / scale);
    let ideal_step = (wanted_max - wanted_min).max(0.1) / 10.;
    let power = 10f64.powf(ideal_step.log10().floor());
    let multiple = [1., 2., 5., 10.]
        .into_iter()
        .find(|m| *m * power >= ideal_step * (1. - 1e-12))
        .unwrap_or(10.);
    let unit = number(scaling, "majorUnit")
        .filter(|v| *v > 0.)
        .map_or(power * multiple, |v| v / scale);
    let lower = explicit_min.map_or_else(|| (wanted_min / unit).floor() * unit, |v| v / scale);
    let upper =
        explicit_max.map_or_else(|| (wanted_max / unit).floor() * unit + unit, |v| v / scale);
    if !unit.is_finite() || unit <= 0. || !lower.is_finite() || !upper.is_finite() || upper <= lower
    {
        return Some(());
    }
    let ticks = (((upper - lower) / unit + 1e-8).floor() as usize).min(500);
    let axis_format = val_axis
        .and_then(|n| child(n, "numFmt"))
        .and_then(|n| n.attribute("formatCode"));
    let value_font = Font::new(ctx, val_axis, "#595959");
    let category_font = Font::new(ctx, cat_axis, "#595959");
    let grid_stroke = Stroke::new(
        ctx,
        val_axis.and_then(|n| child(n, "majorGridlines")),
        "#d9d9d9",
    );
    let value_stroke = Stroke::new(ctx, val_axis, "#d9d9d9");
    let category_stroke = Stroke::new(ctx, cat_axis, "#d9d9d9");
    let widest_label = (0..=ticks)
        .map(|i| value_font.width(&axis_label((lower + unit * i as f64) * scale, axis_format)))
        .fold(0., f64::max);
    let mut left = if show_y_labels {
        16. + widest_label
    } else {
        9.
    };
    let mut right = ctx.width - 9.;
    let mut top = ctx.title_bottom + 6.7;
    let mut bottom = ctx.height
        - if show_x_labels {
            18. + category_font.size
        } else {
            9.
        };
    if child(ctx.root, "chart")
        .and_then(|n| child(n, "legend"))
        .is_some()
    {
        let names: Vec<_> = boxes
            .iter()
            .map(|(i, _)| {
                ctx.data.series[*i]
                    .name
                    .clone()
                    .unwrap_or_else(|| format!("Series {}", ctx.source_indices[*i] + 1))
            })
            .collect();
        let entries: Vec<_> = boxes
            .iter()
            .zip(&names)
            .map(|((i, _), name)| (name.as_str(), ctx.paint(*i, 0, *i)))
            .collect();
        legend(
            ctx,
            out,
            &entries,
            &mut left,
            &mut top,
            &mut right,
            &mut bottom,
        );
    }
    if bottom <= top || right <= left {
        return Some(());
    }
    ctx.plot_background(out, left, top, right, bottom);
    let y_norm = |v: f64| bottom - (v - lower) / (upper - lower) * (bottom - top);
    let y = |v: f64| y_norm(v / scale);
    for i in 0..=ticks {
        let v = lower + i as f64 * unit;
        let line_y = y_norm(v);
        if major_grid {
            grid_stroke.line(out, left, line_y, right, line_y);
        }
        if show_y_labels {
            value_font.text(
                out,
                left - 9.,
                line_y + value_font.size * 0.365,
                "end",
                &axis_label(v * scale, axis_format),
            );
        }
    }
    if !hidden_value {
        value_stroke.line(out, left, bottom, left, top);
    }
    if !flag(cat_axis, "hidden", false) {
        category_stroke.line(out, left, bottom, right, bottom);
    }
    let slot = (right - left) / categories.len() as f64;
    let gap = number(cat_axis.and_then(|n| child(n, "catScaling")), "gapWidth")
        .unwrap_or(1.)
        .clamp(0., 5.);
    let cluster = slot / (1. + gap);
    let (box_width, pitch) = if boxes.len() == 1 {
        ((cluster - 1.).max(0.), cluster)
    } else {
        let pitch = cluster / (boxes.len() as f64 - 0.05);
        (pitch * 0.9, pitch)
    };
    if show_x_labels {
        for (g, category) in categories.iter().enumerate() {
            category_font.text(
                out,
                left + (g as f64 + 0.5) * slot,
                bottom + 8. + category_font.size,
                "middle",
                category,
            );
        }
    }
    write!(out,r#"<defs><clipPath id="box-plot"><rect x="{left}" y="{top}" width="{}" height="{}"/></clipPath></defs><g clip-path="url(#box-plot)">"#,right-left,bottom-top).unwrap();
    for (series_slot, (series_index, groups)) in boxes.into_iter().enumerate() {
        write!(out, r#"<g data-docx-series="{}">"#, ctx.source_indices[series_index]).unwrap();
        let layout = ctx.series(series_index).and_then(|n| child(n, "layoutPr"));
        let visibility = layout.and_then(|n| child(n, "visibility"));
        let inclusive = layout
            .and_then(|n| child(n, "statistics"))
            .and_then(|n| n.attribute("quartileMethod"))
            == Some("inclusive");
        let mut groups: Vec<_> = groups.into_iter().collect();
        groups.sort_unstable_by_key(|(g, _)| *g);
        let mut previous_mean = None;
        for (g, mut values) in groups {
            values.sort_unstable_by(f64::total_cmp);
            let stats = Distribution::from_sorted(&values, inclusive);
            let start =
                left + slot * g as f64 + (slot - cluster) * 0.5 + series_slot as f64 * pitch;
            let end = start + box_width;
            let x = (start + end) * 0.5;
            let source_index = ctx.source_indices[series_index];
            let fill = ctx.paint(series_index, g as u32, series_index);
            let stroke = ctx
                .colors
                .outline(source_index, Some(g as u32))
                .map(str::to_owned)
                .unwrap_or_else(|| shaded(fill));
            let cap = box_width * 0.15;
            for (quartile, whisker) in [(stats.q1, stats.low), (stats.q3, stats.high)] {
                line(out, x, y(quartile), x, y(whisker), &stroke);
                line(out, x - cap, y(whisker), x + cap, y(whisker), &stroke);
            }
            write!(out,r#"<rect x="{start:.3}" y="{:.3}" width="{box_width:.3}" height="{:.3}" fill="{fill}" stroke="{stroke}"/>"#,y(stats.q3),y(stats.q1)-y(stats.q3)).unwrap();
            line(out, start, y(stats.median), end, y(stats.median), &stroke);
            let m = y(stats.mean);
            if flag(visibility, "meanMarker", true) {
                line(out, x - 4., m - 4., x + 4., m + 4., &stroke);
                line(out, x - 4., m + 4., x + 4., m - 4., &stroke);
            }
            if flag(visibility, "meanLine", false) {
                if let Some((prev_x, prev_y)) = previous_mean {
                    line(out, prev_x, prev_y, x, m, &stroke);
                }
                previous_mean = Some((x, m));
            }
            let inner_points = flag(visibility, "nonoutliers", false);
            let outliers = flag(visibility, "outliers", true);
            if inner_points || outliers {
                for value in &values {
                    let outside = *value < stats.low || *value > stats.high;
                    if outside && outliers || !outside && inner_points {
                        write!(
                            out,
                            r#"<circle cx="{x:.3}" cy="{:.3}" r="2.5" fill="{stroke}"/>"#,
                            y(*value)
                        )
                        .unwrap();
                    }
                }
            }
        }
        out.push_str("</g>");
    }
    out.push_str("</g>");
    Some(())
}

#[cfg(test)]
mod tests {
    use super::Distribution;

    #[test]
    fn even_samples_interpolate_quartiles_before_finding_outliers() {
        let values = [1., 2., 3., 4., 9., 16.];
        let exclusive = Distribution::from_sorted(&values, false);
        assert_eq!(
            (exclusive.q1, exclusive.q3, exclusive.high),
            (1.75, 10.75, 16.)
        );
        let inclusive = Distribution::from_sorted(&values, true);
        assert_eq!(
            (inclusive.q1, inclusive.q3, inclusive.high),
            (2.25, 7.75, 16.)
        );
    }
}
