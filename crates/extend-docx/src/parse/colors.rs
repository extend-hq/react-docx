use super::context::ThemeColorMap;

/// Mirrors TypeScript `DEFAULT_DRAWING_SCHEME_COLORS`.
pub fn default_drawing_scheme_colors() -> ThemeColorMap {
    ThemeColorMap::from([
        ("bg1".to_string(), "#ffffff".to_string()),
        ("bg2".to_string(), "#f3f4f6".to_string()),
        ("tx1".to_string(), "#000000".to_string()),
        ("tx2".to_string(), "#1f2937".to_string()),
        ("dk1".to_string(), "#000000".to_string()),
        ("dk2".to_string(), "#1f2937".to_string()),
        ("lt1".to_string(), "#ffffff".to_string()),
        ("lt2".to_string(), "#f3f4f6".to_string()),
        ("accent1".to_string(), "#4472c4".to_string()),
        ("accent2".to_string(), "#ed7d31".to_string()),
        ("accent3".to_string(), "#70ad47".to_string()),
        ("accent4".to_string(), "#5b9bd5".to_string()),
        ("accent5".to_string(), "#7030a0".to_string()),
        ("accent6".to_string(), "#ffc000".to_string()),
        ("hlink".to_string(), "#0563c1".to_string()),
        ("folhlink".to_string(), "#954f72".to_string()),
        ("followedhyperlink".to_string(), "#954f72".to_string()),
    ])
}

/// Mirrors TypeScript `normalizeHexColor`.
pub fn normalize_hex_color(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim();
    if normalized.is_empty() || normalized.eq_ignore_ascii_case("auto") {
        return None;
    }

    if normalized.len() == 6 && normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Some(format!("#{normalized}"));
    }

    if normalized.len() == 3 && normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        let expanded: String = normalized.chars().flat_map(|ch| [ch, ch]).collect();
        return Some(format!("#{expanded}"));
    }

    if normalized.starts_with('#')
        && normalized.len() == 7
        && normalized[1..].chars().all(|ch| ch.is_ascii_hexdigit())
    {
        return Some(normalized.to_string());
    }

    None
}

/// Mirrors TypeScript `resolveDrawingColorFromXml`.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedDrawingColor {
    pub color: String,
    pub opacity: Option<f64>,
}

pub fn resolve_drawing_color_from_xml(
    color_xml: Option<&str>,
    theme_colors: &ThemeColorMap,
) -> Option<ResolvedDrawingColor> {
    let color_xml = color_xml?;
    let defaults = default_drawing_scheme_colors();

    let srgb = find_drawing_attribute_value(color_xml, "a:srgbClr", "val")
        .as_deref()
        .and_then(|value| normalize_hex_color(Some(value)));
    let sys = find_drawing_attribute_value(color_xml, "a:sysClr", "lastClr")
        .as_deref()
        .and_then(|value| normalize_hex_color(Some(value)));
    let scheme_token = find_drawing_attribute_value(color_xml, "a:schemeClr", "val")
        .map(|token| token.trim().to_ascii_lowercase());
    let scheme = scheme_token.as_ref().and_then(|token| {
        theme_colors
            .get(token)
            .cloned()
            .or_else(|| defaults.get(token).cloned())
    });
    let preset = find_drawing_attribute_value(color_xml, "a:prstClr", "val").and_then(|value| {
        match value.as_str() {
            "black" => Some("#000000".to_string()),
            "white" => Some("#ffffff".to_string()),
            _ => None,
        }
    });
    let color = apply_drawing_color_transforms(&srgb.or(sys).or(scheme).or(preset)?, color_xml)?;

    let alpha_raw = find_drawing_attribute_value(color_xml, "a:alpha", "val");
    let alpha = alpha_raw.and_then(|raw| raw.parse::<f64>().ok());
    let opacity = alpha
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| (value / 100_000.0).clamp(0.0, 1.0));

    Some(ResolvedDrawingColor { color, opacity })
}

fn apply_drawing_color_transforms(color: &str, xml: &str) -> Option<String> {
    let tags = [
        "a:tint", "a:shade", "a:sat", "a:satMod", "a:satOff", "a:lum", "a:lumMod", "a:lumOff",
    ];
    let transforms = crate::xml::extract_balanced_tag_blocks_in_order(xml, &tags);
    if transforms.is_empty() {
        return Some(color.to_string());
    }
    let values = transforms.into_iter().filter_map(|tag| {
        let value = crate::xml::get_attribute(&xml[tag.start..tag.end], "val")?
            .parse::<f64>()
            .ok()?;
        if !value.is_finite() {
            return None;
        }
        Some((tag.tag_name, value / 100_000.0))
    });
    transform_rgb(color, values, false)
}

