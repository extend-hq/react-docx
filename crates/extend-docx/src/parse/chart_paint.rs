use super::{color, drawing, drawing_child, ThemeColorMap};
use roxmltree::{Node, NodeId};
use std::collections::HashMap;
use std::fmt::Write;

#[derive(Default)]
pub(super) struct PaintServers {
    ids: HashMap<NodeId, usize>,
    markup: String,
}

impl PaintServers {
    pub(super) fn new(root: Node, theme: &ThemeColorMap) -> Self {
        let mut paints = Self::default();
        for node in root.descendants().filter(|n| drawing(*n)) {
            let id = paints.ids.len();
            if !matches!(node.tag_name().name(), "gradFill" | "pattFill") {
                continue;
            }
            if let Some(markup) = definition(node, theme, &id.to_string()) {
                paints.ids.insert(node.id(), id);
                paints.markup.push_str(&markup);
            }
        }
        paints
    }

    pub(super) fn fill(&self, properties: Node, theme: &ThemeColorMap) -> Option<String> {
        properties
            .children()
            .filter(|n| drawing(*n))
            .find_map(|n| match n.tag_name().name() {
                "noFill" => Some("none".to_owned()),
                "solidFill" => n.children().find_map(|c| color(c, theme)),
                "gradFill" | "pattFill" => self.ids.get(&n.id()).map(|id| format!("url(#cp{id})")),
                _ => None,
            })
    }

    pub(super) fn defs(&self) -> String {
        if self.markup.is_empty() {
            String::new()
        } else {
            format!("<defs>{}</defs>", self.markup)
        }
    }
}

fn fraction(raw: &str) -> Option<f64> {
    let value = if let Some(v) = raw.strip_suffix('%') {
        v.parse::<f64>().ok()? / 100.0
    } else {
        raw.parse::<f64>().ok()? / 100_000.0
    };
    value.is_finite().then_some(value)
}

fn stops(node: Node, theme: &ThemeColorMap) -> Vec<(f64, String)> {
    let mut values = Vec::new();
    if let Some(list) = drawing_child(node, "gsLst") {
        for stop in list
            .children()
            .filter(|n| drawing(*n) && n.tag_name().name() == "gs")
        {
            if let (Some(value), Some(offset)) = (
                stop.children().find_map(|n| color(n, theme)),
                stop.attribute("pos").and_then(fraction),
            ) {
                values.push((offset.clamp(0., 1.), value));
            }
        }
    }
    if values.is_empty() {
        values.extend([(0., "#000000".into()), (1., "#ffffff".into())]);
    }
    values
}

pub(in crate::parse) fn rgba(hex: &str) -> Option<[u8; 4]> {
    if !hex.starts_with('#') || !matches!(hex.len(), 7 | 9) {
        return None;
    }
    let mut components = [255; 4];
    for (i, pair) in hex[1..].as_bytes().chunks_exact(2).enumerate() {
        components[i] = u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?;
    }
    Some(components)
}

