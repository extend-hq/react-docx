use super::drawing::{data_label, format_value, legend, Font, Stroke};
use super::Canvas;
use crate::{
    chart::{cx_child as child, ChartPoint},
    parse::chart_svg::{number as numeric, on},
};
use roxmltree::Node;
use std::{
    collections::{HashMap, HashSet},
    fmt::Write,
};

fn enabled(node: Node, flag: &str) -> bool {
    on(node.attribute(flag))
}

fn labels(axis: Option<Node>) -> bool {
    axis.is_some_and(|a| !enabled(a, "hidden") && child(a, "tickLabels").is_some())
}

struct Outlines {
    series_width: f64,
    point_widths: HashMap<u32, f64>,
}
impl Outlines {
    fn new(series: Node) -> Self {
        let width = |n| {
            child(n, "spPr")?
                .children()
                .find(|n| n.tag_name().name() == "ln")
                .and_then(|n| numeric(n.attribute("w")))
                .map(|w| (w / 9525.).max(0.))
        };
        let point_widths = series
            .children()
            .filter(|n| n.tag_name().name() == "dataPt")
            .filter_map(|n| Some((n.attribute("idx")?.parse().ok()?, width(n)?)))
            .collect();
        Self {
            series_width: width(series).unwrap_or(1.),
            point_widths,
        }
    }
    fn paint<'a>(&self, ctx: &'a Canvas, series: usize, point: u32) -> Option<(&'a str, f64)> {
        Some((
            ctx.colors.outline(series, Some(point))?,
            self.point_widths
                .get(&point)
                .copied()
                .unwrap_or(self.series_width),
        ))
    }
}

fn rect(
    out: &mut String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    color: &str,
    stroke: Option<(&str, f64)>,
) {
    if width > 0. && height > 0. {
        write!(
            out,
            r#"<rect x="{x:.2}" y="{y:.2}" width="{width:.2}" height="{height:.2}" fill="{color}""#
        )
        .unwrap();
        if let Some((color, width)) =
            stroke.filter(|(color, width)| *color != "none" && *width > 0.)
        {
            write!(out, r#" stroke="{color}" stroke-width="{width:.2}""#).unwrap();
        }
        out.push_str("/>");
    }
}

fn axis_format<'a>(axis: Option<Node<'a, 'a>>) -> Option<&'a str> {
    child(axis?, "numFmt")?.attribute("formatCode")
}

fn category(point: &ChartPoint, axis: Option<Node>) -> String {
    point
        .categories
        .iter()
        .min_by_key(|item| item.level)
        .map(|c| c.label.clone())
        .unwrap_or_else(|| format_value(f64::from(point.index) + 1., axis_format(axis)))
}

struct ChartAxes<'a> {
    cat: Option<Node<'a, 'a>>,
    val: Option<Node<'a, 'a>>,
}

impl<'a> ChartAxes<'a> {
    fn new(root: Node<'a, 'a>) -> Self {
        let axis = |name| {
            root.descendants()
                .find(|n| n.tag_name().name() == "axis" && child(*n, name).is_some())
        };
        Self {
            cat: axis("catScaling"),
            val: axis("valScaling"),
        }
    }
    fn gap_width(&self, default: f64) -> f64 {
        self.cat
            .and_then(|a| child(a, "catScaling"))
            .and_then(|c| numeric(c.attribute("gapWidth")))
            .unwrap_or(default)
            .clamp(0., 5.)
    }
}

