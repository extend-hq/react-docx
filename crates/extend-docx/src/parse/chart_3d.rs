use super::chart_colors::ChartColors;
use super::chart_svg::{
    font_family, font_size, line, number, on, text, text_props, text_width, val,
};
use crate::chart::{chart_node, child, ChartData};
use roxmltree::Node;
use std::collections::BTreeMap;
use std::fmt::Write;

mod axes;
mod pie;
mod planes;
mod surface;
mod table;

#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

struct Scene {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    low: f64,
    high: f64,
    step: f64,
    reverse_value: bool,
    model_height: f64,
    model_depth: f64,
    rot_x: f64,
    rot_y: f64,
    shear: bool,
    perspective: f64,
    origin: Point,
    scale: f64,
}

impl Scene {
    fn value(&self, value: f64) -> f64 {
        let t = ((value - self.low) / (self.high - self.low)).clamp(0., 1.);
        if self.reverse_value {
            1. - t
        } else {
            t
        }
    }

    fn camera(&self, x: f64, y: f64, z: f64) -> Point {
        let (sp, cp) = self.rot_x.to_radians().sin_cos();
        let (sy, cy) = self.rot_y.to_radians().sin_cos();
        let x = x - 0.5;
        let y = (y - 0.5) * self.model_height;
        let z = (z - 0.5) * self.model_depth;
        if self.shear {
            // Right-angle axes keep the front elevation undistorted.
            let facing = if cy >= 0. { 1. } else { -1. };
            return Point {
                x: facing * x + sy * z,
                y: -y - sp * z * facing,
            };
        }
        let depth = cy * z - sy * x;
        let denominator = (1. + (depth * cp - y * sp) * self.perspective).max(0.1);
        Point {
            x: (cy * x + sy * z) / denominator,
            y: (-y * cp - depth * sp) / denominator,
        }
    }

    fn project(&self, x: f64, y: f64, z: f64) -> Point {
        let p = self.camera(x, y, z);
        Point {
            x: self.origin.x + self.scale * p.x,
            y: self.origin.y + self.scale * p.y,
        }
    }

    fn fit(&mut self) {
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for x in [0., 1.] {
            for y in [0., 1.] {
                for z in [0., 1.] {
                    let p = self.camera(x, y, z);
                    x0 = x0.min(p.x);
                    y0 = y0.min(p.y);
                    x1 = x1.max(p.x);
                    y1 = y1.max(p.y);
                }
            }
        }
        self.scale = (self.width / (x1 - x0).max(1e-8)).min(self.height / (y1 - y0).max(1e-8));
        self.origin = Point {
            x: self.left + self.width / 2. - self.scale * (x0 + x1) / 2.,
            y: self.top + self.height / 2. - self.scale * (y0 + y1) / 2.,
        };
    }
}

fn polygon(out: &mut String, points: &[Point], fill: &str, stroke: &str) {
    if points.is_empty() {
        return;
    }
    out.push_str("<polygon points=\"");
    for p in points {
        write!(out, "{:.2},{:.2} ", p.x, p.y).unwrap();
    }
    write!(
        out,
        "\" fill=\"{fill}\" stroke=\"{stroke}\" stroke-linejoin=\"round\"/>"
    )
    .unwrap();
}

fn shade(fill: &str, factor: f64) -> String {
    let hex = fill.strip_prefix('#').unwrap_or("");
    if !(hex.len() == 6 || hex.len() == 8) || !hex.is_ascii() {
        return fill.to_owned();
    }
    let mut paint = String::from("#");
    for i in [0, 2, 4] {
        let Ok(c) = u8::from_str_radix(&hex[i..i + 2], 16) else {
            return fill.to_owned();
        };
        write!(
            paint,
            "{:02x}",
            (f64::from(c) * factor).round().clamp(0., 255.) as u8
        )
        .unwrap();
    }
    paint.push_str(&hex[6..]);
    paint
}

fn num(n: Option<Node>, name: &str) -> Option<f64> {
    number(val(n, name))
}

