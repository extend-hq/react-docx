use crate::parse::re;
/// Mirrors TypeScript `extractBodyXml`.
pub fn extract_body_xml(document_xml: &str) -> String {
    let re = re::get_unchecked(r"(?is)<w:body\b[^>]*>([\s\S]*?)</w:body>");
    re.captures(document_xml)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        .unwrap_or_else(|| document_xml.to_string())
}
