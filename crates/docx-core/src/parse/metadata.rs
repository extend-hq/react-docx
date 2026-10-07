use crate::model::DocumentCompatibilitySettings;
use crate::package::OoxmlPackage;
use super::colors::normalize_hex_color;
use crate::xml::{extract_balanced_tag_blocks, get_attribute, parse_integer_attribute, parse_on_off_attribute};

pub fn parse_document_default_tab_stop_twips(pkg: &OoxmlPackage) -> Option<i64> {
    let settings_xml = pkg.parts.get("word/settings.xml")?.content.as_str();
    let tab_stop_tag = super::scan::find_tag_token(settings_xml, "w:defaultTabStop")?;
    parse_integer_attribute(&tab_stop_tag, "w:val").filter(|value| *value >= 0)
}

/// Mirrors TypeScript `extractBodyXml`.
fn extract_body_xml(document_xml: &str) -> &str {
    if let Some(start) = find_subsequence_ignore_ascii_case(document_xml, "<w:body") {
        let after_open = &document_xml[start..];
        let open_end = after_open.find('>').map(|index| start + index + 1);
        let close_start = find_subsequence_ignore_ascii_case(document_xml, "</w:body>");
        if let (Some(open_end), Some(close_start)) = (open_end, close_start) {
            if open_end < close_start {
                return &document_xml[open_end..close_start];
            }
        }
    }
    document_xml
}

/// Mirrors TypeScript `parseDocumentBackgroundColor`.
pub fn parse_document_background_color(document_xml: &str) -> Option<String> {
    let background_tag = super::scan::find_tag_token(document_xml, "w:background")?;
    let color_value = find_namespaced_attribute_value(&background_tag, "w:color");
    normalize_hex_color(color_value.as_deref())
}

/// Mirrors TypeScript `extractDocumentOpenTag`.
pub fn extract_document_open_tag(document_xml: &str) -> Option<String> {
    let start = find_subsequence_ignore_ascii_case(document_xml, "<w:document")?;
    let after_open = &document_xml[start..];
    let end = after_open.find('>')? + start + 1;
    Some(document_xml[start..end].to_string())
}

/// Mirrors TypeScript `extractSectionPropertiesXml`.
pub fn extract_section_properties_xml(document_xml: &str) -> Option<String> {
    let body_xml = extract_body_xml(document_xml);
    let blocks = extract_balanced_tag_blocks(body_xml, "w:sectPr");
    blocks.into_iter().last()
}

/// Mirrors TypeScript `parseDocumentPageCountFromAppProperties`.
pub fn parse_document_page_count_from_app_properties(pkg: &OoxmlPackage) -> Option<i64> {
    let app_xml = pkg
        .parts
        .get("docProps/app.xml")
        .map(|part| part.content.as_str())
        .unwrap_or("");

    if app_xml.is_empty() {
        return None;
    }

    let pages_raw = extract_simple_tag_text(app_xml, "Pages")?;
    let parsed = pages_raw.trim().parse::<i64>().ok()?;
    if parsed > 0 { Some(parsed) } else { None }
}

/// Mirrors TypeScript `parseFirstOnOffSetting`.
fn parse_first_on_off_setting(settings_xml: &str, tag_names: &[&str]) -> Option<bool> {
    for tag_name in tag_names {
        if let Some(tag) = super::styles::direct_table_property(settings_xml, &format!("w:{tag_name}")) {
            return parse_on_off_attribute(tag, tag_name);
        }
    }
    None
}

