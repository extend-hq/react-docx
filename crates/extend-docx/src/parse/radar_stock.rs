use std::{collections::BTreeMap, f64::consts::TAU, fmt::Write};

use roxmltree::Node;

use super::chart_colors::ChartColors;
use super::chart_svg::{
    font_family, font_size, format_value, line, number, on, text, text_props, text_width, val,
};
use crate::chart::{chart_node, child, ChartData};

#[derive(Clone, Copy)]
struct Bounds {
    left: f64,
    right: f64,
    top: f64,
    bottom: f64,
}

#[derive(Clone, Copy)]
struct Scale {
    low: f64,
    high: f64,
    step: f64,
    multiplier: f64,
    reversed: bool,
}

impl Scale {
    fn new(axis: Option<Node>, data: &ChartData, stock: bool, length: f64) -> Self {
        let scaling = axis.and_then(|n| child(n, "scaling"));
        let lower = number(val(scaling, "min"));
        let upper = number(val(scaling, "max"));
        let mut min: f64 = 0.;
        let mut max: f64 = 0.;
        for point in data.series.iter().flat_map(|s| &s.points) {
            if let Some(n) = number(point.value.as_deref()) {
                min = min.min(n);
                max = max.max(n);
            }
        }
        let mag = min
            .abs()
            .max(max.abs())
            .max(lower.unwrap_or(0.).abs())
            .max(upper.unwrap_or(0.).abs());
        let multiplier = if mag > 0. {
            10f64.powf(mag.log10().floor().clamp(-308., 308.))
        } else {
            1.
        };
        min = lower.unwrap_or(min) / multiplier;
        max = upper.unwrap_or(max) / multiplier;
        if max <= min {
            max = min + min.abs().max(1.);
        }
        let desired = (max - min) / (length / 40.).round().clamp(1., 10.);
        let power = 10f64.powf(desired.log10().floor().clamp(-308., 308.));
        let step = number(val(axis, "majorUnit"))
            .map(|n| n / multiplier)
            .filter(|n| n.is_finite() && *n > 0.)
            .unwrap_or_else(|| {
                power
                    * [1., 2., 5., 10.]
                        .into_iter()
                        .find(|n| power * n >= desired * (1. - 1e-10))
                        .unwrap_or(10.)
            });
        let pad = if stock { (max - min) * 0.05 } else { 0. };
        let low = lower.map_or_else(
            || ((min - if min < 0. { pad } else { 0. }) / step + 1e-10).floor() * step,
            |v| v / multiplier,
        );
        let high = upper.map_or_else(
            || ((max + if max > 0. { pad } else { 0. }) / step - 1e-10).ceil() * step,
            |v| v / multiplier,
        );
        Self {
            low,
            high: if high > low { high } else { low + step },
            step,
            multiplier,
            reversed: val(scaling, "orientation") == Some("maxMin"),
        }
    }

    fn position(self, n: f64) -> f64 {
        let part = ((n / self.multiplier - self.low) / (self.high - self.low)).clamp(0., 1.);
        if self.reversed {
            1. - part
        } else {
            part
        }
    }

    fn ticks(self) -> impl Iterator<Item = f64> {
        (0..=128)
            .map(move |i| self.low + f64::from(i) * self.step)
            .take_while(move |n| *n <= self.high + self.step * 1e-8)
            .map(move |n| n * self.multiplier)
            .filter(|n| n.is_finite())
    }
}

fn paint(node: Option<Node>, colors: &ChartColors, fill: &str, stroke: &str) -> (String, String) {
    let props = node.and_then(|n| child(n, "spPr"));
    (
        props
            .and_then(|p| colors.shape_fill(p))
            .unwrap_or_else(|| fill.into()),
        props
            .and_then(|p| colors.shape_stroke(p))
            .unwrap_or_else(|| stroke.into()),
    )
}

fn line_width(node: Option<Node>, fallback: f64) -> f64 {
    node.and_then(|n| child(n, "spPr"))
        .and_then(|p| p.children().find(|n| n.tag_name().name() == "ln"))
        .and_then(|l| number(l.attribute("w")))
        .map_or(fallback, |w| (w / 9525.).clamp(0., 64.))
}

fn append_line(path: &mut String, x: f64, y: f64, new: bool) {
    let command = if new { 'M' } else { 'L' };
    write!(path, "{command}{x:.2} {y:.2}").unwrap();
}

fn marker_symbol<'a>(series: Node<'a, 'a>, index: usize, auto: bool) -> &'a str {
    let symbol =
        val(child(series, "marker"), "symbol").unwrap_or(if auto { "auto" } else { "none" });
    if symbol == "auto" {
        [
            "diamond", "square", "triangle", "x", "star", "dot", "dash", "circle", "plus",
        ][index % 9]
    } else {
        symbol
    }
}