fn linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

pub(super) fn srgb(c: f64) -> f64 {
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1. / 2.4) - 0.055
    }
}

pub(super) fn hsl_to_rgb(hue: f64, saturation: f64, lightness: f64) -> [f64; 3] {
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let x = chroma * (1.0 - (hue % 2.0 - 1.0).abs());
    let offset = lightness - chroma / 2.0;
    match hue as u32 {
        0 => [chroma, x, 0.0],
        1 => [x, chroma, 0.0],
        2 => [0.0, chroma, x],
        3 => [0.0, x, chroma],
        4 => [x, 0.0, chroma],
        _ => [chroma, 0.0, x],
    }
    .map(|channel| channel + offset)
}

pub(super) fn transform_rgb(
    color: &str,
    transforms: impl IntoIterator<Item = (impl AsRef<str>, f64)>,
    linear_tints: bool,
) -> Option<String> {
    let mut rgb = [0.0; 3];
    for (index, channel) in rgb.iter_mut().enumerate() {
        *channel =
            u8::from_str_radix(color.get(1 + index * 2..3 + index * 2)?, 16).ok()? as f64 / 255.0;
    }
    for (name, amount) in transforms {
        let name = name.as_ref().trim_start_matches("a:");
        match name {
            "tint" | "shade" if linear_tints => {
                rgb = rgb.map(|c| {
                    srgb(linear(c) * amount + if name == "tint" { 1. - amount } else { 0. })
                });
            }
            "gamma" => rgb = rgb.map(srgb),
            "invGamma" => rgb = rgb.map(linear),
            "inv" => rgb = rgb.map(|c| srgb(1. - linear(c))),
            "gray" => rgb = [0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; 3],
            "red" | "green" | "blue" | "redMod" | "greenMod" | "blueMod" | "redOff"
            | "greenOff" | "blueOff" => {
                let i = if name.starts_with("red") {
                    0
                } else if name.starts_with("green") {
                    1
                } else {
                    2
                };
                rgb[i] = srgb(if name.ends_with("Mod") {
                    linear(rgb[i]) * amount
                } else if name.ends_with("Off") {
                    linear(rgb[i]) + amount
                } else {
                    amount
                });
            }
            "tint" => rgb = rgb.map(|channel| channel * amount + 1.0 - amount),
            "shade" => rgb = rgb.map(|channel| channel * amount),
            "comp" | "hue" | "hueMod" | "hueOff" | "sat" | "satMod" | "satOff" | "lum"
            | "lumMod" | "lumOff" => {
                let max = rgb.into_iter().fold(0.0_f64, f64::max);
                let min = rgb.into_iter().fold(1.0_f64, f64::min);
                let delta = max - min;
                let mut lightness = (max + min) / 2.0;
                let mut saturation = if delta == 0.0 {
                    0.0
                } else {
                    delta / (1.0 - (2.0 * lightness - 1.0).abs())
                };
                let hue = if delta == 0.0 {
                    0.0
                } else if max == rgb[0] {
                    ((rgb[1] - rgb[2]) / delta).rem_euclid(6.0)
                } else if max == rgb[1] {
                    (rgb[2] - rgb[0]) / delta + 2.0
                } else {
                    (rgb[0] - rgb[1]) / delta + 4.0
                };
                let hue = if name == "comp" || name.starts_with("hue") {
                    match name {
                        "comp" => hue + 3.,
                        "hue" => amount * 6.,
                        "hueMod" => hue * amount,
                        _ => hue + amount * 6.,
                    }
                    .rem_euclid(6.)
                } else {
                    let channel = if name.starts_with("sat") {
                        &mut saturation
                    } else {
                        &mut lightness
                    };
                    *channel = if name.ends_with("Mod") {
                        *channel * amount
                    } else if name.ends_with("Off") {
                        *channel + amount
                    } else {
                        amount
                    }
                    .clamp(0., 1.);
                    hue
                };
                rgb = hsl_to_rgb(hue, saturation, lightness);
            }
            _ => continue,
        }
        rgb = rgb.map(|channel| channel.clamp(0.0, 1.0));
    }
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        (rgb[0] * 255.0).round() as u8,
        (rgb[1] * 255.0).round() as u8,
        (rgb[2] * 255.0).round() as u8
    ))
}

fn find_drawing_attribute_value(xml: &str, tag_name: &str, attribute: &str) -> Option<String> {
    let tag_token = super::scan::find_tag_token(xml, tag_name)?;
    crate::xml::get_attribute(&tag_token, attribute)
}
