#[path = "chart_base_color.rs"]
mod base_color;
#[path = "chart_paint.rs"]
mod paint;
#[path = "chart_style_palette.rs"]
mod style_palette;

pub(super) use paint::rgba;

use super::colors::{default_drawing_scheme_colors, normalize_hex_color, transform_rgb};
use super::context::{ParseContext, ParsedStyleSheet, ThemeColorMap};
use crate::chart::{chart_node, child, cx_child, CHARTEX_NS};
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

#[derive(Default)]
struct Properties {
    fill: Option<String>,
    outline: Option<String>,
    marker: Option<String>,
    marker_outline: Option<String>,
}

impl Properties {
    fn parse(node: Node, theme: &ThemeColorMap, servers: &paint::PaintServers) -> Self {
        let properties = child(node, "spPr").or_else(|| cx_child(node, "spPr"));
        let marker = child(node, "marker").and_then(|m| child(m, "spPr"));
        Self {
            fill: properties.and_then(|p| servers.fill(p, theme)),
            outline: properties
                .and_then(|p| drawing_child(p, "ln"))
                .and_then(|p| servers.fill(p, theme)),
            marker: marker.and_then(|p| servers.fill(p, theme)),
            marker_outline: marker
                .and_then(|m| drawing_child(m, "ln"))
                .and_then(|p| servers.fill(p, theme)),
        }
    }
}

struct Series {
    index: usize,
    vary_by_point: bool,
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

fn default_line_transforms(xml: &str) -> Option<Vec<Transform>> {
    let document = roxmltree::Document::parse(xml).ok()?;
    let styles = document
        .root_element()
        .descendants()
        .find(|n| drawing(*n) && n.tag_name().name() == "lnStyleLst")?;
    let line = drawing_child(styles, "ln")?;
    let scheme = drawing_child(drawing_child(line, "solidFill")?, "schemeClr")?;
    (scheme.attribute("val") == Some("phClr")).then(|| transforms(scheme))
}

pub(super) struct ChartColors {
    legacy_defaults: bool,
    servers: paint::PaintServers,
    palette: Palette,
    style_palette: Option<style_palette::StylePalette>,
    style: Option<style_palette::StylePaint>,
    theme: ThemeColorMap,
    series: Vec<Series>,
    highest_series: usize,
    highest_point: usize,
    line_transforms: Vec<Transform>,
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
        let mapping = child(root, "clrMapOvr").or_else(|| cx_child(root, "clrMapOvr"));
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
        let servers = paint::PaintServers::new(root, &mapped);
        let palette = Palette::legacy(root, &mapped);
        let style_palette = (root.tag_name().namespace() == Some(CHARTEX_NS))
            .then(|| related_xml(ctx, part_name, "chartColorStyle"))
            .flatten()
            .and_then(|xml| style_palette::StylePalette::parse(xml, &mapped));
        let style = if root.tag_name().namespace() == Some(CHARTEX_NS) {
            related_xml(ctx, part_name, "chartStyle").and_then(|xml| {
                style_palette::StylePaint::parse(xml, &mapped, style_palette.as_ref())
            })
        } else {
            None
        };
        let legacy_defaults = super::chart_svg::legacy_defaults(ctx.parts);
        let mut series = Vec::new();