fn range(data: &ChartData, group: Node, axis: Option<Node>, intervals: f64) -> (f64, f64, f64) {
    let scaling = axis.and_then(|a| child(a, "scaling"));
    let grouping = val(Some(group), "grouping");
    let stacked = matches!(grouping, Some("stacked" | "percentStacked"));
    let mut totals = BTreeMap::<u32, (f64, f64)>::new();
    let (mut low, mut high) = (0_f64, 0_f64);
    for p in data.series.iter().flat_map(|s| &s.points) {
        let Some(v) = number(p.value.as_deref()) else {
            continue;
        };
        if stacked {
            let e = totals.entry(p.index).or_default();
            if v < 0. {
                e.0 += v
            } else {
                e.1 += v
            }
        } else {
            low = low.min(v);
            high = high.max(v)
        }
    }
    for (a, b) in totals.into_values() {
        low = low.min(a);
        high = high.max(b)
    }
    if grouping == Some("percentStacked") {
        low = if low < 0. { -1. } else { 0. };
        high = if high > 0. { 1. } else { 0. }
    }
    let min = num(scaling, "min");
    let max = num(scaling, "max");
    low = min.unwrap_or(low);
    high = max.unwrap_or(high);
    if low >= high || !(high - low).is_finite() {
        return (0., 1., 0.2);
    }
    let raw = (high - low) / intervals;
    let power = 10_f64.powf(raw.log10().floor());
    let auto = if power > 0. {
        [1., 2., 5., 10.]
            .into_iter()
            .find(|n| *n * power >= raw * 0.9999)
            .unwrap_or(10.)
            * power
    } else {
        raw
    };
    let step = num(axis, "majorUnit").filter(|v| *v > 0.).unwrap_or(auto);
    if step <= 0. || !step.is_finite() {
        return (0., 1., 0.2);
    }
    let low = min.unwrap_or_else(|| (low / step).floor() * step);
    let high = max.unwrap_or_else(|| (high / step).ceil() * step);
    if high <= low || !(high - low).is_finite() {
        (0., 1., 0.2)
    } else {
        (low, high, step)
    }
}

fn stroke_line(out: &mut String, a: Point, b: Point, color: &str) {
    line(out, a.x, a.y, b.x, b.y, color)
}

fn grids(
    out: &mut String,
    scene: &Scene,
    chart: Node,
    plot: Node,
    colors: &ChartColors,
    horizontal: bool,
) {
    let axis = child(plot, "valAx");
    let grid = axis.and_then(|a| child(a, "majorGridlines"));
    let grid_color = grid
        .and_then(|g| child(g, "spPr"))
        .and_then(|s| colors.shape_stroke(s))
        .unwrap_or_else(|| {
            if colors.legacy_defaults() {
                "#868686"
            } else {
                "#000000"
            }
            .into()
        });
    let point = |x, y, z| {
        if horizontal {
            scene.project(y, x, z)
        } else {
            scene.project(x, y, z)
        }
    };
    let back = if scene.rot_y.to_radians().cos() >= 0. {
        1.
    } else {
        0.
    };
    let side = if scene.rot_y.to_radians().sin() >= 0. {
        0.
    } else {
        1.
    };
    for (name, points) in [
        (
            "floor",
            [
                point(0., 0., 0.),
                point(1., 0., 0.),
                point(1., 0., 1.),
                point(0., 0., 1.),
            ],
        ),
        (
            "sideWall",
            [
                point(side, 0., back),
                point(side, 1., back),
                point(side, 1., 1. - back),
                point(side, 0., 1. - back),
            ],
        ),
        (
            "backWall",
            [
                point(0., 0., back),
                point(0., 1., back),
                point(1., 1., back),
                point(1., 0., back),
            ],
        ),
    ] {
        if let Some(p) = child(chart, name).and_then(|w| child(w, "spPr")) {
            let fill = colors.shape_fill(p).unwrap_or_else(|| "none".into());
            let stroke = colors.shape_stroke(p).unwrap_or_else(|| "none".into());
            polygon(out, &points, &fill, &stroke);
        }
    }
    if grid.is_some() {
        let n = ((scene.high - scene.low) / scene.step)
            .round()
            .clamp(0., 160.) as usize;
        for i in 0..=n {
            let y = scene.value(scene.low + i as f64 * scene.step);
            stroke_line(
                out,
                point(side, y, 1. - back),
                point(side, y, back),
                &grid_color,
            );
            stroke_line(out, point(0., y, back), point(1., y, back), &grid_color);
        }
    }
    stroke_line(
        out,
        point(0., 0., 1. - back),
        point(1., 0., 1. - back),
        "#868686",
    );
    stroke_line(
        out,
        point(1. - side, 0., 1. - back),
        point(1. - side, 0., back),
        "#868686",
    );
}

