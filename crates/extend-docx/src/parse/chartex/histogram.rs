use super::drawing::{Font, Stroke};
use super::Canvas;
use crate::chart::{cx_child as child, ChartSeries, CHARTEX_NS};
use roxmltree::Node;
use std::collections::HashMap;
use std::fmt::Write;

const MAX_BINS: usize = 4096;

fn number(s: Option<&str>) -> Option<f64> {
    s?.parse::<f64>().ok().filter(|n| n.is_finite())
}

fn label(value: f64) -> String {
    if value.abs() >= 1e12 || (value != 0. && value.abs() < 1e-8) {
        return format!("{value:.4e}");
    }
    format!("{value:.8}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_owned()
}

struct Bin {
    label: String,
    value: f64,
    index: u32,
}

fn grouped_values(series: &ChartSeries) -> Vec<Bin> {
    let mut bins = Vec::<Bin>::new();
    let mut positions = HashMap::new();
    for point in &series.points {
        let Some(value) = number(point.value.as_deref()) else {
            continue;
        };
        let Some(category) = point.categories.iter().min_by_key(|c| c.level) else {
            continue;
        };
        let i = *positions.entry(&category.label).or_insert_with(|| {
            let i = bins.len();
            bins.push(Bin {
                label: category.label.clone(),
                value: 0.,
                index: i as u32,
            });
            i
        });
        bins[i].value += value;
    }
    bins
}

fn rounded_scott_width(values: &[f64]) -> Option<f64> {
    if values.len() < 2 {
        return None;
    }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance =
        values.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (values.len() - 1) as f64;
    let width = 3.5 * variance.sqrt() / (values.len() as f64).cbrt();
    let unit = 10f64.powf(width.log10().floor() - 1.);
    let rounded = (width / unit).round() * unit;
    (rounded > 0. && rounded.is_finite()).then_some(rounded)
}

fn numeric_bins(values: &[f64], binning: Option<Node>) -> Vec<Bin> {
    if values.is_empty() {
        return Vec::new();
    }
    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let under = number(binning.and_then(|n| n.attribute("underflow")));
    let over = number(binning.and_then(|n| n.attribute("overflow")))
        .filter(|v| under.is_none_or(|u| *v > u));
    let left_closed = binning.and_then(|n| n.attribute("intervalClosed")) == Some("l");
    let start = under.unwrap_or(min);
    let limit = over.unwrap_or(max);
    let range = (limit - start).max(0.);
    let requested_count = binning
        .and_then(|n| child(n, "binCount"))
        .and_then(|n| n.text())
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|n| *n > 0);
    let width = binning
        .and_then(|n| child(n, "binSize"))
        .and_then(|n| number(n.text()))
        .filter(|v| *v > 0.)
        .or_else(|| {
            requested_count.map(|n| {
                range
                    / n.saturating_sub(usize::from(under.is_some()) + usize::from(over.is_some()))
                        .max(1) as f64
            })
        })
        .or_else(|| rounded_scott_width(values))
        .filter(|v| *v > 0.)
        .unwrap_or(1.);
    let raw_count = (range / width - 1e-12).ceil().max(1.);
    // Keep an extremely small configured bin width from exhausting the SVG budget.
    if !raw_count.is_finite() || raw_count > MAX_BINS as f64 {
        return Vec::new();
    }
    let mut count = raw_count as usize;
    if left_closed
        && over.is_none()
        && max > start
        && (start + count as f64 * width - max).abs() < width * 1e-12
    {
        count += 1;
    }
    let mut bins = Vec::with_capacity(count + 2);
    if let Some(value) = under {
        bins.push(Bin {
            label: format!("{} {}", if left_closed { "<" } else { "≤" }, label(value)),
            value: 0.,
            index: 0,
        });
    }
    let offset = bins.len();
    for i in 0..count {
        let lo = start + i as f64 * width;
        let mut hi = lo + width;
        if let Some(stop) = over {
            hi = hi.min(stop);
        }
        let opener = if left_closed || (i == 0 && under.is_none()) {
            '['
        } else {
            '('
        };
        let closer = if left_closed { ')' } else { ']' };
        bins.push(Bin {
            label: format!("{opener}{}, {}{closer}", label(lo), label(hi)),
            value: 0.,
            index: bins.len() as u32,
        });
    }
    if let Some(value) = over {
        bins.push(Bin {
            label: format!("{} {}", if left_closed { "≥" } else { ">" }, label(value)),
            value: 0.,
            index: bins.len() as u32,
        });
    }
    for value in values {
        let target = if under.is_some_and(|u| *value < u || (!left_closed && *value == u)) {
            0
        } else if over.is_some_and(|o| *value > o || (left_closed && *value == o)) {
            bins.len() - 1
        } else {
            let ratio = (value - start) / width;
            let snap = ratio.round();
            let ratio = if (snap - ratio).abs() <= 8. * f64::EPSILON * ratio.abs().max(1.) {
                snap
            } else {
                ratio
            };
            let index = if left_closed {
                ratio.floor()
            } else {
                ratio.ceil() - 1.
            };
            offset + (index.max(0.) as usize).min(count - 1)
        };
        bins[target].value += 1.;
    }
    bins
}

