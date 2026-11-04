use super::*;

#[derive(Clone, Copy)]
struct Vertex {
    x: f64,
    z: f64,
    value: f64,
}

impl Vertex {
    fn crossing(self, end: Self, level: f64) -> Self {
        let t = (level - self.value) / (end.value - self.value);
        Self {
            x: self.x + t * (end.x - self.x),
            z: self.z + t * (end.z - self.z),
            value: level,
        }
    }

    fn project(self, scene: &Scene) -> Point {
        scene.project(self.x, scene.value(self.value), self.z)
    }
}

fn clip(vertices: &[Vertex], level: f64, above: bool) -> Vec<Vertex> {
    let mut result = Vec::with_capacity(vertices.len() + 1);
    if let Some(mut last) = vertices.last().copied() {
        for &next in vertices {
            let inside = |v: Vertex| {
                if above {
                    v.value >= level
                } else {
                    v.value <= level
                }
            };
            if inside(last) != inside(next) {
                result.push(last.crossing(next, level));
            }
            if inside(next) {
                result.push(next);
            }
            last = next;
        }
    }
    result
}

fn band_format<'a>(group: Node<'a, 'a>, band: usize) -> Option<Node<'a, 'a>> {
    child(group, "bandFmts")?.children().find_map(|n| {
        if chart_node(n, "bandFmt")
            && child(n, "idx")?.attribute("val")?.parse::<usize>().ok()? == band
        {
            child(n, "spPr")
        } else {
            None
        }
    })
}

pub(super) fn band_color(group: Node, colors: &ChartColors, band: usize, count: usize) -> String {
    band_format(group, band)
        .and_then(|sp| colors.shape_fill(sp))
        .unwrap_or_else(|| colors.palette(band, count.saturating_sub(1)))
}

fn unit(v: [f64; 3]) -> [f64; 3] {
    let length = v[0].hypot(v[1]).hypot(v[2]);
    v.map(|n| n / length)
}

fn lighting(scene: &Scene, corners: &[Vertex; 3]) -> (f64, f64) {
    let [a, b, c] = *corners;
    let vector = |v: Vertex| {
        [
            v.x - a.x,
            (scene.value(v.value) - scene.value(a.value)) * scene.model_height,
            (v.z - a.z) * scene.model_depth,
        ]
    };
    let [u, v] = [vector(b), vector(c)];
    let mut normal = unit([
        v[1] * u[2] - v[2] * u[1],
        v[2] * u[0] - v[0] * u[2],
        v[0] * u[1] - v[1] * u[0],
    ]);
    if normal[1] < 0. {
        normal = normal.map(|a| -a);
    }
    let (sx, cx) = scene.rot_x.to_radians().sin_cos();
    let (sy, cy) = scene.rot_y.to_radians().sin_cos();
    let (light, eye) = if scene.shear {
        let sign = if cy >= 0. { 1. } else { -1. };
        (unit([sign, 1., -sign]), unit([sy, sx, -sign]))
    } else {
        let eye = [sy * cx, sx, -cy * cx];
        let right = [cy, 0., sy];
        let up = [-sy * sx, cx, cy * sx];
        (
            unit(std::array::from_fn(|i| right[i] + up[i] + eye[i])),
            eye,
        )
    };
    if normal.iter().zip(eye).map(|(a, b)| a * b).sum::<f64>() < 0. {
        normal = normal.map(|n| -n);
    }
    let half = unit(std::array::from_fn(|i| light[i] + eye[i]));
    let dot = |v: [f64; 3]| {
        normal
            .iter()
            .zip(v)
            .map(|(a, b)| a * b)
            .sum::<f64>()
            .clamp(0., 1.)
    };
    (0.35 + 0.65 * dot(light), 0.25 * dot(half).powi(32))
}

fn lit_color(color: &str, diffuse: f64, specular: f64) -> String {
    let Some(hex) = color
        .strip_prefix('#')
        .filter(|s| matches!(s.len(), 6 | 8) && s.is_ascii())
    else {
        return color.to_owned();
    };
    let mut rgb = [0u8; 3];
    for (i, channel) in rgb.iter_mut().enumerate() {
        let Ok(base) = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16) else {
            return color.to_owned();
        };
        *channel = (f64::from(base) * diffuse + 255. * specular)
            .round()
            .clamp(0., 255.) as u8;
    }
    format!("#{:02x}{:02x}{:02x}{}", rgb[0], rgb[1], rgb[2], &hex[6..])
}

struct Band {
    floor: f64,
    ceiling: f64,
    fill: String,
    stroke: Option<String>,
}

