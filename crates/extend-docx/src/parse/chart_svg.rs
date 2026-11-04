use super::util::escape_xml_text;
use crate::chart::child;
use roxmltree::Node;
use std::fmt::Write;

// Word uses the producing application's major version when chart properties are omitted.
pub(super) fn legacy_defaults(parts: &std::collections::HashMap<String, crate::OoxmlPart>) -> bool {
    let name = crate::package::relationship_target_from_parts(parts, "", "extended-properties");
    let Some(part) = parts.get(name.as_deref().unwrap_or("docProps/app.xml")) else {
        return false;
    };
    let Ok(xml) = roxmltree::Document::parse(&part.content) else {
        return false;
    };
    let version = xml
        .root_element()
        .children()
        .find(|n| n.is_element() && n.tag_name().name() == "AppVersion")
        .and_then(|n| n.text())
        .and_then(|v| v.trim().split('.').next()?.parse::<u16>().ok());
    matches!(version, Some(1..=12))
}

pub(super) fn val<'a>(node: Option<Node<'a, 'a>>, name: &str) -> Option<&'a str> {
    child(node?, name)?.attribute("val")
}

pub(super) fn number(s: Option<&str>) -> Option<f64> {
    s?.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}

pub(super) fn on(s: Option<&str>) -> bool {
    matches!(s, Some("1" | "true" | "on"))
}

pub(super) fn text_props<'a>(node: Option<Node<'a, 'a>>, rich: bool) -> Option<Node<'a, 'a>> {
    let node = node?;
    let root = if rich {
        child(node, "tx")
    } else {
        child(node, "txPr")
    }?;
    root.descendants()
        .find(|n| n.is_element() && matches!(n.tag_name().name(), "rPr" | "defRPr"))
}

pub(super) fn font_size(props: Option<Node>, default: f64) -> f64 {
    number(props.and_then(|p| p.attribute("sz")))
        .map(|n| (n / 75.).clamp(1., 512.))
        .unwrap_or(default)
}

pub(super) fn font_family(props: Option<Node>, default: &str) -> String {
    let name = props
        .and_then(|p| p.children().find(|n| n.tag_name().name() == "latin"))
        .and_then(|n| n.attribute("typeface"))
        .filter(|s| !s.starts_with('+') && !s.is_empty())
        .unwrap_or(default);
    let fallback = if matches!(name, "Cambria" | "Times New Roman" | "Georgia") {
        "serif"
    } else {
        "sans-serif"
    };
    format!("{}, {fallback}", escape_xml_text(name))
}

pub(super) fn text_width(s: &str, size: f64) -> f64 {
    // The model has no platform font shaper. Keep these advances in ems so
    // margins track the text size even when the browser substitutes a font.
    size * s
        .chars()
        .map(|c| match c {
            '0'..='9' => 0.554,
            'i' | 'l' | '.' | ',' | ' ' => 0.25,
            '-' | 't' | 'f' => 0.335,
            'r' => 0.415,
            'M' | 'W' | 'm' | 'w' => 0.8,
            'S' => 0.50,
            'o' => 0.531,
            'h' | 'u' | 'n' => 0.552,
            'A'..='Z' => 0.68,
            _ if c.is_ascii() => 0.54,
            _ => 1.,
        })
        .sum::<f64>()
}

pub(super) fn line(svg: &mut String, x: f64, y: f64, x2: f64, y2: f64, stroke: &str) {
    write!(
        svg,
        r#"<path d="M{x:.2} {y:.2}L{x2:.2} {y2:.2}" fill="none" stroke="{stroke}"/>"#
    )
    .unwrap();
}

pub(super) fn text(
    svg: &mut String,
    x: f64,
    y: f64,
    anchor: &str,
    size: f64,
    family: &str,
    label: &str,
) {
    write!(svg, r#"<text x="{x:.2}" y="{y:.2}" text-anchor="{anchor}" font-size="{size:.2}" font-family="{family}">{}</text>"#, escape_xml_text(label)).unwrap();
}

pub(super) fn marker(
    svg: &mut String,
    (x, y): (f64, f64),
    symbol: &str,
    radius: f64,
    fill: &str,
    outline: &str,
    sw: f64,
) {
    let r = radius;
    write!(svg, r#"<g transform="translate({x:.2} {y:.2})" fill="{fill}" stroke="{outline}" stroke-width="{sw:.2}" stroke-linejoin="round">"#).unwrap();
    let neg = -r;
    let shape = match symbol {
        "circle" | "dot" => format!(r#"<circle r="{r:.2}"/>"#),
        "square" => format!(
            r#"<rect x="{neg:.2}" y="{neg:.2}" width="{w:.2}" height="{w:.2}"/>"#,
            w = 2. * r
        ),
        "diamond" => format!(r#"<path d="M0 {neg:.2}L{r:.2} 0 0 {r:.2} {neg:.2} 0Z"/>"#),
        "triangle" => format!(r#"<path d="M0 {neg:.2}L{r:.2} {r:.2} {neg:.2} {r:.2}Z"/>"#),
        "plus" => format!(r#"<path d="M{neg:.2} 0H{r:.2}M0 {neg:.2}V{r:.2}" fill="none"/>"#),
        "star" => format!(
            r#"<path d="M{neg:.2} {neg:.2}L{r:.2} {r:.2}M{neg:.2} {r:.2}L{r:.2} {neg:.2}M0 {neg:.2}V{r:.2}" fill="none"/>"#
        ),
        "x" => format!(
            r#"<path d="M{neg:.2} {neg:.2}L{r:.2} {r:.2}M{neg:.2} {r:.2}L{r:.2} {neg:.2}" fill="none"/>"#
        ),
        "dash" => format!(r#"<path d="M{neg:.2} 0H{r:.2}" fill="none"/>"#),
        _ => String::new(),
    };
    svg.push_str(&shape);
    svg.push_str("</g>");
}

pub(super) fn format_value(value: f64, code: Option<&str>) -> String {
    let code = code.unwrap_or("General");
    if code == "General" || code.is_empty() {
        return value.to_string();
    }
    let decimals = code.split_once('.').map_or(0, |(_, frac)| {
        frac.chars().take_while(|c| *c == '0').count().min(12)
    });
    if code.to_ascii_uppercase().contains("E+") {
        let scientific = format!("{value:.decimals$E}");
        if let Some((mantissa, exp)) = scientific.split_once('E') {
            if let Ok(exp) = exp.parse::<i32>() {
                return format!("{mantissa}E{exp:+03}");
            }
        }
    }
    if code.contains('%') {
        return format!("{:.decimals$}%", value * 100.);
    }
    if code.contains('0') && code.chars().all(|c| matches!(c, '0' | '.')) {
        return format!("{value:.decimals$}");
    }
    value.to_string()
}