/// Mirrors TypeScript `parseDocumentCompatibilitySettings`.
pub fn parse_document_compatibility_settings(
    pkg: &OoxmlPackage,
) -> Option<DocumentCompatibilitySettings> {
    let settings_xml = pkg
        .parts
        .get("word/settings.xml")
        .map(|part| part.content.as_str())
        .unwrap_or("");

    if settings_xml.is_empty() {
        return None;
    }

    let settings_root = extract_balanced_tag_blocks(settings_xml, "w:settings")
        .into_iter().next().unwrap_or_else(|| settings_xml.to_string());
    let compat_xml = super::styles::direct_table_property(&settings_root, "w:compat")
        .unwrap_or_default();

    let compatibility_mode = super::scan::find_all_tag_tokens(&compat_xml, "w:compatSetting")
        .into_iter()
        .find_map(|tag| {
            if get_attribute(&tag, "w:name").as_deref() != Some("compatibilityMode")
                || get_attribute(&tag, "w:uri").as_deref()
                    != Some("http://schemas.microsoft.com/office/word")
            {
                return None;
            }
            get_attribute(&tag, "w:val")?.parse::<u32>().ok().map(i64::from)
        });

    let no_leading = parse_first_on_off_setting(compat_xml, &["noLeading"]);
    let suppress_top_spacing_wp = parse_first_on_off_setting(compat_xml, &["suppressTopSpacingWP"]);
    let truncate_font_heights_like_wp6 = parse_first_on_off_setting(compat_xml, &["truncateFontHeightsLikeWP6"]);
    let no_extra_line_spacing = parse_first_on_off_setting(compat_xml, &["noExtraLineSpacing"]);
    let space_for_ul = parse_first_on_off_setting(compat_xml, &["spaceForUL"]);
    let suppress_bottom_spacing = parse_first_on_off_setting(compat_xml, &["suppressBottomSpacing"]);

    let suppress_spacing_before_after_page_break =
        parse_first_on_off_setting(&compat_xml, &["suppressSpBfAfterPgBrk"]);
    let use_printer_metrics = parse_first_on_off_setting(&compat_xml, &["usePrinterMetrics"]);
    let use_fixed_html_paragraph_spacing =
        parse_first_on_off_setting(&compat_xml, &["doNotUseHTMLParagraphAutoSpacing"]);
    let do_not_break_wrapped_tables = parse_first_on_off_setting(
        &compat_xml,
        &["doNotBreakWrappedTables", "dontBreakWrappedTables"],
    );
    let do_not_break_constrained_forced_table = parse_first_on_off_setting(
        &compat_xml,
        &[
            "doNotBreakConstrainedForcedTable",
            "dontBreakConstrainedForcedTable",
        ],
    );
    let even_and_odd_headers =
        parse_first_on_off_setting(&settings_root, &["evenAndOddHeaders"]);

    if no_leading.is_none()
        && suppress_top_spacing_wp.is_none()
        && truncate_font_heights_like_wp6.is_none()
        && no_extra_line_spacing.is_none()
        && space_for_ul.is_none()
        && suppress_bottom_spacing.is_none()
        && compatibility_mode.is_none()
        && suppress_spacing_before_after_page_break.is_none()
        && use_printer_metrics.is_none()
        && use_fixed_html_paragraph_spacing.is_none()
        && do_not_break_wrapped_tables.is_none()
        && do_not_break_constrained_forced_table.is_none()
        && even_and_odd_headers.is_none()
    {
        return None;
    }

    Some(DocumentCompatibilitySettings {
        no_leading,
        suppress_top_spacing_wp,
        truncate_font_heights_like_wp6,
        no_extra_line_spacing,
        space_for_ul,
        suppress_bottom_spacing,

        compatibility_mode,
        suppress_spacing_before_after_page_break,
        use_printer_metrics,
        use_fixed_html_paragraph_spacing,
        do_not_break_wrapped_tables,
        do_not_break_constrained_forced_table,
        even_and_odd_headers,
    })
}

fn extract_simple_tag_text(xml: &str, tag_name: &str) -> Option<String> {
    let open = format!("<{tag_name}>");
    let close = format!("</{tag_name}>");
    let start = find_subsequence_ignore_ascii_case(xml, &open)?;
    let content_start = start + open.len();
    let close_start = find_subsequence_ignore_ascii_case(&xml[content_start..], &close)?;
    Some(xml[content_start..content_start + close_start].to_string())
}

fn find_namespaced_attribute_value(tag_xml: &str, attribute: &str) -> Option<String> {
    crate::xml::get_attribute(tag_xml, attribute).or_else(|| {
        let pattern = format!("{attribute}=\"");
        let start = find_subsequence_ignore_ascii_case(tag_xml, &pattern)?;
        let value_start = start + pattern.len();
        let value_end = tag_xml[value_start..].find('"')? + value_start;
        Some(tag_xml[value_start..value_end].to_string())
    })
}

fn find_subsequence_ignore_ascii_case(haystack: &str, needle: &str) -> Option<usize> {
    let haystack_bytes = haystack.as_bytes();
    let needle_bytes = needle.as_bytes();
    if needle_bytes.is_empty() {
        return Some(0);
    }

    haystack_bytes
        .windows(needle_bytes.len())
        .position(|window| {
            window
                .iter()
                .zip(needle_bytes.iter())
                .all(|(left, right)| left.eq_ignore_ascii_case(right))
        })
}
