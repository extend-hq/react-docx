use std::f64::consts::FRAC_PI_4;

type Point = (f64, f64);

pub(super) fn longitude_midpoint(west: f64, east: f64) -> f64 {
    let east = if west > east { east + 360.0 } else { east };
    nearest_longitude((west + east) * 0.5, 0.0)
}

fn nearest_longitude(lon: f64, reference: f64) -> f64 {
    // Keep both endpoints of a ring running along a pole.
    let offset = lon - reference;
    if offset > 180.0 {
        lon - 360.0
    } else if offset < -180.0 {
        lon + 360.0
    } else {
        lon
    }
}

pub(super) struct MapProjection {
    center_lon: f64,
    kind: Kind,
}

enum Kind {
    Robinson,
    Cylindrical {
        miller: bool,
        insets: bool,
    },
    Albers(Albers),
    AlbersUs {
        mainland: Albers,
        alaska: Albers,
        hawaii: Albers,
    },
}

struct Albers {
    meridian: f64,
    n: f64,
    c: f64,
}

impl Albers {
    fn new(meridian: f64, parallel_a: f64, parallel_b: f64) -> Self {
        let (s1, s2) = (parallel_a.to_radians().sin(), parallel_b.to_radians().sin());
        Self {
            meridian,
            n: (s1 + s2) * 0.5,
            c: 1.0 + s1 * s2,
        }
    }

    fn project(&self, lon: f64, lat: f64) -> Point {
        let lambda = (nearest_longitude(lon, self.meridian) - self.meridian).to_radians();
        let sin_phi = lat.to_radians().sin();
        let r = (self.c - 2.0 * self.n * sin_phi).max(0.0).sqrt();
        let r0 = self.c.sqrt();
        let theta = self.n * lambda;
        if self.n.abs() < 1e-12 {
            return (
                (lambda * r0).to_degrees(),
                (sin_phi / r0.max(1e-12)).to_degrees(),
            );
        }
        let (sin_theta, cos_theta) = theta.sin_cos();
        let x = r * sin_theta / self.n;
        // Rationalizing the northing avoids cancellation near symmetric parallels.
        let denominator = r0 + r * cos_theta;
        let y = if denominator > 1e-6 {
            (2.0 * sin_phi + x * r * sin_theta) / denominator
        } else {
            (r0 - r * cos_theta) / self.n
        };
        (x.to_degrees(), y.to_degrees())
    }
}

impl MapProjection {
    pub(super) fn new(
        name: Option<&str>,
        center_lon: f64,
        south: f64,
        north: f64,
        world: bool,
    ) -> Self {
        let kind = match name {
            Some("mercator" | "miller") => Kind::Cylindrical {
                miller: name == Some("miller"),
                insets: false,
            },
            _ if world => Kind::Robinson,
            _ => {
                let north = if north.is_finite() {
                    north.clamp(-90.0, 90.0)
                } else {
                    90.0
                };
                let south = if south.is_finite() {
                    south.clamp(-90.0, north)
                } else {
                    -90.0
                };
                let inset = (north - south) / 6.0;
                Kind::Albers(Albers::new(center_lon, north - inset, south + inset))
            }
        };
        Self { center_lon, kind }
    }

    pub(super) fn with_us_insets(mut self, enabled: bool) -> Self {
        if enabled {
            self.kind = match self.kind {
                Kind::Albers(_) => Kind::AlbersUs {
                    mainland: Albers::new(-96.0, 29.5, 45.5),
                    alaska: Albers::new(-154.0, 55.0, 65.0),
                    hawaii: Albers::new(-157.0, 8.0, 18.0),
                },
                Kind::Cylindrical { miller, .. } => Kind::Cylindrical {
                    miller,
                    insets: true,
                },
                kind => kind,
            }
        }
        self
    }

    pub(super) fn project_ring(&self, ring: &[Point], entity_center_lon: f64) -> Vec<Point> {
        let entity_center = nearest_longitude(entity_center_lon, self.center_lon);
        ring.iter()
            .map(|&(lon, lat)| {
                let lon = nearest_longitude(lon, entity_center);
                self.project(lon, lat)
            })
            .collect()
    }

