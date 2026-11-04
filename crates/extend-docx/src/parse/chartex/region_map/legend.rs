use super::super::drawing::{self, Font};
use super::{
    scale::{stop_offset, Key, Stop},
    Canvas, Rect,
};
use crate::chart::cx_child as child;
use crate::parse::chart_svg::{format_value, on, text_width};
use roxmltree::Node;
use std::fmt::Write;

pub(super) fn render(
    ctx: &Canvas,
    key: &Key,
    name: &str,
    format: Option<&str>,
    face: &str,
    plot: &mut Rect,
    out: &mut String,
) {
    let Some(node) = child(ctx.root, "chart").and_then(|chart| child(chart, "legend")) else {
        return;
    };
    match key {
        Key::Categories(items) => {
            let entries: Vec<_> = items
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            if matches!(node.attribute("pos").unwrap_or("r"), "l" | "r") {
                side_key(ctx, node, &entries, face, plot, out);
                return;
            }
            drawing::legend(
                ctx,
                out,
                &entries,
                &mut plot.left,
                &mut plot.top,
                &mut plot.right,
                &mut plot.bottom,
            );
        }
        Key::Gradient(stops) if !stops.is_empty() => {
            gradient(ctx, node, stops, name, format, face, plot, out);
        }
        _ => {}
    }
}

