//! Two-dimensional plots with category or numeric axes.
#[path = "cartesian_marks.rs"]
mod marks;

use super::chart_colors::ChartColors;
use super::chart_svg::{font_family, font_size, line, number, text_props, text_width, val};
use super::util::escape_xml_text;
use crate::chart::{chart_node, child, ChartData, ChartSeries};
use roxmltree::Node;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write;

fn truth(value: &str) -> bool {
    matches!(value, "true" | "1" | "on")
}

fn flag(node: Option<Node>, key: &str, default: bool) -> bool {
    node.and_then(|n| child(n, key))
        .map_or(default, |n| n.attribute("val").is_none_or(truth))
}

#[derive(Clone, Copy)]
struct Extent {
    lo: f64,
    hi: f64,
}
impl Default for Extent {
    fn default() -> Self {
        Self {
            lo: f64::INFINITY,
            hi: f64::NEG_INFINITY,
        }
    }
}
impl Extent {
    fn record(&mut self, n: f64) {
        if n.is_finite() {
            self.lo = self.lo.min(n);
            self.hi = self.hi.max(n);
        }
    }
    fn merge(&mut self, other: Self) {
        self.record(other.lo);
        self.record(other.hi);
    }
}

#[derive(Clone, Copy)]
struct Scale {
    low: f64,
    high: f64,
    unit: f64,
    multiplier: f64,
    log: Option<f64>,
    reversed: bool,
}
impl Scale {
    fn new(
        range: Extent,
        axis: Option<Node>,
        max_intervals: f64,
        zero_baseline: bool,
        percent: bool,
    ) -> Self {
        let scale = axis.and_then(|n| child(n, "scaling"));
        let min = number(val(scale, "min"));
        let max = number(val(scale, "max"));
        let log = number(val(scale, "logBase")).filter(|v| (2. ..=1000.).contains(v));
        let reversed = val(scale, "orientation") == Some("maxMin");
        if let Some(base) = log {
            let upper = max.filter(|v| *v > 0.).unwrap_or(range.hi.max(base));
            let lower =
                min.filter(|v| *v > 0.)
                    .unwrap_or(if range.lo > 0. { range.lo } else { 1. });
            let low = if min.is_some() {
                lower.log(base)
            } else {
                lower.log(base).floor()
            };
            let high = if max.is_some() {
                upper.log(base)
            } else {
                upper.log(base).ceil()
            };
            return Self {
                low,
                high: if high > low { high } else { low + 1. },
                unit: 1.,
                multiplier: 1.,
                log,
                reversed,
            };
        }
        let empty = range.lo > range.hi;
        let (raw_low, raw_high) = if empty {
            (0., 1.)
        } else {
            (range.lo, range.hi)
        };
        let mag = raw_low
            .abs()
            .max(raw_high.abs())
            .max(min.unwrap_or(0.).abs())
            .max(max.unwrap_or(0.).abs());
        let multiplier = if mag > 0. {
            10f64.powf(mag.log10().floor().clamp(-308., 308.))
        } else {
            1.
        };
        let (mut lo, mut hi) = (raw_low / multiplier, raw_high / multiplier);
        if lo == 0. && hi == 0. {
            hi = 1.;
        }
        if zero_baseline || lo <= hi * 0.5 {
            lo = lo.min(0.);
        }
        if zero_baseline || hi >= lo * 0.5 {
            hi = hi.max(0.);
        }
        let span = (hi - lo).abs().max(hi.abs() * 0.1).max(1e-300);
        let intervals = (max_intervals * 1.01).floor().clamp(1., 9.);
        let step = ((max.map_or(hi, |n| n / multiplier) - min.map_or(lo, |n| n / multiplier))
            .abs()
            / intervals)
            .max(span / 1000.);
        let decade = 10f64.powf(step.log10().floor());
        let unit = number(val(axis, "majorUnit"))
            .map(|v| v / multiplier)
            .filter(|v| v.is_finite() && *v > 0.)
            .unwrap_or_else(|| {
                [1., 2., 5., 10.]
                    .into_iter()
                    .find(|v| *v * decade >= step * 0.995)
                    .unwrap_or(10.)
                    * decade
            });
        if !percent && !empty {
            if lo != 0. {
                lo -= span * 0.05;
            }
            if hi != 0. {
                hi += span * 0.05;
            }
        }
        let low = min.map_or_else(|| (lo / unit + 1e-10).floor() * unit, |n| n / multiplier);
        let high = max.map_or_else(|| (hi / unit - 1e-10).ceil() * unit, |n| n / multiplier);
        let (low, high, unit) =
            if low.is_finite() && high.is_finite() && unit.is_finite() && unit > 0. && high > low {
                (low, high, unit)
            } else {
                (0., 1., 0.2)
            };
        Self {
            low,
            high,
            unit,
            multiplier,
            log,
            reversed,
        }
    }
    fn normalized(self, v: f64) -> f64 {
        if let Some(b) = self.log {
            if v <= 0. {
                return self.low;
            }
            v.log(b)
        } else {
            v / self.multiplier
        }
    }
    fn fraction(self, v: f64) -> f64 {
        let f = ((self.normalized(v) - self.low) / (self.high - self.low)).clamp(-1e6, 1e6);
        if self.reversed {
            1. - f
        } else {
            f
        }
    }
    fn original(self, v: f64) -> f64 {
        self.log.map_or(v * self.multiplier, |b| b.powf(v))
    }
    fn clamp(self, v: f64) -> f64 {
        self.original(self.normalized(v).clamp(self.low, self.high))
    }
    fn ticks(self) -> impl Iterator<Item = f64> {
        let offset = (self.low / self.unit - 1e-9).ceil() * self.unit;
        (0..=150)
            .map(move |i| offset + f64::from(i) * self.unit)
            .take_while(move |v| *v <= self.high + self.unit * 1e-8)
            .map(move |v| self.original(v))
    }
}

