use super::{color, drawing_child, transformed, transforms, Palette, ThemeColorMap, Transform};
use roxmltree::Node;
use std::collections::HashMap;
use std::fmt::Write;
use std::{borrow::Cow, cell::RefCell};

const NS: &str = "http://schemas.microsoft.com/office/drawing/2012/chartStyle";

enum Method {
    Cycle,
    Linear {
        within: Option<Palette>,
        reversed: bool,
    },
}

pub(super) struct StylePalette {
    colors: Palette,
    variations: Vec<Vec<Transform>>,
    method: Method,
}

impl StylePalette {
    pub(super) fn parse(xml: &str, theme: &ThemeColorMap) -> Option<Self> {
        let doc = roxmltree::Document::parse(xml).ok()?;
        let root = doc.root_element();
        if !root.has_tag_name((NS, "colorStyle")) {
            return None;
        }
        let colors: Vec<_> = root.children().filter_map(|n| color(n, theme)).collect();
        if colors.is_empty() {
            return None;
        }
        let variations = root
            .children()
            .filter(|n| n.has_tag_name((NS, "variation")))
            .map(transforms)
            .collect();
        let method = match root.attribute("meth") {
            Some(
                "withinLinear" | "withinLinearReversed" | "acrossLinear" | "acrossLinearReversed",
            ) => {
                let name = root.attribute("meth")?;
                Method::Linear {
                    within: name
                        .starts_with("within")
                        .then(|| Palette(vec![colors[0].clone()])),
                    reversed: name.ends_with("Reversed"),
                }
            }
            _ => Method::Cycle,
        };
        Some(Self {
            colors: Palette(colors),
            variations,
            method,
        })
    }

    pub(super) fn at(&self, index: usize, count: usize) -> String {
        match &self.method {
            Method::Cycle => self.cycled(index),
            Method::Linear { within, reversed } => {
                let last = count.saturating_sub(1);
                let pos = index.min(last);
                let pos = if *reversed { last - pos } else { pos };
                // Across-color ramps reserve the next slot when the last row is full.
                let base = match within {
                    Some(palette) => palette.at(pos, last),
                    None => self.colors.at(pos, count),
                };
                self.variations
                    .first()
                    .and_then(|v| transformed(&base, v))
                    .unwrap_or(base)
            }
        }
    }

    fn cycled(&self, index: usize) -> String {
        let len = self.colors.0.len();
        let base = &self.colors.0[index % len];
        let variation = (index / len) % self.variations.len().max(1);
        self.variations
            .get(variation)
            .and_then(|v| transformed(base, v))
            .unwrap_or_else(|| base.clone())
    }
}

fn cs_child<'a>(parent: Node<'a, 'a>, name: &str) -> Option<Node<'a, 'a>> {
    parent.children().find(|n| n.has_tag_name((NS, name)))
}

#[derive(Clone, Default)]
struct Paint {
    brush: Option<usize>,
    fixed: Option<String>,
    transforms: Vec<Transform>,
}

impl Paint {
    fn resolve(&self, automatic: &str) -> Option<String> {
        let base = self.fixed.as_deref().unwrap_or(automatic);
        transformed(base, &self.transforms)
    }
}

#[derive(Default)]
struct Entry {
    fill: Option<Paint>,
    stroke: Option<Paint>,
    stroke_width: Option<f64>,
    text: Option<Paint>,
    font_size: Option<f64>,
}

struct Brush {
    xml: String,
    placeholder: bool,
}

