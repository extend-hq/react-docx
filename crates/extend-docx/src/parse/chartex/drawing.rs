use super::Canvas;
use crate::chart::cx_child as child;
use crate::parse::{
    chart_svg::{number as numeric, on},
    util::escape_xml_text,
};
use roxmltree::Node;
use std::fmt::Write;

fn style_entry(node: Node) -> Option<&'static str> {
    match node.tag_name().name() {
        "axis" if child(node, "catScaling").is_some() => Some("categoryAxis"),
        "axis" => Some("valueAxis"),
        "legend" => Some("legend"),
        "dataLabels" | "dataLabel" => Some("dataLabel"),
        "majorGridlines" => Some("gridlineMajor"),
        "minorGridlines" => Some("gridlineMinor"),
        "connectorLines" => Some("seriesLine"),
        _ => None,
    }
}

pub(super) struct Font {
    face: String,
    pub(super) size: f64,
    fill: String,
}

impl Font {
    pub(super) fn new(ctx: &Canvas, element: Option<Node>, fallback: &str) -> Self {
        Self::with_defaults(ctx, element, fallback, "Cambria", 12.)
    }

    pub(super) fn with_defaults(
        ctx: &Canvas,
        element: Option<Node>,
        fallback: &str,
        default_face: &str,
        default_size: f64,
    ) -> Self {
        let properties = element
            .and_then(|e| child(e, "txPr"))
            .into_iter()
            .flat_map(|n| n.descendants())
            .filter(|n| matches!(n.tag_name().name(), "defRPr" | "rPr" | "endParaRPr"));
        let size = properties
            .clone()
            .find_map(|n| numeric(n.attribute("sz")))
            .map_or(default_size, |n| (n / 75.).clamp(1., 256.));
        let face = properties
            .clone()
            .find_map(|p| {
                p.children()
                    .find(|n| n.tag_name().name() == "latin")?
                    .attribute("typeface")
            })
            .filter(|s| !s.starts_with('+'))
            .unwrap_or(default_face);
        let fill = properties
            .clone()
            .find_map(|p| ctx.colors.shape_fill(p))
            .or_else(|| {
                let color = ctx.colors.style_text(style_entry(element?)?, fallback)?;
                if fallback == "#fefefe" && color.eq_ignore_ascii_case("#595959") {
                    None
                } else {
                    Some(color)
                }
            })
            .unwrap_or_else(|| fallback.into());
        Self {
            face: escape_xml_text(face),
            size,
            fill,
        }
    }
    pub(super) fn text(&self, out: &mut String, x: f64, y: f64, anchor: &str, label: &str) {
        write!(out, r#"<text x="{x:.2}" y="{y:.2}" text-anchor="{anchor}" fill="{}" font-family="{}" font-size="{:.2}">{}</text>"#,self.fill,self.face,self.size,escape_xml_text(label)).unwrap();
    }
    pub(super) fn width(&self, s: &str) -> f64 {
        label_width(s, self.size, &self.face)
    }
    pub(super) fn face(&self) -> &str {
        &self.face
    }
}

pub(super) struct Stroke {
    color: String,
    width: f64,
}

impl Stroke {
    pub(super) fn new(ctx: &Canvas, node: Option<Node>, default_color: &str) -> Self {
        let props = node.and_then(|n| child(n, "spPr"));
        let color = props
            .and_then(|p| ctx.colors.shape_stroke(p))
            .or_else(|| ctx.colors.style_stroke(style_entry(node?)?, default_color))
            .unwrap_or_else(|| default_color.into());
        let width = props
            .and_then(|p| p.children().find(|n| n.tag_name().name() == "ln"))
            .and_then(|n| numeric(n.attribute("w")))
            .map_or(1., |w| (w / 9525.).max(0.));
        Self { color, width }
    }
    pub(super) fn line(&self, out: &mut String, x: f64, y: f64, x2: f64, y2: f64) {
        if self.width > 0. && self.color != "none" {
            write!(out,r#"<path d="M{x:.2},{y:.2} L{x2:.2},{y2:.2}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#,self.color,self.width).unwrap();
        }
    }
}

fn label_width(s: &str, size: f64, font: &str) -> f64 {
    size * s
        .chars()
        .map(|c| match c {
            '0'..='9' if font == "Calibri" => 0.507,
            '0'..='9' => 0.554,
            '.' | 'i' | 'l' | ' ' => 0.24,
            'I' | 'f' | 'r' | 't' | '-' => 0.35,
            '+' | 'E' => 0.55,
            'M' | 'W' | 'm' | 'w' => 0.81,
            _ if c.is_ascii() => 0.51,
            _ => 1.,
        })
        .sum::<f64>()
}

pub(super) use super::super::chart_svg::format_value;

pub(super) fn data_label(
    labels: Option<Node>,
    category: &str,
    value: &str,
    series: Option<&str>,
) -> Option<String> {
    let node = labels?;
    let v = child(node, "visibility")?;
    let mut parts = Vec::new();
    if on(v.attribute("seriesName")) {
        parts.extend(series);
    }
    if on(v.attribute("categoryName")) {
        parts.push(category);
    }
    if on(v.attribute("value")) {
        parts.push(value);
    }
    (!parts.is_empty()).then(|| parts.join(", "))
}

pub(super) fn legend(
    ctx: &Canvas,
    out: &mut String,
    entries: &[(&str, &str)],
    left: &mut f64,
    top: &mut f64,
    right: &mut f64,
    bottom: &mut f64,
) {
    let Some(node) = ctx
        .root
        .descendants()
        .find(|n| n.has_tag_name((crate::chart::CHARTEX_NS, "legend")))
    else {
        return;
    };
    if entries.is_empty() {
        return;
    }
    let font = Font::new(ctx, Some(node), "#595959");
    let spacing = font.size;
    let key = font.size * 0.775;
    let widths: Vec<_> = entries
        .iter()
        .map(|(s, _)| font.width(s) + 2. * spacing)
        .collect();
    let width = widths.iter().sum::<f64>() - spacing * 2. / 3.;
    let height = (entries.len() as f64) * spacing * 1.65;
    let side_width = widths.iter().copied().fold(0., f64::max) + spacing * 0.75;
    let pos = node.attribute("pos").unwrap_or("t");
    let reserve = !on(node.attribute("overlay"));
    let side = matches!(pos, "l" | "r");
    let align = node.attribute("align").unwrap_or("ctr");
    let align_at = |extent: f64, size: f64| match align {
        "min" | "l" | "t" => 8.,
        "max" | "r" | "b" => extent - size - 8.,
        _ => (extent - size) / 2.,
    };
    let x = if side {
        if pos == "l" {
            8.
        } else {
            ctx.width - side_width
        }
    } else {
        align_at(ctx.width, width)
    };
    let y = if side {
        align_at(ctx.height, height) + spacing
    } else if pos == "b" {
        ctx.height - spacing * 1.5
    } else {
        ctx.title_bottom + spacing * 1.35
    };
    if reserve {
        match pos {
            "r" => *right -= side_width,
            "l" => *left += side_width,
            "b" => *bottom -= 2.75 * spacing,
            _ => *top += 3.2 * spacing,
        }
    }
    let (mut x, mut y) = (x, y);
    for (i, (name, color)) in entries.iter().enumerate() {
        let y0 = y - key / 2.;
        write!(
            out,
            r#"<rect x="{x:.2}" y="{y0:.2}" width="{key:.2}" height="{key:.2}" fill="{color}"/>"#
        )
        .unwrap();
        font.text(out, x + spacing * 1.17, y + spacing * 0.367, "start", name);
        if side {
            y += spacing * 1.65;
        } else {
            x += widths[i];
        }
    }
}
