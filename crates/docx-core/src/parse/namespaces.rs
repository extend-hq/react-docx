use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap};

use crate::package::OoxmlPackage;

pub(crate) fn prefix(uri: &str) -> Option<&'static str> {
    match uri {
        "http://schemas.openxmlformats.org/package/2006/content-types"
        | "http://schemas.openxmlformats.org/package/2006/relationships"
        | "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" => Some(""),
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        | "http://purl.oclc.org/ooxml/wordprocessingml/main" => Some("w"),
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        | "http://purl.oclc.org/ooxml/officeDocument/relationships" => Some("r"),
        "http://schemas.openxmlformats.org/drawingml/2006/main"
        | "http://purl.oclc.org/ooxml/drawingml/main" => Some("a"),
        "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        | "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" => Some("wp"),
        "http://schemas.openxmlformats.org/drawingml/2006/picture"
        | "http://purl.oclc.org/ooxml/drawingml/picture" => Some("pic"),
        "http://schemas.openxmlformats.org/drawingml/2006/chart"
        | "http://purl.oclc.org/ooxml/drawingml/chart" => Some("c"),
        "http://schemas.openxmlformats.org/officeDocument/2006/math"
        | "http://purl.oclc.org/ooxml/officeDocument/math" => Some("m"),
        "http://schemas.openxmlformats.org/markup-compatibility/2006" => Some("mc"),
        "http://schemas.microsoft.com/office/word/2010/wordprocessingShape" => Some("wps"),
        "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" => Some("wpg"),
        "http://schemas.microsoft.com/office/word/2010/wordml" => Some("w14"),
        "http://schemas.microsoft.com/office/word/2012/wordml" => Some("w15"),
        "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" => Some("wp14"),
        "urn:schemas-microsoft-com:vml" => Some("v"),
        "urn:schemas-microsoft-com:office:office" => Some("o"),
        "urn:schemas-microsoft-com:office:word" => Some("w10"),
        "http://www.w3.org/XML/1998/namespace" => Some("xml"),
        _ => None,
    }
}

fn escape_into(value: &str, attribute: bool, out: &mut String) {
    let mut start = 0;
    for (offset, byte) in value.bytes().enumerate() {
        let escaped = match byte {
            b'&' => "&amp;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            b'"' if attribute => "&quot;",
            b'\r' if attribute => "&#13;",
            b'\n' if attribute => "&#10;",
            b'\t' if attribute => "&#9;",
            _ => continue,
        };
        out.push_str(&value[start..offset]);
        out.push_str(escaped);
        start = offset + 1;
    }
    out.push_str(&value[start..]);
}