fn marker(svg: &mut String, symbol: &str, x: f64, y: f64, size: f64, fill: &str, stroke: &str) {
    if symbol == "dot" {
        // Office's dot is a short, right-facing dash centered vertically on the data point.
        write!(svg,r#"<rect x="{x:.2}" y="{:.2}" width="{:.2}" height="0.64" fill="{fill}" stroke="{stroke}"/>"#, y-0.32, size/2.).unwrap();
    } else if symbol != "none" {
        super::chart_svg::marker(svg, (x, y), symbol, size / 2., fill, stroke, 1.);
    }
}

fn marker_size(series: Node) -> f64 {
    number(val(child(series, "marker"), "size")).map_or(9., |v| (v * 4. / 3.).clamp(1., 96.))
}

fn explicitly_false(value: Option<&str>) -> bool {
    matches!(value, Some("0" | "false" | "off"))
}

fn axis_visible(node: Option<Node>, legacy: bool) -> bool {
    node.is_some() && val(node, "delete").map_or(legacy, |v| explicitly_false(Some(v)))
}

fn grid_stroke(axis: Option<Node>, colors: &ChartColors) -> Option<String> {
    let grid = child(axis?, "majorGridlines")?;
    Some(
        paint(
            Some(grid),
            colors,
            "none",
            if colors.legacy_defaults() {
                "#868686"
            } else {
                "black"
            },
        )
        .1,
    )
}

fn bevel_width(series: Node, style: u16) -> Option<f64> {
    child(series, "spPr")
        .and_then(|p| p.descendants().find(|n| n.tag_name().name() == "bevelT"))
        .map(|bevel| number(bevel.attribute("w")).unwrap_or(76200.) / 9525.)
        .or_else(|| (style == 28).then_some(6.))
        .filter(|w| *w > 0.)
}

fn shaded_edges(svg: &mut String, vertices: &[(f64, f64)], center: (f64, f64), bevel: f64) {
    if vertices.len() < 3 {
        return;
    }
    let inset = |(x, y): (f64, f64)| {
        let dx = center.0 - x;
        let dy = center.1 - y;
        let t = (bevel / dx.hypot(dy).max(f64::EPSILON)).min(1.);
        (x + dx * t, y + dy * t)
    };
    let dir = vertices
        .iter()
        .zip(vertices.iter().cycle().skip(1))
        .map(|(&(x, y), &(u, v))| x * v - y * u)
        .sum::<f64>()
        .signum();
    for (&p, &q) in vertices.iter().zip(vertices.iter().cycle().skip(1)) {
        let dx = q.0 - p.0;
        let dy = q.1 - p.1;
        let v = dir * (0.55 * dx - 0.83 * dy) / dx.hypot(dy).max(f64::EPSILON);
        let (paint, opacity) = if v >= 0. {
            ("white", 0.30 * v)
        } else {
            ("black", -0.55 * v)
        };
        let mut path = String::new();
        for (i, (x, y)) in [p, q, inset(q), inset(p)].into_iter().enumerate() {
            append_line(&mut path, x, y, i == 0);
        }
        write!(
            svg,
            r#"<path d="{path}Z" fill="{paint}" opacity="{opacity:.2}"/>"#
        )
        .unwrap();
    }
}

fn fit_prefix(label: &str, size: f64, room: f64) -> usize {
    let mut width = 0.;
    for (i, c) in label.char_indices() {
        let next = width + text_width(c.encode_utf8(&mut [0; 4]), size);
        if next > room {
            return i;
        }
        width = next;
    }
    label.len()
}

fn elide(label: &str, size: f64, room: f64) -> String {
    if text_width(label, size) <= room {
        return label.to_owned();
    }
    let end = fit_prefix(label, size, room - size * 0.8);
    format!("{}…", label[..end].trim_end())
}

fn date_label(serial: f64, epoch_1904: bool, code: &str) -> Option<String> {
    if !(-657434. ..=2958465.).contains(&serial) || code.len() > 64 {
        return None;
    }
    let mut serial = serial.floor() as i32;
    if epoch_1904 {
        serial += 1462;
    }
    let (year, month, day) = if serial == 60 {
        // Excel's 1900 date system includes an extra leap day.
        (1900, 2, 29)
    } else {
        let days = serial + i32::from(serial < 60) - 36526;
        let mut year = 2000 + 400 * days.div_euclid(146097);
        let mut day = days.rem_euclid(146097);
        let leap = |y: i32| y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
        while day >= 365 + i32::from(leap(year)) {
            day -= 365 + i32::from(leap(year));
            year += 1;
        }
        let mut month = 1;
        for length in [
            31,
            28 + i32::from(leap(year)),
            31,
            30,
            31,
            30,
            31,
            31,
            30,
            31,
            30,
            31,
        ] {
            if day < length {
                break;
            }
            day -= length;
            month += 1;
        }
        (year, month, day + 1)
    };
    let code = code.to_ascii_lowercase();
    let mut chars = code.chars().peekable();
    let mut label = String::new();
    let mut has_date = false;
    while let Some(c) = chars.next() {
        if !matches!(c, 'm' | 'd' | 'y') {
            if matches!(c, '/' | '-' | '.' | ' ') {
                label.push(c);
                continue;
            }
            return None;
        }
        let mut count = 1;
        while chars.next_if_eq(&c).is_some() {
            count += 1;
        }
        match (c, count) {
            ('m', 1) => write!(label, "{month}").unwrap(),
            ('m', 2) => write!(label, "{month:02}").unwrap(),
            ('d', 1) => write!(label, "{day}").unwrap(),
            ('d', 2) => write!(label, "{day:02}").unwrap(),
            ('y', 2) => write!(label, "{:02}", year.rem_euclid(100)).unwrap(),
            ('y', 4) => write!(label, "{year:04}").unwrap(),
            _ => return None,
        }
        has_date = true;
    }
    has_date.then_some(label)
}

fn axis_number(axis: Option<Node>, value: f64) -> String {
    format_value(
        value,
        axis.and_then(|a| child(a, "numFmt"))
            .and_then(|n| n.attribute("formatCode")),
    )
}

struct StockRange {
    high: f64,
    low: f64,
    open: Option<f64>,
    close: Option<f64>,
}

struct Plot<'a> {
    bounds: Bounds,
    series: Vec<Node<'a, 'a>>,
    group: Node<'a, 'a>,
    category: Option<Node<'a, 'a>>,
    value: Option<Node<'a, 'a>>,
    font: f64,
    family: String,
    count: u64,
}

