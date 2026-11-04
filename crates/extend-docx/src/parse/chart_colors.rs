#[path = "chart_base_color.rs"]
mod base_color;

use super::colors::{default_drawing_scheme_colors, normalize_hex_color, transform_rgb};
use super::context::{ParseContext, ParsedStyleSheet, ThemeColorMap};
use crate::chart::{chart_node, child};
use roxmltree::Node;
use std::collections::HashMap;

fn drawing(node: Node) -> bool {
    node.is_element()
        && matches!(
            node.tag_name().namespace(),
            Some(
                "http://schemas.openxmlformats.org/drawingml/2006/main"
                    | "http://purl.oclc.org/ooxml/drawingml/main"
            )
        )
}

fn drawing_child<'a>(parent: Node<'a, 'a>, name: &str) -> Option<Node<'a, 'a>> {
    parent
        .children()
        .find(|n| drawing(*n) && n.tag_name().name() == name)
}

fn related_xml<'a>(
    ctx: &ParseContext<'a, impl std::borrow::Borrow<ParsedStyleSheet>>,
    source: &str,
    kind: &str,
) -> Option<&'a str> {
    let part = crate::package::relationship_target_from_parts(ctx.parts, source, kind)?;
    Some(ctx.parts.get(&part)?.content.as_str())
}

type Transform = (String, f64);

fn transforms(node: Node) -> Vec<Transform> {
    node.children()
        .filter(|n| drawing(*n))
        .filter_map(|n| {
            let name = n.tag_name().name();
            if matches!(name, "comp" | "inv" | "gray" | "gamma" | "invGamma") {
                return Some((name.to_owned(), 0.));
            }
            let raw = n.attribute("val")?;
            let ratio = if matches!(name, "hue" | "hueOff") {
                raw.parse::<f64>().ok()? / 21_600_000.
            } else if let Some(percent) = raw.strip_suffix('%') {
                percent.parse::<f64>().ok()? / 100.
            } else {
                raw.parse::<f64>().ok()? / 100_000.
            };
            ratio.is_finite().then(|| (name.to_owned(), ratio))
        })
        .collect()
}

fn transformed(color: &str, transforms: &[Transform]) -> Option<String> {
    if transforms.is_empty() {
        return Some(color.to_owned());
    }
    let mut alpha = color
        .get(7..9)
        .and_then(|s| u8::from_str_radix(s, 16).ok())
        .map_or(1., |x| f64::from(x) / 255.);
    for (name, amount) in transforms {
        alpha = match name.as_str() {
            "alpha" => *amount,
            "alphaMod" => alpha * amount,
            "alphaOff" => alpha + amount,
            _ => continue,
        }
        .clamp(0., 1.);
    }
    let mut rgb = transform_rgb(
        color,
        transforms.iter().map(|(name, value)| (name, *value)),
        true,
    )?;
    if alpha < 1. {
        use std::fmt::Write;
        write!(rgb, "{:02x}", (alpha * 255.).round() as u8).unwrap();
    }
    Some(rgb)
}

fn color(node: Node, theme: &ThemeColorMap) -> Option<String> {
    if !drawing(node) {
        return None;
    }
    let base = match node.tag_name().name() {
        "srgbClr" => normalize_hex_color(node.attribute("val"))?,
        "sysClr" => normalize_hex_color(node.attribute("lastClr"))?,
        "schemeClr" => theme
            .get(&node.attribute("val")?.to_ascii_lowercase())?
            .clone(),
        _ => base_color::resolve(node)?,
    };
    transformed(&base, &transforms(node))
}

fn fill(properties: Node, theme: &ThemeColorMap) -> Option<String> {
    if drawing_child(properties, "noFill").is_some() {
        return Some("none".into());
    }
    drawing_child(properties, "solidFill")?
        .children()
        .find_map(|n| color(n, theme))
}

#[derive(Default)]
struct Properties {
    fill: Option<String>,
    outline: Option<String>,
    marker: Option<String>,
}

