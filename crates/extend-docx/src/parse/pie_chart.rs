//! DrawingML pie, doughnut, and split pie plots.
use super::chart_colors::ChartColors;
use super::chart_svg::{
    font_family, font_size, line, number, on, text, text_props, text_width, val,
};
use crate::chart::{chart_node, child, ChartData, ChartSeries};
use roxmltree::Node;
use std::collections::HashMap;
use std::f64::consts::{PI, TAU};
use std::fmt::Write;

struct Slice {
    index: u32,
    value: f64,
    weight: f64,
    name: String,
    explosion: f64,
}

fn slices(series: &ChartSeries, node: Node) -> Vec<Slice> {
    let explosion = |n| number(val(Some(n), "explosion")).map(|v| v.clamp(0., 400.) / 100.);
    let default_explosion = explosion(node).unwrap_or(0.);
    let overrides: HashMap<_, _> = node
        .children()
        .filter(|n| chart_node(*n, "dPt"))
        .filter_map(|n| Some((val(Some(n), "idx")?.parse::<u32>().ok()?, explosion(n)?)))
        .collect();
    let mut out: Vec<_> = series
        .points
        .iter()
        .map(|p| {
            let value = number(p.value.as_deref()).unwrap_or(0.);
            Slice {
                index: p.index,
                value,
                weight: value.abs(),
                name: p
                    .categories
                    .first()
                    .map(|c| c.label.clone())
                    .unwrap_or_else(|| (u64::from(p.index) + 1).to_string()),
                explosion: overrides
                    .get(&p.index)
                    .copied()
                    .unwrap_or(default_explosion),
            }
        })
        .collect();
    // Scale the weights before summing to keep very large finite values renderable.
    let max = out.iter().map(|p| p.weight).fold(0., f64::max);
    if max > 0. {
        for p in &mut out {
            p.weight /= max;
        }
    }
    out
}

#[derive(Clone, Copy)]
struct Circle {
    x: f64,
    y: f64,
    r: f64,
}
impl Circle {
    fn at(self, angle: f64) -> (f64, f64) {
        (self.x + self.r * angle.cos(), self.y + self.r * angle.sin())
    }

    fn displaced(self, distance: f64, angle: f64) -> Self {
        let (x, y) = Self {
            r: distance,
            ..self
        }
        .at(angle);
        Self { x, y, ..self }
    }
}