fn side_key(
    ctx: &Canvas,
    node: Node,
    entries: &[(&str, &str)],
    face: &str,
    plot: &mut Rect,
    out: &mut String,
) {
    if entries.is_empty() {
        return;
    }
    let font = Font::with_defaults(
        ctx,
        Some(node),
        "#595959",
        face,
        ctx.colors.style_font_size("legend").unwrap_or(12.),
    );
    let em = font.size;
    let width = entries
        .iter()
        .map(|(name, _)| advance(name, em, font.face()))
        .fold(0., f64::max)
        + 2.8 * em;
    let height = (2. * entries.len() as f64 + 0.8) * em;
    let left = node.attribute("pos") == Some("l");
    let x = if left { plot.left } else { plot.right - width };
    let mut y = align(
        plot.top,
        plot.bottom,
        height,
        node.attribute("align").unwrap_or("ctr"),
    ) + em;
    let key = em * 0.8;
    for &(name, color) in entries {
        write!(out, r#"<rect x="{:.2}" y="{y:.2}" width="{key:.2}" height="{key:.2}" fill="{color}" stroke="white" stroke-width=".33"/>"#, x + em).unwrap();
        font.text(out, x + 2.2 * em, y + key, "start", name);
        y += 2. * em;
    }
    if !on(node.attribute("overlay")) {
        if left {
            plot.left += width + 0.4 * em;
        } else {
            plot.right -= width + 0.4 * em;
        }
    }
}

fn align(start: f64, end: f64, length: f64, alignment: &str) -> f64 {
    match alignment {
        "min" => start,
        "max" => (end - length).max(start),
        _ => start + ((end - start - length) * 0.5).max(0.),
    }
}

pub(super) fn cambria_width(text: &str, size: f64) -> Option<f64> {
    // Advances are measured in 2048 units per em.
    const CAMBRIA: [u16; 95] = [
        451, 585, 805, 1268, 1036, 1822, 1408, 485, 782, 782, 875, 1134, 420, 680, 420, 1004, 1134,
        1134, 1134, 1134, 1134, 1134, 1134, 1134, 1134, 1134, 540, 540, 1134, 1134, 1134, 865,
        1813, 1276, 1252, 1152, 1355, 1178, 1099, 1251, 1406, 664, 628, 1289, 1099, 1670, 1394,
        1338, 1163, 1338, 1272, 1016, 1214, 1327, 1236, 1887, 1170, 1168, 1101, 717, 1004, 717,
        1134, 759, 583, 1000, 1121, 903, 1136, 999, 620, 1012, 1130, 569, 545, 1074, 556, 1704,
        1143, 1087, 1139, 1120, 847, 880, 693, 1131, 1032, 1586, 990, 1032, 931, 793, 648, 793,
        1459,
    ];
    let mut units = 0.;
    for ch in text.chars() {
        let advance = match ch {
            ' '..='~' => CAMBRIA[ch as usize - 32],
            '©' => 1743,
            _ => return None,
        };
        units += f64::from(advance);
    }
    Some(units * size / 2048.)
}

fn advance(text: &str, size: f64, face: &str) -> f64 {
    if face.eq_ignore_ascii_case("Cambria") {
        if let Some(width) = cambria_width(text, size) {
            return width;
        }
    }
    text_width(text, size)
}

fn wrap_heading(name: &str, size: f64, face: &str, max_width: f64) -> Vec<String> {
    let mut lines = Vec::new();
    for line in name.lines() {
        let mut current = String::new();
        let mut width = 0.;
        for word in line.split_whitespace() {
            let word_width = advance(word, size, face);
            let space = advance(" ", size, face);
            if !current.is_empty() && width + space + word_width > max_width {
                lines.push(std::mem::take(&mut current));
                width = 0.;
            }
            if !current.is_empty() {
                current.push(' ');
                width += space;
            }
            current.push_str(word);
            width += word_width;
        }
        lines.push(current);
    }
    lines
}

fn gradient(
    ctx: &Canvas,
    node: Node,
    stops: &[Stop],
    name: &str,
    format: Option<&str>,
    face: &str,
    plot: &mut Rect,
    out: &mut String,
) {
    let pos = node.attribute("pos").unwrap_or("r");
    let vertical = matches!(pos, "l" | "r");
    let alignment = node.attribute("align").unwrap_or("ctr");
    let reserve = !on(node.attribute("overlay"));
    let font = Font::with_defaults(
        ctx,
        Some(node),
        "#595959",
        face,
        ctx.colors.style_font_size("legend").unwrap_or(12.),
    );
    let em = font.size;
    let pad = em * 0.65;
    let gap = em * 0.4;
    let face = font.face();
    let lines = wrap_heading(
        name,
        em,
        face,
        if vertical {
            (ctx.width * 0.30 - 2. * pad).max(em)
        } else {
            plot.width()
        },
    );
    let heading_width = lines
        .iter()
        .map(|s| advance(s, em, face))
        .fold(0., f64::max);
    let labels: Vec<_> = stops
        .iter()
        .map(|s| format_value(s.value, format))
        .collect();
    let label_width = labels
        .iter()
        .map(|s| advance(s, em, face))
        .fold(0., f64::max);
    let label_height = 1.2 * em;
    let heading_height = lines.len() as f64 * label_height;
    let thickness = 0.8 * em;
    let length = (7.2 * em).min(if vertical {
        plot.height() * 0.66
    } else {
        plot.width() * 0.66
    });
    let (bar_w, bar_h) = if vertical {
        (thickness, length)
    } else {
        (length, thickness)
    };
    let (width, height) = if vertical {
        (
            heading_width.max(bar_w + 2. * gap + label_width) + 2. * pad,
            2. * pad + heading_height + bar_h + em,
        )
    } else {
        (
            heading_width + bar_w + label_width + 2. * pad,
            (bar_h + label_height + gap * 1.8).max(heading_height) + 2. * pad,
        )
    };
    let (x, y) = match pos {
        "l" => (plot.left, align(plot.top, plot.bottom, height, alignment)),
        "b" => (
            align(plot.left, plot.right, width, alignment),
            (plot.bottom - height).max(plot.top),
        ),
        "t" => (align(plot.left, plot.right, width, alignment), plot.top),
        _ => (
            (plot.right - width).max(plot.left),
            align(plot.top, plot.bottom, height, alignment),
        ),
    };
    let (bx, by) = if vertical {
        (x + pad + em / 3., y + pad + heading_height + em * 0.94)
    } else {
        (x + pad + heading_width + label_width * 0.5, y + pad + gap)
    };
    for (i, line) in lines.iter().enumerate() {
        font.text(
            out,
            x + pad,
            y + pad + em * 0.94 + i as f64 * label_height,
            "start",
            line,
        );
    }
    let min = stops.first().unwrap().value;
    let max = stops.last().unwrap().value;
    let direction = if vertical {
        r#"x1="0" x2="0" y1="1" y2="0""#
    } else {
        r#"x1="0" x2="1" y1="0" y2="0""#
    };
    write!(out, r#"<defs><linearGradient id="mapScale" {direction}>"#).unwrap();
    for (i, stop) in stops.iter().enumerate() {
        write!(
            out,
            r#"<stop offset="{:.5}" stop-color="{}"/>"#,
            stop_offset(stops, i),
            stop.color
        )
        .unwrap();
    }
    write!(out, r##"</linearGradient></defs><rect x="{bx:.2}" y="{by:.2}" width="{bar_w:.2}" height="{bar_h:.2}" fill="url(#mapScale)" stroke="white" stroke-width=".33"/>"##).unwrap();
    for (i, (stop, label)) in stops.iter().zip(labels).enumerate() {
        if i > 0 && stop.value == stops[i - 1].value {
            continue;
        }
        let offset = if min == max {
            0.5
        } else {
            stop_offset(stops, i)
        };
        if vertical {
            font.text(
                out,
                bx + bar_w + gap,
                by + bar_h * (1. - offset) + em * 0.39,
                "start",
                &label,
            );
        } else {
            font.text(
                out,
                bx + bar_w * offset,
                by + bar_h + em + gap,
                "middle",
                &label,
            );
        }
    }
    if reserve {
        match pos {
            "l" => plot.left += width + gap,
            "b" => plot.bottom -= height + gap,
            "t" => plot.top += height + gap,
            _ => plot.right -= width + gap,
        }
    }
}
