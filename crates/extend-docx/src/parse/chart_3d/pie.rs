use super::{polygon, shade, ChartColors, ChartData, Node, Point, Scene};
use crate::chart::{chart_node, child};
use std::f64::consts::{PI, TAU};
use std::fmt::Write;

struct Camera {
    x: f64,
    y: f64,
    radius: f64,
    thickness: f64,
    sin: f64,
    cos: f64,
    focal: f64,
}

impl Camera {
    fn project(&self, x: f64, z: f64, elevation: f64) -> Point {
        let depth = z * self.cos - elevation * self.sin;
        let scale = 1. / (1. + depth / self.focal);
        Point {
            x: self.x + x * scale,
            y: self.y - (z * self.sin + elevation * self.cos) * scale,
        }
    }

    fn rim(&self, angle: f64, offset: (f64, f64), elevation: f64) -> Point {
        self.project(
            self.radius * angle.sin() + offset.0,
            self.radius * angle.cos() + offset.1,
            elevation,
        )
    }
}

fn property(node: Node, name: &str) -> Option<f64> {
    child(node, name)?
        .attribute("val")?
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
}

struct Slice {
    start: f64,
    end: f64,
    offset: (f64, f64),
    fill: String,
    stroke: String,
}

fn arc_angles(start: f64, end: f64) -> impl DoubleEndedIterator<Item = f64> {
    let steps = ((end - start).abs().to_degrees() / 3.).ceil().max(1.) as usize;
    (0..=steps).map(move |i| start + (end - start) * i as f64 / steps as f64)
}

fn side(out: &mut String, cam: &Camera, slice: &Slice, start: f64, end: f64, key: usize) {
    let points: Vec<_> = arc_angles(start, end)
        .map(|a| cam.rim(a, slice.offset, cam.thickness))
        .chain(
            arc_angles(start, end)
                .rev()
                .map(|a| cam.rim(a, slice.offset, 0.)),
        )
        .collect();
    if slice.fill == "none" {
        polygon(out, &points, "none", &slice.stroke);
        return;
    }
    let right = points[0].x;
    let left = cam.rim(end, slice.offset, cam.thickness).x;
    let _ = write!(
        out,
        r#"<defs><linearGradient id="pie-side-{key}" gradientUnits="userSpaceOnUse" x1="{left:.3}" x2="{right:.3}" y1="0" y2="0">"#
    );
    let span = (right - left).max(f64::EPSILON);
    let steps = ((end - start).to_degrees() / 5.).ceil().max(1.) as usize;
    for i in 0..=steps {
        let angle = end - (end - start) * i as f64 / steps as f64;
        let position =
            ((cam.rim(angle, slice.offset, cam.thickness).x - left) / span).clamp(0., 1.);
        let illumination = (0.395 - 0.432 * angle.sin() - 0.303 * angle.cos()).max(0.395);
        let paint = shade(&slice.fill, illumination);
        let _ = write!(
            out,
            r#"<stop offset="{position:.4}" stop-color="{paint}"/>"#
        );
    }
    out.push_str("</linearGradient></defs>");
    polygon(
        out,
        &points,
        &format!("url(#pie-side-{key})"),
        &slice.stroke,
    );
}