fn paint(scene: &Scene, corners: [Vertex; 3], bands: &[Band], wire: bool, out: &mut String) {
    let (diffuse, specular) = lighting(scene, &corners);
    let bottom = corners
        .iter()
        .map(|v| v.value)
        .fold(f64::INFINITY, f64::min);
    let top = corners
        .iter()
        .map(|v| v.value)
        .fold(f64::NEG_INFINITY, f64::max);
    for band in &bands[bands.partition_point(|b| b.ceiling < bottom)..] {
        if band.floor > top {
            break;
        }
        let points = clip(&clip(&corners, band.floor, true), band.ceiling, false);
        if points.len() < 3 {
            continue;
        }
        if wire {
            let paint = band
                .stroke
                .clone()
                .unwrap_or_else(|| lit_color(&band.fill, 0.9, -0.022));
            for (&a, &b) in points.iter().zip(points.iter().cycle().skip(1)) {
                let grid_edge = a.x == b.x || a.z == b.z;
                let isoline = a.value == band.ceiling && b.value == band.ceiling;
                if grid_edge || isoline {
                    stroke_line(out, a.project(scene), b.project(scene), &paint);
                }
            }
        } else {
            let projected: Vec<_> = points.into_iter().map(|v| v.project(scene)).collect();
            polygon(
                out,
                &projected,
                &lit_color(&band.fill, diffuse, specular),
                band.stroke.as_deref().unwrap_or("none"),
            );
        }
    }
}

pub(super) fn draw(
    scene: &Scene,
    data: &ChartData,
    group: Node,
    colors: &ChartColors,
    out: &mut String,
) {
    if data.series.len() < 2 || scene.step <= 0. {
        return;
    }
    let extent = data
        .series
        .iter()
        .filter_map(|s| s.points.last().map(|p| p.index))
        .max()
        .unwrap_or(0);
    if extent == 0 {
        return;
    }
    let count = ((scene.high - scene.low) / scene.step)
        .ceil()
        .clamp(1., 256.) as usize;
    let bands: Vec<_> = (0..count)
        .map(|band| Band {
            floor: scene.low + band as f64 * scene.step,
            ceiling: scene.low + (band + 1) as f64 * scene.step,
            fill: band_color(group, colors, band, count),
            stroke: band_format(group, band).and_then(|sp| colors.shape_stroke(sp)),
        })
        .collect();
    let wire = child(group, "wireframe")
        .is_some_and(|n| !matches!(n.attribute("val"), Some("0" | "false" | "off")));
    let back_first = scene.rot_y.to_radians().cos() >= 0.;
    let right_first = scene.rot_y.to_radians().sin() < 0.;
    let depth = (data.series.len() - 1) as f64;
    for n in 0..data.series.len() - 1 {
        let row = if back_first {
            data.series.len() - 2 - n
        } else {
            n
        };
        let rows = [&data.series[row].points, &data.series[row + 1].points];
        let columns: std::collections::BTreeSet<_> = rows
            .iter()
            .flat_map(|r| r.iter().map(|p| p.index))
            .filter(|i| *i < extent)
            .collect();
        let mut columns = columns.into_iter();
        while let Some(column) = if right_first {
            columns.next_back()
        } else {
            columns.next()
        } {
            let mut corners = Vec::with_capacity(4);
            for (index, side) in [(column, 0), (column + 1, 0), (column + 1, 1), (column, 1)] {
                let points = rows[side];
                let value = points
                    .binary_search_by_key(&index, |p| p.index)
                    .ok()
                    .and_then(|i| points[i].value.as_deref())
                    .and_then(|v| v.parse::<f64>().ok())
                    .filter(|v| v.is_finite());
                if let Some(value) = value {
                    corners.push(Vertex {
                        x: f64::from(index) / f64::from(extent),
                        z: (row + side) as f64 / depth,
                        value,
                    });
                }
            }
            match corners.as_slice() {
                &[a, b, c, d] => {
                    let mut triangles = if a.value + c.value >= b.value + d.value {
                        [[a, b, c], [a, c, d]]
                    } else {
                        [[a, b, d], [b, c, d]]
                    };
                    if back_first {
                        triangles.swap(0, 1);
                    }
                    for t in triangles {
                        paint(scene, t, &bands, wire, out)
                    }
                }
                &[a, b, c] => paint(scene, [a, b, c], &bands, wire, out),
                _ => {}
            }
        }
    }
    if chart_node(group, "surfaceChart") && (scene.rot_x.abs() - 90.).abs() < 1e-6 {
        if let Some(grid) = group
            .parent()
            .and_then(|plot| child(plot, "valAx"))
            .and_then(|a| child(a, "majorGridlines"))
        {
            let stroke = child(grid, "spPr")
                .and_then(|p| colors.shape_stroke(p))
                .unwrap_or_else(|| "#000000".into());
            let back = if back_first { 1. } else { 0. };
            let side = if right_first { 1. } else { 0. };
            stroke_line(
                out,
                scene.project(side, 0., 1. - back),
                scene.project(side, 0., back),
                &stroke,
            );
            stroke_line(
                out,
                scene.project(0., 0., back),
                scene.project(1., 0., back),
                &stroke,
            );
        }
    }
}