impl Brush {
    fn new(node: Node) -> Self {
        // The fill can inherit namespace bindings from any ancestor in the style part.
        let mut xml = String::from("<brush");
        for ns in node.namespaces() {
            xml.push_str(" xmlns");
            if let Some(prefix) = ns.name() {
                write!(xml, ":{prefix}").unwrap();
            }
            write!(xml, r#"="{}""#, crate::parse::escape_xml_text(ns.uri())).unwrap();
        }
        xml.push('>');
        xml.push_str(&node.document().input_text()[node.range()]);
        xml.push_str("</brush>");
        let placeholder = node.descendants().any(|n| {
            super::drawing(n)
                && n.tag_name().name() == "schemeClr"
                && n.attribute("val") == Some("phClr")
        });
        Self { xml, placeholder }
    }
}

#[derive(Default)]
struct Definitions {
    ids: HashMap<(usize, String), usize>,
    markup: String,
    linear: Vec<bool>,
    runs: Vec<GradientRun>,
    continuing: bool,
}

struct GradientRun {
    brush: usize,
    category: usize,
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

pub(super) struct StylePaint {
    entries: HashMap<String, Entry>,
    brushes: Vec<Brush>,
    theme: ThemeColorMap,
    definitions: RefCell<Definitions>,
}

impl StylePaint {
    pub(super) fn parse(
        xml: &str,
        theme: &ThemeColorMap,
        palette: Option<&StylePalette>,
    ) -> Option<Self> {
        let doc = roxmltree::Document::parse(xml).ok()?;
        let root = doc.root_element();
        if !root.has_tag_name((NS, "chartStyle")) {
            return None;
        }
        let read_reference = |ref_node: Node| {
            ref_node.children().find_map(|n| {
                if n.has_tag_name((NS, "styleClr")) {
                    let fixed = match n.attribute("val") {
                        None | Some("auto") => None,
                        Some(value) => {
                            let index = value.parse::<u32>().unwrap_or(0) as usize;
                            palette
                                .map(|p| p.cycled(index))
                                .or_else(|| theme.get(&format!("accent{}", index % 6 + 1)).cloned())
                        }
                    };
                    Some(Paint {
                        brush: None,
                        fixed,
                        transforms: transforms(n),
                    })
                } else {
                    color(n, theme).map(|rgb| Paint {
                        fixed: Some(rgb),
                        ..Default::default()
                    })
                }
            })
        };
        let mut brushes = Vec::new();
        let mut paint = |properties: Option<Node>, reference: Option<Node>| {
            let reference_paint = reference.and_then(read_reference);
            if let Some(props) = properties {
                if drawing_child(props, "noFill").is_some() {
                    return Some(Paint {
                        fixed: Some("none".into()),
                        ..Default::default()
                    });
                }
                if let Some(node) =
                    drawing_child(props, "gradFill").or_else(|| drawing_child(props, "pattFill"))
                {
                    let mut p = reference_paint.unwrap_or_default();
                    p.brush = Some(brushes.len());
                    brushes.push(Brush::new(node));
                    return Some(p);
                }
                if let Some(solid) = drawing_child(props, "solidFill") {
                    return solid.children().find_map(|n| {
                        if super::drawing(n)
                            && n.tag_name().name() == "schemeClr"
                            && n.attribute("val") == Some("phClr")
                        {
                            let mut p = reference_paint.clone().unwrap_or_default();
                            p.transforms.extend(transforms(n));
                            Some(p)
                        } else {
                            color(n, theme).map(|rgb| Paint {
                                fixed: Some(rgb),
                                ..Default::default()
                            })
                        }
                    });
                }
            }
            reference_paint
        };
        let entries = root
            .children()
            .filter(|n| n.is_element() && n.tag_name().namespace() == Some(NS))
            .map(|n| {
                let prop = cs_child(n, "spPr");
                let line = prop.and_then(|p| drawing_child(p, "ln"));
                let text = cs_child(n, "defRPr");
                let entry = Entry {
                    fill: paint(prop, cs_child(n, "fillRef")),
                    stroke: paint(line, cs_child(n, "lnRef")),
                    stroke_width: line
                        .and_then(|p| p.attribute("w")?.parse::<u32>().ok())
                        .map(|w| f64::from(w) / 9525.),
                    text: paint(text, cs_child(n, "fontRef")),
                    font_size: text
                        .and_then(|p| p.attribute("sz")?.parse::<u32>().ok())
                        .map(|s| f64::from(s) / 75.),
                };
                (n.tag_name().name().to_owned(), entry)
            })
            .collect();
        Some(Self {
            entries,
            brushes,
            theme: theme.clone(),
            definitions: RefCell::default(),
        })
    }

    fn resolve(&self, paint: &Paint, automatic: &str) -> Option<String> {
        let Some(index) = paint.brush else {
            return paint.resolve(automatic);
        };
        let brush = &self.brushes[index];
        let placeholder = if brush.placeholder {
            paint.resolve(automatic)?
        } else {
            String::new()
        };
        let key = (index, placeholder);
        let mut defs = self.definitions.borrow_mut();
        let id = if let Some(&id) = defs.ids.get(&key) {
            id
        } else {
            let doc = roxmltree::Document::parse(&brush.xml).ok()?;
            let mut theme = self.theme.clone();
            if brush.placeholder {
                theme.insert("phclr".into(), key.1.clone());
            }
            let node = doc.root_element().first_element_child()?;
            let id = defs.ids.len();
            let markup = super::paint::definition(node, &theme, &format!("L{id}"))?;
            defs.ids.insert(key, id);
            defs.linear.push(
                node.tag_name().name() == "gradFill" && drawing_child(node, "path").is_none(),
            );
            defs.markup.push_str(&markup);
            id
        };
        Some(format!("url(#cpL{id})"))
    }

    pub(super) fn stroke_width(&self, entry: &str) -> Option<f64> {
        self.entries.get(entry)?.stroke_width
    }

    pub(super) fn font_size(&self, entry: &str) -> Option<f64> {
        self.entries.get(entry)?.font_size
    }

