//! Layout of classic two-dimensional bubble charts.
use super::{chart_colors::ChartColors, util::escape_xml_text};
use crate::chart::{chart_node, child, ChartData};
use roxmltree::Node;
use std::fmt::Write;

fn val<'a>(node: Option<Node<'a, 'a>>, name: &str) -> Option<&'a str> {
    child(node?, name)?.attribute("val")
}

fn number(s: Option<&str>) -> Option<f64> {
    s?.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}

fn on(s: Option<&str>) -> bool {
    matches!(s, Some("1" | "true" | "on"))
}

fn text_props<'a>(node: Option<Node<'a, 'a>>, rich: bool) -> Option<Node<'a, 'a>> {
    let node = node?;
    let root = if rich {
        child(node, "tx")
    } else {
        child(node, "txPr")
    }?;
    root.descendants()
        .find(|n| n.is_element() && matches!(n.tag_name().name(), "rPr" | "defRPr"))
}

fn font_size(props: Option<Node>, default: f64) -> f64 {
    number(props.and_then(|p| p.attribute("sz")))
        .map(|n| (n / 75.).clamp(1., 512.))
        .unwrap_or(default)
}

fn font_family(props: Option<Node>, default: &str) -> String {
    let name = props
        .and_then(|p| p.children().find(|n| n.tag_name().name() == "latin"))
        .and_then(|n| n.attribute("typeface"))
        .filter(|s| !s.starts_with('+') && !s.is_empty())
        .unwrap_or(default);
    let fallback = if matches!(name, "Cambria" | "Times New Roman" | "Georgia") {
        "serif"
    } else {
        "sans-serif"
    };
    format!("{}, {fallback}", escape_xml_text(name))
}

fn text_width(s: &str, size: f64) -> f64 {
    // The model has no platform font shaper. Keep these advances in ems so
    // margins track the text size even when the browser substitutes a font.
    size * s
        .chars()
        .map(|c| match c {
            '0'..='9' => 0.554,
            'i' | 'l' | '.' | ',' | ' ' => 0.25,
            '-' | 't' | 'f' => 0.335,
            'r' => 0.415,
            'M' | 'W' | 'm' | 'w' => 0.8,
            'S' => 0.50,
            'o' => 0.531,
            'h' | 'u' | 'n' => 0.552,
            'A'..='Z' => 0.68,
            _ if c.is_ascii() => 0.54,
            _ => 1.,
        })
        .sum::<f64>()
}

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

fn line(svg: &mut String, x: f64, y: f64, x2: f64, y2: f64, stroke: &str) {
    write!(
        svg,
        r#"<path d="M{x:.2} {y:.2}L{x2:.2} {y2:.2}" fill="none" stroke="{stroke}"/>"#
    )
    .unwrap();
}

fn text(svg: &mut String, x: f64, y: f64, anchor: &str, size: f64, family: &str, label: &str) {
    write!(svg, r#"<text x="{x:.2}" y="{y:.2}" text-anchor="{anchor}" font-size="{size:.2}" font-family="{family}">{}</text>"#, escape_xml_text(label)).unwrap();
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
    let title = child(chart, "title");
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
    let title_height = if data.title.is_some() && !on(val(title, "overlay")) {
        12. + tf * 1.15
    } else {
        0.
    };
    let rounded = !matches!(
        val(Some(root), "roundedCorners"),
        Some("0" | "false" | "off")
    );
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
    if let Some(title) = &data.title {
        text(
            &mut svg,
            width / 2.,
            10.33 + tf * 0.917,
            "middle",
            tf,
            &font_family(title_props, "Arial"),
            title,
        );
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
    let name_width = entries
        .iter()
        .map(|(_, _, n)| text_width(n, lf))
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
    let top = (7. + title_height + above + yf * (4. / 7.)).min(height * 0.75);
    let bottom = (height - 7. - below - yf * (4. / 7.)).max(top + 1.);
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
    let x_labels = val(x_ax, "tickLblPos") != Some("none") && !on(val(x_ax, "delete"));
    let widest_y = y_axis
        .ticks()
        .map(|v| text_width(&y_axis.label(v), yf))
        .fold(0., f64::max);
    let legend_left = if legend_pos == "l" { legend_width } else { 0. };
    let reversed = val(x_ax.and_then(|n| child(n, "scaling")), "orientation") == Some("maxMin");
    let outside_y = y_labels && xr.1 >= 0.;
    let gutter = 8.67 + widest_y + 0.903 * yf;
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
    let x = |n| left + x_axis.fraction(n) * (right - left);
    let y = |n| bottom - y_axis.fraction(n) * (bottom - top);
    let vline = left + x_axis.crossing(y_ax) * (right - left);
    let hline = bottom - y_axis.crossing(x_ax) * (bottom - top);
    let (plot_fill, plot_stroke) = shape_paint(plot, "none", "none");
    if plot_fill != "none" || plot_stroke != "none" {
        write!(svg,r#"<rect x="{left:.2}" y="{top:.2}" width="{:.2}" height="{:.2}" fill="{plot_fill}" stroke="{plot_stroke}"/>"#,right-left,bottom-top).unwrap();
    }
    let mut labels = String::new();
    for (horizontal, node, axis, font, face, show_labels) in [
        (true, x_ax, &x_axis, xf, &xface, x_labels),
        (false, y_ax, &y_axis, yf, &yface, y_labels),
    ] {
        if on(val(node, "delete")) {
            continue;
        }
        let grid = node
            .and_then(|n| child(n, "majorGridlines"))
            .map(|n| shape_paint(n, "none", "black").1);
        let stroke = node
            .map(|n| shape_paint(n, "none", "black").1)
            .unwrap_or_else(|| "black".to_owned());
        let tick = match val(node, "majorTickMark") {
            Some("out" | "cross" | "in") => font * 0.317,
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
        write!(
            svg,
            r#"<circle cx="{cx:.2}" cy="{cy:.2}" r="{radius:.2}" fill="{}" stroke="{}"/>"#,
            if z < 0. {
                "white".into()
            } else {
                colors.fill(i, Some(idx))
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
        for (i, (series, point, name)) in entries.iter().enumerate() {
            let (cx, cy) = if side_legend {
                let text_x = if legend_pos == "l" {
                    13.5 + lf * 0.75
                } else {
                    width - 13.5 - name_width
                };
                (
                    text_x - lf * 0.5,
                    mid + (i as f64 - (entries.len() as f64 - 1.) / 2.) * line_height,
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
                lf * 0.264,
                colors.fill(*series, *point),
                colors.outline(*series, *point).unwrap_or("none")
            )
            .unwrap();
            text(
                &mut svg,
                cx + lf * 0.5,
                cy + lf * 0.31,
                "start",
                lf,
                &lface,
                name,
            );
        }
    }
    svg.push_str("</svg>");
    Some(svg)
}

#[cfg(test)]
mod tests {
    use super::*;

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