pub fn normalize_xml(xml: &str) -> Result<String, String> {
    let document = roxmltree::Document::parse(xml).map_err(|e| e.to_string())?;
    let mut namespaces = BTreeMap::<String, String>::new();
    for node in document.descendants().filter(|node| node.is_element()) {
        if node.parent().is_some_and(|parent| parent.is_element()) {
            let start = node.range().start;
            let end = crate::xml::tag_token_end(xml, start).unwrap_or(start);
            if !xml[start..end].contains("xmlns") {
                continue;
            }
        }
        for ns in node.namespaces() {
            if !namespaces.contains_key(ns.uri()) {
                let name = prefix(ns.uri()).map(str::to_string).unwrap_or_else(|| {
                    let candidate = ns.name().unwrap_or("");
                    if candidate.is_empty()
                        || namespaces.values().any(|p| p == candidate)
                        || [
                            "w", "a", "r", "m", "c", "wp", "pic", "wps", "wpg", "mc", "w14", "w15",
                            "v", "o", "xml", "wp14", "w10",
                        ]
                        .contains(&candidate)
                    {
                        let mut index = namespaces.len();
                        while namespaces.values().any(|p| p == &format!("ns{index}")) {
                            index += 1;
                        }
                        format!("ns{index}")
                    } else {
                        candidate.to_string()
                    }
                });
                namespaces.insert(ns.uri().to_string(), name);
            }
        }
    }
    fn write_name(ns: Option<&str>, local: &str, namespaces: &BTreeMap<String, String>, out: &mut String) {
        if let Some(prefix) = ns.and_then(|ns| namespaces.get(ns).map(String::as_str).or_else(|| prefix(ns)))
            .filter(|prefix| !prefix.is_empty()) {
            out.push_str(prefix);
            out.push(':');
        }
        out.push_str(local);
    }
    fn write(
        node: roxmltree::Node<'_, '_>,
        namespaces: &BTreeMap<String, String>,
        out: &mut String,
    ) {
        if node.is_text() {
            escape_into(node.text().unwrap_or(""), false, out);
            return;
        }
        if node.is_comment() {
            out.push_str("<!--");
            out.push_str(node.text().unwrap_or(""));
            out.push_str("-->");
            return;
        }
        if !node.is_element() {
            return;
        }
        let tag = node.tag_name();
        out.push('<');
        write_name(tag.namespace(), tag.name(), namespaces, out);
        if node.parent().is_some_and(|parent| parent.is_root()) {
            let mut declarations = BTreeMap::<&str, &str>::new();
            for (uri, prefix) in namespaces {
                let previous = declarations.entry(prefix.as_str()).or_insert(uri.as_str());
                if previous.starts_with("http://purl.oclc.org/") {
                    *previous = uri;
                }
            }
            for (prefix, uri) in declarations {
                if prefix != "xml" {
                    out.push_str(" xmlns");
                    if !prefix.is_empty() {
                        out.push(':');
                        out.push_str(prefix);
                    }
                    out.push_str("=\"");
                    escape_into(uri, true, out);
                    out.push('"');
                }
            }
        }
        for attr in node.attributes() {
            out.push(' ');
            write_name(attr.namespace(), attr.name(), namespaces, out);
            out.push_str("=\"");
            let value: Cow<'_ , str> = if attr.name() == "Requires" || attr.name() == "Ignorable" {
                attr.value()
                    .split_whitespace()
                    .map(|p| {
                        node.lookup_namespace_uri(Some(p))
                            .and_then(|uri| namespaces.get(uri))
                            .map(String::as_str)
                            .unwrap_or(p)
                    })
                    .collect::<Vec<_>>()
                    .join(" ").into()
            } else {
                Cow::Borrowed(attr.value())
            };
            escape_into(&value, true, out);
            out.push('"');
        }
        if node.has_children() {
            out.push('>');
            for child in node.children() {
                write(child, namespaces, out);
            }
            out.push_str("</");
            write_name(tag.namespace(), tag.name(), namespaces, out);
            out.push('>');
        } else {
            out.push_str("/>");
        }
    }
    let mut result = String::with_capacity(xml.len());
    for node in document.root().children() {
        write(node, &namespaces, &mut result);
    }
    Ok(result)
}

