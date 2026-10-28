/// Mirrors TypeScript `extractBodyXml`.
pub fn extract_body_xml(document_xml: &str) -> String {
    body_xml(document_xml).to_owned()
}

pub(crate) fn body_xml(document_xml: &str) -> &str {
    let Some(open) = super::scan::find_tag_token_ref(document_xml, "w:body") else {
        return document_xml;
    };
    let start = open.as_ptr() as usize - document_xml.as_ptr() as usize + open.len();
    let remainder = &document_xml[start..];
    if let Some(end) = remainder.find("</w:body>") {
        return &remainder[..end];
    }
    let mut cursor = 0;
    while let Some(offset) = remainder[cursor..].find("</") {
        let end = cursor + offset;
        if super::scan::starts_with_ignore_ascii_case(&remainder[end..], "</w:body>") {
            return &remainder[..end];
        }
        cursor = end + 2;
    }
    document_xml
}