struct Scale {
    min: f64,
    max: f64,
    step: f64,
}

impl Scale {
    fn new(min: f64, max: f64, scaling: Option<Node>) -> Self {
        let lo = number(scaling.and_then(|n| n.attribute("min"))).unwrap_or(min.min(0.));
        let auto_hi = max.max(0.);
        let step = number(scaling.and_then(|n| n.attribute("majorUnit")))
            .filter(|v| *v > 0.)
            .unwrap_or_else(|| {
                let raw = ((auto_hi - lo) / 8.).max(f64::MIN_POSITIVE);
                let order = 10f64.powf(raw.log10().floor());
                let factor = [1., 2., 5., 10.]
                    .into_iter()
                    .find(|f| *f * order >= raw)
                    .unwrap_or(10.);
                if min == max && max == 0. {
                    1.
                } else {
                    factor * order
                }
            });
        let hi = number(scaling.and_then(|n| n.attribute("max"))).unwrap_or_else(|| {
            let ceil = (auto_hi / step).ceil() * step;
            if ceil - auto_hi < step * 0.1 {
                ceil + step
            } else {
                ceil
            }
        });
        Self {
            min: lo,
            max: hi.max(lo + step),
            step,
        }
    }

    fn fraction(&self, value: f64) -> f64 {
        ((value - self.min) / (self.max - self.min)).clamp(0., 1.)
    }
}