        if let Some(plot) = child(root, "chart").and_then(|c| child(c, "plotArea")) {
            for group in plot
                .children()
                .filter(|n| n.tag_name().name().ends_with("Chart"))
            {
                let circular = matches!(
                    group.tag_name().name(),
                    "pieChart" | "pie3DChart" | "doughnutChart" | "ofPieChart"
                );
                let vary_by_point = (circular || data.series.len() == 1)
                    && child(group, "varyColors").map_or(!legacy_defaults, |n| {
                        !matches!(n.attribute("val"), Some("false" | "0" | "off"))
                    });
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
                            Some((idx, Properties::parse(n, &mapped, &servers)))
                        })
                        .collect();
                    series.push(Series {
                        index,
                        vary_by_point,
                        points,
                        paint: Properties::parse(s, &mapped, &servers),
                    });
                }
            }
        }
        if root.tag_name().namespace() == Some(CHARTEX_NS) {
            for s in root
                .descendants()
                .filter(|n| n.has_tag_name((CHARTEX_NS, "series")))
            {
                let points = s
                    .children()
                    .filter(|n| n.has_tag_name((CHARTEX_NS, "dataPt")))
                    .filter_map(|pt| {
                        Some((
                            pt.attribute("idx")?.parse().ok()?,
                            Properties::parse(pt, &mapped, &servers),
                        ))
                    })
                    .collect();
                series.push(Series {
                    index: series.len(),
                    vary_by_point: false,
                    points,
                    paint: Properties::parse(s, &mapped, &servers),
                });
            }
        }
        let highest_point = data
            .series
            .iter()
            .filter_map(|s| s.points.last())
            .map(|p| p.index as usize)
            .max()
            .unwrap_or(0);
        let main_part =
            crate::package::relationship_target_from_parts(ctx.parts, "", "officeDocument")
                .unwrap_or_else(|| "word/document.xml".into());
        let theme_xml = related_xml(ctx, &main_part, "theme").or_else(|| {
            ctx.parts
                .get("word/theme/theme1.xml")
                .map(|p| p.content.as_str())
        });
        let line_transforms = related_xml(ctx, part_name, "themeOverride")
            .and_then(default_line_transforms)
            .or_else(|| theme_xml.and_then(default_line_transforms))
            .unwrap_or_default();
        let highest_series = series.iter().map(|s| s.index).max().unwrap_or(0);
        Self {
            legacy_defaults,
            series,
            servers,
            palette,
            style_palette,
            style,
            theme: mapped,
            highest_series,
            highest_point,
            line_transforms,
        }
    }

    pub fn legacy_defaults(&self) -> bool {
        self.legacy_defaults
    }

    pub fn palette(&self, index: usize, highest: usize) -> String {
        if let Some(palette) = &self.style_palette {
            palette.at(index, highest.saturating_add(1))
        } else {
            self.palette.at(index, highest)
        }
    }

    pub fn rectangle_fill<'a>(
        &self,
        fill: &'a str,
        category: usize,
        bounds: [f64; 4],
    ) -> std::borrow::Cow<'a, str> {
        match &self.style {
            Some(style) => style.rectangle_fill(fill, category, bounds),
            None => std::borrow::Cow::Borrowed(fill),
        }
    }

    pub fn style_point_fill(&self, automatic: &str) -> Option<String> {
        self.style.as_ref()?.point_fill(automatic)
    }

    pub fn style_fill(&self, entry: &str, automatic: &str) -> Option<String> {
        self.style.as_ref()?.fill(entry, automatic)
    }

    pub fn style_stroke(&self, entry: &str, automatic: &str) -> Option<String> {
        self.style.as_ref()?.stroke(entry, automatic)
    }

    pub fn style_stroke_width(&self, entry: &str) -> Option<f64> {
        self.style.as_ref()?.stroke_width(entry)
    }

    pub fn style_font_size(&self, entry: &str) -> Option<f64> {
        self.style.as_ref()?.font_size(entry)
    }

    pub fn style_text(&self, entry: &str, automatic: &str) -> Option<String> {
        self.style.as_ref()?.text(entry, automatic)
    }

    pub fn vary_by_point(&self, i: usize) -> bool {
        self.series.get(i).is_some_and(|s| s.vary_by_point)
    }

    pub fn with_definitions(&self, mut svg: String) -> String {
        let mut defs = self.servers.defs();
        if let Some(style) = self.style.as_ref() {
            defs.push_str(&style.defs());
        }
        if !defs.is_empty() {
            if let Some(pos) = svg.find('>') {
                svg.insert_str(pos + 1, &defs);
            }
        }
        svg
    }

    pub fn shape_fill(&self, properties: Node) -> Option<String> {
        self.servers.fill(properties, &self.theme)
    }

    pub fn solid_color(&self, container: Node) -> Option<String> {
        container.children().find_map(|node| color(node, &self.theme))
    }

    pub fn shape_stroke(&self, properties: Node) -> Option<String> {
        self.servers
            .fill(drawing_child(properties, "ln")?, &self.theme)
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
        if self.vary_by_point(i) {
            if let Some(i) = point {
                return self.palette(i as usize, self.highest_point);
            }
        }
        self.palette(
            self.series.get(i).map_or(i, |s| s.index),
            self.highest_series,
        )
    }

    pub fn explicit_fill(&self, i: usize, point: Option<u32>) -> Option<&str> {
        self.explicit(i, point, |p| p.fill.as_deref())
    }

    pub fn fill(&self, i: usize, point: Option<u32>) -> String {
        self.explicit_fill(i, point)
            .map(str::to_owned)
            .unwrap_or_else(|| self.automatic(i, point))
    }

    pub fn outline(&self, i: usize, point: Option<u32>) -> Option<&str> {
        self.explicit(i, point, |p| p.outline.as_deref())
    }

    fn default_stroke(&self, i: usize, point: Option<u32>) -> String {
        let base = self.automatic(i, point);
        transformed(&base, &self.line_transforms).unwrap_or(base)
    }

    pub fn line_at(&self, i: usize, point: Option<u32>) -> String {
        self.outline(i, point)
            .map(str::to_owned)
            .unwrap_or_else(|| self.default_stroke(i, point))
    }

    pub fn line(&self, i: usize) -> String {
        self.line_at(i, None)
    }

    pub fn marker_outline(&self, i: usize, point: Option<u32>) -> String {
        self.explicit(i, point, |p| p.marker_outline.as_deref())
            .map(str::to_owned)
            .unwrap_or_else(|| self.default_stroke(i, point))
    }

    pub fn marker(&self, i: usize, point: Option<u32>) -> String {
        self.explicit(i, point, |p| p.marker.as_deref())
            .map(str::to_owned)
            .unwrap_or_else(|| self.automatic(i, point))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rings_select_colors_by_source_category_and_honor_no_fill() {
        let xml = r#"<chartSpace xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><chart><plotArea><doughnutChart>
        <ser><idx val="0"/><val><numLit><pt idx="0"><v>8</v></pt><pt idx="2"><v>6</v></pt></numLit></val></ser>
        <ser><idx val="1"/><dPt><idx val="0"/><spPr><a:noFill/></spPr></dPt><val><numLit><pt idx="0"><v>3</v></pt><pt idx="2"><v>1</v></pt></numLit></val></ser>
        </doughnutChart></plotArea></chart></chartSpace>"#;
        let document = roxmltree::Document::parse(xml).unwrap();
        let root = document.root_element();
        let data = crate::chart::chart_data_from_root(root).unwrap();
        let context = ParseContext {
            relationships: Default::default(),
            content_types: Default::default(),
            parts: &Default::default(),
            binary_assets: &Default::default(),
            style_sheet: crate::parse::empty_style_sheet(),
            warnings: Default::default(),
        };
        let colors = ChartColors::new(root, &context, "chart.xml", &data);
        assert_eq!(colors.fill(0, Some(0)), "#156082");
        assert_eq!(colors.fill(1, Some(0)), "none");
        assert_eq!(colors.fill(0, Some(2)), "#196B24");
        assert_eq!(colors.fill(1, Some(2)), colors.fill(0, Some(2)));

        let key = "docProps/app.xml";
        let parts = HashMap::from([(key.into(), crate::OoxmlPart {
            name: key.into(),
            content: r#"<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><AppVersion>12.0000</AppVersion></Properties>"#.into(),
        })]);
        let older = ChartColors::new(
            root,
            &ParseContext {
                parts: &parts,
                ..context
            },
            "chart.xml",
            &data,
        );
        assert_eq!(older.fill(1, Some(0)), "none");
        assert_eq!(older.fill(0, Some(2)), "#156082");
        assert_eq!(older.fill(1, Some(2)), "#E97132");
    }
}