impl Plot<'_> {
    fn draw_radar(
        &self,
        svg: &mut String,
        data: &ChartData,
        colors: &ChartColors,
        blanks: &str,
        style: u16,
    ) {
        let category_labels = axis_visible(self.category, colors.legacy_defaults())
            && val(self.category, "tickLblPos") != Some("none");
        let radial_labels = axis_visible(self.value, colors.legacy_defaults())
            && val(self.value, "tickLblPos") != Some("none");
        let inset = if category_labels {
            self.font * if colors.legacy_defaults() { 1.16 } else { 1. }
        } else {
            0.
        };
        let b = self.bounds;
        let (cx, cy) = ((b.left + b.right) / 2., (b.top + b.bottom) / 2.);
        let radius = (((b.right - b.left).min(b.bottom - b.top)) / 2. - inset).max(0.);
        let scale = Scale::new(self.value, data, false, 2. * radius);
        let reverse = val(
            self.category.and_then(|n| child(n, "scaling")),
            "orientation",
        ) == Some("maxMin");
        let locate = |i: u64, f: f64| {
            let a = TAU * i as f64 / self.count as f64 * (if reverse { -1. } else { 1. });
            (cx + f * radius * a.sin(), cy - f * radius * a.cos())
        };
        let grid_start = svg.len();
        let grid = grid_stroke(self.value, colors);
        let grid_stride = self.count.div_ceil(4096);
        if let Some(stroke) = grid {
            for tick in scale.ticks() {
                let f = scale.position(tick);
                if f == 0. {
                    continue;
                }
                let mut path = String::new();
                for i in (0..self.count).step_by(grid_stride as usize) {
                    let (x, y) = locate(i, f);
                    append_line(&mut path, x, y, i == 0);
                }
                write!(svg, r#"<path d="{path}Z" fill="none" stroke="{stroke}"/>"#).unwrap();
            }
        }
        if axis_visible(self.category, colors.legacy_defaults()) {
            if let Some(stroke) = grid_stroke(self.category, colors) {
                for i in (0..self.count).step_by(grid_stride as usize) {
                    let (x, y) = locate(i, 1.);
                    line(svg, cx, cy, x, y, &stroke);
                }
            }
        }
        let foreground_grid = colors.legacy_defaults().then(|| svg.split_off(grid_start));
        if radial_labels {
            for n in scale.ticks() {
                let (_, y) = locate(0, scale.position(n));
                text(
                    svg,
                    cx - 1.05 * self.font,
                    y + self.font * 0.35,
                    "end",
                    self.font,
                    &self.family,
                    &axis_number(self.value, n),
                );
            }
        }
        if category_labels {
            if let Some(first) = data.series.first() {
                for p in first
                    .points
                    .iter()
                    .filter(|p| u64::from(p.index) % grid_stride == 0)
                {
                    if let Some(label) = p.categories.first() {
                        let (x, y) = locate(u64::from(p.index), 1.);
                        let bucket = if self.count > 1 {
                            2. * radius * (std::f64::consts::PI / self.count as f64).sin()
                        } else {
                            b.right - b.left
                        };
                        let raw = &label.label;
                        let label = elide(raw, self.font, bucket.max(self.font * 1.5));
                        let dx = (x - cx) / radius.max(1.);
                        let dy = (y - cy) / radius.max(1.);
                        text(
                            svg,
                            if label != *raw && colors.legacy_defaults() {
                                x + (dx + 1.) * self.font * 0.34
                            } else {
                                x + dx * (4. + text_width(&label, self.font) / 2.)
                            },
                            y + if dy < -0.8 {
                                -self.font * 0.45
                            } else {
                                self.font * 0.32
                            },
                            "middle",
                            self.font,
                            &self.family,
                            &label,
                        );
                    }
                }
            }
        }
        let filled = val(Some(self.group), "radarStyle") == Some("filled");
        let default_markers = val(Some(self.group), "radarStyle") == Some("marker") && style <= 16;
        for (i, (s, ser)) in data.series.iter().zip(&self.series).enumerate() {
            write!(svg, r#"<g data-docx-series="{i}">"#).unwrap();
            let mut path = String::new();
            let mut markers = String::new();
            let bevel = filled.then(|| bevel_width(*ser, style)).flatten();
            let mut vertices = Vec::new();
            let mut previous = None;
            let mut first = None;
            let mut gap = false;
            for p in &s.points {
                let n = number(p.value.as_deref()).or_else(|| (blanks == "zero").then_some(0.));
                let Some(n) = n else { continue };
                let index = u64::from(p.index);
                let (x, y) = locate(index, scale.position(n));
                if bevel.is_some() {
                    vertices.push((x, y));
                }
                let discontinuous = previous.is_some_and(|last| last + 1 != index);
                if discontinuous && blanks == "zero" {
                    let last = previous.unwrap();
                    let (px, py) = locate(last + 1, scale.position(0.));
                    append_line(&mut path, px, py, false);
                    if index > last + 2 {
                        let (px, py) = locate(index - 1, scale.position(0.));
                        append_line(&mut path, px, py, false);
                    }
                }
                gap |= discontinuous && blanks == "gap";
                append_line(
                    &mut path,
                    x,
                    y,
                    previous.is_none() || discontinuous && blanks == "gap",
                );
                previous = Some(index);
                first.get_or_insert((index, x, y));
                let symbol = marker_symbol(*ser, i, default_markers);
                let fill = colors.marker(i, Some(p.index));
                let outline = colors.marker_outline(i, Some(p.index));
                marker(
                    &mut markers,
                    symbol,
                    x,
                    y,
                    marker_size(*ser),
                    &fill,
                    &outline,
                );
            }
            if let (Some((a, x, y)), Some(z)) = (first, previous) {
                if blanks != "gap" || a == 0 && z + 1 == self.count {
                    if gap {
                        append_line(&mut path, x, y, false);
                    } else {
                        path.push('Z');
                    }
                }
                let stroke = if filled {
                    colors.outline(i, None).unwrap_or("none").to_owned()
                } else {
                    colors.line(i)
                };
                let fill = if filled {
                    colors.fill(i, None)
                } else {
                    "none".to_owned()
                };
                let width = line_width(Some(*ser), 3.);
                write!(svg,r#"<path d="{path}" fill="{fill}" stroke="{stroke}" stroke-width="{width:.2}" stroke-linejoin="round"/>"#).unwrap();
                if let Some(width) = bevel.filter(|_| !gap && fill != "none") {
                    shaded_edges(svg, &vertices, (cx, cy), width);
                }
                svg.push_str(&markers);
            }
            svg.push_str("</g>");
        }
        if let Some(grid) = foreground_grid {
            svg.push_str(&grid);
        }
    }

    fn draw_stock(&self, svg: &mut String, data: &ChartData, colors: &ChartColors) {
        let b = self.bounds;
        let scale = Scale::new(self.value, data, true, b.bottom - b.top);
        let y = |v| b.bottom - (b.bottom - b.top) * scale.position(v);
        let date = self.category.is_some_and(|n| chart_node(n, "dateAx"));
        let mut dates = BTreeMap::new();
        for p in data.series.iter().flat_map(|s| &s.points) {
            if let Some(d) = p
                .categories
                .first()
                .and_then(|c| number(Some(&c.label)))
                .filter(|v| (-657434. ..=2958465.).contains(v))
            {
                dates.insert(p.index, d);
            }
        }
        let datespan = if date && !dates.is_empty() {
            Some(
                dates
                    .values()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| {
                        (a.min(v), b.max(v))
                    }),
            )
        } else {
            None
        };
        let reverse = val(
            self.category.and_then(|n| child(n, "scaling")),
            "orientation",
        ) == Some("maxMin");
        let x = |i: u32| {
            let f = datespan.zip(dates.get(&i)).map_or(
                (f64::from(i) + 0.5) / self.count as f64,
                |((min, max), d)| (d - min + 0.5) / (max - min + 1.),
            );
            b.left + (if reverse { 1. - f } else { f }) * (b.right - b.left)
        };
        let grid = grid_stroke(self.value, colors);
        for n in scale.ticks() {
            if let Some(stroke) = &grid {
                write!(svg,r#"<path d="M{:.2} {:.2}H{:.2}" fill="none" stroke="{stroke}" shape-rendering="crispEdges"/>"#,b.left,y(n),b.right).unwrap();
            }
            if axis_visible(self.value, colors.legacy_defaults())
                && val(self.value, "tickLblPos") != Some("none")
            {
                let label = axis_number(self.value, n);
                text(
                    svg,
                    b.left - 5.,
                    y(n) + self.font * 0.35,
                    "end",
                    self.font,
                    &self.family,
                    &label,
                );
            }
        }
        let mut columns = BTreeMap::new();
        for (j, s) in data.series.iter().enumerate() {
            for p in &s.points {
                if let Some(v) = number(p.value.as_deref()) {
                    let entry = columns.entry(p.index).or_insert(StockRange {
                        high: v,
                        low: v,
                        open: None,
                        close: None,
                    });
                    entry.high = entry.high.max(v);
                    entry.low = entry.low.min(v);
                    if j == 0 {
                        entry.open = Some(v);
                    }
                    if j + 1 == data.series.len() {
                        entry.close = Some(v);
                    }
                }
            }
        }
        if axis_visible(self.category, colors.legacy_defaults())
            && val(self.category, "tickLblPos") != Some("none")
        {
            if let Some(first) = data.series.first() {
                for p in &first.points {
                    if let Some(c) = p.categories.first() {
                        let date_text = if date {
                            let epoch_1904 =
                                on(val(Some(self.group.document().root_element()), "date1904"));
                            let format = self
                                .category
                                .and_then(|a| child(a, "numFmt"))
                                .and_then(|n| n.attribute("formatCode"));
                            dates
                                .get(&p.index)
                                .zip(format)
                                .and_then(|(n, code)| date_label(*n, epoch_1904, code))
                        } else {
                            None
                        };
                        text(
                            svg,
                            x(p.index),
                            b.bottom + 1.25 * self.font,
                            "middle",
                            self.font,
                            &self.family,
                            date_text.as_deref().unwrap_or(&c.label),
                        );
                    }
                }
            }
        }
        let high_low = child(self.group, "hiLowLines");
        if let Some(node) = high_low {
            let (_, stroke) = paint(Some(node), colors, "none", "black");
            write!(
                svg,
                r#"<g stroke-width="{:.2}" shape-rendering="crispEdges">"#,
                line_width(Some(node), 1.)
            )
            .unwrap();
            for (index, values) in &columns {
                line(
                    svg,
                    x(*index),
                    y(values.high),
                    x(*index),
                    y(values.low),
                    &stroke,
                );
            }
            svg.push_str("</g>");
        }
        if let Some(bars) = child(self.group, "upDownBars") {
            let gap = number(val(Some(bars), "gapWidth"))
                .unwrap_or(150.)
                .clamp(0., 500.);
            let range = datespan.map_or(self.count as f64, |(min, max)| max - min + 1.);
            let body = (b.right - b.left) / (range * (1. + gap / 100.));
            for (i, values) in &columns {
                if let (Some(open), Some(close)) = (values.open, values.close) {
                    let up = close >= open;
                    let node = child(bars, if up { "upBars" } else { "downBars" });
                    let (fill, stroke) =
                        paint(node, colors, if up { "white" } else { "black" }, "black");
                    let y1 = y(open);
                    let y2 = y(close);
                    write!(svg,r#"<rect x="{:.2}" y="{:.2}" width="{body:.2}" height="{:.2}" fill="{fill}" stroke="{stroke}"/>"#,x(*i)-body/2.,y1.min(y2),(y1-y2).abs().max(0.5)).unwrap();
                }
            }
        }
        for (i, (s, ser)) in data.series.iter().zip(&self.series).enumerate() {
            write!(svg, r#"<g data-docx-series="{i}">"#).unwrap();
            let mut path = String::new();
            let mut markers = String::new();
            let symbol = marker_symbol(*ser, i, false);
            let mut previous = None;
            for p in &s.points {
                if let Some(n) = number(p.value.as_deref()) {
                    let px = x(p.index);
                    let py = y(n);
                    let new = previous != p.index.checked_sub(1) || path.is_empty();
                    append_line(&mut path, px, py, new);
                    previous = Some(p.index);
                    marker(
                        &mut markers,
                        symbol,
                        px,
                        py,
                        marker_size(*ser),
                        &colors.marker(i, Some(p.index)),
                        &colors.marker_outline(i, Some(p.index)),
                    );
                }
            }
            if let Some(stroke) = colors.outline(i, None).filter(|s| *s != "none") {
                write!(
                    svg,
                    r#"<path d="{path}" fill="none" stroke="{stroke}" stroke-width="{:.2}"/>"#,
                    line_width(Some(*ser), 2.)
                )
                .unwrap();
            }
            svg.push_str(&markers);
            svg.push_str("</g>");
        }
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
    let group = plot
        .children()
        .find(|n| chart_node(*n, "stockChart") || chart_node(*n, "radarChart"))?;
    let stock = chart_node(group, "stockChart");
    let kind = if stock { "stock" } else { "radar" };
    if data.series.iter().any(|s| s.chart_type != kind) {
        return None;
    }
    let style = val(Some(root), "style")
        .and_then(|n| n.parse().ok())
        .unwrap_or(2u16);
    let series: Vec<_> = group.children().filter(|n| chart_node(*n, "ser")).collect();
    if series.len() != data.series.len() {
        return None;
    }
    let category = plot
        .children()
        .find(|n| chart_node(*n, "catAx") || chart_node(*n, "dateAx"));
    let value = child(plot, "valAx");
    let base = text_props(Some(root), false);
    let font = font_size(base, 40. / 3.);
    let family = font_family(base, minor_latin.unwrap_or("Cambria"));
    let title = child(chart, "title");
    let title_props = text_props(title, true)
        .or(text_props(title, false))
        .or(base);
    let legacy = colors.legacy_defaults();
    let title_font = font_size(title_props, if legacy { 24. } else { font });
    let title_text = data.title.as_deref().or_else(|| {
        title.and_then(|_| (!on(val(Some(chart), "autoTitleDeleted"))).then_some("Chart Title"))
    });
    let legend = child(chart, "legend");
    let position = val(legend, "legendPos").unwrap_or("r");
    let side = matches!(position, "r" | "tr" | "l");
    let legend_props = text_props(legend, false).or(base);
    let legend_font = font_size(legend_props, font);
    let filled = val(Some(group), "radarStyle") == Some("filled");
    let auto_markers =
        !stock && !filled && style <= 16 && val(Some(group), "radarStyle") == Some("marker");
    let entries: Vec<_> = data
        .series
        .iter()
        .enumerate()
        .filter(|(i, _)| {
            !legend.is_some_and(|l| {
                l.children()
                    .filter(|n| chart_node(*n, "legendEntry"))
                    .any(|e| {
                        val(Some(e), "idx").and_then(|s| s.parse::<usize>().ok()) == Some(*i)
                            && on(val(Some(e), "delete"))
                    })
            })
        })
        .map(|(i, s)| {
            let key = if filled {
                legend_font * 0.55
            } else if !stock || colors.outline(i, None).is_some_and(|c| c != "none") {
                legend_font * 1.92
            } else {
                legend_font * 0.55
            };
            let name = s
                .name
                .clone()
                .unwrap_or_else(|| format!("Series {}", i + 1));
            let length = key + 2.7 + text_width(&name, legend_font);
            (i, name, key, length)
        })
        .collect();
    let legend_max = entries.iter().map(|e| e.3).fold(0., f64::max);
    let inset = if legacy { 20. / 3. } else { 44. / 3. };
    let title_reserved =
        val(title, "overlay").map_or(legacy, |v| explicitly_false(Some(v))) && title_text.is_some();
    let legend_width = if legacy {
        legend_max.min(width * 0.36)
    } else {
        legend_max
    };
    let mut bounds = Bounds {
        left: inset,
        right: width - inset,
        top: inset,
        bottom: height - inset,
    };
    if title_reserved {
        bounds.top += 12. + 1.16 * title_font;
    }
    if legend.is_some() && val(legend, "overlay").map_or(legacy, |v| explicitly_false(Some(v))) {
        if side {
            if position == "l" {
                bounds.left += legend_width + 8.;
            } else {
                bounds.right -= legend_width + 8.;
            }
        } else if position == "t" {
            bounds.top += legend_font * 2.35;
        } else {
            bounds.bottom -= legend_font * 2.35;
        }
    }
    if stock {
        if axis_visible(value, colors.legacy_defaults()) && val(value, "tickLblPos") != Some("none")
        {
            bounds.left += 2. * font;
        }
        if axis_visible(category, colors.legacy_defaults())
            && val(category, "tickLblPos") != Some("none")
        {
            bounds.bottom -= font * 1.7;
        }
    }
    if let Some(manual) = child(plot, "layout").and_then(|n| child(n, "manualLayout")) {
        let left = number(val(Some(manual), "x")).map_or(bounds.left, |v| v * width);
        let top = number(val(Some(manual), "y")).map_or(bounds.top, |v| v * height);
        bounds.right = number(val(Some(manual), "w")).map_or(bounds.right, |v| {
            if val(Some(manual), "wMode") == Some("edge") {
                v * width
            } else {
                left + v * width
            }
        });
        bounds.bottom = number(val(Some(manual), "h")).map_or(bounds.bottom, |v| {
            if val(Some(manual), "hMode") == Some("edge") {
                v * height
            } else {
                top + v * height
            }
        });
        bounds.top = top;
        bounds.left = left;
    }
    bounds.left = bounds.left.clamp(0., (width - 1.).max(0.));
    bounds.top = bounds.top.clamp(0., (height - 1.).max(0.));
    bounds.right = bounds.right.clamp(bounds.left, width.max(bounds.left));
    bounds.bottom = bounds.bottom.clamp(bounds.top, height.max(bounds.top));
    let rounded = if val(Some(root), "roundedCorners").map_or(legacy, |v| explicitly_false(Some(v)))
    {
        0.
    } else {
        40. / 3.
    };
    let (bg, border) = paint(Some(root), colors, "white", "#868686");
    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" rx="{rounded:.2}" fill="{bg}" stroke="{border}"/>"#
    );
    let count = data
        .series
        .iter()
        .flat_map(|s| s.points.last())
        .map(|p| u64::from(p.index) + 1)
        .max()
        .unwrap_or(1)
        .max(
            group
                .descendants()
                .filter(|n| chart_node(*n, "ptCount"))
                .filter_map(|n| n.attribute("val")?.parse::<u32>().ok())
                .map(u64::from)
                .max()
                .unwrap_or(1),
        );
    let spec = Plot {
        bounds,
        group,
        series,
        category,
        value,
        font,
        family,
        count,
    };
    let (bg, border) = paint(Some(plot), colors, "none", "none");
    if bg != "none" || border != "none" {
        let (w, h) = (bounds.right - bounds.left, bounds.bottom - bounds.top);
        let (x, y, w, h) = if stock {
            (bounds.left, bounds.top, w, h)
        } else {
            let s = w.min(h);
            (bounds.left + (w - s) / 2., bounds.top + (h - s) / 2., s, s)
        };
        write!(svg,r#"<rect x="{x:.2}" y="{y:.2}" width="{w:.2}" height="{h:.2}" fill="{bg}" stroke="{border}"/>"#).unwrap();
    }
    if stock {
        spec.draw_stock(&mut svg, data, colors);
    } else {
        spec.draw_radar(
            &mut svg,
            data,
            colors,
            val(Some(chart), "dispBlanksAs").unwrap_or("gap"),
            style,
        );
    }
    if let Some(label) = title_text {
        let shortened = elide(label, title_font, (width - inset * 2.) * 0.78);
        let weight = title_props.and_then(|p| p.attribute("b"));
        if !explicitly_false(weight) {
            svg.push_str(r#"<g font-weight="bold">"#);
        }
        text(
            &mut svg,
            width / 2.
                + if legacy && shortened != label {
                    title_font * 0.35
                } else {
                    0.
                },
            10.6 + title_font * 0.92,
            "middle",
            title_font,
            &font_family(title_props, minor_latin.unwrap_or("Cambria")),
            &shortened,
        );
        if !explicitly_false(weight) {
            svg.push_str("</g>");
        }
    }
    if legend.is_some() {
        let face = font_family(legend_props, minor_latin.unwrap_or("Cambria"));
        let spacing = legend_font * 0.87;
        let total = entries.iter().map(|e| e.3).sum::<f64>()
            + spacing * entries.len().saturating_sub(1) as f64;
        let mut x = if side {
            if position == "l" {
                inset
            } else {
                width - inset - legend_width + if legacy { legend_font * 0.35 } else { 0. }
            }
        } else {
            (width - total) / 2. + spacing / 2. - if stock { 0. } else { 3.5 }
        };
        let mut legend_rows = Vec::new();
        let row_height = legend_font * 1.22;
        let mut keys_height = 0.;
        for (i, name, key, length) in entries {
            let room = (legend_width - key - 6. - if legacy { 5. } else { 0. }).max(legend_font);
            let wrap = if legacy && side {
                fit_prefix(&name, legend_font, room)
            } else {
                name.len()
            };
            let (first, rest) = name.split_at(wrap);
            let second =
                (!rest.trim().is_empty()).then(|| elide(rest.trim_start(), legend_font, room));
            let row = if second.is_some() {
                row_height * 2.
            } else {
                row_height
            };
            if legacy
                && side
                && keys_height + row + row_height > bounds.bottom - bounds.top
                && !legend_rows.is_empty()
            {
                break;
            }
            legend_rows.push((i, first.to_owned(), second, key, length, row));
            keys_height += row + if side { 4. } else { 0. };
        }
        let mut y = if side {
            if legacy {
                (bounds.top + bounds.bottom - keys_height + row_height + 4.) / 2.
            } else {
                (height - (legend_rows.len().saturating_sub(1) as f64) * legend_font * 1.5) / 2.
            }
        } else if position == "t" {
            1.5 * legend_font
        } else {
            height - 1.48 * legend_font
        };
        for (i, name, second, key, length, row) in legend_rows {
            if side && y > height {
                break;
            }
            if !side && x > width {
                break;
            }
            if filled {
                write!(
                    svg,
                    r#"<rect x="{x:.2}" y="{:.2}" width="{key:.2}" height="{key:.2}" fill="{}"/>"#,
                    y - key / 2.,
                    colors.fill(i, None)
                )
                .unwrap();
                if let Some(bevel) = bevel_width(spec.series[i], style) {
                    let top = y - key / 2.;
                    shaded_edges(
                        &mut svg,
                        &[
                            (x, top),
                            (x + key, top),
                            (x + key, top + key),
                            (x, top + key),
                        ],
                        (x + key / 2., y),
                        bevel,
                    );
                }
            } else {
                let ser = spec.series[i];
                let stroke = if stock {
                    colors.outline(i, None).unwrap_or("none").to_string()
                } else {
                    colors.line(i)
                };
                if stroke != "none" {
                    write!(svg,r#"<path d="M{x:.2} {y:.2}h{key:.2}" fill="none" stroke="{stroke}" stroke-width="{:.2}" stroke-linecap="round"/>"#,line_width(Some(ser),3.)).unwrap();
                }
                marker(
                    &mut svg,
                    marker_symbol(ser, i, auto_markers),
                    x + key / 2.,
                    y,
                    marker_size(ser).min(7.7),
                    &colors.marker(i, None),
                    &colors.marker_outline(i, None),
                );
            }
            text(
                &mut svg,
                x + key + 2.7,
                y + legend_font * 0.29,
                "start",
                legend_font,
                &face,
                &name,
            );
            if let Some(next) = second {
                text(
                    &mut svg,
                    x + key + 2.7,
                    y + row_height + legend_font * 0.29,
                    "start",
                    legend_font,
                    &face,
                    &next,
                );
            }
            if side {
                y += row + 4.;
            } else {
                x += length + spacing;
            }
        }
    }
    svg.push_str("</svg>");
    Some(svg)
}

#[cfg(test)]
mod tests {
    use super::date_label;

    #[test]
    fn numeric_date_axis_labels_respect_epoch_and_format() {
        assert_eq!(
            date_label(59., false, "dd/mm/yyyy").as_deref(),
            Some("28/02/1900")
        );
        assert_eq!(
            date_label(60., false, "dd/mm/yyyy").as_deref(),
            Some("29/02/1900")
        );
        assert_eq!(
            date_label(61., false, "dd/mm/yyyy").as_deref(),
            Some("01/03/1900")
        );
        assert_eq!(date_label(0., true, "m/d/yy").as_deref(), Some("1/1/04"));
        assert_eq!(
            date_label(36585., false, "yyyy-mm-dd").as_deref(),
            Some("2000-02-29")
        );
        assert_eq!(date_label(61., false, "0.00"), None);
    }
}