impl Properties {
    fn parse(node: Node, theme: &ThemeColorMap) -> Self {
        let properties = child(node, "spPr");
        Self {
            fill: properties.and_then(|p| fill(p, theme)),
            outline: properties
                .and_then(|p| drawing_child(p, "ln"))
                .and_then(|p| fill(p, theme)),
            marker: child(node, "marker")
                .and_then(|m| child(m, "spPr"))
                .and_then(|p| fill(p, theme)),
        }
    }
}

struct Series {
    index: usize,
    vary: bool,
    paint: Properties,
    points: HashMap<u32, Properties>,
}

struct Palette(Vec<String>);

impl Palette {
    fn legacy(root: Node, theme: &ThemeColorMap) -> Self {
        const MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
        let fallback_style = || {
            root.children()
                .filter(|n| n.has_tag_name((MC, "AlternateContent")))
                .filter_map(|n| n.children().find(|c| c.has_tag_name((MC, "Fallback"))))
                .find_map(|n| child(n, "style"))
        };
        let style = child(root, "style")
            .or_else(fallback_style)
            .and_then(|n| n.attribute("val"))
            .and_then(|v| v.parse::<u8>().ok())
            .filter(|v| (1..=48).contains(v))
            .unwrap_or(2);
        let colors = match (style - 1) % 8 {
            0 => {
                let amounts = if style == 41 {
                    [0.05, 0.55, 0.78, 0.15, 0.7, 0.3]
                } else {
                    [0.88, 0.55, 0.78, 0.92, 0.7, 0.3]
                };
                amounts
                    .iter()
                    .map(|t| transformed(&theme["dk1"], &[("tint".into(), *t)]).unwrap())
                    .collect()
            }
            1 => (1..=6)
                .map(|i| theme[&format!("accent{i}")].clone())
                .collect(),
            n => vec![theme[&format!("accent{}", n - 1)].clone()],
        };
        Self(colors)
    }

    fn at(&self, index: usize, highest: usize) -> String {
        let base = &self.0[index % self.0.len()];
        let cycle = (index / self.0.len()) as u64;
        let last = (highest / self.0.len()) as u64;
        // Chart formatting uses whole signed percentages before mixing in linear RGB.
        let fade = (140 * (cycle + 1) / (last + 2)) as i32 - 70;
        if fade == 0 {
            return base.clone();
        }
        let name = if fade > 0 { "tint" } else { "shade" };
        transformed(base, &[(name.into(), 1. - f64::from(fade.abs()) / 100.)])
            .unwrap_or_else(|| base.clone())
    }
}

pub(super) struct ChartColors {
    palette: Palette,
    theme: ThemeColorMap,
    series: Vec<Series>,
    highest_series: usize,
    highest_point: usize,
}