fn is_canonical_xml(xml: &str) -> bool {
    use quick_xml::events::Event;
    if xml.contains('\r') {
        return false;
    }
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut bindings = BTreeMap::<String, String>::new();
    let mut depth = 0usize;
    let mut roots = 0usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(tag) | Event::Empty(tag)) => {
                if depth == 0 {
                    roots += 1;
                }
                let raw = tag.as_ref();
                for attribute in tag.attributes() {
                    let Ok(attribute) = attribute else {
                        return false;
                    };
                    let name = attribute.key.as_ref();
                    let value = attribute.value.as_ref();
                    if value.contains(['\n', '\t', '<', '>'])
                        || value.split('&').skip(1).any(|reference| {
                            !["amp;", "lt;", "gt;", "quot;"]
                                .iter()
                                .any(|entity| reference.starts_with(entity))
                        })
                    {
                        return false;
                    }
                    if name == "xmlns" || name.starts_with("xmlns:") {
                        let declared = name.strip_prefix("xmlns:").unwrap_or("");
                        if depth > 0 && !bindings.contains_key(declared) {
                            return false;
                        }
                        if value.contains('&') {
                            return false;
                        }
                        if let Some(expected) = prefix(value) {
                            if declared != expected {
                                return false;
                            }
                        } else if declared.is_empty()
                            || [
                                "w", "r", "a", "m", "c", "wp", "pic", "wps", "wpg", "mc", "w14",
                                "w15", "v", "o", "xml", "wp14", "w10",
                            ]
                            .contains(&declared)
                        {
                            return false;
                        }
                        if bindings.get(declared).is_some_and(|old| old != value)
                            || bindings
                                .iter()
                                .any(|(key, old)| old == value && key != declared)
                        {
                            return false;
                        }
                        bindings
                            .entry(declared.to_owned())
                            .or_insert_with(|| value.to_owned());
                    }
                }
                let mut quoted = false;
                let bytes = raw.as_bytes();
                for (index, byte) in bytes.iter().enumerate() {
                    if *byte == b'"' {
                        quoted = !quoted;
                    }
                    if !quoted
                        && (*byte == b'\''
                            || (*byte == b'='
                                && (index == 0
                                    || bytes[index - 1].is_ascii_whitespace()
                                    || bytes.get(index + 1) != Some(&b'"'))))
                    {
                        return false;
                    }
                }
                let name = tag.name();
                let name = name.as_ref();
                if let Some((prefix, _)) = name.split_once(':') {
                    if prefix != "xml" && !bindings.contains_key(prefix) {
                        return false;
                    }
                }
                for attribute in tag.attributes().with_checks(false) {
                    let Ok(attribute) = attribute else {
                        return false;
                    };
                    if let Some((prefix, _)) = attribute.key.as_ref().split_once(':') {
                        if prefix != "xml" && prefix != "xmlns" && !bindings.contains_key(prefix) {
                            return false;
                        }
                    }
                }
                if xml.as_bytes().get(reader.buffer_position() as usize - 2) != Some(&b'/') {
                    depth += 1;
                }
            }
            Ok(Event::End(_)) => {
                if xml
                    .as_bytes()
                    .get(reader.buffer_position() as usize - 2)
                    .is_some_and(u8::is_ascii_whitespace)
                {
                    return false;
                }
                let Some(next) = depth.checked_sub(1) else {
                    return false;
                };
                depth = next;
            }
            Ok(Event::Eof) => return depth == 0 && roots == 1,
            Ok(Event::Text(text)) => {
                if depth == 0 && !text.as_ref().bytes().all(|byte| byte.is_ascii_whitespace()) {
                    return false;
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if depth == 0 {
                    return false;
                }
                let name = reference.as_ref();
                if !["amp", "lt", "gt", "quot", "apos"].contains(&name) {
                    let code = name
                        .strip_prefix("#x")
                        .or_else(|| name.strip_prefix("#X"))
                        .and_then(|digits| u32::from_str_radix(digits, 16).ok())
                        .or_else(|| {
                            name.strip_prefix('#')
                                .and_then(|digits| digits.parse::<u32>().ok())
                        });
                    if !code.is_some_and(|code| {
                        code >= 0x20
                            && !matches!(code, 0xfffe | 0xffff)
                            && char::from_u32(code).is_some()
                    }) {
                        return false;
                    }
                }
            }
            Ok(Event::Comment(_) | Event::Decl(_)) => {}
            _ => return false,
        }
    }
}

/// Normalizes an XML-only view while the caller retains the original binary assets.
pub(crate) fn normalized_package(pkg: &OoxmlPackage) -> (Cow<'_, OoxmlPackage>, HashMap<String, crate::xml_index::Index>) {
    let mut indexes = HashMap::new();
    let mut replacements = Vec::new();
    for part in pkg.parts.values() {
        if !part.name.ends_with(".xml") && !part.name.ends_with(".rels") { continue; }
        if let Some(index) = crate::xml_index::Index::canonical(&part.content) {
            indexes.insert(part.name.clone(), index);
        } else if !is_canonical_xml(&part.content) {
            replacements.push((part.name.clone(), normalize_xml(&part.content)));
        }
    }
    if replacements.is_empty() {
        return (Cow::Borrowed(pkg), indexes);
    }
    let mut normalized = OoxmlPackage {
        parts: pkg.parts.clone(),
        binary_assets: HashMap::new(),
        warnings: pkg.warnings.clone(),
    };
    for (name, replacement) in replacements {
        match replacement {
            Ok(xml) => {
                if let Some(part) = normalized.parts.get_mut(&name) {
                    part.content = xml;
                }
            }
            Err(error) => normalized
                .warnings
                .push(format!("XML normalization failed in {}: {error}", name)),
        }
    }
    (Cow::Owned(normalized), indexes)
}