fn funnel(ctx: &Canvas, series_index: usize, out: &mut String) -> Option<()> {
    let data = ctx.data.series.get(series_index)?;
    let series = ctx.series(series_index)?;
    let outlines = Outlines::new(series);
    let axes = ChartAxes::new(ctx.root);
    let font = Font::new(ctx, axes.cat, "#595959");
    let axis_stroke = Stroke::new(ctx, axes.cat, "#d9d9d9");
    let labels_on = labels(axes.cat);
    let widest_label = if labels_on {
        data.points
            .iter()
            .map(|p| font.width(&category(p, axes.cat)))
            .fold(0., f64::max)
    } else {
        0.
    };
    let left = if labels_on { 15. + widest_label } else { 9. };
    let right = ctx.width - 9.;
    let top = ctx.title_bottom + 1.;
    let bottom = ctx.height - 9.;
    if right <= left || bottom <= top {
        return Some(());
    }
    ctx.plot_background(out, left, top, right, bottom);
    let count = data.points.last().map_or(0., |p| f64::from(p.index) + 1.);
    let max = data
        .points
        .iter()
        .filter_map(|p| numeric(p.value.as_deref()))
        .fold(0., f64::max);
    if count == 0. {
        return Some(());
    }
    let stride = (bottom - top) / count;
    let bar_height = stride / (1. + axes.gap_width(0.1));
    let tick = axes
        .cat
        .filter(|a| !enabled(*a, "hidden"))
        .and_then(|a| child(a, "majorTickMarks"))
        .and_then(|n| n.attribute("type"))
        .unwrap_or("none");
    let center = (right + left) * 0.5;
    let label_props = child(series, "dataLabels");
    let data_font = Font::new(ctx, label_props, "#fefefe");
    for p in &data.points {
        let cy = top + (f64::from(p.index) + 0.5) * stride;
        let label = category(p, axes.cat);
        if labels_on {
            font.text(out, left - 8., cy + font.size * 0.35, "end", &label);
        }
        if let Some(value) = numeric(p.value.as_deref()).filter(|x| *x > 0.) {
            let width = if max > 0. {
                value / max * (right - left)
            } else {
                0.
            };
            let fill = ctx.paint(series_index, p.index, 0);
            rect(
                out,
                center - width / 2.,
                cy - bar_height / 2.,
                width,
                bar_height,
                fill,
                outlines.paint(ctx, series_index, p.index),
            );
            if let Some(s) = data_label(
                label_props,
                &label,
                &format_value(
                    value,
                    label_props
                        .and_then(|p| child(p, "numFmt"))
                        .and_then(|n| n.attribute("formatCode")),
                ),
                data.name.as_deref(),
            ) {
                data_font.text(out, center, cy + data_font.size * 0.367, "middle", &s);
            }
        }
        if tick != "none" {
            let y = cy - stride / 2.;
            let (a, b) = match tick {
                "out" => (-4., 0.),
                "cross" => (-2., 2.),
                _ => (0., 4.),
            };
            axis_stroke.line(out, left + a, y, left + b, y);
        }
    }
    if axes.cat.is_some_and(|a| !enabled(a, "hidden")) {
        axis_stroke.line(out, left, top, left, bottom);
        if tick != "none" {
            let (a, b) = match tick {
                "out" => (-4., 0.),
                "cross" => (-2., 2.),
                _ => (0., 4.),
            };
            axis_stroke.line(out, left + a, bottom, left + b, bottom);
        }
    }
    Some(())
}

struct Bar<'a> {
    point: &'a ChartPoint,
    from: f64,
    to: f64,
    value: f64,
    palette: usize,
}

