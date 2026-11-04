use super::*;

fn show(table: Node, name: &str) -> bool {
    child(table, name).is_some_and(|n| {
        n.attribute("val")
            .is_none_or(|v| !matches!(v, "0" | "false" | "off"))
    })
}

pub(super) fn reserved_height(plot: Node, data: &ChartData, size: f64) -> f64 {
    let Some(table) = child(plot, "dTable") else {
        return 0.;
    };
    let size = font_size(text_props(Some(table), false), size);
    size * (3.22 + data.series.len() as f64 * 1.558)
}

fn displayed_value(raw: &str, code: &str) -> String {
    let Some(n) = number(Some(raw)) else {
        return raw.to_owned();
    };
    if code.eq_ignore_ascii_case("General") || code.is_empty() {
        if n == 0. {
            return "0".into();
        }
        let exponent = n.abs().log10().floor() as i32;
        if !(-9..=10).contains(&exponent) {
            let scientific = format!("{n:.8e}");
            if let Some((mantissa, power)) = scientific.split_once('e') {
                let sign = if power.starts_with('-') { "" } else { "+" };
                return format!(
                    "{}E{sign}{power}",
                    mantissa.trim_end_matches('0').trim_end_matches('.')
                );
            }
            return scientific;
        }
        let decimals = (9 - exponent).max(0) as usize;
        let formatted = format!("{n:.decimals$}");
        return if decimals > 0 {
            formatted.trim_end_matches('0').trim_end_matches('.').into()
        } else {
            formatted
        };
    }
    let section = code.split(';').next().unwrap_or(code);
    if section
        .chars()
        .all(|c| matches!(c, '0' | '#' | '.' | ',' | '%' | '$' | ' '))
    {
        let decimals = section
            .split_once('.')
            .map(|(_, d)| {
                d.chars()
                    .take_while(|c| matches!(c, '0' | '#'))
                    .count()
                    .min(15)
            })
            .unwrap_or(0);
        let percent = section.contains('%');
        let value = if percent { 100. * n } else { n };
        let mut formatted = format!("{value:.decimals$}");
        if section.contains(',') {
            let integer = formatted.find('.').unwrap_or(formatted.len());
            let sign = usize::from(formatted.starts_with('-'));
            let mut i = integer;
            while i > sign + 3 {
                i -= 3;
                formatted.insert(i, ',');
            }
        }
        if section.contains('$') {
            formatted.insert(0, '$');
        }
        if percent {
            formatted.push('%');
        }
        return formatted;
    }
    raw.into()
}

