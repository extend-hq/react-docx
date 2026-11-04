//! Layout of classic bubble charts.
use super::chart_colors::ChartColors;
use super::chart_svg::{
    font_family, font_size, line, number, on, text, text_props, text_width, val,
};
use crate::chart::{chart_node, child, ChartData};
use roxmltree::Node;
use std::fmt::Write;

#[derive(Clone, Copy)]
struct Axis {
    low: f64,
    high: f64,
    unit: f64,
    multiplier: f64,
    reversed: bool,
}

impl Axis {
    fn new(
        raw: (f64, f64),
        node: Option<Node>,
        length: f64,
        nominal_radius: f64,
        label_spacing: f64,
    ) -> Self {
        let scaling = node.and_then(|n| child(n, "scaling"));
        let explicit_min = number(val(scaling, "min"));
        let explicit_max = number(val(scaling, "max"));
        // Normalize by a power of ten before subtracting extreme signed values.
        let magnitude = raw
            .0
            .abs()
            .max(raw.1.abs())
            .max(explicit_min.unwrap_or(0.).abs())
            .max(explicit_max.unwrap_or(0.).abs());
        let multiplier = if magnitude > 0. {
            10f64.powf(magnitude.log10().floor().clamp(-308., 308.))
        } else {
            1.
        };
        let mut lo = raw.0 / multiplier;
        let mut hi = raw.1 / multiplier;
        if hi <= lo {
            let delta = lo.abs().max(1.) * 0.1;
            lo -= delta;
            hi += delta;
        }
        let pad = nominal_radius.min(length * 0.35)
            / (length - 2. * nominal_radius.min(length * 0.35)).max(1.)
            * (hi - lo);
        let mut lower = lo - pad;
        let mut upper = hi + pad;
        if lo > 0. && lo <= hi * 0.5 {
            lower = lower.min(0.);
        }
        if hi < 0. && hi >= lo * 0.5 {
            upper = upper.max(0.);
        }
        lower = explicit_min.map_or(lower, |v| v / multiplier);
        upper = explicit_max.map_or(upper, |v| v / multiplier);
        if upper <= lower {
            upper = lower + lower.abs().max(1.);
        }
        let intervals = (length / label_spacing.max(1.)).floor().clamp(1., 40.);
        let desired = ((upper - lower) / intervals).max(1e-300);
        let decade = 10f64.powf(desired.log10().floor());
        let nice = [1., 2., 5., 10.]
            .into_iter()
            .find(|factor| desired <= decade * factor * 1.005)
            .unwrap_or(10.);
        let unit = number(val(node, "majorUnit"))
            .map(|n| n / multiplier)
            .filter(|u| *u > 0. && u.is_finite())
            .unwrap_or(decade * nice);
        let low = explicit_min.map_or((lower / unit).floor() * unit, |v| v / multiplier);
        let high = explicit_max.map_or((upper / unit).ceil() * unit, |v| v / multiplier);
        let (low, high, unit) =
            if !low.is_finite() || !high.is_finite() || high <= low || !unit.is_finite() {
                (lower, upper, upper - lower)
            } else {
                (low, high, unit)
            };
        Self {
            low,
            high,
            unit,
            multiplier,
            reversed: val(scaling, "orientation") == Some("maxMin"),
        }
    }
    fn fraction(&self, normalized: f64) -> f64 {
        let f = (normalized - self.low) / (self.high - self.low);
        if self.reversed {
            1. - f
        } else {
            f
        }
    }
    fn crossing(&self, other: Option<Node>) -> f64 {
        let target = number(val(other, "crossesAt")).map_or_else(
            || match val(other, "crosses") {
                Some("max") => self.high,
                Some("min") => self.low,
                _ => 0.,
            },
            |v| v / self.multiplier,
        );
        self.fraction(target.clamp(self.low, self.high))
    }
    fn ticks(&self) -> impl Iterator<Item = f64> + '_ {
        (0..=128)
            .map(|i| self.low + f64::from(i) * self.unit)
            .take_while(|v| *v <= self.high + self.unit * 1e-8)
    }
    fn label(&self, n: f64) -> String {
        if !(n * self.multiplier).is_finite() {
            return format!("{n:.2}e{}", self.multiplier.log10().round() as i32);
        }
        let n = if n.abs() < self.unit.abs() * 1e-9 {
            0.
        } else {
            n * self.multiplier
        };
        if n == 0. {
            return "0".into();
        }
        if !(1e-6..1e12).contains(&n.abs()) {
            return format!("{n:.2e}");
        }
        format!("{n:.9}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_owned()
    }
}