struct Group<'a> {
    node: Node<'a, 'a>,
    start: usize,
    end: usize,
    category: Option<Node<'a, 'a>>,
    value: Option<Node<'a, 'a>>,
    scatter: bool,
    horizontal: bool,
    percent: bool,
}
impl<'a> Group<'a> {
    fn ranges(&self, series: &[ChartSeries]) -> (Extent, Extent) {
        let mut values = Extent::default();
        let mut cats = Extent::default();
        let stacked = matches!(
            val(Some(self.node), "grouping"),
            Some("stacked" | "percentStacked")
        );
        let mut sums: BTreeMap<u32, (f64, f64)> = BTreeMap::new();
        for s in series {
            for p in &s.points {
                if let Some(n) = number(p.x.as_deref()) {
                    cats.record(n);
                }
                if let Some(n) = number(if self.scatter {
                    p.y.as_deref()
                } else {
                    p.value.as_deref()
                }) {
                    if stacked {
                        let v = sums.entry(p.index).or_default();
                        if n < 0. {
                            v.0 += n;
                        } else {
                            v.1 += n;
                        }
                    } else {
                        values.record(n);
                    }
                }
            }
        }
        for (lo, hi) in sums.into_values() {
            if self.percent {
                values.record(if lo < 0. { -1. } else { 0. });
                values.record(if hi > 0. { 1. } else { 0. });
            } else {
                values.record(lo);
                values.record(hi);
            }
        }
        (cats, values)
    }
}

fn groups<'a>(plot: Node<'a, 'a>, data: &ChartData) -> Option<Vec<Group<'a>>> {
    let mut out = Vec::new();
    let axes_by_id: HashMap<_, _> = plot
        .children()
        .filter(|n| n.tag_name().name().ends_with("Ax"))
        .filter_map(|n| Some((val(Some(n), "axId")?, n)))
        .collect();
    let mut start = 0;
    for node in plot
        .children()
        .filter(|n| n.is_element() && n.tag_name().name().ends_with("Chart"))
    {
        let scatter = chart_node(node, "scatterChart");
        if !scatter
            && !["barChart", "lineChart", "areaChart"]
                .iter()
                .any(|name| chart_node(node, name))
        {
            return None;
        }
        let end = start + node.children().filter(|n| chart_node(*n, "ser")).count();
        let axes: Vec<_> = node
            .children()
            .filter(|n| chart_node(*n, "axId"))
            .filter_map(|n| n.attribute("val"))
            .filter_map(|id| axes_by_id.get(id).copied())
            .collect();
        let category = axes
            .iter()
            .find(|a| {
                if scatter {
                    matches!(val(Some(**a), "axPos"), Some("b" | "t"))
                } else {
                    !chart_node(**a, "valAx")
                }
            })
            .copied()
            .or_else(|| axes.first().copied());
        let value = axes
            .iter()
            .find(|a| chart_node(**a, "valAx") && Some(**a) != category)
            .copied();
        if start < end {
            out.push(Group {
                node,
                start,
                end,
                category,
                value,
                scatter,
                horizontal: val(Some(node), "barDir") == Some("bar"),
                percent: val(Some(node), "grouping") == Some("percentStacked"),
            });
        }
        start = end;
    }
    if start != data.series.len() || out.is_empty() {
        None
    } else {
        Some(out)
    }
}

#[derive(Clone, Copy)]
struct Box2 {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}
impl Box2 {
    fn width(self) -> f64 {
        (self.right - self.left).max(1e-6)
    }
    fn height(self) -> f64 {
        (self.bottom - self.top).max(1e-6)
    }
}

struct Coords {
    rect: Box2,
    horizontal: bool,
    count: f64,
    between: bool,
    reversed: bool,
    values: Scale,
    x: Option<Scale>,
}
impl Coords {
    fn point(&self, category: f64, value: f64) -> (f64, f64) {
        let category = if let Some(x) = self.x {
            x.fraction(category)
        } else {
            let p = if self.between {
                (category + 0.5) / self.count
            } else if self.count > 1. {
                category / (self.count - 1.)
            } else {
                0.5
            };
            if self.reversed {
                1. - p
            } else {
                p
            }
        };
        let v = self.values.fraction(value);
        let (x, y) = if self.horizontal {
            (v, category)
        } else {
            (category, v)
        };
        (
            self.rect.left + x * self.rect.width(),
            self.rect.bottom - y * self.rect.height(),
        )
    }
    fn slot_width(&self) -> f64 {
        (if self.horizontal {
            self.rect.height()
        } else {
            self.rect.width()
        }) / self.count
    }
    fn is_horizontal(&self) -> bool {
        self.horizontal
    }
    fn clamp_value(&self, v: f64) -> f64 {
        self.values.clamp(v)
    }
}