pub(super) fn draw(
    scene: &Scene,
    data: &ChartData,
    group: Node,
    colors: &ChartColors,
    out: &mut String,
) {
    let Some((i, series)) = data
        .series
        .iter()
        .enumerate()
        .find(|(_, s)| s.chart_type == "pie3D")
    else {
        return;
    };
    let Some(source) = child(group, "ser") else {
        return;
    };
    let view = group
        .ancestors()
        .find(|n| chart_node(*n, "chart"))
        .and_then(|n| child(n, "view3D"));
    let elevation = view
        .and_then(|v| property(v, "rotX"))
        .unwrap_or(14.82)
        .clamp(0., 90.)
        .to_radians();
    let rotation = view
        .and_then(|v| property(v, "rotY"))
        .unwrap_or(0.)
        .to_radians();
    let perspective = view
        .and_then(|v| property(v, "perspective"))
        .unwrap_or(30.)
        .clamp(0., 240.);
    let perspective = if view
        .and_then(|v| child(v, "rAngAx"))
        .is_some_and(|n| !matches!(n.attribute("val"), Some("0" | "false" | "off")))
    {
        0.
    } else {
        perspective
    };
    let inset = 14.4_f64.min(0.1 * scene.width.min(scene.height));
    let inner_height = scene.height - 2. * inset;
    let inner_width = scene.width - 2. * inset;
    let focal = if perspective == 0. {
        f64::INFINITY
    } else {
        inner_height * 1.067 / (perspective.to_radians() * 0.5).min(1.30).tan()
    };
    let depth = 0.243
        * view
            .and_then(|v| property(v, "depthPercent"))
            .unwrap_or(100.)
            .clamp(20., 2000.)
        / 100.;
    let explosion = property(source, "explosion").unwrap_or(0.).clamp(0., 400.) / 100.;
    let offsets: std::collections::HashMap<u32, f64> = source
        .children()
        .filter(|n| chart_node(*n, "dPt"))
        .filter_map(|p| {
            let idx = child(p, "idx")?.attribute("val")?.parse().ok()?;
            Some((idx, property(p, "explosion")?.clamp(0., 400.) / 100.))
        })
        .collect();
    let max_offset = offsets.values().copied().fold(explosion, f64::max);
    let (sin, cos) = elevation.sin_cos();
    // Fit the projected cylinder to the chart canvas. Its silhouette is wider
    // than an orthographic ellipse because the front rim is nearer the camera.
    let half_width = inner_width * 0.485;
    let half_height = inner_height * 0.485;
    let horizontal =
        half_width / ((half_width * cos / focal).hypot(1.) + half_width * depth * sin / focal);
    let front = half_height / (sin + half_height * cos / focal);
    let back = half_height
        / (sin + depth * cos - half_height * (cos - depth * sin) / focal).max(f64::EPSILON);
    let radius = horizontal.min(front).min(back) / (1. + max_offset);
    let cam = Camera {
        x: scene.left + scene.width / 2.,
        y: scene.top + scene.height / 2. - 0.002 * radius,
        radius,
        thickness: radius * depth,
        sin,
        cos,
        focal: focal.max(radius * (1. + depth + max_offset) * 1.1),
    };
    let values: Vec<_> = series
        .points
        .iter()
        .filter_map(|p| {
            let value = p.value.as_ref()?.parse::<f64>().ok()?.abs();
            (value.is_finite() && value > 0.).then_some((p.index, value))
        })
        .collect();
    let max_value = values.iter().map(|(_, v)| *v).fold(0., f64::max);
    if max_value == 0. {
        return;
    }
    let total: f64 = values.iter().map(|(_, v)| v / max_value).sum();
    let mut angle = rotation.rem_euclid(TAU);
    let mut slices = Vec::with_capacity(values.len());
    for (idx, value) in values {
        let end = angle + TAU * (value / max_value) / total;
        let mid = (angle + end) / 2.;
        let offset = offsets.get(&idx).copied().unwrap_or(explosion) * radius;
        slices.push(Slice {
            start: angle,
            end,
            offset: (offset * mid.sin(), offset * mid.cos()),
            fill: colors.fill(i, Some(idx)),
            stroke: colors.outline(i, Some(idx)).unwrap_or("none").to_owned(),
        });
        angle = end;
    }
    slices.sort_by(|a, b| b.offset.1.total_cmp(&a.offset.1));
    for (i, slice) in slices.iter().enumerate() {
        let center = |e| cam.project(slice.offset.0, slice.offset.1, e);
        if slice.offset != (0., 0.) {
            for (a, visible) in [
                (slice.start, slice.start.sin() < 0.),
                (slice.end, slice.end.sin() > 0.),
            ] {
                if visible {
                    polygon(
                        out,
                        &[
                            center(0.),
                            cam.rim(a, slice.offset, 0.),
                            cam.rim(a, slice.offset, cam.thickness),
                            center(cam.thickness),
                        ],
                        &shade(&slice.fill, 0.65),
                        &slice.stroke,
                    );
                }
            }
        }
        let tangent = (-(radius * cam.cos)
            / (cam.focal + slice.offset.1 * cam.cos - cam.thickness * cam.sin))
            .clamp(-1., 1.)
            .acos();
        for period in 0..=1 {
            let start = slice.start.max(tangent + TAU * period as f64);
            let end = slice.end.min(TAU - tangent + TAU * period as f64);
            if end > start {
                side(out, &cam, slice, start, end, 2 * i + period);
            }
        }
        let mut top: Vec<_> = arc_angles(slice.start, slice.end)
            .map(|a| cam.rim(a, slice.offset, cam.thickness))
            .collect();
        if slice.end - slice.start < 2. * PI - 1e-10 {
            top.push(center(cam.thickness));
        }
        polygon(out, &top, &shade(&slice.fill, 0.923), &slice.stroke);
    }
}