fn sector(
    svg: &mut String,
    circle: Circle,
    inner: f64,
    start: f64,
    sweep: f64,
    fill: &str,
    stroke: &str,
) {
    if sweep <= 0. || circle.r <= 0. {
        return;
    }
    let (x, y, r) = (circle.x, circle.y, circle.r);
    let (a, b) = circle.at(start);
    let (z, w) = circle.at(start + sweep);
    let inner_circle = Circle { r: inner, ..circle };
    let (u, v) = inner_circle.at(start + sweep);
    let (s, t) = inner_circle.at(start);
    if sweep >= TAU - 1e-10 {
        if inner <= 0. {
            write!(
                svg,
                r#"<circle cx="{x:.3}" cy="{y:.3}" r="{r:.3}" fill="{fill}" stroke="{stroke}"/>"#
            )
            .unwrap();
        } else {
            let (l, k) = circle.at(start + PI);
            let (il, ik) = inner_circle.at(start + PI);
            write!(svg,r#"<path d="M{a:.3} {b:.3}A{r:.3},{r:.3} 0 1 1 {l:.3},{k:.3}A{r:.3},{r:.3} 0 1 1 {a:.3},{b:.3}ZM{s:.3} {t:.3}A{inner:.3},{inner:.3} 0 1 0 {il:.3},{ik:.3}A{inner:.3},{inner:.3} 0 1 0 {s:.3},{t:.3}Z" fill="{fill}" fill-rule="evenodd" stroke="{stroke}"/>"#).unwrap();
        }
        return;
    }
    let long = u8::from(sweep > PI);
    write!(
        svg,
        r#"<path d="M{a:.3},{b:.3}A{r:.3},{r:.3} 0 {long} 1 {z:.3},{w:.3}"#
    )
    .unwrap();
    if inner > 0. {
        write!(
            svg,
            "L{u:.3},{v:.3}A{inner:.3},{inner:.3} 0 {long} 0 {s:.3},{t:.3}"
        )
        .unwrap();
    } else {
        write!(svg, "L{x:.3},{y:.3}").unwrap();
    }
    write!(svg, r#"Z" fill="{fill}" stroke="{stroke}"/>"#).unwrap();
}

struct LabelStyle<'a> {
    options: Node<'a, 'a>,
    series: &'a str,
    size: f64,
    face: &'a str,
    legacy: bool,
}

impl LabelStyle<'_> {
    fn write(
        &self,
        svg: &mut String,
        p: &Slice,
        fraction: f64,
        x: f64,
        y: f64,
        max_width: f64,
        color: &str,
    ) {
        let over = self.options.children().find(|n| {
            chart_node(*n, "dLbl")
                && val(Some(*n), "idx").and_then(|s| s.parse().ok()) == Some(p.index)
        });
        if on(val(over, "delete")) {
            return;
        }
        let shown = |name| {
            over.and_then(|o| child(o, name))
                .or_else(|| child(self.options, name))
                .map_or(!self.legacy, |n| {
                    !matches!(n.attribute("val"), Some("0" | "false" | "off"))
                })
        };
        let mut items = Vec::new();
        if shown("showSerName") && !self.series.is_empty() {
            items.push(self.series.to_owned())
        }
        if shown("showCatName") {
            items.push(p.name.clone())
        }
        if shown("showVal") {
            items.push(p.value.to_string())
        }
        if shown("showPercent") {
            items.push(format!("{:.0}%", fraction * 100.))
        }
        let separator = child(self.options, "separator")
            .and_then(|s| s.text())
            .unwrap_or(", ");
        let key = if shown("showLegendKey") {
            self.size * 0.53
        } else {
            0.
        };
        let mut rows = Vec::new();
        for section in items.join(separator).lines() {
            let mut line = String::new();
            for word in section.split_inclusive([' ', '-']) {
                if !line.is_empty()
                    && text_width(line.trim_end(), self.size)
                        + text_width(word.trim_end(), self.size)
                        > max_width
                {
                    rows.push(line.trim_end().to_owned());
                    line.clear();
                }
                line.push_str(word);
            }
            if !line.is_empty() {
                rows.push(line.trim_end().to_owned());
            }
        }
        let start = y + self.size * 0.32 - rows.len().saturating_sub(1) as f64 * self.size * 0.58;
        for (i, row) in rows.iter().enumerate() {
            let mut cx = x;
            if i == 0 && key > 0. {
                let left = x - (text_width(row, self.size) + key + 3.) / 2.;
                write!(svg,r#"<rect x="{left:.2}" y="{:.2}" width="{key:.2}" height="{key:.2}" fill="{color}"/>"#,start-key).unwrap();
                cx += (key + 3.) / 2.;
            }
            text(
                svg,
                cx,
                start + i as f64 * self.size * 1.16,
                "middle",
                self.size,
                self.face,
                row,
            );
        }
    }
}

struct Ring<'a> {
    circle: Circle,
    inner: f64,
    start: f64,
    series: usize,
    colors: &'a ChartColors,
    overall: f64,
    labels: Option<&'a LabelStyle<'a>>,
}

impl Ring<'_> {
    fn draw(&self, svg: &mut String, label_svg: &mut String, slices: &[&Slice]) {
        let sum: f64 = slices.iter().map(|p| p.weight).sum();
        if sum <= 0. {
            return;
        }
        let mut angle = self.start;
        for p in slices.iter().filter(|p| p.weight > 0.) {
            let sweep = p.weight / sum * TAU;
            let bisector = angle + sweep / 2.;
            let circle = self.circle.displaced(self.circle.r * p.explosion, bisector);
            let fill = self.colors.fill(self.series, Some(p.index));
            let stroke = self
                .colors
                .outline(self.series, Some(p.index))
                .unwrap_or("none");
            sector(svg, circle, self.inner, angle, sweep, &fill, stroke);
            if let Some(labels) = self.labels {
                let placement = val(Some(labels.options), "dLblPos").unwrap_or("bestFit");
                let r = if placement == "outEnd" || (placement == "bestFit" && sweep < 0.25 * PI) {
                    circle.r * 1.13
                } else {
                    (circle.r + self.inner) * 0.58
                };
                let (x, y) = Circle { r, ..circle }.at(bisector);
                labels.write(
                    label_svg,
                    p,
                    p.weight / self.overall,
                    x,
                    y,
                    (circle.r * 0.64).max(labels.size * 3.),
                    &fill,
                );
            }
            angle += sweep;
        }
    }
}