impl ChartColors {
    pub fn new(
        root: Node,
        ctx: &ParseContext<'_, impl std::borrow::Borrow<ParsedStyleSheet>>,
        part_name: &str,
        data: &crate::chart::ChartData,
    ) -> Self {
        let mut theme = default_drawing_scheme_colors();
        for (token, color) in [
            ("accent1", "#156082"),
            ("accent2", "#E97132"),
            ("accent3", "#196B24"),
            ("accent4", "#0F9ED5"),
            ("accent5", "#A02B93"),
            ("accent6", "#4EA72E"),
            ("dk2", "#0E2841"),
            ("lt2", "#E8E8E8"),
            ("hlink", "#467886"),
            ("folhlink", "#96607D"),
        ] {
            theme.insert(token.into(), color.into());
        }
        theme.extend(ctx.styles().theme_colors.clone());
        if let Some(xml) = related_xml(ctx, part_name, "themeOverride")
            .and_then(|xml| roxmltree::Document::parse(xml).ok())
        {
            if let Some(scheme) = drawing_child(xml.root_element(), "clrScheme") {
                for item in scheme.children().filter(|n| drawing(*n)) {
                    if let Some(rgb) = item.children().find_map(|n| color(n, &theme)) {
                        theme.insert(item.tag_name().name().to_ascii_lowercase(), rgb);
                    }
                }
            }
        }
        let mapping = child(root, "clrMapOvr");
        let mut mapped = theme.clone();
        for (token, base) in [
            ("bg1", "lt1"),
            ("bg2", "lt2"),
            ("tx1", "dk1"),
            ("tx2", "dk2"),
            ("accent1", "accent1"),
            ("accent2", "accent2"),
            ("accent3", "accent3"),
            ("accent4", "accent4"),
            ("accent5", "accent5"),
            ("accent6", "accent6"),
            ("hlink", "hlink"),
            ("folHlink", "folHlink"),
        ] {
            let mapped_to = mapping.and_then(|m| m.attribute(token)).unwrap_or(base);
            if let Some(value) = theme.get(&mapped_to.to_ascii_lowercase()) {
                mapped.insert(token.to_ascii_lowercase(), value.clone());
            }
        }
        let palette = Palette::legacy(root, &mapped);
        let mut series = Vec::new();

        if let Some(plot) = child(root, "chart").and_then(|c| child(c, "plotArea")) {
            for group in plot
                .children()
                .filter(|n| n.tag_name().name().ends_with("Chart"))
            {
                let vary = child(group, "varyColors").map_or_else(
                    || matches!(group.tag_name().name(), "pieChart" | "doughnutChart"),
                    |n| !matches!(n.attribute("val"), Some("false" | "0" | "off")),
                );
                for s in group.children().filter(|n| chart_node(*n, "ser")) {
                    let index = child(s, "idx")
                        .and_then(|n| n.attribute("val"))
                        .and_then(|v| v.parse::<u32>().ok())
                        .map_or(series.len(), |i| i as usize);
                    let points = s
                        .children()
                        .filter(|n| chart_node(*n, "dPt"))
                        .filter_map(|n| {
                            let idx = child(n, "idx")?.attribute("val")?.parse().ok()?;
                            Some((idx, Properties::parse(n, &mapped)))
                        })
                        .collect();
                    series.push(Series {
                        index,
                        vary,
                        points,
                        paint: Properties::parse(s, &mapped),
                    });
                }
            }
        }
        let highest_point = data
            .series
            .first()
            .and_then(|s| s.points.last())
            .map_or(0, |p| p.index as usize);
        let highest_series = series.iter().map(|s| s.index).max().unwrap_or(0);
        Self {
            series,
            palette,
            theme: mapped,
            highest_series,
            highest_point,
        }
    }

    pub fn shape_fill(&self, properties: Node) -> Option<String> {
        fill(properties, &self.theme)
    }

    pub fn shape_stroke(&self, properties: Node) -> Option<String> {
        fill(drawing_child(properties, "ln")?, &self.theme)
    }

    fn explicit(
        &self,
        i: usize,
        point: Option<u32>,
        field: fn(&Properties) -> Option<&str>,
    ) -> Option<&str> {
        let s = self.series.get(i)?;
        point
            .and_then(|p| s.points.get(&p))
            .and_then(field)
            .or_else(|| field(&s.paint))
    }

    fn automatic(&self, i: usize, point: Option<u32>) -> String {
        if self.series.len() == 1 && self.series[0].vary {
            if let Some(i) = point {
                return self.palette.at(i as usize, self.highest_point);
            }
        }
        self.palette.at(
            self.series.get(i).map_or(i, |s| s.index),
            self.highest_series,
        )
    }

    pub fn fill(&self, i: usize, point: Option<u32>) -> String {
        self.explicit(i, point, |p| p.fill.as_deref())
            .map(str::to_owned)
            .unwrap_or_else(|| self.automatic(i, point))
    }

    pub fn outline(&self, i: usize, point: Option<u32>) -> Option<&str> {
        self.explicit(i, point, |p| p.outline.as_deref())
    }

    pub fn line(&self, i: usize) -> String {
        self.outline(i, None)
            .map(str::to_owned)
            .unwrap_or_else(|| self.automatic(i, None))
    }

    pub fn marker(&self, i: usize, point: Option<u32>) -> String {
        self.explicit(i, point, |p| p.marker.as_deref())
            .map(str::to_owned)
            .unwrap_or_else(|| self.automatic(i, point))
    }
}
