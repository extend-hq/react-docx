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
    let scheme = scheme_token
        .as_ref()
        .and_then(|token| {
            theme_colors
                .get(token)
                .cloned()
                .or_else(|| defaults.get(token).cloned())
        });
    let color = srgb.or(sys).or(scheme)?;

    let alpha_raw = find_drawing_attribute_value(color_xml, "a:alpha", "val");
    let alpha = alpha_raw.and_then(|raw| raw.parse::<f64>().ok());
    let opacity = alpha.filter(|value| value.is_finite() && *value >= 0.0).map(|value| {
        (value / 100_000.0).clamp(0.0, 1.0)
    });

    Some(ResolvedDrawingColor { color, opacity })
}

fn find_drawing_attribute_value(xml: &str, tag_name: &str, attribute: &str) -> Option<String> {
    let tag_token = super::scan::find_tag_token(xml, tag_name)?;
    crate::xml::get_attribute(&tag_token, attribute)
}