pub(super) fn draw(
    out: &mut String,
    plot: Node,
    data: &ChartData,
    colors: &ChartColors,
    width: f64,
    height: f64,
    plot_bottom: f64,
    font: &str,
    size: f64,
) {
    let Some(table) = child(plot, "dTable") else {
        return;
    };
    let count = data
        .series
        .iter()
        .filter_map(|s| s.points.last())
        .map(|p| u64::from(p.index) + 1)
        .max()
        .unwrap_or(0);
    if count == 0 {
        return;
    }
    let props = text_props(Some(table), false);
    let size = font_size(props, size);
    let local_font = props.map(|p| font_family(Some(p), "Calibri"));
    let font = local_font.as_deref().unwrap_or(font);
    let key = if show(table, "showKeys") {
        size * 0.55
    } else {
        0.
    };
    let names: Vec<_> = data
        .series
        .iter()
        .enumerate()
        .map(|(i, s)| {
            s.name
                .clone()
                .unwrap_or_else(|| format!("Series {}", i + 1))
        })
        .collect();
    let label_width = (names
        .iter()
        .map(|n| {
            text_width(n, size)
                * if font.starts_with("Calibri,") {
                    0.88
                } else {
                    1.
                }
        })
        .fold(0., f64::max)
        + size * 0.85
        + key)
        .min(width * 0.40);
    let manual = child(plot, "layout").and_then(|n| child(n, "manualLayout"));
    let left = num(manual, "x").unwrap_or(0.12).clamp(0., 1.) * width;
    let span = num(manual, "w").unwrap_or(0.84).clamp(0., 1.) * width;
    let header_x = (left + 1.57 * size).max(label_width + 1.).min(width);
    let right = (left + span - 0.60 * size).clamp(header_x, width);
    let x = header_x - label_width;
    let header_height = size * 1.22;
    let row_height = size * 1.558;
    let y = plot_bottom + size * 2.;
    let top_row = y + header_height;
    let rows = data
        .series
        .len()
        .min(((height - top_row) / row_height).ceil().max(0.) as usize);
    if rows == 0 || right <= header_x {
        return;
    }
    let bottom = top_row + rows as f64 * row_height;
    let cell_width = (right - header_x) / count as f64;
    let sp = child(table, "spPr");
    let stroke = sp
        .and_then(|n| colors.shape_stroke(n))
        .unwrap_or_else(|| "#868686".into());
    let fill = sp
        .and_then(|n| colors.shape_fill(n))
        .unwrap_or_else(|| "none".into());
    let outline = if show(table, "showOutline") {
        stroke.as_str()
    } else {
        "none"
    };
    write!(out,r#"<path d="M{header_x:.2} {y:.2}H{right:.2}V{bottom:.2}H{x:.2}V{top_row:.2}H{header_x:.2}Z" fill="{fill}" stroke="{outline}"/>"#).unwrap();
    if show(table, "showHorzBorder") {
        line(out, header_x, top_row, right, top_row, &stroke);
        for i in 1..rows {
            let yy = top_row + i as f64 * row_height;
            line(out, x, yy, right, yy, &stroke);
        }
    }
    let stride = (1. / cell_width).ceil().max(1.) as usize;
    if show(table, "showVertBorder") {
        line(out, header_x, top_row, header_x, bottom, &stroke);
        for i in (1..count).step_by(stride) {
            let xx = header_x + i as f64 * cell_width;
            line(out, xx, y, xx, bottom, &stroke);
        }
    }
    let mut categories = BTreeMap::new();
    for s in &data.series {
        for point in &s.points {
            if let Some(cat) = point.categories.first() {
                categories.entry(point.index).or_insert(cat.label.as_str());
            }
        }
    }
    let center = |idx: u32| header_x + (f64::from(idx) + 0.5) * cell_width;
    let text_stride = (size * 1.4 / cell_width).ceil().max(1.) as u64;
    for (index, label) in categories {
        if u64::from(index) % text_stride == 0 {
            text(
                out,
                center(index),
                y + size * 0.89,
                "middle",
                size,
                font,
                label,
            );
        }
    }
    let format_codes: Vec<_> = plot
        .children()
        .filter(|n| n.tag_name().name().ends_with("Chart"))
        .flat_map(|g| g.children().filter(|n| chart_node(*n, "ser")))
        .map(|s| {
            child(s, "val")
                .and_then(|v| v.descendants().find(|n| chart_node(*n, "formatCode")))
                .and_then(|n| n.text())
                .unwrap_or("General")
        })
        .collect();
    for (i, series) in data.series.iter().take(rows).enumerate() {
        let mid = top_row + (i as f64 + 0.5) * row_height;
        let key_x = x + size * 0.35;
        if key > 0. {
            write!(
                out,
                r#"<rect x="{key_x:.2}" y="{:.2}" width="{key:.2}" height="{key:.2}" fill="{}"/>"#,
                mid - key / 2.,
                colors.fill(i, None)
            )
            .unwrap();
        }
        text(
            out,
            key_x + key + if key > 0. { size * 0.24 } else { 0. },
            mid + size * 0.26,
            "start",
            size,
            font,
            &names[i],
        );
        for p in &series.points {
            if u64::from(p.index) % text_stride != 0 {
                continue;
            }
            if let Some(raw) = p.value.as_deref() {
                let value = displayed_value(raw, format_codes.get(i).copied().unwrap_or("General"));
                text(
                    out,
                    center(p.index),
                    mid + size * 0.28,
                    "middle",
                    size,
                    font,
                    &value,
                );
            }
        }
    }
}
