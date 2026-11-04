use super::*;
use crate::chart::child;
use std::collections::BTreeMap;

fn setting<'a>(node: Node<'a, 'a>, name: &str) -> Option<&'a str> {
    child(node, name)?.attribute("val")
}

fn gap(node: Node, key: &str) -> f64 {
    setting(node, key)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(150)
        .min(500) as f64
        / 100.
}

fn point_value(point: &crate::chart::ChartPoint) -> Option<f64> {
    super::number(point.value.as_deref())
}

fn plot_values(
    points: &[crate::chart::ChartPoint],
    count: u64,
    zero_blanks: bool,
) -> Vec<(u32, Option<f64>)> {
    let mut values = Vec::with_capacity(points.len());
    let mut next = 0u64;
    for point in points {
        let index = u64::from(point.index);
        if zero_blanks && next < index {
            values.push((next as u32, Some(0.)));
            if index - next > 1 {
                values.push(((index - 1) as u32, Some(0.)));
            }
        }
        values.push((point.index, point_value(point)));
        next = index + 1;
    }
    if zero_blanks && next < count {
        values.push((next as u32, Some(0.)));
        if count - next > 1 {
            values.push(((count - 1) as u32, Some(0.)));
        }
    }
    values
}

struct Strip {
    index: u32,
    x: f64,
    bottom: f64,
    top: f64,
}

struct Extrusion<'a> {
    scene: &'a Scene,
    near: f64,
    far: f64,
    fill: &'a str,
    stroke: &'a str,
}

impl Extrusion<'_> {
    fn face(&self, out: &mut String, points: &[[f64; 3]; 4], light: f64) {
        let points = points.map(|[x, y, z]| self.scene.project(x, y, z));
        let cross = points
            .iter()
            .zip(points.iter().cycle().skip(1))
            .map(|(a, b)| a.x * b.y - b.x * a.y)
            .sum::<f64>();
        if cross < -1e-9 {
            polygon(out, &points, &shade(self.fill, light), self.stroke);
        }
    }

    fn prism(&self, out: &mut String, a: &Strip, b: &Strip) {
        let (x0, x1) = (a.x, b.x);
        let (y0, y1) = (a.bottom.min(a.top), b.bottom.min(b.top));
        let (h0, h1) = (a.bottom.max(a.top), b.bottom.max(b.top));
        let (z0, z1) = (self.near, self.far);

        self.face(
            out,
            &[[x0, y0, z0], [x1, y1, z0], [x1, h1, z0], [x0, h0, z0]],
            1.,
        );
        self.face(
            out,
            &[[x0, y0, z1], [x0, h0, z1], [x1, h1, z1], [x1, y1, z1]],
            0.70,
        );
        self.face(
            out,
            &[[x0, y0, z0], [x0, h0, z0], [x0, h0, z1], [x0, y0, z1]],
            0.64,
        );
        self.face(
            out,
            &[[x1, y1, z0], [x1, y1, z1], [x1, h1, z1], [x1, h1, z0]],
            0.64,
        );
        let slope = (h1 - h0).atan2(x1 - x0);
        self.face(
            out,
            &[[x0, h0, z0], [x1, h1, z0], [x1, h1, z1], [x0, h0, z1]],
            0.75 - 0.10 * slope.sin(),
        );
        self.face(
            out,
            &[[x0, y0, z0], [x0, y0, z1], [x1, y1, z1], [x1, y1, z0]],
            0.40,
        );
    }

    fn shaped_bar(
        &self,
        out: &mut String,
        category: [f64; 2],
        value: [f64; 2],
        horizontal: bool,
        shape: &str,
        end_radius: f64,
    ) {
        let pyramidal = matches!(shape, "pyramid" | "pyramidToMax");
        let count = if pyramidal { 4 } else { 24 };
        let shape_point = |i: usize, height: f64, radius: f64| {
            let angle = (i as f64 + if pyramidal { 0.5 } else { 0. }) * std::f64::consts::TAU
                / count as f64;
            let radius = radius
                * if pyramidal {
                    std::f64::consts::SQRT_2
                } else {
                    1.
                };
            let category = (category[0] + category[1]) / 2.
                + (category[1] - category[0]).abs() / 2. * angle.cos() * radius;
            let z =
                (self.near + self.far) / 2. + (self.far - self.near) / 2. * angle.sin() * radius;
            if horizontal {
                [height, category, z]
            } else {
                [category, height, z]
            }
        };
        let invert = horizontal ^ (value[1] < value[0]);
        for i in 0..count {
            let next = (i + 1) % count;
            let a = shape_point(i, value[0], 1.);
            let b = shape_point(next, value[0], 1.);
            let c = shape_point(next, value[1], end_radius);
            let d = shape_point(i, value[1], end_radius);
            let angle = (i as f64 + if pyramidal { 1. } else { 0.5 }) * std::f64::consts::TAU
                / count as f64;
            let light = (0.65 - 0.33 * angle.sin() - 0.10 * angle.cos()).clamp(0.4, 1.);
            let mut side = [a, b, c, d];
            let mut base = [shape_point(i, value[0], 0.), b, a, a];
            let mut top = [shape_point(i, value[1], 0.), d, c, c];
            if invert {
                side.reverse();
                base.reverse();
                top.reverse();
            }
            self.face(out, &side, light);
            self.face(out, &base, 0.40);
            self.face(out, &top, 0.75);
        }
    }

    fn ribbon(&self, out: &mut String, a: &Strip, b: &Strip) {
        let slope = (b.top - a.top).atan2(b.x - a.x);
        let (z0, z1) = (self.near, self.far);
        let points = [
            [a.x, a.top, z0],
            [b.x, b.top, z0],
            [b.x, b.top, z1],
            [a.x, a.top, z1],
        ];
        self.face(out, &points, 0.75 - 0.10 * slope.sin());
        self.face(out, &[points[3], points[2], points[1], points[0]], 0.40);
    }
}