fn stop_markup(stops: &[(f64, String)]) -> String {
    let mut result = String::new();
    let shaped_ramp = stops.first().is_some_and(|s| s.0 == 0.)
        && stops.last().is_some_and(|s| s.0 == 1.)
        && (stops.len() == 2 || stops.len() == 3 && stops[0].1.eq_ignore_ascii_case(&stops[2].1));
    for (i, (offset, value)) in stops.iter().enumerate() {
        write!(result, r#"<stop offset="{offset}" stop-color="{value}"/>"#).unwrap();
        if !shaped_ramp {
            continue;
        }
        let Some((end_offset, end_value)) = stops.get(i + 1) else {
            continue;
        };
        let (Some(start), Some(end)) = (rgba(value), rgba(end_value)) else {
            continue;
        };
        // The two-color ramp weights the brighter end of each RGB channel.
        for step in 1..16 {
            let t = f64::from(step) / 16.;
            let [r, g, b, a] = std::array::from_fn(|c| {
                let ratio = if c == 3 {
                    t
                } else if start[c] < end[c] {
                    1. - (1. - t).powf(1.875)
                } else {
                    t.powf(1.875)
                };
                (f64::from(start[c]) + (f64::from(end[c]) - f64::from(start[c])) * ratio).round()
                    as u8
            });
            let x = offset + (end_offset - offset) * t;
            write!(
                result,
                r##"<stop offset="{x}" stop-color="#{r:02x}{g:02x}{b:02x}{a:02x}"/>"##
            )
            .unwrap();
        }
    }
    result
}

pub(super) fn definition(node: Node, theme: &ThemeColorMap, id: &str) -> Option<String> {
    match node.tag_name().name() {
        "gradFill" => gradient(node, theme, id),
        "pattFill" => pattern(node, theme, id),
        _ => None,
    }
}

fn gradient(node: Node, theme: &ThemeColorMap, id: &str) -> Option<String> {
    let values = stops(node, theme);
    let path = drawing_child(node, "path");
    let stops = stop_markup(&values);
    if let Some(path) = path {
        let inset = drawing_child(path, "fillToRect");
        let inset_at = |attr| {
            inset
                .and_then(|n| n.attribute(attr).and_then(fraction))
                .unwrap_or(if inset.is_some() { 0. } else { 0.5 })
        };
        let (left, top, right, bottom) = (
            inset_at("l"),
            inset_at("t"),
            1. - inset_at("r"),
            1. - inset_at("b"),
        );
        if path.attribute("path") == Some("circle") {
            let cx = (left + right) / 2.;
            let cy = (top + bottom) / 2.;
            let radius = 0.5_f64.hypot(0.5);
            let inner_radius = radius * (right - left).min(bottom - top).clamp(0., 1.);
            if node.parent_element().and_then(|p| p.parent_element())
                == Some(node.document().root_element())
            {
                let fx = cx * 100.;
                let fy = cy * 100.;
                let outer = radius * 100.;
                let inner = inner_radius * 100.;
                return Some(format!(
                    r#"<radialGradient id="cp{id}" gradientUnits="userSpaceOnUse" cx="50%" cy="50%" r="{outer}%" fx="{fx}%" fy="{fy}%" fr="{inner}%">{stops}</radialGradient>"#
                ));
            }
            return Some(format!(
                r#"<radialGradient id="cp{id}" cx="0.5" cy="0.5" r="{radius}" fx="{cx}" fy="{cy}" fr="{inner_radius}">{stops}</radialGradient>"#
            ));
        }

        // Each side interpolates between the corresponding edges of the focus and outer rectangles.
        let mut markup = format!(r#"<linearGradient id="cs{id}">{stops}</linearGradient>"#);
        let sides = [
            (
                0.,
                top,
                0.,
                0.,
                format!("0,0 1,0 {right},{top} {left},{top}"),
            ),
            (
                right,
                0.,
                1.,
                0.,
                format!("1,0 1,1 {right},{bottom} {right},{top}"),
            ),
            (
                0.,
                bottom,
                0.,
                1.,
                format!("1,1 0,1 {left},{bottom} {right},{bottom}"),
            ),
            (
                left,
                0.,
                0.,
                0.,
                format!("0,1 0,0 {left},{top} {left},{bottom}"),
            ),
        ];
        let mut sides_svg = String::new();
        for (i, (x1, y1, x2, y2, points)) in sides.into_iter().enumerate() {
            write!(markup, r##"<linearGradient id="cs{id}-{i}" href="#cs{id}" gradientUnits="userSpaceOnUse" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>"##).unwrap();
            write!(
                sides_svg,
                r##"<polygon shape-rendering="crispEdges" points="{points}" fill="url(#cs{id}-{i})"/>"##
            )
            .unwrap();
        }
        let first = &values[0].1;
        let focus_w = (right - left).max(0.);
        let focus_h = (bottom - top).max(0.);
        write!(markup, r#"<pattern id="cp{id}" width="1" height="1" patternContentUnits="objectBoundingBox"><rect x="{left}" y="{top}" width="{focus_w}" height="{focus_h}" fill="{first}"/>{sides_svg}</pattern>"#).unwrap();
        return Some(markup);
    }
    let degrees = drawing_child(node, "lin")
        .and_then(|n| n.attribute("ang")?.parse::<i32>().ok())
        .map_or(0., |v| f64::from(v) / 60_000.);
    let (dy, dx) = degrees.to_radians().sin_cos();
    let span = (dx.abs() + dy.abs()) * 0.5;
    let (x1, y1, x2, y2) = (
        0.5 - dx * span,
        0.5 - dy * span,
        0.5 + dx * span,
        0.5 + dy * span,
    );
    Some(format!(
        r#"<linearGradient id="cp{id}" x1="{x1:.6}" y1="{y1:.6}" x2="{x2:.6}" y2="{y2:.6}">{stops}</linearGradient>"#
    ))
}

fn pattern(node: Node, theme: &ThemeColorMap, id: &str) -> Option<String> {
    let preset = node.attribute("prst").unwrap_or("pct5");
    let bits = pattern_bits(preset)?;
    let paint = |name, default: &str| {
        drawing_child(node, name)
            .and_then(|n| n.children().find_map(|c| color(c, theme)))
            .unwrap_or_else(|| default.to_owned())
    };
    let foreground = paint("fgClr", "black");
    let background = paint("bgClr", "white");
    let path = mask_path(bits);
    let fringe = match preset {
        "dnDiag" => Some(0x41a0_5028_140a_0582),
        "upDiag" => Some(0x8205_0a14_2850_a041),
        "diagCross" => Some(0x42a5_5a24_245a_a542),
        _ => None,
    }
    .map(|mask| {
        format!(
            r#"<path fill="{foreground}" fill-opacity="0.5" d="{}"/>"#,
            mask_path(mask)
        )
    })
    .unwrap_or_default();
    // The repeat is eight points wide and tall. The mask uses its eight logical cells.
    Some(format!(
        r#"<pattern id="cp{id}" patternUnits="userSpaceOnUse" width="10.666667" height="10.666667" viewBox="0 0 8 8"><rect width="8" height="8" fill="{background}"/><path fill="{foreground}" d="{path}"/>{fringe}</pattern>"#
    ))
}

fn mask_path(bits: u64) -> String {
    let mut path = String::new();
    for (y, row) in bits.to_be_bytes().into_iter().enumerate() {
        let mut x = 0;
        while x < 8 {
            if row & (0x80 >> x) == 0 {
                x += 1;
                continue;
            }
            let start = x;
            while x < 8 && row & (0x80 >> x) != 0 {
                x += 1;
            }
            let length = x - start;
            write!(path, "M{start} {y}h{length}v1h-{length}z").unwrap();
        }
    }
    path
}

fn pattern_bits(preset: &str) -> Option<u64> {
    Some(match preset {
        "pct5" => 0x8000_0000_0800_0000,
        "pct10" => 0x8000_0800_8000_0800,
        "pct20" => 0x8800_2200_8800_2200,
        "pct25" => 0x8822_8822_8822_8822,
        "pct30" => 0xaa44_aa11_aa44_aa11,
        "pct40" => 0xaa55_aa51_aa55_aa15,
        "pct50" => 0xaa55_aa55_aa55_aa55,
        "pct60" => 0xee55_bb55_ee55_bb55,
        "pct70" => 0x77dd_77dd_77dd_77dd,
        "pct75" => 0x77ff_ddff_77ff_ddff,
        "pct80" => 0xefff_feff_efff_feff,
        "pct90" => 0xffff_fff7_ffff_ff7f,
        "horz" => 0xff00_0000_0000_0000,
        "vert" => 0x8080_8080_8080_8080,
        "ltHorz" => 0xff00_0000_ff00_0000,
        "ltVert" => 0x8888_8888_8888_8888,
        "dkHorz" => 0xffff_0000_ffff_0000,
        "dkVert" => 0xcccc_cccc_cccc_cccc,
        "narHorz" => 0xff00_ff00_ff00_ff00,
        "narVert" => 0x5555_5555_5555_5555,
        "dashHorz" => 0xf000_0000_0f00_0000,
        "dashVert" => 0x8080_8080_0808_0808,
        "cross" => 0xff80_8080_8080_8080,
        "dnDiag" => 0x8040_2010_0804_0201,
        "upDiag" => 0x0102_0408_1020_4080,
        "ltDnDiag" => 0x8844_2211_8844_2211,
        "ltUpDiag" => 0x1122_4488_1122_4488,
        "dkDnDiag" => 0xcc66_3399_cc66_3399,
        "dkUpDiag" => 0x3366_cc99_3366_cc99,
        "wdDnDiag" => 0xc1e0_7038_1c0e_0783,
        "wdUpDiag" => 0x8307_0e1c_3870_e0c1,
        "dashDnDiag" => 0x0000_8844_2211_0000,
        "dashUpDiag" => 0x0000_1122_4488_0000,
        "diagCross" => 0x8142_2418_1824_4281,
        "smCheck" => 0x9966_6699_9966_6699,
        "lgCheck" => 0xf0f0_f0f0_0f0f_0f0f,
        "smGrid" => 0xff88_8888_ff88_8888,
        "lgGrid" => 0xff80_8080_8080_8080,
        "dotGrid" => 0xaa00_8000_8000_8000,
        "smConfetti" => 0x8008_4002_1001_2004,
        "lgConfetti" => 0xb130_031b_d8c0_0c8d,
        "horzBrick" => 0xff80_8080_ff08_0808,
        "diagBrick" => 0x0102_0408_1824_4281,
        "solidDmnd" => 0x1038_7cfe_7c38_1000,
        "openDmnd" => 0x8244_2810_2844_8201,
        "dotDmnd" => 0x8000_2200_0800_2200,
        "plaid" => 0xaa55_aa55_f0f0_f0f0,
        "sphere" => 0x7789_8f8f_7798_f8f8,
        "weave" => 0x8854_2245_8814_2251,
        "divot" => 0x0010_0810_0080_0180,
        "shingle" => 0x0384_4830_0c02_0101,
        "wave" => 0x0018_25c0_0018_25c0,
        "trellis" => 0xff66_ff99_ff66_ff99,
        "zigZag" => 0x8142_2418_8142_2418,
        _ => return None,
    })
}