pub(super) fn render(ctx: &Canvas, out: &mut String) -> Option<()> {
    let series = ctx.data.series.first()?;
    let source = ctx.series(0)?;
    let layout = child(source, "layoutPr");
    let pareto_series = ctx
        .series_nodes
        .iter()
        .position(|n| n.attribute("layoutId") == Some("paretoLine"));
    let pareto = pareto_series.is_some();
    let mut bins = if layout.and_then(|n| child(n, "aggregation")).is_some() {
        grouped_values(series)
    } else {
        let values: Vec<_> = series
            .points
            .iter()
            .filter_map(|p| number(p.value.as_deref()))
            .collect();
        numeric_bins(&values, layout.and_then(|n| child(n, "binning")))
    };
    if bins.is_empty() {
        return Some(());
    }
    if pareto {
        bins.sort_by(|a, b| b.value.total_cmp(&a.value));
    }
    let mut axes = ctx
        .root
        .descendants()
        .filter(|n| n.has_tag_name((CHARTEX_NS, "axis")));
    let category_axis = axes.clone().find(|n| child(*n, "catScaling").is_some());
    let value_axis = axes.find(|n| child(*n, "valScaling").is_some());
    let secondary = axes.find(|n| child(*n, "valScaling").is_some());
    let labels = |axis: Option<Node>| {
        axis.is_some_and(|n| {
            child(n, "tickLabels").is_some() && !matches!(n.attribute("hidden"), Some("1" | "true"))
        })
    };
    let category_labels = labels(category_axis);
    let value_labels = labels(value_axis);
    let percentage_labels = pareto && labels(secondary);
    let value_font = Font::new(ctx, value_axis, "#595959");
    let category_font = Font::new(ctx, category_axis, "#595959");
    let secondary_font = Font::new(ctx, secondary, "#595959");
    let data_labels = child(source, "dataLabels");
    let label_font = Font::new(ctx, data_labels, "#595959");
    let grid_node = value_axis.and_then(|n| child(n, "majorGridlines"));
    let grid_stroke = Stroke::new(ctx, grid_node, "#d9d9d9");
    let value_stroke = Stroke::new(ctx, value_axis, "#d9d9d9");
    let category_stroke = Stroke::new(ctx, category_axis, "#d9d9d9");
    let secondary_stroke = Stroke::new(ctx, secondary, "#d9d9d9");
    let (min, max) = bins
        .iter()
        .map(|b| b.value)
        .fold((0.0_f64, 0.0_f64), |(lo, hi), v| (lo.min(v), hi.max(v)));
    let scale = Scale::new(min, max, value_axis.and_then(|n| child(n, "valScaling")));
    let secondary_scale = Scale::new(0., 1., secondary.and_then(|n| child(n, "valScaling")));
    let left = if value_labels {
        (0.054 * ctx.width).max(10. + 6. * label(scale.max).len() as f64)
    } else {
        8.
    };
    let right = ctx.width - if percentage_labels { 56. } else { 9. };
    let bottom = ctx.height - if category_labels { 30.4 } else { 8. };
    let top = if ctx.data.title.is_some() {
        ctx.title_bottom + if percentage_labels { 8.4 } else { 6.9 }
    } else {
        10.
    };
    if right <= left || bottom <= top || !scale.step.is_finite() || scale.step <= 0. {
        return Some(());
    }
    ctx.plot_background(out, left, top, right, bottom);
    let plot_height = bottom - top;
    let y = |v| bottom - scale.fraction(v) * plot_height;
    let band = (right - left) / bins.len() as f64;
    let gap = number(
        category_axis
            .and_then(|n| child(n, "catScaling"))
            .and_then(|n| n.attribute("gapWidth")),
    )
    .unwrap_or(0.)
    .clamp(0., 5.);
    let bar = band / (1. + gap);
    let total = bins.iter().map(|b| b.value).sum::<f64>();

    let ticks = ((scale.max - scale.min) / scale.step + 1e-8)
        .floor()
        .min(200.) as usize;
    for i in 0..=ticks {
        let value = scale.min + i as f64 * scale.step;
        let pos = y(value);
        if grid_node.is_some() {
            grid_stroke.line(out, left, pos, right, pos);
        }
        if value_labels {
            let code = value_axis
                .and_then(|n| child(n, "numFmt"))
                .and_then(|n| n.attribute("formatCode"));
            let formatted = code.map_or_else(
                || label(value),
                |code| super::drawing::format_value(value, Some(code)),
            );
            value_font.text(
                out,
                left - 9.,
                pos + value_font.size * 0.34,
                "end",
                &formatted,
            );
        }
    }
    let label_format = data_labels
        .and_then(|n| child(n, "numFmt"))
        .and_then(|n| n.attribute("formatCode"));
    for (i, b) in bins.iter().enumerate() {
        let center = left + (i as f64 + 0.5) * band;
        let x = center - bar * 0.5;
        let ypos = y(b.value).min(y(0.));
        let h = (y(b.value) - y(0.)).abs();
        let width = (bar - 0.32).max(0.);
        let fill = ctx
            .colors
            .rectangle_fill(ctx.paint(0, b.index, 0), 0, [x, ypos, width, h]);
        let _ = write!(
            out,
            r#"<rect x="{x:.2}" y="{ypos:.2}" width="{width:.2}" height="{h:.2}" fill="{fill}"/>"#
        );
        if let Some(value) = super::drawing::data_label(
            data_labels,
            &b.label,
            &super::drawing::format_value(b.value, label_format),
            series.name.as_deref(),
        ) {
            let baseline = y(0.);
            let end = y(b.value);
            let towards_end = if b.value >= 0. { -1. } else { 1. };
            let label_y = match data_labels.and_then(|n| n.attribute("pos")) {
                Some("inBase") => baseline + 10. * towards_end,
                Some("inEnd") => end - 10. * towards_end,
                Some("ctr") => (end + baseline) / 2.,
                _ => end + 9. * towards_end,
            };
            label_font.text(
                out,
                center,
                label_y + label_font.size * 0.34,
                "middle",
                &value,
            );
        }
        if category_labels {
            let stride = ((category_font.width(&b.label) + 3.) / band).ceil().max(1.) as usize;
            if i % stride == 0 {
                category_font.text(
                    out,
                    center,
                    bottom + 8.3 + category_font.size,
                    "middle",
                    &b.label,
                );
            }
        }
    }
    if value_axis.is_some_and(|n| !matches!(n.attribute("hidden"), Some("1" | "true"))) {
        value_stroke.line(out, left, top, left, bottom);
    }
    if category_axis.is_some_and(|n| !matches!(n.attribute("hidden"), Some("1" | "true"))) {
        category_stroke.line(out, left, bottom, right, bottom);
    }
    if pareto && total > 0. {
        let mut cumulative = 0.;
        let mut path = String::new();
        for (i, b) in bins.iter().enumerate() {
            cumulative += b.value;
            let x = left + (i as f64 + 0.5) * band;
            let y = bottom - plot_height * secondary_scale.fraction(cumulative / total);
            let _ = write!(path, "{} {x:.2} {y:.2}", if i == 0 { "M" } else { "L" });
        }
        let fill = ctx.stroke(pareto_series.unwrap_or(0));
        let _ = write!(
            out,
            r#"<path d="{path}" fill="none" stroke="{fill}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>"#
        );
        if percentage_labels {
            secondary_stroke.line(out, right, top, right, bottom);
            let major = number(
                secondary
                    .and_then(|n| child(n, "valScaling"))
                    .and_then(|n| n.attribute("majorUnit")),
            )
            .filter(|v| *v > 0.)
            .unwrap_or((secondary_scale.max - secondary_scale.min) / 10.);
            let count = ((secondary_scale.max - secondary_scale.min) / major + 1e-8)
                .floor()
                .min(200.) as usize;
            for i in 0..=count {
                let value = secondary_scale.min + i as f64 * major;
                secondary_font.text(
                    out,
                    right + 8.,
                    bottom - secondary_scale.fraction(value) * plot_height + 4.1,
                    "start",
                    &format!("{}%", label(value * 100.)),
                );
            }
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_bins_use_sample_variance_and_round_the_displayed_width() {
        let bins = numeric_bins(&[12., 10., 11., 13., 15.], None);
        let summary: Vec<_> = bins.iter().map(|b| (b.label.as_str(), b.value)).collect();
        assert_eq!(summary, [("[10, 13.9]", 4.), ("(13.9, 17.8]", 1.)]);
    }

    #[test]
    fn boundary_observations_only_belong_to_one_bin() {
        for (closed, expected) in [("r", [2., 2., 2., 1.]), ("l", [1., 2., 2., 2.])] {
            let xml = format!(
                r#"<cx:binning xmlns:cx="{CHARTEX_NS}" intervalClosed="{closed}" underflow="0" overflow="4"><cx:binCount>4</cx:binCount></cx:binning>"#
            );
            let doc = roxmltree::Document::parse(&xml).unwrap();
            let bins = numeric_bins(&[-1., 0., 1., 2., 3., 4., 5.], Some(doc.root_element()));
            assert_eq!(bins.iter().map(|b| b.value).collect::<Vec<_>>(), expected);
        }
    }
}
