use crate::model::ImageRunNode;

fn escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn parse_math(xml: &str) -> Option<ImageRunNode> {
    let wrapped = format!("<root xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">{xml}</root>");
    let document = roxmltree::Document::parse(&wrapped).ok()?;
    fn child<'a, 'input>(
        node: roxmltree::Node<'a, 'input>,
        name: &str,
    ) -> Option<roxmltree::Node<'a, 'input>> {
        node.children()
            .find(|n| n.is_element() && n.tag_name().name() == name)
    }
    fn value(node: roxmltree::Node<'_, '_>, property: &str, default: &str) -> String {
        node.children()
            .filter(|n| n.tag_name().name().ends_with("Pr"))
            .flat_map(|n| n.children())
            .find(|n| n.tag_name().name() == property)
            .and_then(|n| n.attributes().find(|a| a.name() == "val"))
            .map(|a| a.value().to_string())
            .unwrap_or_else(|| default.into())
    }
    fn render(node: roxmltree::Node<'_, '_>) -> String {
        if !node.is_element() {
            return String::new();
        }
        let name = node.tag_name().name();
        if name.ends_with("Pr") {
            return String::new();
        }
        let children = || node.children().map(render).collect::<String>();
        let arg = |name| {
            child(node, name)
                .map(render)
                .unwrap_or_else(|| "<mrow/>".into())
        };
        match name {
            "t" => {
                let text = node.text().unwrap_or("");
                let tag = if text.chars().all(|c| c.is_numeric() || c == '.') {
                    "mn"
                } else if text.chars().all(|c| c.is_alphabetic()) {
                    "mi"
                } else {
                    "mtext"
                };
                format!("<{tag}>{}</{tag}>", escaped(text))
            }
            "f" => format!("<mfrac>{}{}</mfrac>", arg("num"), arg("den")),
            "sSub" => format!("<msub>{}{}</msub>", arg("e"), arg("sub")),
            "sSup" => format!("<msup>{}{}</msup>", arg("e"), arg("sup")),
            "sSubSup" => format!(
                "<msubsup>{}{}{}</msubsup>",
                arg("e"),
                arg("sub"),
                arg("sup")
            ),
            "sPre" => format!(
                "<mmultiscripts>{}<mprescripts/>{}{}</mmultiscripts>",
                arg("e"),
                arg("sub"),
                arg("sup")
            ),
            "rad" => {
                if value(node, "degHide", "0") == "1"
                    || child(node, "deg")
                        .is_none_or(|n| !n.descendants().any(|n| n.tag_name().name() == "t"))
                {
                    format!("<msqrt>{}</msqrt>", arg("e"))
                } else {
                    format!("<mroot>{}{}</mroot>", arg("e"), arg("deg"))
                }
            }
            "d" => {
                let args = node
                    .children()
                    .filter(|n| n.tag_name().name() == "e")
                    .map(render)
                    .collect::<Vec<_>>()
                    .join(&format!(
                        "<mo>{}</mo>",
                        escaped(&value(node, "sepChr", "|"))
                    ));
                format!(
                    "<mrow><mo>{}</mo>{args}<mo>{}</mo></mrow>",
                    escaped(&value(node, "begChr", "(")),
                    escaped(&value(node, "endChr", ")"))
                )
            }
            "nary" => format!(
                "<mrow><munderover><mo>{}</mo>{}{}</munderover>{}</mrow>",
                escaped(&value(node, "chr", "∫")),
                arg("sub"),
                arg("sup"),
                arg("e")
            ),
            "limLow" => format!("<munder>{}{}</munder>", arg("e"), arg("lim")),
            "limUpp" => format!("<mover>{}{}</mover>", arg("e"), arg("lim")),
            "acc" | "bar" | "groupChr" => {
                let tag = if value(node, "pos", "top") == "bot" {
                    "munder"
                } else {
                    "mover"
                };
                format!(
                    "<{tag}>{}<mo>{}</mo></{tag}>",
                    arg("e"),
                    escaped(&value(node, "chr", if name == "acc" { "̂" } else { "¯" }))
                )
            }
            "m" => format!("<mtable>{}</mtable>", children()),
            "mr" => format!(
                "<mtr>{}</mtr>",
                node.children()
                    .filter(|n| n.tag_name().name() == "e")
                    .map(|n| format!("<mtd>{}</mtd>", render(n)))
                    .collect::<String>()
            ),
            "eqArr" => format!(
                "<mtable>{}</mtable>",
                node.children()
                    .filter(|n| n.tag_name().name() == "e")
                    .map(|n| format!("<mtr><mtd>{}</mtd></mtr>", render(n)))
                    .collect::<String>()
            ),
            "phant" => format!("<mphantom>{}</mphantom>", arg("e")),
            _ => format!("<mrow>{}</mrow>", children()),
        }
    }
    let math = document.root_element().first_element_child()?;
    let text = math
        .descendants()
        .filter(|n| n.is_element() && n.tag_name().name() == "t")
        .filter_map(|n| n.text())
        .collect::<String>();
    let math_ml = format!(
        "<math xmlns=\"http://www.w3.org/1998/Math/MathML\">{}</math>",
        render(math)
    );
    serde_json::from_value(serde_json::json!({"type":"image", "semanticKind":"formula", "mathMl":math_ml, "alt":text, "sourceXml":xml, "widthPx": (text.chars().count().max(1) * 9) as f64, "heightPx":28.0})).ok()
}
