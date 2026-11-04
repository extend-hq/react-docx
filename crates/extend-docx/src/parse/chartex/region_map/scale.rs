use super::super::Canvas;
use crate::chart::{cx_child as child, ChartSeries};
use crate::parse::{chart_svg::number, colors::transform_rgb};
use roxmltree::Node;
use std::collections::HashMap;

pub(super) struct Stop {
    pub value: f64,
    pub color: String,
}

pub(super) fn stop_offset(stops: &[Stop], index: usize) -> f64 {
    let lo = stops[0].value;
    let hi = stops[stops.len() - 1].value;
    if lo == hi {
        return index as f64 / (stops.len() - 1) as f64;
    }
    fraction(stops[index].value, lo, hi)
}

fn fraction(value: f64, lo: f64, hi: f64) -> f64 {
    if value <= lo {
        return 0.;
    }
    if value >= hi {
        return 1.;
    }
    let span = hi - lo;
    if span.is_finite() {
        (value - lo) / span
    } else {
        (value * 0.5 - lo * 0.5) / (hi * 0.5 - lo * 0.5)
    }
}

pub(super) enum Key {
    Gradient(Vec<Stop>),
    Categories(Vec<(String, String)>),
}

pub(super) struct MapScale {
    pub key: Key,
    pub fills: HashMap<u32, String>,
}

impl MapScale {
    pub fn new(ctx: &Canvas, dimension: Option<Node>, source: Node, series: &ChartSeries) -> Self {
        let categorical = dimension.is_some_and(|d| d.attribute("type") == Some("colorStr"));
        let mut fills = HashMap::new();
        let key = if categorical {
            let mut entries = Vec::new();
            let mut indices = HashMap::new();
            for point in &series.points {
                let Some(label) = point.value.as_deref().filter(|s| !s.is_empty()) else {
                    continue;
                };
                let next = indices.len();
                let index = *indices.entry(label).or_insert(next);
                if index == next {
                    entries.push((label.to_owned(), String::new()));
                }
            }
            let last = entries.len().saturating_sub(1);
            for (i, (_, fill)) in entries.iter_mut().enumerate() {
                *fill = ctx.colors.palette(i, last);
            }
            for point in &series.points {
                if let Some(&index) = point.value.as_deref().and_then(|s| indices.get(s)) {
                    fills.insert(point.index, entries[index].1.clone());
                }
            }
            Key::Categories(entries)
        } else {
            let stops = numeric_stops(ctx, source, series);
            for point in &series.points {
                if let Some(value) = number(point.value.as_deref()) {
                    if let Some(fill) = gradient_color(&stops, value) {
                        fills.insert(point.index, fill);
                    }
                }
            }
            Key::Gradient(stops)
        };
        for point in &series.points {
            if let Some(fill) = ctx
                .colors
                .explicit_fill(ctx.source_indices[0], Some(point.index))
            {
                fills.insert(point.index, fill.to_owned());
            }
        }
        Self { key, fills }
    }
}

fn numeric_stops(ctx: &Canvas, source: Node, data: &ChartSeries) -> Vec<Stop> {
    let mut values = data
        .points
        .iter()
        .filter_map(|p| number(p.value.as_deref()));
    let Some(first) = values.next() else {
        return Vec::new();
    };
    let (min, max) = values.fold((first, first), |(lo, hi), v| (lo.min(v), hi.max(v)));
    let positions = child(source, "valueColorPositions");
    let colors = child(source, "valueColors");
    let color = |name: &str| ctx.colors.solid_color(child(colors?, name)?);
    let position = |name: &str, default: f64, range_min: f64, range_max: f64| {
        positions
            .and_then(|p| child(p, name))
            .and_then(|p| {
                if let Some(percent) = child(p, "percent").and_then(|n| number(n.attribute("val")))
                {
                    let t = (percent / 100.).clamp(0., 1.);
                    Some(range_min * (1. - t) + range_max * t)
                } else {
                    child(p, "number").and_then(|n| number(n.attribute("val")))
                }
            })
            .filter(|v| v.is_finite())
            .unwrap_or(default)
    };
    let base = ctx.colors.palette(0, 0);
    let low = color("minColor").unwrap_or_else(|| {
        transform_rgb(&base, [("lumMod", 0.2), ("lumOff", 0.8)], true)
            .unwrap_or_else(|| base.clone())
    });
    let high = color("maxColor").unwrap_or_else(|| {
        transform_rgb(&base, [("lumMod", 0.75)], true).unwrap_or_else(|| base.clone())
    });
    let lo = position("min", min, min, max);
    let hi = position("max", max, min, max).max(lo);
    let mut stops = vec![Stop {
        value: lo,
        color: low,
    }];
    if positions.is_some_and(|p| p.attribute("count") == Some("3")) {
        stops.push(Stop {
            value: position("mid", lo * 0.5 + hi * 0.5, lo, hi).clamp(lo, hi),
            color: color("midColor").unwrap_or(base),
        });
    }
    stops.push(Stop {
        value: hi,
        color: high,
    });
    stops
}

fn gradient_color(stops: &[Stop], value: f64) -> Option<String> {
    let first = stops.first()?;
    let last = stops.last()?;
    let t = if first.value == last.value {
        0.5
    } else {
        fraction(value, first.value, last.value)
    };
    if t == 0. {
        return Some(first.color.clone());
    }
    let Some(i) = (1..stops.len()).find(|&i| t < stop_offset(stops, i)) else {
        return Some(last.color.clone());
    };
    let (from, to) = (&stops[i - 1], &stops[i]);
    let t = fraction(t, stop_offset(stops, i - 1), stop_offset(stops, i));
    let a = crate::parse::chart_colors::rgba(&from.color)?;
    let b = crate::parse::chart_colors::rgba(&to.color)?;
    let [r, g, b, alpha] =
        std::array::from_fn(|i| (f64::from(a[i]) * (1. - t) + f64::from(b[i]) * t).round() as u8);
    Some(if alpha == 255 {
        format!("#{r:02x}{g:02x}{b:02x}")
    } else {
        format!("#{r:02x}{g:02x}{b:02x}{alpha:02x}")
    })
}