    fn project(&self, lon: f64, lat: f64) -> Point {
        let (x, y) = match &self.kind {
            Kind::Robinson => {
                // Office linearly interpolates the Robinson table at five-degree intervals.
                const X: [f64; 19] = [
                    1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679,
                    0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322,
                ];
                const Y: [f64; 19] = [
                    0.0, 5.58, 11.16, 16.74, 22.32, 27.9, 33.48, 39.06, 44.622, 50.139, 55.584,
                    60.921, 66.114, 71.127, 75.915, 80.424, 84.546, 87.849, 90.0,
                ];
                let band = lat.abs().min(90.0) / 5.0;
                let i = (band as usize).min(17);
                let f = band - i as f64;
                let interpolate = |table: &[f64; 19]| table[i] + (table[i + 1] - table[i]) * f;
                (lon * interpolate(&X), interpolate(&Y).copysign(lat))
            }
            Kind::Cylindrical { miller, insets } => {
                let k = if *miller { 0.8 } else { 1.0 };
                let lat = lat.clamp(-79.0, 85.0).to_radians();
                let y = (FRAC_PI_4 + k * lat * 0.5).tan().ln().to_degrees() / k;
                if *insets && y > if *miller { 55.0 } else { 58.0 } {
                    (
                        lon * 0.25 - 80.0,
                        y * 0.25 + if *miller { 10.5 } else { 7.0 },
                    )
                } else if *insets && lon < -140.0 {
                    (lon + 50.0, y + if *miller { 7.0 } else { 5.5 })
                } else {
                    (lon, y)
                }
            }
            Kind::Albers(a) => a.project(lon, lat),
            Kind::AlbersUs {
                mainland,
                alaska,
                hawaii,
            } => {
                if lat > 50.0 {
                    let (x, y) = alaska.project(lon, lat);
                    (x * 0.35 - 17.0, y * 0.35 + 7.0)
                } else if lon < -140.0 {
                    let (x, y) = hawaii.project(lon, lat);
                    (x - 9.0, y + 5.5)
                } else {
                    mainland.project(lon, lat)
                }
            }
        };
        (x, -y)
    }
}

#[derive(Clone, Copy)]
pub(super) struct Bounds {
    pub(super) min_x: f64,
    pub(super) min_y: f64,
    pub(super) max_x: f64,
    pub(super) max_y: f64,
}

impl Bounds {
    pub(super) fn new() -> Self {
        Self {
            min_x: f64::INFINITY,
            min_y: f64::INFINITY,
            max_x: f64::NEG_INFINITY,
            max_y: f64::NEG_INFINITY,
        }
    }

    pub(super) fn add(&mut self, (x, y): Point) {
        if x.is_finite() && y.is_finite() {
            self.min_x = self.min_x.min(x);
            self.max_x = self.max_x.max(x);
            self.min_y = self.min_y.min(y);
            self.max_y = self.max_y.max(y);
        }
    }

    pub(super) fn center(&self) -> Point {
        (
            (self.min_x + self.max_x) * 0.5,
            (self.min_y + self.max_y) * 0.5,
        )
    }

    pub(super) fn fit(&self, x: f64, y: f64, width: f64, height: f64) -> Option<Transform> {
        let dx = self.max_x - self.min_x;
        let dy = self.max_y - self.min_y;
        if dx < 0.0 || dy < 0.0 || width <= 0.0 || height <= 0.0 {
            return None;
        }
        let scale = (width / dx).min(height / dy);
        if !scale.is_finite() || scale <= 0.0 {
            return None;
        }
        let (cx, cy) = self.center();
        Some(Transform {
            scale,
            x: x + width * 0.5 - cx * scale,
            y: y + height * 0.5 - cy * scale,
        })
    }
}

pub(super) struct Transform {
    scale: f64,
    x: f64,
    y: f64,
}

impl Transform {
    pub(super) fn apply(&self, (x, y): Point) -> Point {
        (x * self.scale + self.x, y * self.scale + self.y)
    }
}