pub(super) fn draw(
    scene: &Scene,
    data: &ChartData,
    group: Node,
    colors: &ChartColors,
    out: &mut String,
) {
    let group_type = group.tag_name().name();
    let bars = group_type == "bar3DChart";
    let lines = group_type == "line3DChart";
    if !bars && !lines && group_type != "area3DChart" {
        return;
    }

    let xml_series: Vec<_> = group
        .children()
        .filter(|n| crate::chart::chart_node(*n, "ser"))
        .collect();
    let offset = group
        .prev_siblings()
        .skip(1)
        .filter(|g| g.is_element() && g.tag_name().name().ends_with("Chart"))
        .flat_map(|g| g.children())
        .filter(|n| crate::chart::chart_node(*n, "ser"))
        .count();
    let series: Vec<_> = data
        .series
        .iter()
        .enumerate()
        .skip(offset)
        .take(xml_series.len())
        .collect();
    if series.is_empty() {
        return;
    }
    let count = series
        .iter()
        .flat_map(|(_, s)| s.points.last())
        .map(|p| u64::from(p.index) + 1)
        .max()
        .unwrap_or(0);
    let declared = group
        .descendants()
        .filter(|n| crate::chart::chart_node(*n, "ptCount"))
        .filter_map(|n| n.attribute("val")?.parse::<u32>().ok())
        .max()
        .unwrap_or(0);
    let count = count.max(u64::from(declared));
    if count == 0 {
        return;
    }
    let nf = count as f64;
    let nseries = series.len() as f64;
    let grouping =
        setting(group, "grouping").unwrap_or(if bars { "clustered" } else { "standard" });
    let percent = grouping == "percentStacked";
    let stacked = grouping == "stacked" || percent;
    let clustered = bars && !stacked && grouping != "standard";
    let horizontal = bars && setting(group, "barDir") == Some("bar");
    let band = 1. / (if clustered { nseries } else { 1. } + gap(group, "gapWidth"));
    let layers = if stacked || clustered { 1. } else { nseries };
    let depth = 1. / (1. + gap(group, "gapDepth")) / layers;
    let plot = group.parent_element().unwrap_or(group);
    let blanks = plot
        .parent_element()
        .and_then(|c| setting(c, "dispBlanksAs"))
        .unwrap_or("gap");
    let category_axis = child(plot, "catAx").or_else(|| child(plot, "dateAx"));
    let reverse = category_axis
        .and_then(|n| child(n, "scaling"))
        .and_then(|s| setting(s, "orientation"))
        == Some("maxMin");
    let category = |x: f64| if reverse { 1. - x } else { x };
    let reverse_depth = child(plot, "serAx")
        .and_then(|n| child(n, "scaling"))
        .and_then(|n| setting(n, "orientation"))
        == Some("maxMin");
    let mut totals = BTreeMap::<u32, f64>::new();
    if percent {
        for (_, s) in &series {
            for p in &s.points {
                if let Some(value) = point_value(p) {
                    *totals.entry(p.index).or_default() += value.abs();
                }
            }
        }
    }
    let mut sums = BTreeMap::<u32, (f64, f64)>::new();
    let mut drawn: Vec<(f64, String)> = Vec::new();
    for (order, (source, s)) in series.iter().enumerate() {
        let center = if layers == 1. {
            0.5
        } else {
            (order as f64 + 0.5) / layers
        };
        let center = if reverse_depth { 1. - center } else { center };
        let near = center - depth * 0.5;
        let far = center + depth * 0.5;
        let fill = if lines {
            colors.line(*source)
        } else {
            colors.fill(*source, None)
        };
        let stroke = colors.outline(*source, None).unwrap_or("none");
        let mut shapes = format!(r#"<g data-docx-series="{source}">"#);
        let mut previous: Option<Strip> = None;
        let shape = setting(xml_series[order], "shape")
            .or_else(|| setting(group, "shape"))
            .unwrap_or("box");
        let series_max = if shape.ends_with("ToMax") {
            s.points
                .iter()
                .filter_map(point_value)
                .map(f64::abs)
                .fold(0., f64::max)
        } else {
            0.
        };
        for (index, cached) in plot_values(&s.points, count, !bars && blanks == "zero") {
            let value = match cached {
                Some(value) => value,
                None if blanks == "zero" => 0.,
                None => {
                    if blanks != "span" {
                        previous = None;
                    }
                    continue;
                }
            };
            let value = if percent {
                let sum = totals.get(&index).copied().unwrap_or(0.);
                if sum > 0. {
                    value / sum
                } else {
                    0.
                }
            } else {
                value
            };
            let base = if stacked {
                let sum = sums.entry(index).or_default();
                let slot = if value < 0. { &mut sum.1 } else { &mut sum.0 };
                let prev = *slot;
                *slot += value;
                prev
            } else {
                0.
            };
            let h0 = scene.value(base).clamp(0., 1.);
            let h1 = scene.value(base + value).clamp(0., 1.);
            if bars {
                if (h0 - h1).abs() < 1e-12 {
                    continue;
                }
                let shift = if clustered {
                    (order as f64 - (nseries - 1.) * 0.5) * band
                } else {
                    0.
                };
                let mid = index as f64 + 0.5 + shift;
                let lo = category((mid - band * 0.5) / nf);
                let hi = category((mid + band * 0.5) / nf);
                let (x0, x1, y0, y1) = if horizontal {
                    (h0.min(h1), h0.max(h1), lo.min(hi), lo.max(hi))
                } else {
                    (lo.min(hi), lo.max(hi), h0.min(h1), h0.max(h1))
                };
                let ink = colors.fill(*source, Some(index));
                let paint = Extrusion {
                    scene,
                    near,
                    far,
                    fill: &ink,
                    stroke: colors.outline(*source, Some(index)).unwrap_or("none"),
                };
                if matches!(
                    shape,
                    "cylinder" | "cone" | "coneToMax" | "pyramid" | "pyramidToMax"
                ) {
                    let end_radius = if shape == "cylinder" {
                        1.
                    } else if series_max > 0. {
                        (1. - value.abs() / series_max).clamp(0., 1.)
                    } else {
                        0.
                    };
                    paint.shaped_bar(
                        &mut shapes,
                        [lo, hi],
                        [h0, h1],
                        horizontal,
                        shape,
                        end_radius,
                    );
                    continue;
                }
                let start = Strip {
                    index,
                    x: x0,
                    bottom: y0,
                    top: y1,
                };
                let end = Strip { x: x1, ..start };
                paint.prism(&mut shapes, &start, &end);
            } else {
                let x = category(
                    if lines
                        && setting(child(plot, "valAx").unwrap_or(plot), "crossBetween")
                            != Some("midCat")
                    {
                        (f64::from(index) + 0.5) / nf
                    } else if count == 1 {
                        0.5
                    } else {
                        f64::from(index) / (nf - 1.)
                    },
                );
                let curr = Strip {
                    index,
                    x,
                    bottom: h0,
                    top: h1,
                };
                if let Some(prev) = previous.as_ref().filter(|prev| {
                    matches!(blanks, "span" | "zero") || index.checked_sub(prev.index) == Some(1)
                }) {
                    let paint = Extrusion {
                        scene,
                        near,
                        far,
                        fill: &fill,
                        stroke,
                    };
                    let (a, b) = if prev.x < curr.x {
                        (prev, &curr)
                    } else {
                        (&curr, prev)
                    };
                    if lines {
                        paint.ribbon(&mut shapes, a, b)
                    } else {
                        let d0 = a.top - a.bottom;
                        let d1 = b.top - b.bottom;
                        if d0 * d1 < 0. {
                            let t = d0 / (d0 - d1);
                            let baseline = a.bottom + (b.bottom - a.bottom) * t;
                            let cross = Strip {
                                index: a.index,
                                x: a.x + (b.x - a.x) * t,
                                bottom: baseline,
                                top: baseline,
                            };
                            paint.prism(&mut shapes, a, &cross);
                            paint.prism(&mut shapes, &cross, b);
                        } else {
                            paint.prism(&mut shapes, a, b);
                        }
                        // The fill seam follows the roof of each area strip;
                        // outlining every face would expose internal divisions.
                        if stroke == "none"
                            && colors.legacy_defaults()
                            && colors.outline(*source, None).is_none()
                        {
                            for (v0, v1, z) in [
                                (a.top, b.top, near),
                                (a.top, b.top, far),
                                (a.bottom, b.bottom, near),
                            ] {
                                super::stroke_line(
                                    &mut shapes,
                                    scene.project(a.x, v0, z),
                                    scene.project(b.x, v1, z),
                                    "#ffffff",
                                );
                            }
                        }
                    }
                }
                previous = Some(curr);
            }
        }
        let depth_order = center * scene.rot_y.to_radians().cos();
        shapes.push_str("</g>");
        drawn.push((depth_order, shapes));
    }
    drawn.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (_, shapes) in drawn {
        out.push_str(&shapes);
    }
}