fn format_tick(v: f64) -> String {
    if v != 0. && (v.abs() < 0.001 || v.abs() > 1e8) {
        return format!("{v:.1e}");
    }
    format!("{v:.3}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_owned()
}

fn legend(
    out: &mut String,
    chart: Node,
    group: Node,
    data: &ChartData,
    colors: &ChartColors,
    scene: &Scene,
    font: &str,
    base_size: f64,
    w: f64,
    h: f64,
) {
    let Some(legend) = child(chart, "legend") else {
        return;
    };
    let size = font_size(text_props(Some(legend), false), base_size);
    let kind = group.tag_name().name();
    let wire = kind.starts_with("surface")
        && child(group, "wireframe")
            .is_some_and(|n| !matches!(n.attribute("val"), Some("0" | "false" | "off")));
    let mut entries: Vec<(String, String)> = if kind.starts_with("surface") {
        let count = ((scene.high - scene.low) / scene.step)
            .ceil()
            .clamp(1., 160.) as usize;
        (0..count)
            .rev()
            .map(|i| {
                let v = scene.low + i as f64 * scene.step;
                let fill = surface::band_color(group, colors, i, count);
                (
                    format!("{}-{}", format_tick(v), format_tick(v + scene.step)),
                    super::colors::transform_rgb(&fill, [("shade", 0.75)], true)
                        .map(|c| c + fill.get(7..).unwrap_or(""))
                        .unwrap_or(fill),
                )
            })
            .collect()
    } else if kind == "pie3DChart" {
        data.series
            .first()
            .into_iter()
            .flat_map(|s| s.points.iter())
            .filter(|p| p.value.is_some())
            .map(|p| {
                (
                    p.categories
                        .first()
                        .map_or_else(|| (u64::from(p.index) + 1).to_string(), |c| c.label.clone()),
                    colors.fill(0, Some(p.index)),
                )
            })
            .collect()
    } else {
        data.series
            .iter()
            .enumerate()
            .map(|(i, s)| (s.name.clone().unwrap_or_default(), colors.fill(i, None)))
            .collect()
    };
    if matches!(kind, "bar3DChart" | "area3DChart" | "line3DChart")
        && matches!(
            val(Some(group), "grouping"),
            Some("stacked" | "percentStacked")
        )
    {
        entries.reverse();
    }
    let key = size * 0.525;
    let longest = entries
        .iter()
        .map(|(n, _)| text_width(n, size))
        .fold(0., f64::max);
    let stride = size * 1.75;
    let placement = val(Some(legend), "legendPos").unwrap_or("r");
    let horizontal = matches!(placement, "b" | "t");
    let mut x = match placement {
        "l" => 12.,
        "b" | "t" => {
            (w - entries
                .iter()
                .map(|(n, _)| text_width(n, size) + key + 12.)
                .sum::<f64>())
                / 2.
        }
        _ => w - 16. - key - longest,
    };
    let y0 = match placement {
        "t" => 18.,
        "b" => h - 12.,
        _ => (h - stride * (entries.len().saturating_sub(1) as f64)) / 2.,
    };
    for (i, (name, fill)) in entries.iter().enumerate() {
        let y = y0 + if horizontal { 0. } else { i as f64 * stride };
        let (stroke, fill) = if wire {
            (fill.as_str(), "none")
        } else {
            ("none", fill.as_str())
        };
        write!(
            out,
            r#"<rect x="{x:.2}" y="{:.2}" width="{key:.2}" height="{key:.2}" fill="{fill}" stroke="{stroke}"/>"#,
            y - key / 2.
        )
        .unwrap();
        text(
            out,
            x + key + 3.,
            y + size * 0.34,
            "start",
            size,
            font,
            name,
        );
        if horizontal {
            x += text_width(name, size) + key + 12.;
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
        matches!(
            n.tag_name().name(),
            "bar3DChart"
                | "area3DChart"
                | "line3DChart"
                | "pie3DChart"
                | "surfaceChart"
                | "surface3DChart"
        ) && chart_node(*n, n.tag_name().name())
    })?;
    let kind = group.tag_name().name();
    let view = child(chart, "view3D");
    let contour = kind == "surfaceChart";
    let is_pie = kind == "pie3DChart";
    let bars = kind == "bar3DChart";
    let val_axis = child(plot, "valAx");
    let base = text_props(Some(root), false);
    let font = font_family(base, minor_latin.unwrap_or("Cambria"));
    let size = font_size(base, 40. / 3.);
    let manual = child(plot, "layout").and_then(|l| child(l, "manualLayout"));
    let manual_h = num(manual, "h").map(|h| height * h);
    let (low, high, step) = range(
        data,
        group,
        val_axis,
        if let Some(h) = manual_h {
            (h / (size * 3.)).floor().clamp(1., 10.)
        } else if bars || kind == "line3DChart" {
            10.
        } else {
            5.
        },
    );
    let n = data
        .series
        .iter()
        .filter_map(|s| s.points.last())
        .map(|p| f64::from(p.index) + 1.)
        .fold(1., f64::max);
    let series = data.series.len().max(1) as f64;
    let depth = match (kind, val(Some(group), "grouping")) {
        ("bar3DChart", Some("clustered") | None) => {
            (1. + num(Some(group), "gapDepth").unwrap_or(150.) / 100.)
                / (n * (series + num(Some(group), "gapWidth").unwrap_or(150.) / 100.))
        }
        (_, Some("stacked" | "percentStacked")) => 1. / n,
        _ => series / n,
    };
    let horizontal = bars && val(Some(group), "barDir") == Some("bar");
    let default_height = if bars {
        0.961 * height / width
    } else if kind == "line3DChart" {
        0.45
    } else {
        1. / 3.
    };
    let mut scene = Scene {
        low,
        high,
        step,
        reverse_value: val(val_axis.and_then(|a| child(a, "scaling")), "orientation")
            == Some("maxMin"),
        left: if is_pie {
            0.
        } else if bars {
            width * 0.0275
        } else if kind == "area3DChart" {
            width * 0.0375
        } else {
            width * 0.029
        },
        top: if is_pie {
            0.
        } else if kind == "area3DChart" {
            height * 0.043
        } else {
            height * 0.055
        },
        width: if is_pie {
            width
        } else if kind == "area3DChart" {
            width * 0.925
        } else {
            width * 0.942
        },
        height: if is_pie {
            height
        } else if bars {
            height * 0.8955
        } else {
            height * 0.89
        },
        model_height: num(view, "hPercent")
            .map_or(default_height, |h| h / 100.)
            .clamp(0.015, 5.),
        model_depth: (depth * num(view, "depthPercent").unwrap_or(100.) / 100.).clamp(0.002, 20.),
        rot_x: num(view, "rotX")
            .unwrap_or(if contour {
                90.
            } else if matches!(kind, "line3DChart" | "area3DChart") {
                14.
            } else {
                15.
            })
            .clamp(-90., 90.),
        rot_y: num(view, "rotY")
            .unwrap_or(if contour || is_pie { 0. } else { 20. })
            .rem_euclid(360.),
        shear: on(val(view, "rAngAx")) && !is_pie,
        perspective: 2.
            * (num(view, "perspective").unwrap_or(30.).clamp(0., 240.) * 0.375)
                .to_radians()
                .min(1.45)
                .tan(),
        origin: Point { x: 0., y: 0. },
        scale: 1.,
    };
    if let Some(manual) = manual {
        let x = num(Some(manual), "x");
        let y = num(Some(manual), "y");
        let span = |len: f64, start: Option<f64>, end: &str, mode: &str, fallback: f64| {
            num(Some(manual), end)
                .map_or(fallback, |value| {
                    len * if val(Some(manual), mode) == Some("edge") {
                        value - start.unwrap_or(0.)
                    } else {
                        value
                    }
                })
                .clamp(1., len * 2.)
        };
        scene.left = x.map_or(scene.left, |n| n * width);
        scene.top = y.map_or(scene.top, |n| n * height);
        scene.width = span(width, x, "w", "wMode", scene.width);
        scene.height = span(height, y, "h", "hMode", scene.height);
        if bars && num(view, "hPercent").is_none() {
            scene.model_height = 0.84 * scene.height / scene.width;
        }
    } else if !is_pie && !contour {
        let (mut l, mut t, mut r, mut b) =
            axes::margins(root, plot, data, width, height, &font, size, horizontal);
        b += table::reserved_height(plot, data, size);
        if colors.legacy_defaults() {
            if let Some(legend) = child(chart, "legend").filter(|n| !on(val(Some(*n), "overlay"))) {
                let longest = data
                    .series
                    .iter()
                    .filter_map(|s| s.name.as_deref())
                    .map(|name| text_width(name, size))
                    .fold(0., f64::max);
                let gap = longest + 1.9 * size;
                match val(Some(legend), "legendPos").unwrap_or("r") {
                    "l" => l += gap,
                    "t" => t += size * 2.5,
                    "b" => b += size * 2.5,
                    _ => r += gap,
                }
            }
        }
        if colors.legacy_defaults() && matches!(kind, "area3DChart" | "line3DChart") {
            // Legacy plots reserve additional cap-height above the value axis.
            t += size * 0.7;
            l = (l - size * 0.3).max(0.);
            b = (b - size * 0.3).max(0.);
        }
        scene.left += l;
        scene.top += t;
        scene.width = (scene.width - l - r).max(1.);
        scene.height = (scene.height - t - b).max(1.);
        if val(Some(group), "grouping").is_some_and(|g| matches!(g, "stacked" | "percentStacked"))
            && num(view, "hPercent").is_none()
            && !bars
        {
            scene.model_height = 0.96 * scene.height / scene.width;
        }
    }
    scene.fit();
    // Raster and vector entries share the chart frame's pixel-center origin.
    if manual.is_none() && !is_pie && !colors.legacy_defaults() {
        scene.origin.x -= 0.5;
        scene.origin.y += 0.75;
    }
    let corner = if colors.legacy_defaults()
        || matches!(
            val(Some(root), "roundedCorners"),
            Some("0" | "false" | "off")
        ) {
        0.
    } else {
        height.min(336.) / 25.2
    };
    let sp = child(root, "spPr");
    let fill = sp
        .and_then(|p| colors.shape_fill(p))
        .unwrap_or_else(|| "white".into());
    let border = sp
        .and_then(|p| colors.shape_stroke(p))
        .unwrap_or_else(|| "#868686".into());
    let mut out = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="{width}" height="{height}" rx="{corner}" fill="{fill}" stroke="{border}"/>"#
    );
    if !is_pie && !contour {
        grids(&mut out, &scene, chart, plot, colors, horizontal);
    }
    match kind {
        "pie3DChart" => pie::draw(&scene, data, group, colors, &mut out),
        "surface3DChart" | "surfaceChart" => surface::draw(&scene, data, group, colors, &mut out),
        _ => planes::draw(&scene, data, group, colors, &mut out),
    }
    if !is_pie && !contour {
        axes::draw(
            &mut out, &scene, plot, data, horizontal, &font, size, colors,
        );
        table::draw(
            &mut out,
            plot,
            data,
            colors,
            width,
            height,
            scene.top + scene.height,
            &font,
            size,
        );
    }
    if let Some(label) = data.title.as_ref() {
        let props = text_props(child(chart, "title"), true);
        let run = child(chart, "title")
            .and_then(|n| n.descendants().find(|r| r.tag_name().name() == "rPr"));
        let sz = font_size(
            run.or(props),
            if colors.legacy_defaults() {
                size * 1.8
            } else {
                size
            },
        );
        let color = run
            .and_then(|n| colors.shape_fill(n))
            .or_else(|| props.and_then(|n| colors.shape_fill(n)))
            .unwrap_or_else(|| "#000000".into());
        write!(out, r#"<g font-weight="bold" fill="{color}">"#).unwrap();
        text(
            &mut out,
            width / 2.,
            10. + sz * 0.95,
            "middle",
            sz,
            &font_family(props, minor_latin.unwrap_or("Cambria")),
            label,
        );
        out.push_str("</g>");
    }
    legend(
        &mut out, chart, group, data, colors, &scene, &font, size, width, height,
    );
    out.push_str("</svg>");
    Some(out)
}