fn waterfall(ctx: &Canvas, series_index: usize, out: &mut String) -> Option<()> {
    let data = ctx.data.series.get(series_index)?;
    let series = ctx.series(series_index)?;
    let outlines = Outlines::new(series);
    let layout = child(series, "layoutPr");
    let totals: HashSet<u32> = layout
        .and_then(|l| child(l, "subtotals"))
        .into_iter()
        .flat_map(|n| n.children())
        .filter(|n| n.tag_name().name() == "idx")
        .filter_map(|n| n.attribute("val")?.parse().ok())
        .collect();
    let show_connectors = layout
        .and_then(|l| child(l, "visibility"))
        .and_then(|n| n.attribute("connectorLines"))
        .is_none_or(|s| !matches!(s, "0" | "false"));
    let mut running = 0.;
    let mut bars = Vec::new();
    for point in &data.points {
        let Some(value) = numeric(point.value.as_deref()) else {
            continue;
        };
        let total = totals.contains(&point.index);
        let from = if total { 0. } else { running };
        let to = from + value;
        if !to.is_finite() {
            return None;
        }
        running = to;
        bars.push(Bar {
            point,
            from,
            to,
            value,
            palette: if total { 2 } else { usize::from(value < 0.) },
        });
    }
    let axes = ChartAxes::new(ctx.root);
    let font = Font::new(ctx, axes.val, "#595959");
    let val_stroke = Stroke::new(ctx, axes.val, "#d9d9d9");
    let cat_stroke = Stroke::new(ctx, axes.cat, "#d9d9d9");
    let grid_stroke = Stroke::new(
        ctx,
        axes.val.and_then(|a| child(a, "majorGridlines")),
        "#d9d9d9",
    );
    let cat_font = Font::new(ctx, axes.cat, "#595959");
    let mut top = ctx.title_bottom
        + 1.
        + if labels(axes.val) {
            0.48 * font.size
        } else {
            0.
        };
    let mut bottom = ctx.height
        - 9.
        - if labels(axes.cat) {
            cat_font.size + 9.
        } else {
            0.
        };
    let mut left = 9.;
    let mut right = ctx.width - 9.;
    let legend_entries = [
        ("Increase", ctx.color(0)),
        ("Decrease", ctx.color(1)),
        ("Total", ctx.color(2)),
    ];
    legend(
        ctx,
        out,
        &legend_entries,
        &mut left,
        &mut top,
        &mut right,
        &mut bottom,
    );
    let raw_min = bars.iter().map(|b| b.from.min(b.to)).fold(0., f64::min);
    let raw_max = bars.iter().map(|b| b.from.max(b.to)).fold(0., f64::max);
    let scale = axes.val.and_then(|a| child(a, "valScaling"));
    let manual = |k| scale.and_then(|n| numeric(n.attribute(k)));
    let raw_min = manual("min").unwrap_or(raw_min);
    let raw_max = manual("max").unwrap_or(raw_max);
    let span = raw_max - raw_min;
    if !span.is_finite() {
        return None;
    }
    let target = (span / ((bottom - top) / 28.).clamp(2., 12.)).max(f64::MIN_POSITIVE);
    let power = 10f64.powf(target.log10().floor());
    let ratio = target / power;
    let unit = manual("majorUnit").filter(|v| *v > 0.).unwrap_or_else(|| {
        if span <= 0. {
            1.
        } else {
            power
                * if ratio < 1.5 {
                    1.
                } else if ratio < 3. {
                    2.
                } else if ratio < 7. {
                    5.
                } else {
                    10.
                }
        }
    });
    let low = manual("min").unwrap_or_else(|| {
        if raw_min < 0. {
            ((raw_min / unit).ceil() - 1.) * unit
        } else {
            0.
        }
    });
    let mut high = manual("max").unwrap_or_else(|| ((raw_max / unit).floor() + 1.) * unit);
    if high <= low {
        high = low + unit;
    }
    if !high.is_finite() || !low.is_finite() || !(high > low) {
        return Some(());
    }
    if labels(axes.val) {
        let text_width = |n| font.width(&format_value(n, axis_format(axes.val)));
        left += text_width(low).max(text_width(high)) + 7.;
    }
    if right <= left || bottom <= top {
        return Some(());
    }
    ctx.plot_background(out, left, top, right, bottom);
    let ordinate = |v: f64| bottom - (v.clamp(low, high) - low) / (high - low) * (bottom - top);
    let ticks = (((high - low) / unit).ceil() as usize).min(150);
    for i in 0..=ticks {
        let value = low + i as f64 * unit;
        if value > high + unit * 1e-8 {
            break;
        }
        let y = ordinate(value);
        if axes
            .val
            .is_some_and(|a| child(a, "majorGridlines").is_some())
        {
            grid_stroke.line(out, left, y, right, y);
        }
        if labels(axes.val) {
            font.text(
                out,
                left - 8.,
                y + font.size * 0.37,
                "end",
                &format_value(value, axis_format(axes.val)),
            );
        }
    }
    if axes.val.is_some_and(|a| !enabled(a, "hidden")) {
        val_stroke.line(out, left, bottom, left, top);
    }
    if axes.cat.is_some_and(|a| !enabled(a, "hidden")) {
        cat_stroke.line(out, left, bottom, right, bottom);
    }
    let count = data.points.last().map_or(0., |p| f64::from(p.index) + 1.);
    if count == 0. {
        return Some(());
    }
    let stride = (right - left) / count;
    let width = stride / (1. + axes.gap_width(0.5));
    let abscissa = |p: &ChartPoint| left + (f64::from(p.index) + 0.5) * stride;
    for p in &data.points {
        if labels(axes.cat) {
            cat_font.text(
                out,
                abscissa(p),
                bottom + cat_font.size + 8.,
                "middle",
                &category(p, axes.cat),
            );
        }
    }
    let label_props = child(series, "dataLabels");
    let data_font = Font::new(ctx, label_props, "#595959");
    let connector_stroke = Stroke::new(
        ctx,
        layout.and_then(|n| child(n, "connectorLines")),
        "#d9d9d9",
    );
    let mut previous = None;
    for b in &bars {
        let x = abscissa(b.point);
        let y = ordinate(b.to);
        let start = ordinate(b.from);
        if show_connectors {
            if let Some((end, y)) = previous {
                connector_stroke.line(out, end, y, x - width / 2., y);
            }
        }
        previous = Some((x + width / 2., y));
        let fill = ctx.colors.rectangle_fill(
            ctx.paint(series_index, b.point.index, b.palette),
            b.palette,
            [x - width / 2., y.min(start), width, (y - start).abs()],
        );
        rect(
            out,
            x - width / 2.,
            y.min(start),
            width,
            (y - start).abs(),
            &fill,
            outlines.paint(ctx, series_index, b.point.index),
        );
        let value = format_value(
            b.value,
            label_props
                .and_then(|p| child(p, "numFmt"))
                .and_then(|n| n.attribute("formatCode")),
        );
        if let Some(label) = data_label(
            label_props,
            &category(b.point, axes.cat),
            &value,
            data.name.as_deref(),
        ) {
            let baseline = match label_props
                .and_then(|n| n.attribute("pos"))
                .unwrap_or("outEnd")
            {
                "ctr" => (y + start) / 2. + 4.,
                "inBase" => {
                    if y <= start {
                        start - 3.
                    } else {
                        start + 11.
                    }
                }
                "inEnd" => {
                    if y <= start {
                        y + 11.
                    } else {
                        y - 3.
                    }
                }
                _ => {
                    if y <= start {
                        y - 2.5
                    } else {
                        (y + 12.).min(bottom - 1.)
                    }
                }
            };
            data_font.text(out, x, baseline, "middle", &label);
        }
    }
    Some(())
}

pub(super) fn render(ctx: &Canvas, out: &mut String) -> Option<()> {
    for (index, series) in ctx.data.series.iter().enumerate() {
        if ctx.series(index).is_some_and(|n| enabled(n, "hidden")) {
            continue;
        }
        match series.chart_type.as_str() {
            "waterfall" => return waterfall(ctx, index, out),
            "funnel" => return funnel(ctx, index, out),
            _ => (),
        }
    }
    None
}