fn legend_lines(name: &str, size: f64, limit: f64) -> Vec<&str> {
    let mut rest = name;
    let mut lines = Vec::new();
    while !rest.is_empty() {
        let mut width = 0.;
        let mut end = 0;
        let mut boundary = 0;
        for (i, c) in rest.char_indices() {
            let next = i + c.len_utf8();
            width += text_width(&rest[i..next], size);
            if width > limit && end > 0 {
                break;
            }
            end = next;
            if c.is_whitespace() || c == '-' {
                boundary = end;
            }
        }
        if end < rest.len() && boundary > 0 {
            end = boundary;
        }
        lines.push(rest[..end].trim_end());
        if lines.len() >= 64 {
            break;
        }
        rest = rest[end..].trim_start();
    }
    if lines.is_empty() {
        lines.push("");
    }
    lines
}

// The bevel is lit from above and to the left, using the actual point paint as its material.
fn sphere_paint(svg: &mut String, fill: &str) -> Option<String> {
    let base = fill
        .strip_prefix('#')
        .filter(|v| v.len() == 6 && v.is_ascii())?;
    let rgb = [
        u8::from_str_radix(&base[0..2], 16).ok()? as f64,
        u8::from_str_radix(&base[2..4], 16).ok()? as f64,
        u8::from_str_radix(&base[4..6], 16).ok()? as f64,
    ];
    let id = format!("bubble-{base}");
    let luma = 0.213 * rgb[0] + 0.715 * rgb[1] + 0.072 * rgb[2];
    write!(
        svg,
        r#"<radialGradient id="{id}" cx="48%" cy="48%" r="53%" fx="40%" fy="32%">"#
    )
    .unwrap();
    for (offset, scale, shine) in [
        (0, 1.18, 40.),
        (15, 1.04, 5.),
        (40, 0.88, 0.),
        (67, 0.7, 0.),
        (87, 0.4, 0.),
        (100, 0.32, 0.),
    ] {
        let [r, g, b] = rgb.map(|c| {
            ((c + 0.2 * (c - luma)) * scale + shine)
                .round()
                .clamp(0., 255.) as u8
        });
        write!(
            svg,
            r##"<stop offset="{offset}%" stop-color="#{r:02X}{g:02X}{b:02X}"/>"##
        )
        .unwrap();
    }
    svg.push_str("</radialGradient>");
    Some(format!("url(#{id})"))
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
    let group = child(plot, "bubbleChart")?;
    if data.series.iter().any(|s| s.chart_type != "bubble") {
        return None;
    }
    let legacy = colors.legacy_defaults();
    let title = child(chart, "title");
    let title_label = data.title.as_deref().or_else(|| {
        if !legacy || title.is_none() || on(val(Some(chart), "autoTitleDeleted")) {
            return None;
        }
        Some(if data.series.len() == 1 {
            data.series[0].name.as_deref().unwrap_or("Chart Title")
        } else {
            "Chart Title"
        })
    });
    let legend = child(chart, "legend");
    let base_props = text_props(Some(root), false);
    let size = font_size(base_props, 40. / 3.);
    let default_face = minor_latin.unwrap_or("Calibri");
    let axis_by_pos = |horizontal| {
        plot.children().find(|n| {
            chart_node(*n, "valAx")
                && match val(Some(*n), "axPos") {
                    Some("b" | "t") => horizontal,
                    Some("l" | "r") => !horizontal,
                    _ => false,
                }
        })
    };
    let x_ax = axis_by_pos(true);
    let y_ax = axis_by_pos(false);
    let x_props = text_props(x_ax, false).or(base_props);
    let y_props = text_props(y_ax, false).or(base_props);
    let legend_props = text_props(legend, false).or(base_props);
    let (xf, yf, lf) = (
        font_size(x_props, size),
        font_size(y_props, size),
        font_size(legend_props, size),
    );
    let (xface, yface, lface) = (
        font_family(x_props, default_face),
        font_family(y_props, default_face),
        font_family(legend_props, default_face),
    );
    let title_props = text_props(title, true).or(text_props(title, false));
    let tf = font_size(title_props, 24.);
    let title_height = if title_label.is_some() && !on(val(title, "overlay")) {
        12. + tf * 1.15
    } else {
        0.
    };
    let rounded =
        val(Some(root), "roundedCorners").map_or(!legacy, |v| !matches!(v, "0" | "false" | "off"));
    let corner = if rounded { 40. / 3. } else { 0. };
    let shape_paint = |node: Node, default_fill: &str, default_stroke: &str| {
        let pr = child(node, "spPr");
        (
            pr.and_then(|n| colors.shape_fill(n))
                .unwrap_or_else(|| default_fill.to_owned()),
            pr.and_then(|n| colors.shape_stroke(n))
                .unwrap_or_else(|| default_stroke.to_owned()),
        )
    };
    let (background, border) = shape_paint(root, "white", "#868686");
    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="{width}" height="{height}" rx="{corner:.2}" fill="{background}" stroke="{border}"/>"#
    );
    if legacy {
        // Match the theme face's x-height when the browser substitutes a system face.
        svg.push_str(r#"<style>text[font-family^="Calibri,"]{font-size-adjust:0.46436}</style>"#);
    }
    if let Some(title) = title_label {
        let bold = title_props
            .and_then(|p| p.attribute("b"))
            .map_or(legacy, |s| on(Some(s)));
        if bold {
            svg.push_str(r#"<g font-weight="bold">"#);
        }
        text(
            &mut svg,
            width / 2.,
            10.33 + tf * 0.917,
            "middle",
            tf,
            &font_family(title_props, if legacy { default_face } else { "Arial" }),
            title,
        );
        if bold {
            svg.push_str("</g>");
        }
    }
    let mut entries = Vec::new();
    let mut points = Vec::new();
    let show_neg = on(val(Some(group), "showNegBubbles"));
    let size_is_width = val(Some(group), "sizeRepresents") == Some("w");
    let mut max_size = 0_f64;
    let (mut xr, mut yr) = (
        (f64::INFINITY, f64::NEG_INFINITY),
        (f64::INFINITY, f64::NEG_INFINITY),
    );
    for (s, series) in data.series.iter().enumerate() {
        if data.series.len() == 1 && on(val(Some(group), "varyColors")) {
            let capacity = ((height - title_height - 40. / 3.) / (lf * 1.16 + 8.))
                .floor()
                .clamp(1., 256.) as u32;
            let count = series
                .points
                .last()
                .map_or(0, |p| p.index.saturating_add(1))
                .min(capacity);
            for idx in 0..count {
                let name = series
                    .points
                    .binary_search_by_key(&idx, |p| p.index)
                    .ok()
                    .and_then(|i| series.points[i].x.as_deref())
                    .unwrap_or("");
                entries.push((s, Some(idx), name.to_owned()));
            }
        } else {
            entries.push((
                s,
                None,
                series
                    .name
                    .clone()
                    .unwrap_or_else(|| format!("Series {}", s + 1)),
            ));
        }
        for pt in &series.points {
            let (Some(x), Some(y), Some(z)) = (
                number(pt.x.as_deref()),
                number(pt.y.as_deref()),
                number(pt.bubble_size.as_deref()),
            ) else {
                continue;
            };
            xr = (xr.0.min(x), xr.1.max(x));
            yr = (yr.0.min(y), yr.1.max(y));
            if z == 0. || (z < 0. && !show_neg) {
                continue;
            }
            max_size = max_size.max(z.abs());
            points.push((s, pt.index, x, y, z));
        }
    }
    if !xr.0.is_finite() {
        xr = (0., 1.);
        yr = (0., 1.);
    }
    let legend_pos = val(legend, "legendPos").unwrap_or("r");
    let side_legend = matches!(legend_pos, "l" | "r" | "tr");
    if side_legend {
        entries.truncate(
            ((height - title_height - 40. / 3.) / (lf * 1.16 + 8.))
                .floor()
                .clamp(1., 256.) as usize,
        );
    }
    let name_lines: Vec<_> = entries
        .iter()
        .map(|(_, _, n)| {
            if legacy && side_legend {
                legend_lines(n, lf, (width * 0.19).max(lf))
            } else {
                vec![n.as_str()]
            }
        })
        .collect();
    let name_width = name_lines
        .iter()
        .flatten()
        .map(|n| text_width(n, lf) * if legacy { 0.87 } else { 1. })
        .fold(0., f64::max);
    let legend_width = if legend.is_some() && !on(val(legend, "overlay")) && side_legend {
        name_width + lf * 1.055 + 16.
    } else {
        0.
    };
    let legend_height = if legend.is_some() && !side_legend && !on(val(legend, "overlay")) {
        lf * 1.5
    } else {
        0.
    };
    let above = if legend_pos == "t" { legend_height } else { 0. };
    let below = legend_height - above;
    let inset = 20. / 3.;
    let x_labels = val(x_ax, "tickLblPos") != Some("none") && !on(val(x_ax, "delete"));
    let legacy_pad = if legacy && x_labels && yr.0 >= 0. && val(x_ax, "tickLblPos") != Some("high")
    {
        xf * 1.41
    } else {
        0.
    };
    let top = ((if legacy { 8.9 } else { 7. }) + title_height + above + yf * (4. / 7.))
        .min(height * 0.75);
    let bottom = (height - 7. - below - legacy_pad - yf * (4. / 7.)).max(top + 1.);
    // Size against the space left by the title and legend before allocating tick labels.
    // The diameter occupies 30% of the shorter dimension, including its own padding.
    let preliminary = (height - 2. * inset - title_height - legend_height)
        .min(width - 2. * inset - legend_width)
        .max(1.);
    let radius = |scale: f64| preliminary * 0.15 * scale / (1. + 0.3 * scale);
    let max_radius =
        radius((number(val(Some(group), "bubbleScale")).unwrap_or(100.) / 100.).clamp(0., 3.));
    let nominal_y_radius =
        (height - 2. * inset - title_height - legend_height).max(1.) * (0.15 / 1.3);
    let y_axis = Axis::new(yr, y_ax, bottom - top, nominal_y_radius, yf * 1.4);
    let y_labels = val(y_ax, "tickLblPos") != Some("none") && !on(val(y_ax, "delete"));
    let widest_y = y_axis
        .ticks()
        .map(|v| text_width(&y_axis.label(v), yf))
        .fold(0., f64::max);
    let legend_left = if legend_pos == "l" { legend_width } else { 0. };
    let reversed = val(x_ax.and_then(|n| child(n, "scaling")), "orientation") == Some("maxMin");
    let outside_y = y_labels && xr.1 >= 0.;
    let gutter = 8.67 + widest_y + (if legacy { 0.88 } else { 0.903 }) * yf;
    let mut left = (if outside_y && !reversed {
        gutter
    } else {
        14.67
    }) + legend_left;
    let mut right =
        width - (if outside_y && reversed { gutter } else { 14.67 }) - (legend_width - legend_left);
    let mut x_axis = Axis::new(xr, x_ax, (right - left).max(1.), radius(1.), xf * 3.5);
    if x_labels {
        if !outside_y || !reversed {
            let end = if reversed { x_axis.low } else { x_axis.high };
            right -= text_width(&x_axis.label(end), xf) / 2.;
        }
        if !outside_y || reversed {
            let start = if reversed { x_axis.high } else { x_axis.low };
            left += text_width(&x_axis.label(start), xf) / 2.;
        }
    }
    left = left.min(width - 2.);
    right = right.max(left + 1.);
    x_axis = Axis::new(xr, x_ax, right - left, radius(1.), xf * 3.5);
    if legacy
        && xr.0 >= 0.
        && x_axis.low < 0.
        && val(x_ax.and_then(|a| child(a, "scaling")), "min").is_none()
    {
        x_axis.low = 0.;
    }
    let x = |n| left + x_axis.fraction(n) * (right - left);
    let y = |n| bottom - y_axis.fraction(n) * (bottom - top);
    let vline = left + x_axis.crossing(y_ax) * (right - left);
    let hline = bottom - y_axis.crossing(x_ax) * (bottom - top);
    let (plot_fill, plot_stroke) = shape_paint(plot, "none", "none");
    if plot_fill != "none" || plot_stroke != "none" {
        write!(svg,r#"<rect x="{left:.2}" y="{top:.2}" width="{:.2}" height="{:.2}" fill="{plot_fill}" stroke="{plot_stroke}"/>"#,right-left,bottom-top).unwrap();
    }
    let mut labels = String::new();
    let axis_ink = if legacy { "#868686" } else { "black" };
    for (horizontal, node, axis, font, face, show_labels) in [
        (true, x_ax, &x_axis, xf, &xface, x_labels),
        (false, y_ax, &y_axis, yf, &yface, y_labels),
    ] {
        if on(val(node, "delete")) {
            continue;
        }
        let grid = node
            .and_then(|n| child(n, "majorGridlines"))
            .map(|n| shape_paint(n, "none", axis_ink).1);
        let stroke = node
            .map(|n| shape_paint(n, "none", axis_ink).1)
            .unwrap_or_else(|| axis_ink.to_owned());
        let tick = match val(node, "majorTickMark") {
            Some("out" | "cross" | "in") => font * 0.317,
            None if legacy => font * 0.317,
            _ => 0.,
        };
        for v in axis.ticks() {
            let mark = axis.label(v);
            if horizontal {
                let pos = x(v);
                if let Some(grid) = &grid {
                    line(&mut svg, pos, top, pos, bottom, grid);
                }
                let direction = if val(node, "majorTickMark") == Some("in") {
                    -1.
                } else {
                    1.
                };
                if tick > 0. {
                    line(&mut svg, pos, hline, pos, hline + direction * tick, &stroke);
                }
                if show_labels {
                    let base = match val(node, "tickLblPos") {
                        Some("high") => top - font * 0.45,
                        Some("low") => bottom + tick + font * 1.26,
                        _ => hline + tick + font * 1.26,
                    };
                    text(&mut labels, pos, base, "middle", font, face, &mark);
                }
            } else {
                let pos = y(v);
                if let Some(grid) = &grid {
                    line(&mut svg, left, pos, right, pos, grid);
                }
                let direction = if val(node, "majorTickMark") == Some("in") {
                    1.
                } else {
                    -1.
                };
                if tick > 0. {
                    line(
                        &mut svg,
                        vline,
                        pos,
                        vline + direction * tick * (if reversed { -1. } else { 1. }),
                        pos,
                        &stroke,
                    );
                }
                if show_labels {
                    let (base, anchor) = match val(node, "tickLblPos") {
                        Some("high") => (right + font * 0.9, "start"),
                        Some("low") => (left - font * 0.9, "end"),
                        _ if reversed => (vline + font * 0.9, "start"),
                        _ => (vline - font * 0.9, "end"),
                    };
                    text(
                        &mut labels,
                        base,
                        pos + font * 0.31,
                        anchor,
                        font,
                        face,
                        &mark,
                    );
                }
            }
        }
        if horizontal {
            line(&mut svg, left, hline, right, hline, &stroke);
        } else {
            line(&mut svg, vline, top, vline, bottom, &stroke);
        }
    }
    write!(svg,r#"<defs><clipPath id="plot"><rect x="{left:.2}" y="{top:.2}" width="{:.2}" height="{:.2}"/></clipPath></defs><g clip-path="url(#plot)">"#,right-left,bottom-top).unwrap();
    let flag = |node: Node| {
        child(node, "bubble3D").map(|n| n.attribute("val").is_none_or(|v| on(Some(v))))
    };
    let group_3d = flag(group).unwrap_or(false);
    let bevel_state: Vec<_> = group
        .children()
        .filter(|n| chart_node(*n, "ser"))
        .map(|ser| {
            let points = ser
                .children()
                .filter(|n| chart_node(*n, "dPt"))
                .filter_map(|p| Some((val(Some(p), "idx")?.parse::<u32>().ok()?, flag(p)?)))
                .collect::<std::collections::HashMap<_, _>>();
            (flag(ser).unwrap_or(group_3d), points)
        })
        .collect();
    let mut bevels = std::collections::HashMap::new();
    let mut defs = String::new();
    let mut paint = |i: usize, idx: Option<u32>, fill: String| {
        if bevel_state.get(i).is_some_and(|(series, points)| {
            idx.and_then(|p| points.get(&p)).copied().unwrap_or(*series)
        }) {
            bevels
                .entry(fill.clone())
                .or_insert_with(|| sphere_paint(&mut defs, &fill).unwrap_or(fill))
                .clone()
        } else {
            fill
        }
    };
    let shadow = legacy
        && val(Some(root), "style")
            .and_then(|v| v.parse::<u8>().ok())
            .is_some_and(|n| (25..=32).contains(&n));
    if shadow {
        svg.push_str("<defs>");
        svg.push_str(r#"<filter id="bubbleShadow" x="-70%" y="-70%" width="240%" height="270%"><feDropShadow dx="0.8" dy="2.8" stdDeviation="1.5" flood-opacity="0.43"/></filter>"#);
        svg.push_str("</defs>");
    }
    for (i, idx, vx, vy, z) in points {
        let ratio = z.abs() / max_size;
        let radius = max_radius * if size_is_width { ratio } else { ratio.sqrt() };
        let fx = x_axis.fraction(vx / x_axis.multiplier);
        let fy = y_axis.fraction(vy / y_axis.multiplier);
        if !fx.is_finite()
            || !fy.is_finite()
            || !(-10.0..=11.0).contains(&fx)
            || !(-10.0..=11.0).contains(&fy)
        {
            continue;
        }
        let (cx, cy) = (left + fx * (right - left), bottom - fy * (bottom - top));
        let shadow_attr = if shadow && z > 0. {
            r##" filter="url(#bubbleShadow)""##
        } else {
            ""
        };
        write!(
            svg,
            r#"<circle cx="{cx:.2}" cy="{cy:.2}" r="{radius:.2}" fill="{}" stroke="{}"{shadow_attr} data-docx-series="{i}"/>"#,
            if z < 0. {
                "white".into()
            } else {
                paint(i, Some(idx), colors.fill(i, Some(idx)))
            },
            if z < 0. {
                "black"
            } else {
                colors.outline(i, Some(idx)).unwrap_or("none")
            }
        )
        .unwrap();
    }
    svg.push_str("</g>");
    svg.push_str(&labels);
    if legend.is_some() {
        let line_height = lf * 1.16 + 8.;
        let mid = if legend_pos == "tr" {
            top + line_height * entries.len() as f64 / 2.
        } else {
            (top + bottom) / 2.
        };
        let total_width: f64 = entries
            .iter()
            .map(|(_, _, n)| text_width(n, lf) + lf * 1.2)
            .sum();
        let mut run_x = (width - total_width) / 2. + lf * 0.3;
        let wrapped_lines: usize = name_lines.iter().map(|ls| ls.len() - 1).sum();
        let mut wrap_before = 0;
        for (i, (series, point, name)) in entries.iter().enumerate() {
            write!(svg, r#"<g data-docx-series="{series}">"#).unwrap();
            let lines = &name_lines[i];
            let wrap_line_height = lf * 1.22;
            let (cx, cy) = if side_legend {
                let text_x = if legend_pos == "l" {
                    13.5 + lf * 0.75
                } else {
                    width - 13.5 - name_width
                };
                (
                    text_x - lf * 0.5,
                    mid + (i as f64 - (entries.len() as f64 - 1.) / 2.) * line_height
                        + (wrap_before as f64 - wrapped_lines as f64 / 2.) * wrap_line_height
                        + if legacy { lf * 0.75 } else { 0. },
                )
            } else {
                let x = run_x;
                run_x += text_width(name, lf) + lf * 1.2;
                (
                    x,
                    if legend_pos == "t" {
                        inset + title_height + lf * 0.65
                    } else {
                        height - inset - lf * 0.65
                    },
                )
            };
            write!(
                svg,
                r#"<circle cx="{cx:.2}" cy="{cy:.2}" r="{:.2}" fill="{}" stroke="{}"/>"#,
                lf * if legacy { 0.3 } else { 0.264 },
                paint(*series, *point, colors.fill(*series, *point)),
                colors.outline(*series, *point).unwrap_or("none")
            )
            .unwrap();
            wrap_before += lines.len() - 1;
            for (row, line) in lines.iter().enumerate() {
                text(
                    &mut svg,
                    cx + lf * 0.5,
                    cy + lf * 0.31 + row as f64 * wrap_line_height,
                    "start",
                    lf,
                    &lface,
                    line,
                );
            }
            svg.push_str("</g>");
        }
    }
    if !defs.is_empty() {
        write!(svg, "<defs>{defs}</defs>").unwrap();
    }
    svg.push_str("</svg>");
    Some(svg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_legend_wraps_at_breaks_then_character_boundaries() {
        assert_eq!(
            legend_lines("Y-Values", 40. / 3., 22.8),
            ["Y-", "Val", "ues"]
        );
        assert_eq!(legend_lines("增长率", 12., 13.), ["增", "长", "率"]);
    }

    #[test]
    fn bevel_depends_on_the_material_and_retains_explicit_non_solid_paint() {
        let mut out = String::new();
        assert_eq!(sphere_paint(&mut out, "url(#gradient)"), None);
        assert_eq!(
            sphere_paint(&mut out, "#000000").as_deref(),
            Some("url(#bubble-000000)")
        );
        assert!(!out.contains("NaN"));
        assert!(out.contains(r##"stop-color="#000000""##));
    }

    #[test]
    fn automatic_axis_reserves_room_for_bubbles_and_whole_ticks() {
        let axis = Axis::new((0., 7.5), None, 176., 23.6, 33.6);
        assert_eq!(
            axis.ticks().map(|v| axis.label(v)).collect::<Vec<_>>(),
            ["-5", "0", "5", "10"]
        );
        let taller = Axis::new((0., 7.5), None, 297., 37.5, 33.6);
        assert_eq!(
            taller.ticks().map(|v| taller.label(v)).collect::<Vec<_>>(),
            ["-2", "0", "2", "4", "6", "8", "10"]
        );
    }

    #[test]
    fn explicit_reversed_scale_honors_bounds_and_major_unit() {
        let doc=roxmltree::Document::parse(r#"<valAx xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart"><scaling><min val="-3"/><max val="9"/><orientation val="maxMin"/></scaling><majorUnit val="3"/></valAx>"#).unwrap();
        let axis = Axis::new((-100., 100.), Some(doc.root_element()), 200., 20., 20.);
        assert_eq!(
            axis.ticks().map(|v| axis.label(v)).collect::<Vec<_>>(),
            ["-3", "0", "3", "6", "9"]
        );
        assert_eq!(axis.fraction(axis.low), 1.);
        assert_eq!(axis.fraction(axis.high), 0.);
        assert!((axis.crossing(None) - 0.75).abs() < 1e-12);
    }

    #[test]
    fn opposite_extreme_values_produce_finite_positions_and_labels() {
        let axis = Axis::new((-f64::MAX, f64::MAX), None, 250., 25., 20.);
        for n in axis.ticks() {
            assert!(axis.fraction(n).is_finite());
            assert!(!axis.label(n).contains("inf"));
        }
        assert!(axis.fraction(f64::MAX / axis.multiplier) < 1.);
    }
}