fn split<'a>(group: Node, points: &'a [Slice], total: f64) -> (Vec<&'a Slice>, Vec<&'a Slice>) {
    let position = number(val(Some(group), "splitPos"));
    let mode = val(Some(group), "splitType").unwrap_or("auto");
    let count = position
        .unwrap_or((points.len() as f64 / 3.).round().max(1.))
        .max(0.) as usize;
    let last = points
        .len()
        .saturating_sub(count.min(points.len().saturating_sub(1)));
    let selected: std::collections::HashSet<u32> = child(group, "custSplit")
        .into_iter()
        .flat_map(|n| n.children())
        .filter(|n| chart_node(*n, "secondPiePt"))
        .filter_map(|n| n.attribute("val")?.parse().ok())
        .collect();
    let (mut primary, mut secondary) = (Vec::new(), Vec::new());
    for (i, p) in points.iter().enumerate() {
        let in_second = match mode {
            "val" => p.value < position.unwrap_or(0.),
            "percent" => p.weight / total * 100. < position.unwrap_or(0.),
            "cust" => selected.contains(&p.index),
            _ => i >= last,
        };
        if in_second {
            secondary.push(p);
        } else {
            primary.push(p);
        }
    }
    (primary, secondary)
}

fn draw_split(
    svg: &mut String,
    label_svg: &mut String,
    group: Node,
    points: &[Slice],
    frame: Frame,
    colors: &ChartColors,
    labels: Option<&LabelStyle>,
) {
    let total = points.iter().map(|p| p.weight).sum::<f64>();
    if total <= 0. {
        return;
    }
    let (mut first, second) = split(group, points, total);
    let combined = second.iter().map(|p| p.weight).sum::<f64>();
    let total_value = second.iter().map(|p| p.value.abs()).sum::<f64>();
    let explosion = points.iter().map(|p| p.explosion).fold(0., f64::max);
    if first.is_empty() || combined <= 0. || second.is_empty() {
        let circle = Circle {
            x: frame.x,
            y: frame.y,
            r: frame.width.min(frame.height) / 2. / (1. + explosion),
        };
        Ring {
            circle,
            inner: 0.,
            start: -PI / 2.,
            series: 0,
            colors,
            overall: total,
            labels,
        }
        .draw(svg, label_svg, &points.iter().collect::<Vec<_>>());
        return;
    }
    let other = Slice {
        index: points
            .iter()
            .map(|p| p.index)
            .max()
            .unwrap_or(0)
            .saturating_add(1),
        value: total_value,
        weight: combined,
        name: "Other".into(),
        explosion,
    };
    first.push(&other);
    let bar = val(Some(group), "ofPieType") == Some("bar");
    let scale = number(val(Some(group), "secondPieSize"))
        .unwrap_or(75.)
        .clamp(5., 200.)
        / 100.;
    let gap = number(val(Some(group), "gapWidth"))
        .unwrap_or(150.)
        .clamp(0., 500.)
        / 100.;
    let units = if bar {
        2. + gap / 2. + scale
    } else {
        2. + gap + scale * 2.
    };
    let label_inset = if labels.is_some() { 0.125 } else { 0. };
    let space_w = (frame.width - (frame.width + 88. / 3.) * label_inset).max(1.);
    let space_h = (frame.height - (frame.height + 88. / 3.) * label_inset).max(1.);
    let effective = (space_w / units).min(space_h / 2. / scale.max(1.));
    let radius = effective / (1. + explosion);
    let left = frame.x - units * effective / 2.;
    let main = Circle {
        x: left + effective,
        y: frame.y,
        r: radius,
    };
    let right = left + units * effective;
    let start = PI * combined / total;
    let secondary_radius = scale * radius;
    let secondary = Circle {
        x: right - scale * effective,
        y: frame.y,
        r: secondary_radius,
    };
    let bar_left = right - scale * effective;
    if let Some(lines) = child(group, "serLines") {
        let stroke = child(lines, "spPr")
            .and_then(|p| colors.shape_stroke(p))
            .unwrap_or_else(|| "black".to_owned());
        let shifted = main.displaced(radius * other.explosion, 0.);
        for sign in [-1., 1.] {
            let (x, y) = shifted.at(sign * start);
            let (x2, y2) = if bar {
                (bar_left, frame.y + sign * scale * effective)
            } else {
                let vertical = sign * PI / 2.;
                let mut angle = start;
                let mut edge = secondary.at(vertical);
                for p in &second {
                    let sweep = TAU * p.weight / combined;
                    if (vertical - angle).rem_euclid(TAU) <= sweep {
                        edge = secondary
                            .displaced(secondary_radius * p.explosion, angle + sweep / 2.)
                            .at(vertical);
                        break;
                    }
                    angle += sweep;
                }
                edge
            };
            line(svg, x, y, x2, y2, &stroke);
        }
    }
    let ring = Ring {
        circle: main,
        inner: 0.,
        series: 0,
        colors,
        start,
        overall: total,
        labels,
    };
    ring.draw(svg, label_svg, &first);
    if bar {
        let mut y = frame.y - scale * effective;
        for p in second {
            let h = 2. * scale * effective * p.weight / combined;
            let fill = colors.fill(0, Some(p.index));
            let stroke = colors.outline(0, Some(p.index)).unwrap_or("none");
            let w = scale * effective;
            write!(svg,r#"<rect x="{bar_left:.3}" y="{y:.3}" width="{w:.3}" height="{h:.3}" fill="{fill}" stroke="{stroke}"/>"#).unwrap();
            if let Some(labels) = labels {
                labels.write(
                    label_svg,
                    p,
                    p.weight / total,
                    if labels.legacy {
                        bar_left + w + labels.size
                    } else {
                        bar_left + w / 2.
                    },
                    y + h / 2.,
                    w,
                    &fill,
                );
            }
            y += h;
        }
    } else {
        Ring {
            circle: secondary,
            ..ring
        }
        .draw(svg, label_svg, &second);
    }
}

#[derive(Clone, Copy)]
struct Frame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn plot_frame(plot: Node, width: f64, height: f64) -> Frame {
    let layout = child(plot, "layout").and_then(|n| child(n, "manualLayout"));
    let left = number(val(layout, "x")).unwrap_or(0.).clamp(0., 1.) * width;
    let top = number(val(layout, "y")).unwrap_or(0.).clamp(0., 1.) * height;
    let w = number(val(layout, "w")).map_or(width - 88. / 3., |n| n.clamp(0., 1.) * width);
    let h = number(val(layout, "h")).map_or(height - 88. / 3., |n| n.clamp(0., 1.) * height);
    Frame {
        x: if layout.is_some() {
            left + w / 2.
        } else {
            width / 2.
        },
        y: if layout.is_some() {
            top + h / 2.
        } else {
            height / 2.
        },
        width: w.max(1.),
        height: h.max(1.),
    }
}

fn legend(
    svg: &mut String,
    node: Node,
    entries: &[(usize, u32, &str)],
    colors: &ChartColors,
    width: f64,
    height: f64,
    size: f64,
    face: &str,
) {
    let pos = val(Some(node), "legendPos").unwrap_or("r");
    let side = matches!(pos, "l" | "r" | "tr");
    let hidden: std::collections::HashSet<u32> = node
        .children()
        .filter(|n| chart_node(*n, "legendEntry") && on(val(Some(*n), "delete")))
        .filter_map(|n| val(Some(n), "idx")?.parse().ok())
        .collect();
    let items: Vec<_> = entries
        .iter()
        .filter(|(_, idx, _)| !hidden.contains(idx))
        .map(|e| (e, text_width(e.2, size)))
        .collect();
    let key = size * 0.527;
    let step = size * 1.76;
    let max_name = items.iter().map(|(_, w)| *w).fold(0., f64::max);
    let total = items
        .iter()
        .map(|(_, w)| w + key + size * 0.95)
        .sum::<f64>();
    let mut x = if side {
        if pos == "l" {
            size
        } else {
            width - size - max_name - key - size * 0.225
        }
    } else {
        (width - total) / 2. + size * 0.32
    };
    let n = if side {
        items.len().min((height / step).floor() as usize)
    } else {
        items.len()
    };
    let mut y = if side {
        if pos == "tr" {
            size * 1.5
        } else {
            (height - (n.saturating_sub(1) as f64) * step) / 2.
        }
    } else if pos == "t" {
        size * 1.48
    } else {
        height - size * 1.48
    };
    for (&(series, index, label), w) in items.into_iter().take(n) {
        let fill = colors.fill(series, Some(index));
        let stroke = colors.outline(series, Some(index)).unwrap_or("none");
        write!(svg,r#"<rect x="{x:.2}" y="{:.2}" width="{key:.2}" height="{key:.2}" fill="{fill}" stroke="{stroke}"/>"#,y-key/2.).unwrap();
        text(
            svg,
            x + key + size * 0.225,
            y + size * 0.3,
            "start",
            size,
            face,
            label,
        );
        if side {
            y += step;
        } else {
            x += w + key + size * 0.95;
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
    let group = plot.children().find(|n| {
        ["pieChart", "doughnutChart", "ofPieChart"]
            .iter()
            .any(|k| chart_node(*n, k))
    })?;
    let kind = group.tag_name().name().strip_suffix("Chart")?;
    if data.series.is_empty() || data.series.iter().any(|s| s.chart_type != kind) {
        return None;
    }
    let base_props = text_props(Some(root), false);
    let size = font_size(base_props, 40. / 3.);
    let face = font_family(base_props, minor_latin.unwrap_or("Calibri"));
    let mut frame = plot_frame(plot, width, height);
    let legacy = colors.legacy_defaults();
    let paint = child(root, "spPr");
    let bg = paint
        .and_then(|n| colors.shape_fill(n))
        .unwrap_or_else(|| "white".to_string());
    let border = paint
        .and_then(|n| colors.shape_stroke(n))
        .unwrap_or_else(|| "#868686".to_string());
    let corner = if !val(Some(root), "roundedCorners").map_or(!legacy, |v| on(Some(v))) {
        0.
    } else {
        40. / 3.
    };
    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="{width}" height="{height}" rx="{corner:.2}" fill="{bg}" stroke="{border}"/>"#
    );
    let mut label_svg = String::new();
    let nodes: Vec<_> = group.children().filter(|n| chart_node(*n, "ser")).collect();
    let count = if kind == "doughnut" { nodes.len() } else { 1 };
    let sets: Vec<_> = data
        .series
        .iter()
        .zip(nodes.iter().copied())
        .take(count)
        .map(|(s, n)| slices(s, n))
        .collect();
    let mut ring_order: Vec<_> = (0..sets.len()).collect();
    ring_order.sort_by_key(|i| {
        val(Some(nodes[*i]), "order")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(*i)
    });
    let first_index = *ring_order.first()?;
    let first = &sets[first_index];
    let legend_node = child(chart, "legend");
    let legend_props = text_props(legend_node, false).or(base_props);
    let legend_size = font_size(legend_props, size);
    let legend_face = font_family(legend_props, minor_latin.unwrap_or("Calibri"));
    let entries: Vec<_> = if sets.len() > 1 && !colors.vary_by_point(first_index) {
        ring_order
            .iter()
            .map(|&idx| {
                (
                    idx,
                    idx as u32,
                    data.series[idx].name.as_deref().unwrap_or(""),
                )
            })
            .collect()
    } else {
        first
            .iter()
            .map(|p| (first_index, p.index, p.name.as_str()))
            .collect()
    };
    let title = child(chart, "title");
    let title_props = text_props(title, true).or_else(|| text_props(title, false));
    let title_font = font_size(title_props, if legacy { 24. } else { size });
    let title_face = font_family(title_props, minor_latin.unwrap_or("Calibri"));
    if legacy
        && child(plot, "layout")
            .and_then(|n| child(n, "manualLayout"))
            .is_none()
    {
        if title.is_some() && !on(val(title, "overlay")) {
            let leading = if title_face.contains("Cambria") {
                1.17
            } else {
                1.22
            };
            let h = 12. + title_font * leading;
            frame.y += h / 2.;
            frame.height -= h;
        }
        if legend_node.is_some() && !on(val(legend_node, "overlay")) {
            let pos = val(legend_node, "legendPos").unwrap_or("r");
            if matches!(pos, "l" | "r" | "tr") {
                let longest = entries
                    .iter()
                    .map(|e| text_width(e.2, legend_size))
                    .fold(0., f64::max);
                let w = longest + legend_size * 1.055 + 13.333;
                frame.x += if pos == "l" { w / 2. } else { -w / 2. };
                frame.width -= w;
            } else {
                let h = legend_size * 1.76 + 8.;
                frame.y += if pos == "t" { h / 2. } else { -h / 2. };
                frame.height -= h;
            }
        }
        frame.width = frame.width.max(1.);
        frame.height = frame.height.max(1.);
    }
    let explosion = sets
        .iter()
        .flatten()
        .map(|p| p.explosion)
        .fold(0., f64::max);
    let r = frame.width.min(frame.height) / 2. / (1. + explosion);
    let hole = if kind == "doughnut" {
        number(val(Some(group), "holeSize"))
            .unwrap_or(50.)
            .clamp(10., 90.)
            / 100.
    } else {
        0.
    };
    let start = number(val(Some(group), "firstSliceAng"))
        .unwrap_or(0.)
        .to_radians()
        - PI / 2.;
    for (ring, i) in ring_order.into_iter().enumerate() {
        write!(svg, r#"<g data-docx-series="{i}">"#).unwrap();
        let points = &sets[i];
        let series = &data.series[i];
        let all_labels = child(nodes[i], "dLbls").or_else(|| child(group, "dLbls"));
        let labels = all_labels.map(|options| LabelStyle {
            options,
            series: series.name.as_deref().unwrap_or(""),
            size,
            face: &face,
            legacy,
        });
        if kind == "ofPie" {
            draw_split(
                &mut svg,
                &mut label_svg,
                group,
                points,
                frame,
                colors,
                labels.as_ref(),
            );
        } else {
            let band = r * (1. - hole) / count as f64;
            let inner = r * hole + band * ring as f64;
            Ring {
                circle: Circle {
                    x: frame.x,
                    y: frame.y,
                    r: inner + band,
                },
                inner,
                series: i,
                start,
                colors,
                labels: labels.as_ref(),
                overall: points.iter().map(|p| p.weight).sum(),
            }
            .draw(&mut svg, &mut label_svg, &points.iter().collect::<Vec<_>>());
        }
        svg.push_str("</g>");
    }
    svg.push_str(&label_svg);
    if title.is_some() {
        let props = title_props;
        let label = data
            .title
            .as_deref()
            .or_else(|| {
                if legacy {
                    data.series.first()?.name.as_deref()
                } else {
                    None
                }
            })
            .unwrap_or("Chart Title");
        let font = title_font;
        let bold = props
            .and_then(|n| n.attribute("b"))
            .map_or(true, |a| a != "0" && a != "false");
        if bold {
            svg.push_str("<g font-weight=\"bold\">");
        }
        text(
            &mut svg,
            width / 2.,
            10.4 + font * 0.925,
            "middle",
            font,
            &title_face,
            label,
        );
        if bold {
            svg.push_str("</g>");
        }
    }
    if let Some(node) = legend_node {
        legend(
            &mut svg,
            node,
            &entries,
            colors,
            width,
            height,
            legend_size,
            &legend_face,
        );
    }
    svg.push_str("</svg>");
    Some(svg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_slices_have_nonzero_area() {
        let circle = Circle {
            x: 50.,
            y: 50.,
            r: 40.,
        };
        let mut disk = String::new();
        sector(&mut disk, circle, 0., 0., TAU, "red", "none");
        assert_eq!(
            roxmltree::Document::parse(&disk)
                .unwrap()
                .root_element()
                .tag_name()
                .name(),
            "circle"
        );
        let mut annulus = String::new();
        sector(&mut annulus, circle, 20., 0., TAU, "red", "none");
        let svg = roxmltree::Document::parse(&annulus).unwrap();
        assert_eq!(
            svg.root_element()
                .attribute("d")
                .unwrap()
                .matches('A')
                .count(),
            4
        );
        assert_eq!(svg.root_element().attribute("fill-rule"), Some("evenodd"));
    }

    #[test]
    fn custom_subplots_use_source_point_indices() {
        let doc=roxmltree::Document::parse(r#"<ofPieChart xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart"><splitType val="cust"/><custSplit><secondPiePt val="7"/></custSplit></ofPieChart>"#).unwrap();
        let points = [1, 4, 7].map(|index| Slice {
            index,
            value: 4.,
            weight: 1.,
            name: String::new(),
            explosion: 0.,
        });
        let (main, second) = split(doc.root_element(), &points, 3.);
        assert_eq!(main.iter().map(|p| p.index).collect::<Vec<_>>(), [1, 4]);
        assert_eq!(second.iter().map(|p| p.index).collect::<Vec<_>>(), [7]);
    }
}