    pub(super) fn rectangle_fill<'a>(
        &self,
        fill: &'a str,
        category: usize,
        [x, y, w, h]: [f64; 4],
    ) -> Cow<'a, str> {
        let mut defs = self.definitions.borrow_mut();
        let brush = fill
            .strip_prefix("url(#cpL")
            .and_then(|id| id.strip_suffix(')'))
            .and_then(|id| id.parse::<usize>().ok())
            .filter(|id| defs.linear.get(*id) == Some(&true));
        let Some(brush) = brush.filter(|_| w > 0. && h > 0.) else {
            defs.continuing = false;
            return Cow::Borrowed(fill);
        };
        if defs.continuing
            && defs
                .runs
                .last()
                .is_some_and(|r| r.brush == brush && r.category == category)
        {
            let run = defs.runs.last_mut().unwrap();
            run.left = run.left.min(x);
            run.top = run.top.min(y);
            run.right = run.right.max(x + w);
            run.bottom = run.bottom.max(y + h);
        } else {
            defs.runs.push(GradientRun {
                brush,
                category,
                left: x,
                top: y,
                right: x + w,
                bottom: y + h,
            });
            defs.continuing = true;
        }
        Cow::Owned(format!("url(#cgr{})", defs.runs.len() - 1))
    }

    pub(super) fn defs(&self) -> String {
        let defs = self.definitions.borrow();
        if defs.markup.is_empty() {
            String::new()
        } else {
            let mut out = format!("<defs>{}", defs.markup);
            for (i, r) in defs.runs.iter().enumerate() {
                let (w, h) = (r.right - r.left, r.bottom - r.top);
                write!(out, r##"<linearGradient id="cgr{i}" href="#cpL{}" gradientUnits="userSpaceOnUse" gradientTransform="matrix({w:.4} 0 0 {h:.4} {:.4} {:.4})"/>"##,r.brush,r.left,r.top).unwrap();
            }
            out.push_str("</defs>");
            out
        }
    }

    pub(super) fn point_fill(&self, automatic: &str) -> Option<String> {
        self.fill("dataPoint", automatic)
    }

    pub(super) fn fill(&self, entry: &str, automatic: &str) -> Option<String> {
        self.resolve(self.entries.get(entry)?.fill.as_ref()?, automatic)
    }

    pub(super) fn stroke(&self, entry: &str, automatic: &str) -> Option<String> {
        self.resolve(self.entries.get(entry)?.stroke.as_ref()?, automatic)
    }

    pub(super) fn text(&self, entry: &str, automatic: &str) -> Option<String> {
        self.resolve(self.entries.get(entry)?.text.as_ref()?, automatic)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn palette(method: &str, body: &str) -> StylePalette {
        StylePalette::parse(&format!(r#"<cs:colorStyle xmlns:cs="{NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" meth="{method}">{body}</cs:colorStyle>"#), &ThemeColorMap::default()).unwrap()
    }

    #[test]
    fn reserved_roles_and_linear_direction_match_word_colors() {
        let colors = r#"<a:srgbClr val="442280"/><a:srgbClr val="33994d"/><a:srgbClr val="e97713"/><a:srgbClr val="46a7f2"/>"#;
        let forward = palette("withinLinear", colors);
        let backward = palette("withinLinearReversed", colors);
        let across = palette("acrossLinearReversed", colors);
        assert_eq!(forward.at(0, 2), "#3b1d71");
        assert_eq!(forward.at(1, 2), "#8f87a9");
        assert_eq!(
            (0..4).map(|i| forward.at(i, 4)).collect::<Vec<_>>(),
            ["#331863", "#3f1f77", "#796d9b", "#b3afc3"]
        );
        assert_eq!(backward.at(0, 4), "#b3afc3");
        assert_eq!(across.at(0, 3), "#e97713");
    }

    #[test]
    fn across_ramps_include_a_full_row_boundary_then_apply_the_variation() {
        let colors = r#"<a:srgbClr val="442280"/><a:srgbClr val="33994d"/><cs:variation><a:red val="100000"/></cs:variation><cs:variation><a:green val="100000"/></cs:variation>"#;
        let p = palette("acrossLinear", colors);
        assert_eq!(p.at(0, 1), "#ff2280");
        assert_eq!(
            (0..2).map(|i| p.at(i, 2)).collect::<Vec<_>>(),
            ["#ff1d71", "#ff8743"]
        );
        assert_eq!(
            (0..3).map(|i| p.at(i, 3)).collect::<Vec<_>>(),
            ["#ff1d71", "#ff8743", "#ff87a9"]
        );
        assert_eq!(
            (0..3).map(|i| p.at(i, 4)).collect::<Vec<_>>(),
            ["#ff1a69", "#ff7e3e", "#ff2280"]
        );
    }

    #[test]
    fn variations_apply_before_the_next_base_color_cycle() {
        let palette = palette(
            "cycle",
            r#"<a:srgbClr val="442280"/><cs:variation><a:lumMod val="50000"/></cs:variation><cs:variation/><cs:variation><a:lumMod val="50000"/><a:lumOff val="50000"/></cs:variation>"#,
        );
        assert_eq!(
            (0..4).map(|i| palette.at(i, 4)).collect::<Vec<_>>(),
            ["#221140", "#442280", "#9a76da", "#221140"]
        );
    }

    #[test]
    fn style_brushes_resolve_placeholders_only_for_colors_used() {
        let style = StylePaint::parse(&format!(r#"<cs:chartStyle xmlns:cs="{NS}" xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/main">
            <cs:dataPoint><cs:fillRef idx="0"><cs:styleClr val="auto"/></cs:fillRef><cs:spPr><d:gradFill><d:gsLst><d:gs pos="0"><d:schemeClr val="phClr"/></d:gs><d:gs pos="100000"><d:srgbClr val="ee11aa"/></d:gs></d:gsLst></d:gradFill></cs:spPr></cs:dataPoint>
            <cs:plotArea><cs:spPr><d:pattFill prst="wdUpDiag"><d:fgClr><d:srgbClr val="ee11aa"/></d:fgClr></d:pattFill></cs:spPr></cs:plotArea>
        </cs:chartStyle>"#), &ThemeColorMap::default(), None).unwrap();
        assert!(style.defs().is_empty());
        assert_eq!(style.point_fill("#4f81bd").as_deref(), Some("url(#cpL0)"));
        assert_eq!(style.point_fill("#4f81bd").as_deref(), Some("url(#cpL0)"));
        assert_eq!(style.point_fill("#c0504d").as_deref(), Some("url(#cpL1)"));
        assert_eq!(
            style.fill("plotArea", "#4f81bd").as_deref(),
            Some("url(#cpL2)")
        );
        assert_eq!(
            style.fill("plotArea", "#c0504d").as_deref(),
            Some("url(#cpL2)")
        );
        let defs = style.defs();
        assert_eq!(defs.matches("<linearGradient ").count(), 2);
        assert_eq!(defs.matches("<pattern ").count(), 1);
        assert!(defs.contains("stop-color=\"#4f81bd\"") && defs.contains("stop-color=\"#c0504d\""));
        assert!(defs.contains("#ee11aa"));
        let first = style.rectangle_fill("url(#cpL0)", 0, [1., 2., 3., 4.]);
        assert_eq!(
            first,
            style.rectangle_fill("url(#cpL0)", 0, [4., 3., 6., 1.])
        );
        assert_eq!(
            style.rectangle_fill("url(#cp0)", 0, [10., 3., 1., 1.]),
            "url(#cp0)"
        );
        assert_ne!(
            first,
            style.rectangle_fill("url(#cpL0)", 0, [12., 3., 2., 2.])
        );
        assert!(style
            .defs()
            .contains("matrix(9.0000 0 0 4.0000 1.0000 2.0000)"));
    }

    #[test]
    fn style_paint_resolves_indexed_references_and_local_placeholder_transforms() {
        let palette = palette(
            "cycle",
            r#"<a:srgbClr val="442280"/><a:srgbClr val="33994d"/>"#,
        );
        let style = StylePaint::parse(&format!(r#"<cs:chartStyle xmlns:cs="{NS}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <cs:dataPoint><cs:fillRef idx="0"><cs:styleClr val="1"><a:alpha val="80000"/></cs:styleClr></cs:fillRef><cs:spPr><a:solidFill><a:schemeClr val="phClr"><a:alphaMod val="50000"/></a:schemeClr></a:solidFill><a:ln><a:noFill/></a:ln></cs:spPr></cs:dataPoint>
            <cs:dataPointLine><cs:lnRef idx="0"><cs:styleClr val="auto"/></cs:lnRef><cs:spPr><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></cs:spPr></cs:dataPointLine>
            <cs:chartArea><cs:spPr><a:solidFill><a:srgbClr val="0fc3b2"/></a:solidFill></cs:spPr></cs:chartArea>
        </cs:chartStyle>"#), &ThemeColorMap::default(),Some(&palette)).unwrap();
        assert_eq!(style.point_fill("#ffffff").as_deref(), Some("#33994d66"));
        assert_eq!(
            style.stroke("dataPoint", "#ffffff").as_deref(),
            Some("none")
        );
        assert_eq!(
            style.stroke("dataPointLine", "#123456").as_deref(),
            Some("#123456")
        );
        assert_eq!(
            style.fill("chartArea", "#ffffff").as_deref(),
            Some("#0fc3b2")
        );
    }
}