fn axis_visible(n: Option<Node>, legacy: bool) -> bool {
    n.is_some() && !flag(n, "delete", !legacy)
}
fn has_labels(n: Option<Node>, legacy: bool) -> bool {
    axis_visible(n, legacy) && val(n, "tickLblPos") != Some("none")
}
fn label_number(n: f64, axis: Option<Node>, percent: bool) -> String {
    let format = axis
        .and_then(|n| child(n, "numFmt"))
        .and_then(|n| n.attribute("formatCode"))
        .unwrap_or("");
    if !format.is_empty() && format != "General" {
        return super::chart_svg::format_value(n, Some(format));
    }
    let percent = percent || format.contains('%');
    let n = if percent { n * 100. } else { n };
    if n.abs() > 1e12 || (n != 0. && n.abs() < 1e-6) {
        return format!("{n:.2e}");
    }
    let n = if n.abs() < 1e-12 { 0. } else { n };
    let s = format!("{n:.8}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if percent {
        format!("{s}%")
    } else {
        s.to_owned()
    }
}

fn text(
    svg: &mut String,
    x: f64,
    y: f64,
    anchor: &str,
    size: f64,
    face: &str,
    label: &str,
    bold: bool,
) {
    write!(svg,r#"<text x="{x:.2}" y="{y:.2}" text-anchor="{anchor}" font-size="{size:.2}" font-family="{face}"{}>{}</text>"#,if bold {r#" font-weight="bold""#} else {""},escape_xml_text(label)).unwrap();
}

fn stroke(node: Option<Node>, colors: &ChartColors) -> String {
    node.and_then(|n| child(n, "spPr"))
        .and_then(|n| colors.shape_stroke(n))
        .unwrap_or_else(|| {
            if colors.legacy_defaults() {
                "#868686"
            } else {
                "black"
            }
            .into()
        })
}

fn axis_tick(
    svg: &mut String,
    along_x: bool,
    pos: f64,
    at: f64,
    outside: f64,
    style: &str,
    length: f64,
    stroke: &str,
) {
    let (a, b) = match style {
        "in" => (0., -length * outside),
        "out" => (0., length * outside),
        "cross" => (-length, length),
        _ => return,
    };
    if along_x {
        line(svg, pos, at + a, pos, at + b, stroke);
    } else {
        line(svg, at + a, pos, at + b, pos, stroke);
    }
}

fn axis_title(axis: Option<Node>, legacy: bool) -> Option<String> {
    let title = child(axis?, "title")?;
    let Some(tx) = child(title, "tx") else {
        return legacy.then(|| "Axis Title".to_owned());
    };
    let label: String = tx
        .descendants()
        .filter(|n| n.is_element() && matches!(n.tag_name().name(), "t" | "v"))
        .filter_map(|n| n.text())
        .collect();
    (!label.is_empty()).then_some(label)
}

fn draw_axes(
    svg: &mut String,
    labels: &mut String,
    g: &Group,
    c: &Coords,
    cats: &BTreeMap<u32, String>,
    colors: &ChartColors,
    size: f64,
    face: &str,
    draw_category: bool,
    draw_value: bool,
) {
    let r = c.rect;
    let legacy = colors.legacy_defaults();
    let position = |n: Option<Node>, other: Option<Node>, scale: Scale| -> f64 {
        if let Some(n) = number(val(n, "crossesAt")) {
            return scale.clamp(n);
        }
        match val(n, "crosses") {
            Some("max") => scale.original(scale.high),
            Some("min") => scale.original(scale.low),
            _ if val(other, "axPos") == Some("t") => scale.original(scale.high),
            _ => scale.clamp(0.),
        }
    };
    let axis_line = |svg: &mut String, horizontal: bool, physical: f64, stroke: &str| {
        if horizontal {
            line(svg, r.left, physical, r.right, physical, stroke);
        } else {
            line(svg, physical, r.top, physical, r.bottom, stroke);
        }
    };
    let side = val(g.value, "axPos").unwrap_or(if g.horizontal { "b" } else { "l" });
    let v_pos = if let Some(x) = c.x {
        c.point(position(g.value, g.category, x), 0.).0
    } else if g.horizontal {
        if side == "t" {
            r.top
        } else {
            r.bottom
        }
    } else if side == "r" || val(g.value, "crosses") == Some("max") {
        r.right
    } else {
        r.left
    };
    let cp = c.point(0., position(g.category, g.value, c.values));
    let c_pos = if g.horizontal { cp.0 } else { cp.1 };
    if draw_value {
        let grid = g.value.and_then(|n| child(n, "majorGridlines"));
        let grid_color = stroke(grid, colors);
        let axis_stroke = stroke(g.value, colors);
        let outside = if matches!(side, "t" | "l") { -1. } else { 1. };
        if axis_visible(g.value, legacy) {
            let unit = number(val(g.value, "minorUnit"))
                .filter(|n| *n > 0.)
                .map(|v| v / c.values.multiplier)
                .unwrap_or(c.values.unit / 5.);
            let minor =
                val(g.value, "minorTickMark").unwrap_or(if legacy { "none" } else { "cross" });
            if minor != "none" && unit.is_finite() && unit > 0. && c.values.log.is_none() {
                for t in 0..512 {
                    let v = c.values.low + f64::from(t) * unit;
                    if v > c.values.high + unit * 1e-8 {
                        break;
                    }
                    let (x, y) = c.point(0., c.values.original(v));
                    axis_tick(
                        svg,
                        g.horizontal,
                        if g.horizontal { x } else { y },
                        v_pos,
                        outside,
                        minor,
                        3.2,
                        &axis_stroke,
                    );
                }
            }
        }
        for v in c.values.ticks() {
            let (x, y) = c.point(0., v);
            if grid.is_some() {
                axis_line(
                    svg,
                    !g.horizontal,
                    if g.horizontal { x } else { y },
                    &grid_color,
                );
            }
            if axis_visible(g.value, legacy) {
                axis_tick(
                    svg,
                    g.horizontal,
                    if g.horizontal { x } else { y },
                    v_pos,
                    outside,
                    val(g.value, "majorTickMark").unwrap_or(if legacy { "out" } else { "cross" }),
                    4.2,
                    &axis_stroke,
                );
            }
            if has_labels(g.value, legacy) {
                let s = label_number(v, g.value, g.percent);
                if g.horizontal {
                    text(
                        labels,
                        x,
                        v_pos + if side == "t" { -5. } else { size * 1.60 },
                        "middle",
                        size,
                        face,
                        &s,
                        false,
                    );
                } else {
                    let right = side == "r";
                    text(
                        labels,
                        v_pos + if right { size * 0.90 } else { -size * 0.90 },
                        y + size * 0.31,
                        if right { "start" } else { "end" },
                        size,
                        face,
                        &s,
                        false,
                    );
                }
            }
        }
        if axis_visible(g.value, legacy) {
            axis_line(svg, g.horizontal, v_pos, &stroke(g.value, colors));
        }
    }
    if draw_category {
        let grid = g.category.and_then(|n| child(n, "majorGridlines"));
        let grid_paint = stroke(grid, colors);
        let paint = |svg: &mut String, labels: &mut String, n: f64, s: &str| {
            let (x, y) = c.point(n, 0.);
            if grid.is_some() {
                axis_line(
                    svg,
                    g.horizontal,
                    if g.horizontal { y } else { x },
                    &grid_paint,
                );
            }
            if has_labels(g.category, legacy) {
                if g.horizontal {
                    text(
                        labels,
                        c_pos - size * 0.90,
                        y + size * 0.31,
                        "end",
                        size,
                        face,
                        s,
                        false,
                    );
                } else {
                    text(
                        labels,
                        x,
                        c_pos + size * 1.60,
                        "middle",
                        size,
                        face,
                        s,
                        false,
                    );
                }
            }
        };
        if let Some(scale) = c.x {
            for x in scale.ticks() {
                paint(svg, labels, x, &label_number(x, g.category, false));
            }
        } else if grid.is_some() || has_labels(g.category, legacy) {
            let skip = number(val(g.category, "tickLblSkip"))
                .unwrap_or_else(|| {
                    (c.count
                        / ((if g.horizontal { r.height() } else { r.width() }) / (size * 2.5))
                            .max(1.))
                    .ceil()
                })
                .max(1.) as u64;
            for i in (0..c.count as u64).step_by(skip as usize).take(512) {
                let s = cats
                    .get(&(i as u32))
                    .cloned()
                    .unwrap_or_else(|| (i + 1).to_string());
                paint(svg, labels, i as f64, &s);
            }
        }
        if axis_visible(g.category, legacy) {
            let axis_paint = stroke(g.category, colors);
            let major =
                val(g.category, "majorTickMark").unwrap_or(if legacy { "out" } else { "cross" });
            let minor =
                val(g.category, "minorTickMark").unwrap_or(if legacy { "none" } else { "cross" });
            let side = val(g.category, "axPos").unwrap_or(if g.horizontal { "l" } else { "b" });
            let outside = if side == "l" || side == "t" { -1. } else { 1. };
            let mut tick = |cat: f64, style: &str, len: f64| {
                let (x, y) = c.point(cat, 0.);
                axis_tick(
                    svg,
                    !g.horizontal,
                    if g.horizontal { y } else { x },
                    c_pos,
                    outside,
                    style,
                    len,
                    &axis_paint,
                );
            };
            if let Some(scale) = c.x {
                for x in scale.ticks() {
                    tick(x, major, 4.2);
                }
            } else {
                let skip = number(val(g.category, "tickMarkSkip"))
                    .unwrap_or(1.)
                    .max((c.count / 512.).ceil())
                    .max(1.) as usize;
                for i in (0..c.count as u64).step_by(skip) {
                    let i = i as f64;
                    tick(i, minor, 3.2);
                    tick(if c.between { i - 0.5 } else { i }, major, 4.2);
                }
                if c.between {
                    tick(c.count - 0.5, major, 4.2);
                }
            }
        }
        if axis_visible(g.category, legacy) {
            axis_line(svg, !g.horizontal, c_pos, &stroke(g.category, colors));
        }
    }
    for (axis, draw) in [(g.category, draw_category), (g.value, draw_value)] {
        if !draw || !axis_visible(axis, legacy) {
            continue;
        }
        let Some(label) = axis_title(axis, legacy) else {
            continue;
        };
        let side = val(axis, "axPos").unwrap_or("b");
        let title = axis.and_then(|n| child(n, "title"));
        let props = text_props(title, true).or(text_props(title, false));
        let ts = font_size(props, size);
        let family = props
            .map(|p| font_family(Some(p), face.split(',').next().unwrap_or("Calibri")))
            .unwrap_or_else(|| face.to_owned());
        let (x, y, rotate) = match side {
            "l" => (r.left - size * 2.5, (r.top + r.bottom) / 2., -90),
            "r" => (r.right + size * 2.5, (r.top + r.bottom) / 2., 90),
            "t" => ((r.left + r.right) / 2., r.top - size * 1.65, 0),
            _ => ((r.left + r.right) / 2., r.bottom + size * 2.65, 0),
        };
        write!(labels, r#"<g transform="rotate({rotate} {x:.2} {y:.2})">"#).unwrap();
        text(labels, x, y, "middle", ts, &family, &label, true);
        labels.push_str("</g>");
    }
}

#[derive(Clone)]
struct LegendEntry<'a> {
    group: Node<'a, 'a>,
    ser: Node<'a, 'a>,
    index: usize,
    point: Option<u32>,
    value: Option<f64>,
    label: String,
}
fn legend_entries<'a>(
    groups: &[Group<'a>],
    data: &ChartData,
    legend: Node,
    colors: &ChartColors,
) -> Vec<LegendEntry<'a>> {
    let mut entries = Vec::new();
    for g in groups {
        let nodes = g.node.children().filter(|n| chart_node(*n, "ser"));
        for (i, node) in (g.start..g.end).zip(nodes) {
            let s = &data.series[i];
            let entry = LegendEntry {
                group: g.node,
                ser: node,
                index: i,
                point: None,
                value: None,
                label: s
                    .name
                    .clone()
                    .unwrap_or_else(|| format!("Series {}", i + 1)),
            };
            if data.series.len() == 1 && colors.vary_by_point(i) && !s.points.is_empty() {
                for p in s.points.iter().take(512) {
                    let label = p
                        .categories
                        .first()
                        .map(|v| v.label.clone())
                        .or_else(|| p.x.clone())
                        .unwrap_or_else(|| (u64::from(p.index) + 1).to_string());
                    entries.push(LegendEntry {
                        point: Some(p.index),
                        value: number(p.value.as_deref()),
                        label,
                        ..entry.clone()
                    });
                }
            } else {
                entries.push(entry);
            }
        }
    }
    if groups.iter().all(|g| {
        g.horizontal
            || (chart_node(g.node, "lineChart")
                && matches!(
                    val(Some(g.node), "grouping"),
                    Some("stacked" | "percentStacked")
                ))
    }) {
        entries.reverse();
    }
    let hidden: std::collections::BTreeSet<_> = legend
        .children()
        .filter(|n| chart_node(*n, "legendEntry") && flag(Some(*n), "delete", false))
        .filter_map(|n| val(Some(n), "idx")?.parse::<usize>().ok())
        .collect();
    entries
        .into_iter()
        .enumerate()
        .filter_map(|(i, e)| (!hidden.contains(&i)).then_some(e))
        .collect()
}

