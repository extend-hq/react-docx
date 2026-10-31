use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap, HashSet};

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
    if !attribute {
        let mut start = 0;
        for offset in memchr::memchr3_iter(b'&', b'<', b'>', value.as_bytes()) {
            out.push_str(&value[start..offset]);
            out.push_str(match value.as_bytes()[offset] {
                b'&' => "&amp;",
                b'<' => "&lt;",
                _ => "&gt;",
            });
            start = offset + 1;
        }
        out.push_str(&value[start..]);
        return;
    }
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
    let root = document.root_element();
    let root_open_end =
        crate::xml::tag_token_end(xml, root.range().start).unwrap_or(root.range().start);
    let root_only_namespaces = !xml[root_open_end..].contains("xmlns");
    let namespace_nodes = document
        .descendants()
        .filter(|node| node.is_element())
        .take(if root_only_namespaces { 1 } else { usize::MAX });
    for node in namespace_nodes {
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
    fn write_name(
        ns: Option<&str>,
        local: &str,
        namespaces: &BTreeMap<String, String>,
        out: &mut String,
    ) {
        if let Some(prefix) = ns
            .and_then(|ns| prefix(ns).or_else(|| namespaces.get(ns).map(String::as_str)))
            .filter(|prefix| !prefix.is_empty())
        {
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
            let value: Cow<'_, str> = if attr.name() == "Requires" || attr.name() == "Ignorable" {
                attr.value()
                    .split_whitespace()
                    .map(|p| {
                        node.lookup_namespace_uri(Some(p))
                            .and_then(|uri| namespaces.get(uri))
                            .map(String::as_str)
                            .unwrap_or(p)
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
                    .into()
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

fn contains_bmp_noncharacter(xml: &str) -> bool {
    let bytes = xml.as_bytes();
    memchr::memchr_iter(0xef, bytes).any(|offset| {
        bytes[offset..].starts_with(b"\xef\xbf\xbe") || bytes[offset..].starts_with(b"\xef\xbf\xbf")
    })
}

fn is_canonical_xml(xml: &str) -> bool {
    use quick_xml::events::Event;
    if memchr::memchr(b'\r', xml.as_bytes()).is_some() {
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

fn contains_disallowed_xml_controls(bytes: &[u8]) -> bool {
    let scalar = |bytes: &[u8]| {
        bytes
            .iter()
            .any(|&byte| byte < 0x20 && !matches!(byte, b'\n' | b'\t'))
    };
    let mut chunks = bytes.chunks_exact(8);
    for chunk in &mut chunks {
        let word = u64::from_ne_bytes(chunk.try_into().unwrap());
        if word.wrapping_sub(0x2020_2020_2020_2020) & !word & 0x8080_8080_8080_8080 != 0
            && scalar(chunk)
        {
            return true;
        }
    }
    scalar(chunks.remainder())
}

struct RootPlan {
    prefix: String,
    attributes: String,
    default_rebound: bool,
}

type RootPlanEntry = (String, String, std::sync::Arc<RootPlan>);

fn cached_root_plan(
    key: (&str, &str),
    build: impl FnOnce() -> Option<RootPlan>,
) -> Option<std::sync::Arc<RootPlan>> {
    use std::collections::VecDeque;
    use std::sync::{Arc, LazyLock, Mutex};
    static PLANS: LazyLock<Mutex<VecDeque<RootPlanEntry>>> =
        LazyLock::new(|| Mutex::new(VecDeque::new()));
    if key.0.len() > 64 || key.1.len() > 8192 {
        return build().map(Arc::new);
    }
    {
        let mut plans = PLANS.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(at) = plans
            .iter()
            .position(|(prefix, attributes, _)| prefix == key.0 && attributes == key.1)
        {
            let entry = plans.remove(at).unwrap();
            let plan = Arc::clone(&entry.2);
            plans.push_front(entry);
            return Some(plan);
        }
    }
    let plan = Arc::new(build()?);
    let mut plans = PLANS.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(at) = plans
        .iter()
        .position(|(prefix, attributes, _)| prefix == key.0 && attributes == key.1)
    {
        let entry = plans.remove(at).unwrap();
        let plan = Arc::clone(&entry.2);
        plans.push_front(entry);
        return Some(plan);
    }
    if plans.len() == 32 {
        plans.pop_back();
    }
    plans.push_front((key.0.to_owned(), key.1.to_owned(), Arc::clone(&plan)));
    Some(plan)
}

#[derive(Default)]
struct PrologCache<'a> {
    declarations: HashSet<&'a str>,
    roots: HashMap<(&'a str, &'a str), std::sync::Arc<RootPlan>>,
}

fn permits_default_rebinding(before: &str, after: &str) -> bool {
    let Ok(before) = roxmltree::Document::parse(before) else {
        return false;
    };
    let before = before.root_element();
    let Some(default) = before.lookup_namespace_uri(None) else {
        return false;
    };
    if prefix(default).is_some() {
        return false;
    }
    let Ok(after) = roxmltree::Document::parse(after) else {
        return false;
    };
    let after = after.root_element();
    after.lookup_namespace_uri(None).is_none()
        && before.namespaces().len() == after.namespaces().len()
        && before
            .namespaces()
            .filter(|ns| ns.name().is_some())
            .all(|ns| after.lookup_namespace_uri(ns.name()) == Some(ns.uri()))
        && after
            .namespaces()
            .any(|ns| ns.name().is_some() && ns.uri() == default)
}

#[cfg(test)]
fn normalize_prolog_xml(xml: &str) -> Option<(String, crate::xml_index::Index)> {
    normalize_prolog_cached(xml, &mut PrologCache::default())
}

fn normalize_prolog_cached<'a>(
    xml: &'a str,
    cache: &mut PrologCache<'a>,
) -> Option<(String, crate::xml_index::Index)> {
    if memchr::memchr(b'\r', xml.as_bytes()).is_none() {
        return None;
    }
    let declaration_end = xml.strip_prefix("<?xml ").and_then(|_| xml.find("?>"))? + 2;
    let body = xml[declaration_end..].trim_matches([' ', '\t', '\r', '\n']);
    if !body.starts_with('<')
        || memchr::memmem::find(body.as_bytes(), b"<?").is_some()
        || memchr::memmem::find(body.as_bytes(), b"]]>").is_some()
        || contains_disallowed_xml_controls(body.as_bytes())
        || contains_bmp_noncharacter(body)
    {
        return None;
    }
    let declaration = &xml[..declaration_end];
    if !cache.declarations.contains(declaration) {
        roxmltree::Document::parse(&format!("{declaration}<root/>")).ok()?;
        cache.declarations.insert(declaration);
    }
    let root_end = crate::xml::tag_token_end(body, 0)?;
    let empty_root = body[..root_end].ends_with("/>");
    let root_name_end =
        body[1..root_end].find(|ch: char| ch.is_ascii_whitespace() || matches!(ch, '/' | '>'))? + 1;
    let root_name = &body[1..root_name_end];
    let mut name_parts = 0;
    if !root_name.split(':').all(|part| {
        name_parts += 1;
        name_parts <= 2
            && part
                .as_bytes()
                .first()
                .is_some_and(|b| b.is_ascii_alphabetic() || *b == b'_')
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
    }) {
        return None;
    }
    let prefix_end = root_name.find(':').map_or(0, |position| position + 1);
    let raw_prefix = &root_name[..prefix_end];
    let raw_attributes = &body[root_name_end..root_end - if empty_root { 2 } else { 1 }];
    let key = (raw_prefix, raw_attributes);
    if !cache.roots.contains_key(&key) {
        let plan = cached_root_plan(key, || {
            let mut root = body[..root_end].to_owned();
            if !empty_root {
                root.pop();
                root.push_str("/>");
            }
            let normalized = normalize_xml(&root).ok()?;
            let name_end = normalized[1..]
                .find(|ch: char| ch.is_ascii_whitespace() || matches!(ch, '/' | '>'))?
                + 1;
            let normalized_prefix_end = normalized[1..name_end]
                .find(':')
                .map_or(1, |position| position + 2);
            Some(RootPlan {
                prefix: normalized[1..normalized_prefix_end].to_owned(),
                attributes: normalized[name_end..normalized.len() - 2].to_owned(),
                default_rebound: normalized.len() != root.len()
                    && permits_default_rebinding(&root, &normalized),
            })
        })?;
        cache.roots.insert(key, plan);
    }
    let plan = cache.roots.get(&key)?;
    let mut normalized = String::with_capacity(
        root_end - raw_prefix.len() - raw_attributes.len()
            + plan.prefix.len()
            + plan.attributes.len(),
    );
    normalized.push('<');
    normalized.push_str(&plan.prefix);
    normalized.push_str(&root_name[prefix_end..]);
    normalized.push_str(&plan.attributes);
    normalized.push_str(if empty_root { "/>" } else { ">" });
    if normalized.as_bytes().get(..=root_name_end) != body.as_bytes().get(..=root_name_end) {
        return None;
    }
    if memchr::memmem::find(body[root_end..].as_bytes(), b"&#").is_some() {
        return None;
    }
    if normalized.len() != root_end {
        if !plan.default_rebound
            || memchr::memmem::find(body[root_end..].as_bytes(), b"xmlns").is_some()
        {
            return None;
        }
        normalized.reserve(body.len() - root_end);
        normalized.push_str(&body[root_end..]);
        let index = crate::xml_index::Index::canonical_serialized(&normalized)?;
        if !index.serialization_equivalent() || !index.all_elements_qualified() {
            return None;
        }
        return Some((normalized, index));
    }
    let index = crate::xml_index::Index::canonical_serialized(body)?;
    if !index.serialization_equivalent() {
        return None;
    }
    // Attribute ordering does not affect indexed ranges when the root token keeps its width.
    normalized.reserve(body.len() - root_end);
    normalized.push_str(&body[root_end..]);
    Some((normalized, index))
}

#[cfg(test)]
mod default_namespace_tests {
    use super::{normalize_prolog_cached, normalize_prolog_xml, normalize_xml, PrologCache};

    fn xml(body: &str, declarations: &str) -> String {
        format!(
            "<?xml version=\"1.0\"?>\r\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns=\"urn:unused\" {declarations}>{body}</w:document>"
        )
    }

    #[test]
    fn unused_default_preserves_complete_normalization() {
        for (body, declarations) in [
            ("<w:p><w:r><w:t>Text &amp; text</w:t></w:r></w:p>", ""),
            ("<w:p w:val=\"value\"/>", "xmlns:q=\"urn:fixed\""),
            ("<q:item><w:p/></q:item>", "xmlns:q=\"urn:fixed\" xmlns:ns2=\"urn:other\""),
            ("<w:p mc:Ignorable=\"q\"><q:item/></w:p>", "xmlns:q=\"urn:fixed\" xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\""),
        ] {
            let input = xml(body, declarations);
            let (normalized, index) = normalize_prolog_xml(&input).unwrap();
            assert_eq!(normalized, normalize_xml(&input).unwrap());
            assert!(index.serialization_equivalent());
            assert!(index.all_elements_qualified());
        }
    }

    #[test]
    fn namespace_or_serialization_changes_fall_back() {
        for (body, declarations) in [
            ("<child/>", ""),
            ("<w:p><child/></w:p>", ""),
            ("<w:p xmlns:q=\"urn:other\"><q:item/></w:p>", ""),
            (
                "<w:p/>",
                "xmlns:q=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"",
            ),
            ("<w:p></w:p>", ""),
            ("<w:p><w:t>&#65;</w:t></w:p>", ""),
            ("<w:p w:val='value'/>", ""),
        ] {
            assert!(normalize_prolog_xml(&xml(body, declarations)).is_none());
        }
    }

    #[test]
    fn shared_root_attributes_keep_each_element_name_and_binding() {
        let mut inputs = Vec::new();
        for default in ["urn:unused", "urn:changed"] {
            for name in ["document", "styles", "numbering"] {
                for empty in [false, true] {
                    let opening = format!("<?xml version=\"1.0\"?>\r\n<w:{name} xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns=\"{default}\"");
                    inputs.push(if empty {
                        format!("{opening}/>")
                    } else {
                        format!("{opening}><w:p w:val=\"value\"/></w:{name}>")
                    });
                }
            }
        }
        let mut cache = PrologCache::default();
        for input in &inputs {
            let (normalized, _) = normalize_prolog_cached(input, &mut cache).unwrap();
            assert_eq!(normalized, normalize_xml(input).unwrap());
        }
    }

    #[test]
    fn cached_bindings_do_not_validate_new_names_or_default_usage() {
        let inputs = [
            xml("<w:p/>", ""),
            xml("<child/>", ""),
            xml("<w:p/>", "").replace("w:document", "w:bad?name"),
            xml("<w:p/>", "").replace("w:document", "w:bad:name"),
            xml("<w:p/>", "").replace("w:document", "w:node.name"),
            xml("<w:p/>", ""),
        ];
        let mut cache = PrologCache::default();
        for (input, accepted) in inputs.iter().zip([true, false, false, false, false, true]) {
            let result = normalize_prolog_cached(input, &mut cache);
            assert_eq!(result.is_some(), accepted);
            if let Some((normalized, _)) = result {
                assert_eq!(normalized, normalize_xml(input).unwrap());
            }
        }
    }
}

fn normalize_hoisted_xml(xml: &str) -> Option<(String, crate::xml_index::Index)> {
    let body = if xml.starts_with("<?xml ") {
        let end = xml.find("?>")? + 2;
        roxmltree::Document::parse(&format!("{}<root/>", &xml[..end])).ok()?;
        &xml[end..]
    } else {
        xml
    };
    let body = body.trim_matches([' ', '\t', '\r', '\n']);
    if memchr::memmem::find(body.as_bytes(), b"]]>").is_some()
        || contains_disallowed_xml_controls(body.as_bytes())
        || contains_bmp_noncharacter(body)
    {
        return None;
    }
    crate::xml_index::Index::canonical_hoisted(body)
}

type PreparedPart = (
    Option<crate::xml_index::Index>,
    Option<Result<String, String>>,
);

fn prepare_part<'a>(
    part: &'a crate::package::OoxmlPart,
    names_match: bool,
    prologs: &mut PrologCache<'a>,
) -> PreparedPart {
    #[cfg(not(target_arch = "wasm32"))]
    if names_match
        && part.content.len() <= 512 * 1024
        && matches!(part.name.rsplit('/').next(), Some("styles.xml" | "stylesWithEffects.xml" | "numbering.xml" | "theme1.xml" | "fontTable.xml" | "settings.xml"))
    {
        return definition_indexes::prepare(part, prologs);
    }
    prepare_uncached_part(part, names_match, prologs)
}

fn prepare_uncached_part<'a>(
    part: &'a crate::package::OoxmlPart,
    names_match: bool,
    prologs: &mut PrologCache<'a>,
) -> PreparedPart {
    if let Some(index) = crate::xml_index::Index::canonical(&part.content) {
        (Some(index), None)
    } else if let Some((xml, index)) = normalize_prolog_cached(&part.content, prologs) {
        (Some(index), Some(Ok(xml)))
    } else if let Some((xml, index)) = names_match
        .then(|| normalize_hoisted_xml(&part.content))
        .flatten()
    {
        (Some(index), Some(Ok(xml)))
    } else if !is_canonical_xml(&part.content) {
        let replacement = normalize_xml(&part.content);
        let index = if names_match {
            replacement
                .as_ref()
                .ok()
                .and_then(|xml| crate::xml_index::Index::canonical_normalized(xml))
        } else {
            None
        };
        (index, Some(replacement))
    } else {
        (None, None)
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn prepare_parallel_parts(
    pkg: &OoxmlPackage,
    names_match: bool,
) -> Option<Vec<(&crate::package::OoxmlPart, PreparedPart)>> {
    let eligible = |part: &&crate::package::OoxmlPart| {
        part.name.ends_with(".xml") || part.name.ends_with(".rels")
    };
    let (count, bytes, largest) = pkg.parts.values().filter(eligible).fold(
        (0usize, 0usize, 0usize),
        |(count, bytes, largest), part| {
            (
                count + 1,
                bytes.saturating_add(part.content.len()),
                largest.max(part.content.len()),
            )
        },
    );
    if count < 4 || bytes < 64 * 1024 || largest > bytes - bytes / 4 {
        return None;
    }
    let pool = worker_pool()?;
    let workers = pool.current_num_threads() + 1;
    let parts: Vec<_> = pkg.parts.values().filter(eligible).collect();
    let mut order: Vec<_> = (0..parts.len()).collect();
    order.sort_unstable_by_key(|index| std::cmp::Reverse(parts[*index].content.len()));
    let mut weights = vec![0usize; workers];
    let mut assignments = vec![0usize; parts.len()];
    for index in order {
        let worker = (0..workers).min_by_key(|worker| weights[*worker])?;
        assignments[index] = worker;
        weights[worker] = weights[worker].saturating_add(parts[index].content.len().max(1));
    }
    let mut results: Vec<Option<PreparedPart>> = (0..parts.len()).map(|_| None).collect();
    let mut groups: Vec<Vec<_>> = (0..workers).map(|_| Vec::new()).collect();
    for ((part, result), worker) in parts.iter().zip(results.iter_mut()).zip(assignments) {
        groups[worker].push((*part, result));
    }
    let mut groups = groups.into_iter();
    let caller = groups.next()?;
    pool.in_place_scope(|scope| {
        for group in groups {
            scope.spawn(move |_| {
                let mut prologs = PrologCache::default();
                for (part, slot) in group {
                    *slot = Some(prepare_part(part, names_match, &mut prologs));
                }
            });
        }
        let mut prologs = PrologCache::default();
        for (part, slot) in caller {
            *slot = Some(prepare_part(part, names_match, &mut prologs));
        }
    });
    Some(
        parts
            .into_iter()
            .zip(results)
            .map(|(part, result)| (part, result.expect("joined normalization task")))
            .collect(),
    )
}

/// Normalizes an XML-only view while the caller retains the original binary assets.
pub(crate) fn normalized_package(
    pkg: &OoxmlPackage,
) -> (
    Cow<'_, OoxmlPackage>,
    HashMap<String, crate::xml_index::Index>,
) {
    let mut indexes = HashMap::new();
    let mut replacements = Vec::new();
    let names_match = pkg.parts.iter().all(|(name, part)| name == &part.name);
    #[cfg(not(target_arch = "wasm32"))]
    let parallel = prepare_parallel_parts(pkg, names_match);
    #[cfg(target_arch = "wasm32")]
    let parallel: Option<Vec<(&crate::package::OoxmlPart, PreparedPart)>> = None;
    let mut accept = |part: &crate::package::OoxmlPart, (index, replacement): PreparedPart| {
        if let Some(index) = index {
            indexes.insert(part.name.clone(), index);
        }
        if let Some(replacement) = replacement {
            replacements.push((part.name.clone(), replacement));
        }
    };
    if let Some(parts) = parallel {
        for (part, prepared) in parts {
            accept(part, prepared);
        }
    } else {
        let mut prologs = PrologCache::default();
        for part in pkg.parts.values() {
            if part.name.ends_with(".xml") || part.name.ends_with(".rels") {
                accept(part, prepare_part(part, names_match, &mut prologs));
            }
        }
    }
    let normalized_index_names_match = names_match;
    if replacements.is_empty() {
        return (Cow::Borrowed(pkg), indexes);
    }
    if normalized_index_names_match {
        let mut replacements = replacements.into_iter().peekable();
        let mut warnings = pkg.warnings.clone();
        let mut parts =
            HashMap::with_capacity_and_hasher(pkg.parts.capacity(), pkg.parts.hasher().clone());
        for (name, part) in &pkg.parts {
            let content = if replacements
                .peek()
                .is_some_and(|(replacement_name, _)| replacement_name == name)
            {
                match replacements.next().unwrap().1 {
                    Ok(xml) => xml,
                    Err(error) => {
                        warnings.push(format!("XML normalization failed in {}: {error}", name));
                        part.content.clone()
                    }
                }
            } else {
                part.content.clone()
            };
            parts.insert(
                name.clone(),
                crate::package::OoxmlPart {
                    name: part.name.clone(),
                    content,
                },
            );
        }
        return (
            Cow::Owned(OoxmlPackage {
                parts,
                binary_assets: HashMap::new(),
                warnings,
            }),
            indexes,
        );
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

#[cfg(test)]
mod control_guard_tests {
    use super::contains_disallowed_xml_controls as words;
    fn scalar(bytes: &[u8]) -> bool {
        bytes
            .iter()
            .any(|&b| b < 0x20 && !matches!(b, b'\n' | b'\t'))
    }

    #[test]
    fn adjacent_byte_pairs_and_partial_chunks_agree() {
        for pair in 0..=u16::MAX {
            for position in 0..8 {
                let mut bytes = [b' '; 17];
                bytes[position] = pair as u8;
                bytes[position + 1] = (pair >> 8) as u8;
                for length in [7, 8, 9, 16, 17] {
                    assert_eq!(words(&bytes[..length]), scalar(&bytes[..length]));
                }
            }
        }
    }

    #[test]
    fn mixed_words_and_all_tail_positions_agree() {
        let mut state = 0x6c92_e375_19fa_b248_u64;
        for _ in 0..100000 {
            let mut bytes = [0u8; 31];
            for byte in &mut bytes {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                *byte = (state >> 32) as u8;
            }
            for length in 0..=31 {
                assert_eq!(words(&bytes[..length]), scalar(&bytes[..length]));
            }
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod parallel_part_tests {
    use super::*;
    use crate::package::OoxmlPart;

    #[test]
    fn concurrent_preparation_preserves_order_and_errors() {
        let mut pkg = OoxmlPackage {
            parts: HashMap::new(),
            binary_assets: HashMap::new(),
            warnings: Vec::new(),
        };
        for index in 0..8 {
            let name = format!("section-{index}.xml");
            let prefix = if index % 2 == 0 { "w" } else { "alternate" };
            let content = format!(
                "<?xml version=\"1.0\"?><{prefix}:root xmlns:{prefix}=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><{prefix}:p>{}</{prefix}:p></{prefix}:root>",
                "text &amp; value ".repeat(2048),
            );
            pkg.parts.insert(name.clone(), OoxmlPart { name, content });
        }
        pkg.parts
            .get_mut("section-3.xml")
            .unwrap()
            .content
            .push('<');
        for names_match in [true, false] {
            let Some(parallel) = prepare_parallel_parts(&pkg, names_match) else {
                continue;
            };
            let mut prologs = PrologCache::default();
            assert_eq!(parallel.len(), pkg.parts.len());
            for ((actual_part, actual), expected_part) in
                parallel.into_iter().zip(pkg.parts.values())
            {
                assert_eq!(actual_part.name, expected_part.name);
                let expected = prepare_part(expected_part, names_match, &mut prologs);
                assert_eq!(actual.0.is_some(), expected.0.is_some());
                assert_eq!(actual.1, expected.1);
            }
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn worker_pool() -> Option<&'static rayon::ThreadPool> {
    static POOL: std::sync::OnceLock<Option<rayon::ThreadPool>> = std::sync::OnceLock::new();
    POOL.get_or_init(|| {
        let workers = std::thread::available_parallelism().ok()?.get().min(4);
        if workers < 2 {
            return None;
        }
        rayon::ThreadPoolBuilder::new()
            .num_threads(workers - 1)
            .stack_size(64 * 1024 * 1024)
            .thread_name(|index| format!("docx-parse-{index}"))
            .build()
            .ok()
    })
    .as_ref()
}

#[cfg(test)]
mod root_plan_cache_tests {
    #[test]
    fn cached_plans_preserve_distinct_roots_through_eviction() {
        for value in (0..48).chain((0..48).rev()) {
            for name in ["document", "styles", "hdr", "ftr"] {
                let xml = format!("<?xml version=\"1.0\"?>\r\n<w:{name} xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:q=\"urn:cache:{value}\" xmlns=\"urn:unused\"><w:p><w:r><w:t>Text &amp; detail</w:t></w:r></w:p></w:{name}>");
                let expected = super::normalize_xml(&xml).unwrap();
                let (actual, index) = super::normalize_prolog_xml(&xml).unwrap();
                assert_eq!(actual, expected);
                assert!(index.serialization_equivalent());
            }
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod definition_indexes {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Mutex, OnceLock};

    static PREPARED: OnceLock<Mutex<VecDeque<(String, PreparedPart)>>> = OnceLock::new();

    fn copy(prepared: &PreparedPart) -> PreparedPart {
        (prepared.0.as_ref().map(crate::xml_index::Index::shared_copy), prepared.1.clone())
    }

    pub(super) fn prepare<'a>(part: &'a crate::package::OoxmlPart, prologs: &mut PrologCache<'a>) -> PreparedPart {
        let prepared = PREPARED.get_or_init(|| Mutex::new(VecDeque::new()));
        {
            let entries = prepared.lock().unwrap_or_else(|error| error.into_inner());
            if let Some((_, result)) = entries.iter().find(|(key, _)| key == &part.content) {
                return copy(result);
            }
        }
        let result = prepare_uncached_part(part, true, prologs);
        if result.0.is_some() && !matches!(result.1, Some(Err(_))) {
            let entry = (part.content.clone(), copy(&result));
            let mut entries = prepared.lock().unwrap_or_else(|error| error.into_inner());
            if !entries.iter().any(|(key, _)| key == &part.content) {
                let mut retained = entries.iter().map(|(key, _)| key.len()).sum::<usize>();
                while entries.len() >= 8 || retained + part.content.len() > 1024 * 1024 {
                    let Some((key, _)) = entries.pop_front() else { break };
                    retained -= key.len();
                }
                entries.push_back(entry);
            }
        }
        result
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod definition_index_tests {
    use super::*;
    use crate::package::OoxmlPart;

    #[test]
    fn normalization_reuse_preserves_namespace_changes_and_offsets() {
        for value in (0..12).chain((0..12).rev()) {
            let prefix = if value % 2 == 0 { "w" } else { "alternate" };
            let content = format!("<?xml version=\"1.0\"?><{prefix}:styles xmlns:{prefix}=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><{prefix}:style {prefix}:val=\"{value}\"/></{prefix}:styles>");
            let part = OoxmlPart { name: "word/styles.xml".to_owned(), content };
            let expected = prepare_uncached_part(&part, true, &mut PrologCache::default()).1;
            for _ in 0..2 {
                let (index, normalized) = prepare_part(&part, true, &mut PrologCache::default());
                assert_eq!(normalized, expected);
                let xml = normalized.as_ref().map(|value| value.as_ref().unwrap().as_str()).unwrap_or(&part.content);
                let _scope = crate::xml_index::scope([("part", xml)].into_iter(), HashMap::from([("part".to_owned(), index.unwrap())]));
                assert!(crate::xml_index::tag(xml, "w:style").flatten().is_some());
            }
        }
    }
}


#[cfg(test)]
mod numeric_reference_preflight_tests {
    use super::*;

    fn wrapped(body: &str) -> String {
        format!("<?xml version=\"1.0\"?>\r\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}</w:body></w:document>")
    }

    #[test]
    fn numeric_references_keep_complete_normalization() {
        for body in [
            "<w:p><w:r><w:t>&#65; &#x1F600;</w:t></w:r></w:p>",
            "<w:p w:val=\"&#xA;&#9;&#13;\"/>",
            "<w:p w:val=\"&amp;#xA;\"><w:r><w:t>&amp;#65;</w:t></w:r></w:p>",
        ] {
            let xml = wrapped(body);
            let part = crate::package::OoxmlPart { name: "part.xml".into(), content: xml.clone() };
            let (_, replacement) = prepare_uncached_part(&part, true, &mut PrologCache::default());
            assert_eq!(replacement.unwrap().unwrap(), normalize_xml(&xml).unwrap());
        }
    }

    #[test]
    fn escaped_reference_text_remains_eligible() {
        let xml = wrapped("<w:p><w:r><w:t>&amp;#xA;</w:t></w:r></w:p>");
        let (normalized, index) = normalize_prolog_cached(&xml, &mut PrologCache::default()).unwrap();
        assert_eq!(normalized, normalize_xml(&xml).unwrap());
        assert!(index.serialization_equivalent());
    }
}