fn wrap_label(label: &str, size: f64, limit: f64) -> Vec<String> {
    if text_width(label, size) <= limit {
        return vec![label.to_owned()];
    }
    let mut lines = Vec::new();
    let mut current = String::new();
    for token in label.split_inclusive([' ', '-']) {
        let mut used = text_width(&current, size);
        if !current.is_empty() && used + text_width(token.trim_end(), size) > limit {
            lines.push(current.trim_end().to_owned());
            current.clear();
            used = 0.;
        }
        for c in token.chars() {
            let advance = text_width(c.encode_utf8(&mut [0; 4]), size);
            if used + advance > limit && !current.is_empty() {
                lines.push(current.trim_end().to_owned());
                current.clear();
                used = 0.;
                if lines.len() >= 32 {
                    return lines;
                }
            }
            current.push(c);
            used += advance;
        }
    }
    if !current.trim().is_empty() {
        lines.push(current.trim_end().to_owned());
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn draw_legend(
    svg: &mut String,
    entries: &[LegendEntry],
    colors: &ChartColors,
    width: f64,
    height: f64,
    pos: &str,
    size: f64,
    face: &str,
    title_center_offset: f64,
) {
    let side = matches!(pos, "r" | "l" | "tr");
    let rows = (height / (size * 1.65)).floor().max(1.) as usize;
    let entries = &entries[..entries.len().min(if side { rows } else { 512 })];
    if entries.is_empty() {
        return;
    }
    let key_width = if entries
        .iter()
        .any(|e| chart_node(e.group, "lineChart") || chart_node(e.group, "scatterChart"))
    {
        size * 1.92
    } else {
        size * 0.528
    };
    let extents = entries
        .iter()
        .map(|e| key_width + size * 0.22 + text_width(&e.label, size))
        .collect::<Vec<_>>();
    let space = size * 0.88;
    let total = extents.iter().sum::<f64>() + space * entries.len().saturating_sub(1) as f64;
    let mut cur = ((width - total) / 2.).max(5.);
    let max_width = extents.iter().copied().fold(0., f64::max).min(width * 0.31);
    let text_space = (max_width - key_width - size * 0.04).max(size);
    let lines: Vec<_> = entries
        .iter()
        .map(|e| {
            if side {
                wrap_label(&e.label, size, text_space)
            } else {
                vec![e.label.clone()]
            }
        })
        .collect();
    let entry_height = |n: usize| size * (1.65 + 1.22 * (n as f64 - 1.));
    let total_height: f64 = lines.iter().map(|ls| entry_height(ls.len())).sum();
    let mut top = if pos == "tr" {
        12.
    } else {
        (height + title_center_offset - total_height) * 0.5 + size * 0.8
    };
    for (j, e) in entries.iter().enumerate() {
        let (x, y) = if side {
            let x = if pos == "l" {
                12.
            } else {
                width - 12. - max_width
            };
            let y = top;
            top += entry_height(lines[j].len());
            (x, y)
        } else {
            (cur, if pos == "t" { 19.7 } else { height - 19.7 })
        };
        let is_line = chart_node(e.group, "lineChart") || chart_node(e.group, "scatterChart");
        let paint = marks::legend_color(e.group, e.ser, e.index, e.point, e.value, colors, is_line);
        if is_line {
            write!(svg,r#"<path d="M{x:.2} {y:.2}h{key_width:.2}" fill="none" stroke="{paint}" stroke-width="3"/>"#).unwrap();
            let style = val(Some(e.group), "scatterStyle").unwrap_or("");
            let glyph_index = e.point.map_or_else(
                || {
                    val(Some(e.ser), "idx")
                        .and_then(|n| n.parse().ok())
                        .unwrap_or(e.index)
                },
                |p| p as usize,
            );
            let default_marker = glyph_kind(e, glyph_index);
            if default_marker != "none"
                && (!chart_node(e.group, "scatterChart")
                    || matches!(style, "marker" | "lineMarker" | "smoothMarker"))
            {
                let fill = colors.marker(e.index, e.point);
                let mid = x + key_width / 2.;
                let r = size * 0.28;
                let outline = colors.marker_outline(e.index, e.point);
                super::chart_svg::marker(svg, (mid, y), &default_marker, r, &fill, &outline, 1.);
            }
        } else {
            let h = size * 0.528;
            let border = colors.outline(e.index, e.point).unwrap_or_else(|| {
                if chart_node(e.group, "barChart")
                    && e.value.is_some_and(|v| v < 0.)
                    && marks::invert_negative(e.ser, e.point, colors)
                {
                    "black"
                } else {
                    "none"
                }
            });
            write!(svg,r#"<rect x="{x:.2}" y="{:.2}" width="{key_width:.2}" height="{h:.2}" fill="{paint}" stroke="{border}"/>"#,y-h/2.).unwrap();
        }
        for (k, label) in lines[j].iter().enumerate() {
            text(
                svg,
                x + key_width + size * 0.22,
                y + size * (0.3 + 1.22 * k as f64),
                "start",
                size,
                face,
                label,
                false,
            );
        }
        cur += extents[j] + space;
    }
}

fn glyph_kind(entry: &LegendEntry, ordinal: usize) -> String {
    let marker = child(entry.ser, "marker");
    match val(marker, "symbol") {
        Some(s) if s != "auto" => s.into(),
        _ if chart_node(entry.group, "scatterChart") || flag(Some(entry.group), "marker", true) => {
            [
                "diamond", "square", "triangle", "x", "star", "circle", "plus",
            ][ordinal % 7]
                .into()
        }
        _ => "none".into(),
    }
}

pub(super) fn render(
    root: Node,
    data: &ChartData,
    width: f64,
    height: f64,
    colors: &ChartColors,
    minor_latin: Option<&str>,
) -> Option<String> {
    let chart = child(root, "chart")?;
    let plot = child(chart, "plotArea")?;
    let groups = groups(plot, data)?;
    let legacy = colors.legacy_defaults();
    let default_face = minor_latin.unwrap_or("Calibri");
    let base = text_props(Some(root), false);
    let size = font_size(base, 40. / 3.);
    let axis_face = font_family(base, default_face);
    let title = child(chart, "title");
    let legend = child(chart, "legend");
    let chart_title = data.title.as_deref().or_else(|| {
        (legacy && title.is_some() && !flag(Some(chart), "autoTitleDeleted", false)).then(|| {
            if data.series.len() == 1 {
                data.series[0].name.as_deref().unwrap_or("Chart Title")
            } else {
                "Chart Title"
            }
        })
    });
    let title_props = text_props(title, true)
        .or(text_props(title, false))
        .or(base);
    let title_size = font_size(title_props, if legacy { 24. } else { size });
    let title_face = font_family(title_props, default_face);
    let legend_props = text_props(legend, false).or(base);
    let lf = font_size(legend_props, size);
    let legend_face = font_family(legend_props, default_face);
    let entries = legend.map_or_else(Vec::new, |n| legend_entries(&groups, data, n, colors));
    let legend_pos = val(legend, "legendPos").unwrap_or("r");
    let inset: f64 = 44. / 3.;
    let mut rect = Box2 {
        left: inset.min(width * 0.18),
        right: width - inset.min(width * 0.18),
        top: inset.min(height * 0.18),
        bottom: height - inset.min(height * 0.18),
    };
    if chart_title.is_some() && !flag(title, "overlay", !legacy) {
        rect.top += title_size * 1.17 + 12. + if legacy { 4. / 3. } else { 0. };
    }
    if !entries.is_empty() && !flag(legend, "overlay", !legacy) {
        let text_extent = entries
            .iter()
            .map(|e| text_width(&e.label, lf))
            .fold(0., f64::max);
        let lw = if legacy {
            let long_key = entries
                .iter()
                .any(|e| chart_node(e.group, "lineChart") || chart_node(e.group, "scatterChart"));
            (text_extent * 0.94 + lf * if long_key { 1.92 } else { 0.528 }).min(width * 0.31)
                + lf * 1.5
        } else {
            text_extent + lf * 1.5 + 12.
        };
        let lh = lf * 1.16 + 16.;
        match legend_pos {
            "b" => rect.bottom -= lh,
            "t" => rect.top += lh,
            "l" => rect.left += lw,
            _ => rect.right -= lw,
        }
    }

    let title_center_offset = if legacy { rect.top - inset } else { 0. };
    let mut count = 1u64;
    let mut categories = BTreeMap::new();
    // When every value axis is deleted, Word uses the first value scale for
    // the combined plot. Explicitly visible secondary axes keep their own domain.
    let primary = groups[0].value;
    let value_axis = |g: &Group| {
        if g.value != primary && !axis_visible(g.value, legacy) && !axis_visible(primary, legacy) {
            primary.map(|n| n.id())
        } else {
            g.value.map(|n| n.id())
        }
    };
    let mut x_ranges: HashMap<_, Extent> = HashMap::new();
    let mut y_ranges: HashMap<_, Extent> = HashMap::new();
    let mut zero_axes = HashSet::new();
    for g in &groups {
        let series = &data.series[g.start..g.end];
        for s in series {
            for p in &s.points {
                count = count.max(u64::from(p.index) + 1);
                if let Some(label) = p.categories.first() {
                    categories
                        .entry(p.index)
                        .or_insert_with(|| label.label.clone());
                }
            }
        }
        for ser in g.node.children().filter(|n| chart_node(*n, "ser")) {
            for channel in ser.children().filter(|n| {
                ["cat", "val", "yVal"]
                    .iter()
                    .any(|name| chart_node(*n, name))
            }) {
                if let Some(total) = channel
                    .descendants()
                    .find(|n| chart_node(*n, "ptCount"))
                    .and_then(|n| n.attribute("val"))
                    .and_then(|v| v.parse::<u32>().ok())
                {
                    count = count.max(total as u64);
                }
            }
        }
        let (x, y) = g.ranges(series);
        x_ranges
            .entry(g.category.map(|n| n.id()))
            .or_default()
            .merge(x);
        y_ranges.entry(value_axis(g)).or_default().merge(y);
        if !g.scatter {
            zero_axes.insert(value_axis(g));
        }
    }
    let x_scale = |g: &Group, rect: Box2| {
        Scale::new(
            x_ranges[&g.category.map(|n| n.id())],
            g.category,
            rect.width() / (size * 3.5),
            false,
            false,
        )
    };
    let value_scale = |g: &Group, rect: Box2| {
        Scale::new(
            y_ranges[&value_axis(g)],
            g.value,
            if g.horizontal {
                rect.width() / (size * 3.5)
            } else {
                rect.height() / (size * 1.4)
            },
            zero_axes.contains(&value_axis(g)),
            g.percent,
        )
    };
    let mut gutters = [0f64; 4];
    for g in &groups {
        for (axis, is_value) in [(g.value, true), (g.category, false)] {
            if !has_labels(axis, legacy) {
                continue;
            }
            let pos = val(axis, "axPos").unwrap_or(if is_value { "l" } else { "b" });
            let horizontal = matches!(pos, "b" | "t");
            let extent = if horizontal {
                size * 1.355
            } else if is_value || g.scatter {
                let scale = if is_value {
                    value_scale(g, rect)
                } else {
                    x_scale(g, rect)
                };
                scale
                    .ticks()
                    .map(|v| text_width(&label_number(v, axis, is_value && g.percent), size))
                    .fold(0., f64::max)
                    + size * 0.45
            } else {
                categories
                    .values()
                    .map(|s| text_width(s, size))
                    .fold(0., f64::max)
                    + size * 0.45
            };
            let i = match pos {
                "l" => 0,
                "t" => 1,
                "r" => 2,
                _ => 3,
            };
            let title_space = if axis_title(axis, legacy).is_some() {
                size * if legacy { 2.05 } else { 1.45 }
            } else {
                0.
            };
            gutters[i] = gutters[i].max(extent + title_space);
        }
    }
    rect.left += gutters[0];
    rect.top += gutters[1];
    rect.right -= gutters[2];
    rect.bottom -= gutters[3];
    if let Some(layout) = child(plot, "layout").and_then(|n| child(n, "manualLayout")) {
        if let Some(v) = number(val(Some(layout), "x")) {
            rect.left = v.clamp(0., 1.) * width;
        }
        if let Some(v) = number(val(Some(layout), "y")) {
            rect.top = v.clamp(0., 1.) * height;
        }
        if let Some(v) = number(val(Some(layout), "w")) {
            rect.right = if val(Some(layout), "wMode") == Some("edge") {
                0.
            } else {
                rect.left
            } + v.clamp(0., 1.) * width;
        }
        if let Some(v) = number(val(Some(layout), "h")) {
            rect.bottom = if val(Some(layout), "hMode") == Some("edge") {
                0.
            } else {
                rect.top
            } + v.clamp(0., 1.) * height;
        }
    }
    rect.left = rect.left.clamp(0., width * 0.92);
    rect.top = rect.top.clamp(0., height * 0.92);
    rect.right = rect.right.clamp(rect.left + width * 0.01, width);
    rect.bottom = rect.bottom.clamp(rect.top + height * 0.01, height);

    let shape = |node: Node, default_fill: &str, default_stroke: &str| {
        let pr = child(node, "spPr");
        (
            pr.and_then(|n| colors.shape_fill(n))
                .unwrap_or_else(|| default_fill.into()),
            pr.and_then(|n| colors.shape_stroke(n))
                .unwrap_or_else(|| default_stroke.into()),
        )
    };
    let (bg, border) = shape(root, "white", "#868686");
    let corner = if flag(Some(root), "roundedCorners", !legacy) {
        40. / 3.
    } else {
        0.
    };
    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="{width}" height="{height}" rx="{corner:.2}" fill="{bg}" stroke="{border}"/>"#
    );
    let (plot_fill, plot_stroke) = shape(plot, "white", "none");
    let frame = format!(
        r#"x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}""#,
        rect.left,
        rect.top,
        rect.width(),
        rect.height()
    );
    write!(svg,r#"<rect {frame} fill="{plot_fill}" stroke="{plot_stroke}"/><defs><clipPath id="plot"><rect {frame}/></clipPath></defs>"#).unwrap();
    let label_fill = base
        .and_then(|p| colors.shape_fill(p))
        .unwrap_or_else(|| "black".into());
    let mut labels = format!(r#"<g fill="{label_fill}">"#);
    let mut geometry = String::new();
    let mut seen_c = HashSet::new();
    let mut seen_v = HashSet::new();
    for g in &groups {
        let between = val(g.value, "crossBetween")
            .map_or(!chart_node(g.node, "areaChart"), |v| v == "between");
        let c = Coords {
            rect,
            horizontal: g.horizontal,
            count: count as f64,
            between,
            reversed: val(g.category.and_then(|n| child(n, "scaling")), "orientation")
                == Some("maxMin"),
            values: value_scale(g, rect),
            x: g.scatter.then(|| x_scale(g, rect)),
        };
        let draw_c = seen_c.insert(g.category.map(|n| n.id()));
        let draw_v = seen_v.insert(value_axis(g));
        draw_axes(
            &mut svg,
            &mut labels,
            g,
            &c,
            &categories,
            colors,
            size,
            &axis_face,
            draw_c,
            draw_v,
        );
        marks::draw(
            &mut geometry,
            &mut labels,
            g.node,
            &data.series[g.start..g.end],
            g.start,
            colors,
            &c,
            val(Some(chart), "dispBlanksAs").unwrap_or(if legacy { "gap" } else { "zero" }),
            default_face,
        );
    }
    labels.push_str("</g>");
    write!(svg, r#"<g clip-path="url(#plot)">{geometry}</g>{labels}"#).unwrap();
    if let Some(label) = chart_title {
        let paint = title_props
            .and_then(|p| colors.shape_fill(p))
            .unwrap_or_else(|| label_fill.clone());
        write!(svg, r#"<g fill="{paint}">"#).unwrap();
        text(
            &mut svg,
            width / 2.,
            10.66 + title_size * 0.915,
            "middle",
            title_size,
            &title_face,
            label,
            title_props.and_then(|n| n.attribute("b")).is_none_or(truth),
        );
        svg.push_str("</g>");
    }
    let paint = legend_props
        .and_then(|p| colors.shape_fill(p))
        .unwrap_or(label_fill);
    write!(svg, r#"<g fill="{paint}">"#).unwrap();
    draw_legend(
        &mut svg,
        &entries,
        colors,
        width,
        height,
        legend_pos,
        lf,
        &legend_face,
        title_center_offset,
    );
    svg.push_str("</g></svg>");
    Some(svg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_columns_share_a_zero_crossing_and_keep_their_extremes() {
        let scale = Scale::new(Extent { lo: -4., hi: 7. }, None, 9., true, false);
        assert_eq!(scale.original(scale.low), -6.);
        assert_eq!(scale.original(scale.high), 8.);
        let coords = Coords {
            rect: Box2 {
                left: 0.,
                top: 0.,
                right: 300.,
                bottom: 140.,
            },
            horizontal: false,
            count: 3.,
            between: true,
            reversed: false,
            values: scale,
            x: None,
        };
        assert_eq!(coords.point(0., -4.), (50., 120.));
        assert_eq!(coords.point(1., 0.), (150., 80.));
        assert_eq!(coords.point(2., 7.), (250., 10.));
    }

    #[test]
    fn an_empty_cache_uses_a_finite_unit_interval() {
        let axis = Scale::new(Extent::default(), None, 9., true, false);
        assert_eq!((axis.low, axis.high), (0., 1.));
        assert!(axis.ticks().all(f64::is_finite));
    }
}
