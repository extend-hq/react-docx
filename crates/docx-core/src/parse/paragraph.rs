use crate::model::{
    FormFieldCheckboxSizeMode, FormFieldCheckboxWidgetSettings, FormFieldDropdownWidgetSettings,
    FormFieldOption, FormFieldRunNode, FormFieldRunNodeType, FormFieldSourceKind,
    FormFieldTextWidgetSettings, FormFieldType, FormFieldWidgetSettings, NoteReference,
    NoteReferenceKind, ParagraphChildNode, ParagraphNode, ParagraphNodeType,
    ParagraphSourceTextPatch, ParagraphSourceTextPatchRun, TextRunNode, TextRunNodeType, TextStyle,
};
use crate::parse::context::ParseContext;
use crate::parse::images::parse_run_image_tokens;
use crate::parse::re;
use crate::parse::style::{parse_paragraph_style_in_table, parse_run_style_in_table};
use crate::parse::util::{
    active_xml as prefer_alternate_content_choice, decode_hex_code_point, decode_xml_attribute,
    normalize_legacy_form_display_value, on_off_value_to_boolean, parse_on_off_tag_value,
    parse_relationships_from_parts, strip_text_box_content,
};
use crate::xml::{
    decode_xml_entities, extract_balanced_tag_blocks, extract_balanced_tag_ranges, get_attribute,
    parse_integer_attribute, parse_on_off_attribute,
};

#[derive(Clone, Debug)]
pub struct ParagraphRunToken {
    pub xml: String,
    pub start: usize,
    pub end: usize,
    pub link: Option<String>,
    pub text_links: Vec<(usize, Option<String>)>,
}

#[derive(Clone, Debug)]
struct RunToken<'a> {
    xml: std::borrow::Cow<'a, str>,
    start: usize,
    end: usize,
    link: Option<String>,
    text_links: Vec<(usize, Option<String>)>,
}

#[derive(Clone, Debug)]
pub struct ParsedRunTextToken {
    pub text: String,
    pub source_start: usize,
    pub note_reference: Option<NoteReference>,
}

fn run_text_xml(run_xml: &str) -> std::borrow::Cow<'_, str> {
    let mut active = prefer_alternate_content_choice(run_xml);
    for range in extract_balanced_tag_ranges(&active, "w:txbxContent")
        .into_iter()
        .rev()
    {
        active
            .to_mut()
            .replace_range(range.start..range.end, &" ".repeat(range.end - range.start));
    }
    active
}

pub fn parse_run_text_tokens(run_xml: &str) -> Vec<ParsedRunTextToken> {
    let normalized_run_xml = prefer_alternate_content_choice(run_xml);
    if let Some(tokens) = stream_run_text_tokens(&normalized_run_xml) {
        return tokens;
    }
    let token_pattern = re::get_unchecked(
        r#"(?is)<w:t\b(?:[^>]*[^/>])?>([\s\S]*?)</w:t>|<a:t\b(?:[^>]*[^/>])?>([\s\S]*?)</a:t>|<w:footnoteReference\b[^>]*w:id="(-?\d+)"[^>]*/>|<w:endnoteReference\b[^>]*w:id="(-?\d+)"[^>]*/>|<w:tab\b[^>]*/>|<a:tab\b[^>]*/>|<w:br\b[^>]*/>|<w:cr\b[^>]*/>|<a:br\b[^>]*/>|<w:noBreakHyphen\b[^>]*/>|<w:softHyphen\b[^>]*/>|<w:sym\b[^>]*/>|</w:p>"#,
    );
    let mut parts = Vec::new();
    for caps in token_pattern.captures_iter(&normalized_run_xml) {
        let source_start = caps.get(0).unwrap().start();
        if let Some(m) = caps.get(1) {
            // Literal XML line endings are text whitespace; explicit break
            // elements carry the document's line-break semantics.
            let text = if m.as_str().contains(['\r', '\n']) {
                decode_xml_entities(&m.as_str().replace("\r\n", " ").replace(['\r', '\n'], " "))
            } else {
                decode_xml_entities(m.as_str())
            };
            parts.push(ParsedRunTextToken {
                source_start,
                text,
                note_reference: None,
            });
            continue;
        }
        if let Some(m) = caps.get(2) {
            parts.push(ParsedRunTextToken {
                source_start,
                text: decode_xml_entities(m.as_str()),
                note_reference: None,
            });
            continue;
        }
        if let Some(m) = caps.get(3) {
            let reference_id: i64 = m.as_str().parse().unwrap_or(0);
            if reference_id >= 0 {
                parts.push(ParsedRunTextToken {
                    source_start,
                    text: String::new(),
                    note_reference: Some(NoteReference {
                        kind: NoteReferenceKind::Footnote,
                        id: reference_id,
                    }),
                });
            }
            continue;
        }
        if let Some(m) = caps.get(4) {
            let reference_id: i64 = m.as_str().parse().unwrap_or(0);
            if reference_id >= 0 {
                parts.push(ParsedRunTextToken {
                    source_start,
                    text: String::new(),
                    note_reference: Some(NoteReference {
                        kind: NoteReferenceKind::Endnote,
                        id: reference_id,
                    }),
                });
            }
            continue;
        }
        let marker = caps
            .get(0)
            .map(|m| m.as_str().to_ascii_lowercase())
            .unwrap_or_default();
        if marker.starts_with("<w:nobreakhyphen")
            || marker.starts_with("<w:softhyphen")
            || marker.starts_with("<w:sym")
        {
            let raw = caps.get(0).unwrap().as_str();
            let text = if marker.starts_with("<w:nobreakhyphen") {
                "\u{2011}".to_string()
            } else if marker.starts_with("<w:softhyphen") {
                "\u{00ad}".to_string()
            } else {
                let code =
                    get_attribute(raw, "w:char").and_then(|v| u32::from_str_radix(&v, 16).ok());
                let font = get_attribute(raw, "w:font").unwrap_or_default();
                code.and_then(|code| {
                    super::symbols::symbol_character(&font, code).or_else(|| char::from_u32(code))
                })
                .unwrap_or('\u{fffd}')
                .to_string()
            };
            parts.push(ParsedRunTextToken {
                text,
                source_start,
                note_reference: None,
            });
        } else if marker == "</w:p>" {
            parts.push(ParsedRunTextToken {
                source_start,
                text: "\n".to_string(),
                note_reference: None,
            });
        } else if marker.starts_with("<w:tab") || marker.starts_with("<a:tab") {
            parts.push(ParsedRunTextToken {
                source_start,
                text: "\t".to_string(),
                note_reference: None,
            });
        } else {
            parts.push(ParsedRunTextToken {
                source_start,
                text: "\n".to_string(),
                note_reference: None,
            });
        }
    }
    parts
}

fn stream_run_text_tokens(xml: &str) -> Option<Vec<ParsedRunTextToken>> {
    use quick_xml::events::Event;
    if xml.contains("<!") { return None; }
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut tokens = Vec::new();
    loop {
        let source_start = reader.buffer_position() as usize;
        let event = reader.read_event().ok()?;
        if let Event::Start(tag) | Event::Empty(tag) = &event {
            if tag.as_ref().contains('<') { return None; }
        }
        match event {
            Event::Start(tag) if matches!(tag.name().as_ref(), "w:t" | "a:t") => {
                let word_text = tag.name().as_ref() == "w:t";
                let text = reader.read_text(tag.name()).ok()?;
                let text = text.as_ref();
                if text.contains('<') { return None; }
                let text = if word_text && text.contains(['\r', '\n']) {
                    decode_xml_entities(&text.replace("\r\n", " ").replace(['\r', '\n'], " "))
                } else {
                    decode_xml_entities(text)
                };
                tokens.push(ParsedRunTextToken { text, source_start, note_reference: None });
            }
            Event::Empty(tag) => {
                let name = tag.name();
                let name = name.as_ref();
                let text = match name {
                    "w:footnoteReference" | "w:endnoteReference" => {
                        let raw = tag.as_ref();
                        let mut ids = 0;
                        for attribute in tag.attributes() {
                            let attribute = attribute.ok()?;
                            ids += usize::from(attribute.key.as_ref().eq_ignore_ascii_case("w:id"));
                        }
                        if ids != 1 { return None; }
                        let Some(id) = raw.split_once("w:id=\"").and_then(|(_, value)| value.split_once('"').map(|v| v.0)) else { return None };
                        let digits = id.strip_prefix('-').unwrap_or(id);
                        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) { continue; }
                        let id = id.parse::<i64>().unwrap_or(0);
                        if id >= 0 {
                            tokens.push(ParsedRunTextToken {
                                text: String::new(), source_start,
                                note_reference: Some(NoteReference {
                                    kind: if name == "w:footnoteReference" { NoteReferenceKind::Footnote } else { NoteReferenceKind::Endnote }, id,
                                }),
                            });
                        }
                        continue;
                    }
                    "w:tab" | "a:tab" => "\t".to_owned(),
                    "w:br" | "w:cr" | "a:br" => "\n".to_owned(),
                    "w:noBreakHyphen" => "\u{2011}".to_owned(),
                    "w:softHyphen" => "\u{00ad}".to_owned(),
                    "w:sym" => {
                        let code = get_attribute(tag.as_ref(), "w:char").and_then(|v| u32::from_str_radix(&v, 16).ok());
                        let font = get_attribute(tag.as_ref(), "w:font").unwrap_or_default();
                        code.and_then(|code| super::symbols::symbol_character(&font, code).or_else(|| char::from_u32(code)))
                            .unwrap_or('\u{fffd}').to_string()
                    }
                    _ => {
                        if ["w:footnoteReference", "w:endnoteReference", "w:tab", "a:tab", "w:br", "w:cr", "a:br", "w:noBreakHyphen", "w:softHyphen", "w:sym"]
                            .iter().any(|expected| name.eq_ignore_ascii_case(expected)) { return None; }
                        continue;
                    }
                };
                tokens.push(ParsedRunTextToken { text, source_start, note_reference: None });
            }
            Event::End(tag) if tag.name().as_ref().eq_ignore_ascii_case("w:p") => {
                if !xml[source_start..reader.buffer_position() as usize].eq_ignore_ascii_case("</w:p>") { return None; }
                tokens.push(ParsedRunTextToken { text: "\n".into(), source_start, note_reference: None });
            }
            Event::Start(tag) if ["w:t", "a:t"].iter().any(|name| tag.name().as_ref().eq_ignore_ascii_case(name)) => return None,
            Event::Eof => return Some(tokens),
            _ => {}
        }
    }
}

pub fn parse_run_text(run_xml: &str) -> String {
    parse_run_text_tokens(run_xml)
        .into_iter()
        .map(|token| token.text)
        .collect()
}

fn hyperlink_href_from_tag(hyperlink_tag: &str, context: &ParseContext<'_>) -> Option<String> {
    let relationship_id = get_attribute(hyperlink_tag, "r:id");
    let anchor = get_attribute(hyperlink_tag, "w:anchor");
    let relationship_target = relationship_id
        .as_deref()
        .and_then(|id| context.relationships.get(id).cloned());
    if relationship_id.is_some() && relationship_target.is_none() {
        context.push_warning(format!(
            "Missing hyperlink relationship target for {}",
            relationship_id.unwrap_or_default()
        ));
    }
    if let (Some(anchor), Some(target)) = (anchor.as_deref(), relationship_target.as_deref()) {
        return Some(format!(
            "{}#{anchor}",
            target.split('#').next().unwrap_or(target)
        ));
    }
    if let Some(target) = relationship_target {
        return Some(target);
    }
    anchor.map(|a| format!("#{a}"))
}

fn hyperlink_href_from_field_instruction(raw_instruction: &str) -> Option<String> {
    if raw_instruction.is_empty() {
        return None;
    }
    let instruction = decode_xml_entities(raw_instruction);
    if !re::get_unchecked(r"(?i)^\s*HYPERLINK\b").is_match(&instruction) {
        return None;
    }
    let anchor_match = re::get(r#"(?i)\\l\s+(?:"([^"]+)"|([^\s\\]+))"#)
        .and_then(|re| re.captures(&instruction))
        .and_then(|c| {
            c.get(1)
                .or_else(|| c.get(2))
                .map(|m| m.as_str().to_string())
        });
    let explicit_target_match = re::get(r#"(?i)^\s*HYPERLINK\b\s+(?:"([^"]+)"|([^\s\\]+))"#)
        .and_then(|re| re.captures(&instruction))
        .and_then(|c| {
            c.get(1)
                .or_else(|| c.get(2))
                .map(|m| m.as_str().to_string())
        });
    if let Some(target) = explicit_target_match {
        if let Some(ref anchor) = anchor_match {
            return Some(format!(
                "{}#{anchor}",
                target.split('#').next().unwrap_or(&target)
            ));
        }
        return Some(target);
    }
    anchor_match.map(|a| format!("#{a}"))
}

pub fn parse_paragraph_runs(paragraph_xml: &str, context: &ParseContext<'_>) -> Vec<ParagraphRunToken> {
    paragraph_runs(paragraph_xml, context).into_iter().map(|run| ParagraphRunToken {
        xml: run.xml.into_owned(), start: run.start, end: run.end, link: run.link, text_links: run.text_links,
    }).collect()
}

fn paragraph_runs<'a>(
    paragraph_xml: &'a str,
    context: &ParseContext<'_>,
) -> Vec<RunToken<'a>> {
    let run_ranges = extract_balanced_tag_ranges(paragraph_xml, "w:r");
    if run_ranges.is_empty() {
        return Vec::new();
    }

    let has_complex_fields = super::scan::contains_tag(paragraph_xml, "w:fldChar");
    if !has_complex_fields
        && !super::scan::contains_tag(paragraph_xml, "w:hyperlink")
        && !super::scan::contains_tag(paragraph_xml, "w:fldSimple")
    {
        return run_ranges
            .into_iter()
            .map(|range| RunToken {
                xml: std::borrow::Cow::Borrowed(&paragraph_xml[range.start..range.end]),
                start: range.start,
                end: range.end,
                link: None,
                text_links: Vec::new(),
            })
            .collect();
    }

    let mut hyperlink_ranges: Vec<_> = extract_balanced_tag_ranges(paragraph_xml, "w:hyperlink")
        .into_iter()
        .map(|range| {
            let hyperlink_xml = &paragraph_xml[range.start..range.end];
            let hyperlink_tag = re::get(r"(?i)<w:hyperlink\b[^>]*>")
                .and_then(|re| re.find(hyperlink_xml))
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            let href = hyperlink_href_from_tag(&hyperlink_tag, context);
            (range, href)
        })
        .collect();
    hyperlink_ranges.extend(
        extract_balanced_tag_ranges(paragraph_xml, "w:fldSimple")
            .into_iter()
            .map(|range| {
                let tag = super::scan::find_tag_token_ref(
                    &paragraph_xml[range.start..range.end],
                    "w:fldSimple",
                )
                .unwrap_or("");
                let href = get_attribute(tag, "w:instr")
                    .and_then(|instruction| hyperlink_href_from_field_instruction(&instruction));
                (range, href)
            }),
    );
    hyperlink_ranges.sort_by_key(|(range, _)| range.start);

    let mut field_links_by_run: std::collections::HashMap<usize, String> =
        std::collections::HashMap::new();
    let mut field_text_links_by_run: std::collections::HashMap<
        usize,
        Vec<(usize, Option<String>)>,
    > = std::collections::HashMap::new();
    #[derive(Default)]
    struct FieldState {
        instruction: String,
        link: Option<String>,
        separated: bool,
    }
    let mut fields: Vec<FieldState> = Vec::new();
    let field_tokens = re::get_unchecked(
        r#"(?is)<w:instrText\b(?:[^>]*[^/>])?>([\s\S]*?)</w:instrText>|<w:fldChar\b[^>]*>|<w:t\b(?:[^>]*[^/>])?>[\s\S]*?</w:t>|<a:t\b(?:[^>]*[^/>])?>[\s\S]*?</a:t>|<w:(?:drawing|pict)\b[^>]*>|<w:(?:sym|tab|br|cr|noBreakHyphen|softHyphen|footnoteReference|endnoteReference)\b[^>]*/>|<a:(?:tab|br)\b[^>]*/>"#,
    );

    for (run_index, range) in run_ranges.iter().enumerate() {
        if !has_complex_fields {
            field_text_links_by_run.insert(run_index, vec![(0, None)]);
            continue;
        }
        let run_xml = run_text_xml(&paragraph_xml[range.start..range.end]);
        let mut text_links = vec![(0, fields.iter().rev().find_map(|field| field.link.clone()))];
        for token in field_tokens.captures_iter(&run_xml) {
            if let Some(instruction) = token.get(1) {
                if let Some(field) = fields.last_mut().filter(|field| !field.separated) {
                    field.instruction.push_str(instruction.as_str());
                }
                continue;
            }
            let tag = token.get(0).unwrap().as_str();
            if tag.to_ascii_lowercase().starts_with("<w:fldchar") {
                match get_attribute(tag, "w:fldCharType").as_deref() {
                    Some("begin") => fields.push(FieldState::default()),
                    Some("separate") => {
                        if let Some(field) = fields.last_mut() {
                            field.link = hyperlink_href_from_field_instruction(&field.instruction);
                            field.separated = true;
                        }
                    }
                    Some("end") => {
                        fields.pop();
                    }
                    _ => {}
                }
                text_links.push((
                    token.get(0).unwrap().end(),
                    fields.iter().rev().find_map(|field| field.link.clone()),
                ));
            } else {
                let link = fields.iter().rev().find_map(|field| field.link.clone());
                if let Some(link) = link.as_ref() {
                    field_links_by_run
                        .entry(run_index)
                        .or_insert_with(|| link.clone());
                }
            }
        }
        field_text_links_by_run.insert(run_index, text_links);
    }

    let mut hyperlink_range_cursor = 0usize;
    run_ranges
        .into_iter()
        .enumerate()
        .map(|(run_index, range)| {
            while hyperlink_range_cursor < hyperlink_ranges.len()
                && hyperlink_ranges[hyperlink_range_cursor].0.end <= range.start
            {
                hyperlink_range_cursor += 1;
            }
            let current = hyperlink_ranges.get(hyperlink_range_cursor);
            let hyperlink_href = current.and_then(|(hyperlink_range, href)| {
                if range.start >= hyperlink_range.start && range.end <= hyperlink_range.end {
                    href.clone()
                } else {
                    None
                }
            });
            let field_links = field_text_links_by_run
                .remove(&run_index)
                .unwrap_or_default();
            let overlapping: Vec<_> = hyperlink_ranges[hyperlink_range_cursor..]
                .iter()
                .take_while(|(hyperlink, _)| hyperlink.start < range.end)
                .filter(|(hyperlink, _)| hyperlink.end > range.start)
                .collect();
            let mut offsets: Vec<_> = field_links.iter().map(|(offset, _)| *offset).collect();
            for (hyperlink, _) in &overlapping {
                offsets.push(hyperlink.start.saturating_sub(range.start));
                if hyperlink.end < range.end {
                    offsets.push(hyperlink.end - range.start);
                }
            }
            offsets.sort_unstable();
            offsets.dedup();
            let text_links = offsets
                .into_iter()
                .map(|offset| {
                    let position = range.start + offset;
                    let href = overlapping
                        .iter()
                        .rev()
                        .find(|(hyperlink, _)| {
                            position >= hyperlink.start && position < hyperlink.end
                        })
                        .and_then(|(_, href)| href.clone())
                        .or_else(|| {
                            field_links
                                .iter()
                                .rev()
                                .find(|(start, _)| *start <= offset)
                                .and_then(|(_, href)| href.clone())
                        });
                    (offset, href)
                })
                .collect();
            let link = hyperlink_href.or_else(|| field_links_by_run.get(&run_index).cloned());
            RunToken {
                xml: std::borrow::Cow::Borrowed(&paragraph_xml[range.start..range.end]),
                start: range.start,
                end: range.end,
                link,
                text_links,
            }
        })
        .collect()
}

#[derive(Clone, Debug)]
struct ParagraphFormFieldToken {
    start: usize,
    end: usize,
    field: FormFieldRunNode,
}

fn decode_active_x_binary_markup(binary: &[u8]) -> String {
    let utf16: String = binary
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .filter_map(|code_unit| char::from_u32(code_unit as u32))
        .collect();
    if re::get(r"(?i)input\s+type=").is_some_and(|re| re.is_match(&utf16)) {
        return utf16;
    }
    binary.iter().map(|&b| b as char).collect()
}

pub fn parse_run_active_x_checkbox_field(
    run_xml: &str,
    context: &ParseContext<'_>,
    style: Option<TextStyle>,
    link: Option<String>,
) -> Option<FormFieldRunNode> {
    if !re::get(r"(?i)<w:object\b").is_some_and(|re| re.is_match(run_xml))
        || !re::get(r"(?i)<w:control\b").is_some_and(|re| re.is_match(run_xml))
    {
        return None;
    }
    let control_tag = re::get(r"(?i)<w:control\b[^>]*/?>")
        .and_then(|re| re.find(run_xml))
        .map(|m| m.as_str().to_string())?;
    let control_relationship_id = get_attribute(&control_tag, "r:id")?;
    let active_x_part_name = context.relationships.get(&control_relationship_id)?.clone();
    let active_x_xml = context.parts.get(&active_x_part_name)?.content.clone();
    let ocx_tag = re::get(r"(?i)<ax:ocx\b[^>]*/?>")
        .and_then(|re| re.find(&active_x_xml))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let binary_relationship_id = get_attribute(&ocx_tag, "r:id")?;
    let active_x_relationships = parse_relationships_from_parts(context.parts, &active_x_part_name);
    let active_x_binary_part_name = active_x_relationships.get(&binary_relationship_id)?.clone();
    let active_x_binary = context.binary_assets.get(&active_x_binary_part_name)?;
    if active_x_binary.is_empty() {
        return None;
    }
    let markup = decode_active_x_binary_markup(active_x_binary);
    if !re::get(r#"(?i)input\s+type\s*=\s*"checkbox""#).is_some_and(|re| re.is_match(&markup)) {
        return None;
    }
    let name = re::get(r#"(?i)\bname\s*=\s*"([^"]+)""#)
        .and_then(|re| re.captures(&markup))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string());
    Some(FormFieldRunNode {
        r#type: FormFieldRunNodeType::FormField,
        field_type: FormFieldType::Checkbox,
        source_kind: Some(FormFieldSourceKind::Legacy),
        id: None,
        tag: None,
        title: None,
        placeholder: None,
        checked: Some(re::get(r"(?i)\bchecked\b").is_some_and(|re| re.is_match(&markup))),
        value: None,
        options: None,
        widget: Some(FormFieldWidgetSettings {
            name,
            enabled: None,
            calc_on_exit: None,
            text: None,
            checkbox: None,
            dropdown: None,
        }),
        checked_symbol: Some("☒".to_string()),
        unchecked_symbol: Some("☐".to_string()),
        style,
        link,
        source_xml: Some(run_xml.to_string()),
    })
}

fn parse_legacy_form_field_from_range(
    paragraph_xml: &str,
    runs: &[RunToken<'_>],
    context: &ParseContext<'_>,
    paragraph_style_id: Option<&str>,
    table_run_style: Option<&TextStyle>,
    start_run_index: usize,
    separate_run_index: Option<usize>,
    end_run_index: usize,
    raw_instruction: &str,
    ff_data_xml: Option<&str>,
) -> Option<FormFieldRunNode> {
    let instruction = decode_xml_entities(raw_instruction)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let normalized_instruction = instruction.to_ascii_uppercase();
    let field_type = if normalized_instruction.contains("FORMCHECKBOX") {
        FormFieldType::Checkbox
    } else if normalized_instruction.contains("FORMDROPDOWN") {
        FormFieldType::Dropdown
    } else if normalized_instruction.contains("FORMTEXT") {
        FormFieldType::Text
    } else {
        return None;
    };

    let result_start_run_index = separate_run_index
        .map(|i| i + 1)
        .unwrap_or((end_run_index).min(start_run_index + 1));
    let result_runs = if result_start_run_index < end_run_index {
        &runs[result_start_run_index..end_run_index]
    } else {
        &[]
    };
    let fallback_result_text = normalize_legacy_form_display_value(Some(
        &result_runs
            .iter()
            .map(|r| parse_run_text(&r.xml))
            .collect::<String>(),
    ));
    let style_run_xml = result_runs
        .iter()
        .find(|run| {
            !parse_run_text(&run.xml).trim().is_empty()
                || re::get(r"(?i)<w:sym\b").is_some_and(|re| re.is_match(&run.xml))
        })
        .or_else(|| runs.get(start_run_index))
        .map(|r| r.xml.as_ref());
    let style = style_run_xml.and_then(|xml| {
        parse_run_style_in_table(xml, context, paragraph_style_id, table_run_style)
    });
    let link = runs
        .get(start_run_index..=end_run_index.min(runs.len().saturating_sub(1)))
        .and_then(|slice| slice.iter().find_map(|r| r.link.clone()));
    let field_xml = runs
        .get(start_run_index)
        .zip(runs.get(end_run_index))
        .map(|(start, end)| paragraph_xml[start.start..end.end].to_string());

    let name_tag = ff_data_xml.and_then(|xml| {
        re::get(r"(?i)<w:name\b[^>]*/?>")
            .and_then(|re| re.find(xml))
            .map(|m| m.as_str().to_string())
    });
    let enabled = ff_data_xml.and_then(|xml| parse_on_off_attribute(xml, "enabled"));
    let calc_on_exit = ff_data_xml.and_then(|xml| parse_on_off_attribute(xml, "calcOnExit"));
    let mut widget_settings = FormFieldWidgetSettings {
        name: name_tag
            .as_deref()
            .and_then(|tag| get_attribute(tag, "w:val"))
            .and_then(|value| decode_xml_attribute(Some(&value))),
        enabled,
        calc_on_exit,
        text: None,
        checkbox: None,
        dropdown: None,
    };

    match field_type {
        FormFieldType::Checkbox => {
            let checkbox_xml = ff_data_xml
                .and_then(|xml| {
                    extract_balanced_tag_blocks(xml, "w:checkBox")
                        .into_iter()
                        .next()
                })
                .or_else(|| {
                    ff_data_xml.and_then(|xml| {
                        re::get(r"(?i)<w:checkBox\b[^>]*/?>")
                            .and_then(|re| re.find(xml))
                            .map(|m| m.as_str().to_string())
                    })
                });
            let default_tag = checkbox_xml.as_deref().and_then(|xml| {
                re::get(r"(?i)<w:default\b[^>]*/?>")
                    .and_then(|re| re.find(xml))
                    .map(|m| m.as_str().to_string())
            });
            let checked_tag = checkbox_xml.as_deref().and_then(|xml| {
                re::get(r"(?i)<w:checked\b[^>]*/?>")
                    .and_then(|re| re.find(xml))
                    .map(|m| m.as_str().to_string())
            });
            let size_auto_tag = checkbox_xml.as_deref().and_then(|xml| {
                re::get(r"(?i)<w:sizeAuto\b[^>]*/?>")
                    .and_then(|re| re.find(xml))
                    .map(|m| m.as_str().to_string())
            });
            let size_tag = checkbox_xml.as_deref().and_then(|xml| {
                re::get(r"(?i)<w:size\b[^>]*/?>")
                    .and_then(|re| re.find(xml))
                    .map(|m| m.as_str().to_string())
            });
            let default_checked = parse_on_off_tag_value(default_tag.as_deref(), &["w:val"]);
            let checked =
                parse_on_off_tag_value(checked_tag.as_deref(), &["w:val"]).or(default_checked);
            let size_value = size_tag
                .as_deref()
                .and_then(|t| parse_integer_attribute(t, "w:val"));
            let size_pt = size_value
                .filter(|v| *v > 0)
                .map(|v| ((v as f64) / 2.0 * 100.0).round() / 100.0);
            let size_mode = if size_auto_tag.is_some() {
                Some(FormFieldCheckboxSizeMode::Auto)
            } else if size_pt.is_some() {
                Some(FormFieldCheckboxSizeMode::Exact)
            } else {
                None
            };
            if default_checked.is_some() || size_mode.is_some() || size_pt.is_some() {
                widget_settings.checkbox = Some(FormFieldCheckboxWidgetSettings {
                    default_checked,
                    size_mode,
                    size_pt,
                });
            }
            return Some(FormFieldRunNode {
                r#type: FormFieldRunNodeType::FormField,
                field_type: FormFieldType::Checkbox,
                source_kind: Some(FormFieldSourceKind::Legacy),
                id: None,
                tag: None,
                title: None,
                placeholder: None,
                checked: Some(checked.unwrap_or(false)),
                value: None,
                options: None,
                widget: Some(widget_settings),
                checked_symbol: Some("☒".to_string()),
                unchecked_symbol: Some("☐".to_string()),
                style,
                link,
                source_xml: field_xml,
            });
        }
        FormFieldType::Dropdown => {
            let dropdown_xml = ff_data_xml
                .and_then(|xml| {
                    extract_balanced_tag_blocks(xml, "w:ddList")
                        .into_iter()
                        .next()
                })
                .or_else(|| {
                    ff_data_xml.and_then(|xml| {
                        re::get(r"(?i)<w:ddList\b[^>]*/?>")
                            .and_then(|re| re.find(xml))
                            .map(|m| m.as_str().to_string())
                    })
                });
            let options: Vec<FormFieldOption> = dropdown_xml
                .as_deref()
                .map(|xml| {
                    re::get(r"(?i)<w:listEntry\b[^>]*/?>")
                        .map(|re| {
                            re.find_iter(xml)
                                .filter_map(|m| {
                                    let entry = get_attribute(m.as_str(), "w:val")
                                        .and_then(|value| decode_xml_attribute(Some(&value)))?
                                        .trim()
                                        .to_string();
                                    if entry.is_empty() {
                                        None
                                    } else {
                                        Some(FormFieldOption {
                                            display_text: entry.clone(),
                                            value: Some(entry),
                                        })
                                    }
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            let default_tag = dropdown_xml.as_deref().and_then(|xml| {
                re::get(r"(?i)<w:default\b[^>]*/?>")
                    .and_then(|re| re.find(xml))
                    .map(|m| m.as_str().to_string())
            });
            let default_value = default_tag
                .as_deref()
                .and_then(|tag| get_attribute(tag, "w:val"))
                .as_deref()
                .and_then(|value| decode_xml_attribute(Some(&value)))
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            let dropdown_default_value = default_value.clone();
            if dropdown_default_value.is_some() {
                widget_settings.dropdown = Some(FormFieldDropdownWidgetSettings {
                    default_value: dropdown_default_value,
                });
            }
            let value = fallback_result_text
                .or(default_value)
                .or_else(|| options.first().map(|o| o.display_text.clone()));
            return Some(FormFieldRunNode {
                r#type: FormFieldRunNodeType::FormField,
                field_type: FormFieldType::Dropdown,
                source_kind: Some(FormFieldSourceKind::Legacy),
                id: None,
                tag: None,
                title: None,
                placeholder: None,
                checked: None,
                value,
                options: if options.is_empty() {
                    None
                } else {
                    Some(options)
                },
                widget: Some(widget_settings),
                checked_symbol: None,
                unchecked_symbol: None,
                style,
                link,
                source_xml: field_xml,
            });
        }
        FormFieldType::Text => {
            let text_input_xml = ff_data_xml
                .and_then(|xml| {
                    extract_balanced_tag_blocks(xml, "w:textInput")
                        .into_iter()
                        .next()
                })
                .or_else(|| {
                    ff_data_xml.and_then(|xml| {
                        re::get(r"(?i)<w:textInput\b[^>]*/?>")
                            .and_then(|re| re.find(xml))
                            .map(|m| m.as_str().to_string())
                    })
                });
            let type_tag = text_input_xml.as_deref().and_then(|xml| {
                re::get(r"(?i)<w:type\b[^>]*/?>")
                    .and_then(|re| re.find(xml))
                    .map(|m| m.as_str().to_string())
            });
            let default_tag = text_input_xml.as_deref().and_then(|xml| {
                re::get(r"(?i)<w:default\b[^>]*/?>")
                    .and_then(|re| re.find(xml))
                    .map(|m| m.as_str().to_string())
            });
            let max_length_tag = text_input_xml.as_deref().and_then(|xml| {
                re::get(r"(?i)<w:maxLength\b[^>]*/?>")
                    .and_then(|re| re.find(xml))
                    .map(|m| m.as_str().to_string())
            });
            let format_tag = text_input_xml.as_deref().and_then(|xml| {
                re::get(r"(?i)<w:format\b[^>]*/?>")
                    .and_then(|re| re.find(xml))
                    .map(|m| m.as_str().to_string())
            });
            let input_type = type_tag
                .as_deref()
                .and_then(|tag| get_attribute(tag, "w:val"))
                .as_deref()
                .and_then(|value| decode_xml_attribute(Some(&value)));
            let default_text = default_tag
                .as_deref()
                .and_then(|tag| get_attribute(tag, "w:val"))
                .as_deref()
                .and_then(|value| decode_xml_attribute(Some(&value)));
            let max_length = max_length_tag
                .as_deref()
                .and_then(|tag| parse_integer_attribute(tag, "w:val"));
            let text_format = format_tag
                .as_deref()
                .and_then(|tag| get_attribute(tag, "w:val"))
                .as_deref()
                .and_then(|value| decode_xml_attribute(Some(&value)));
            let text_default = default_text.clone();
            if input_type.is_some()
                || text_default.is_some()
                || max_length.is_some()
                || text_format.is_some()
            {
                widget_settings.text = Some(FormFieldTextWidgetSettings {
                    input_type,
                    default_text: text_default,
                    max_length,
                    text_format,
                });
            }
            let value = fallback_result_text.or(default_text);
            return Some(FormFieldRunNode {
                r#type: FormFieldRunNodeType::FormField,
                field_type: FormFieldType::Text,
                source_kind: Some(FormFieldSourceKind::Legacy),
                id: None,
                tag: None,
                title: None,
                placeholder: None,
                checked: None,
                value,
                options: None,
                widget: Some(widget_settings),
                checked_symbol: None,
                unchecked_symbol: None,
                style,
                link,
                source_xml: field_xml,
            });
        }
        FormFieldType::Date => None,
    }
}

fn parse_legacy_paragraph_form_field_tokens(
    paragraph_xml: &str,
    runs: &[RunToken<'_>],
    context: &ParseContext<'_>,
    paragraph_style_id: Option<&str>,
    table_run_style: Option<&TextStyle>,
) -> Vec<ParagraphFormFieldToken> {
    if runs.is_empty() {
        return Vec::new();
    }
    let mut tokens = Vec::new();
    let mut stack: Vec<(usize, Option<usize>, Vec<String>, Option<String>)> = Vec::new();
    let inline_token_pattern = re::get_unchecked(
        r#"(?is)<w:fldChar\b[^>]*\bw:fldCharType="(begin|separate|end)"[^>]*>([\s\S]*?)</w:fldChar>|<w:fldChar\b[^>]*\bw:fldCharType="(begin|separate|end)"[^>]*/>|<w:instrText\b(?:[^>]*[^/>])?>([\s\S]*?)</w:instrText>"#,
    );

    for (run_index, run) in runs.iter().enumerate() {
        for caps in inline_token_pattern.captures_iter(&run.xml) {
            if let Some(chunk) = caps.get(4) {
                if let Some(current) = stack.last_mut() {
                    current.2.push(chunk.as_str().to_string());
                }
                continue;
            }
            let field_type = caps
                .get(1)
                .or_else(|| caps.get(3))
                .map(|m| m.as_str().to_ascii_lowercase())
                .unwrap_or_default();
            if field_type == "begin" {
                let field_xml = caps.get(0).map(|m| m.as_str()).unwrap_or_default();
                let ff_data_xml = extract_balanced_tag_blocks(field_xml, "w:ffData")
                    .into_iter()
                    .next()
                    .or_else(|| {
                        re::get(r"(?i)<w:ffData\b[^>]*/?>")
                            .and_then(|re| re.find(field_xml))
                            .map(|m| m.as_str().to_string())
                    });
                stack.push((run_index, None, Vec::new(), ff_data_xml));
                continue;
            }
            if field_type == "separate" {
                if let Some(current) = stack.last_mut() {
                    if current.1.is_none() {
                        current.1 = Some(run_index);
                    }
                }
                continue;
            }
            if field_type == "end" {
                let Some(current) = stack.pop() else { continue };
                let field = parse_legacy_form_field_from_range(
                    paragraph_xml,
                    runs,
                    context,
                    paragraph_style_id,
                    table_run_style,
                    current.0,
                    current.1,
                    run_index,
                    &current.2.join(" "),
                    current.3.as_deref(),
                );
                let Some(field) = field else { continue };
                let start = runs.get(current.0).map(|r| r.start);
                let end = runs.get(run_index).map(|r| r.end);
                if let (Some(start), Some(end)) = (start, end) {
                    if end > start {
                        tokens.push(ParagraphFormFieldToken { start, end, field });
                    }
                }
            }
        }
    }
    tokens
}

fn parse_form_field_from_sdt_xml(
    sdt_xml: &str,
    context: &ParseContext<'_>,
    paragraph_style_id: Option<&str>,
    table_run_style: Option<&TextStyle>,
    link: Option<String>,
) -> Option<FormFieldRunNode> {
    let sdt_properties_xml = extract_balanced_tag_blocks(sdt_xml, "w:sdtPr")
        .into_iter()
        .next()
        .or_else(|| {
            re::get(r"(?i)<w:sdtPr\b[^>]*/?>")
                .and_then(|re| re.find(sdt_xml))
                .map(|m| m.as_str().to_string())
        })
        .unwrap_or_default();
    let sdt_content_xml = extract_balanced_tag_blocks(sdt_xml, "w:sdtContent")
        .into_iter()
        .next()
        .unwrap_or_default();
    if sdt_properties_xml.is_empty() {
        return None;
    }

    let alias_tag = re::get(r"(?i)<w:alias\b[^>]*/?>")
        .and_then(|re| re.find(&sdt_properties_xml))
        .map(|m| m.as_str().to_string());
    let tag_tag = re::get(r"(?i)<w:tag\b[^>]*/?>")
        .and_then(|re| re.find(&sdt_properties_xml))
        .map(|m| m.as_str().to_string());
    let id_tag = re::get(r"(?i)<w:id\b[^>]*/?>")
        .and_then(|re| re.find(&sdt_properties_xml))
        .map(|m| m.as_str().to_string());
    let placeholder_tag = re::get(r"(?is)<w:placeholder\b[\s\S]*?</w:placeholder>")
        .and_then(|re| re.find(&sdt_properties_xml))
        .map(|m| m.as_str().to_string());
    let placeholder_doc_part_tag = placeholder_tag.as_deref().and_then(|xml| {
        re::get(r"(?i)<w:docPart\b[^>]*/?>")
            .and_then(|re| re.find(xml))
            .map(|m| m.as_str().to_string())
    });
    let title = alias_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:val"))
        .as_deref()
        .and_then(|value| decode_xml_attribute(Some(&value)));
    let tag = tag_tag
        .as_deref()
        .and_then(|t| get_attribute(t, "w:val"))
        .as_deref()
        .and_then(|value| decode_xml_attribute(Some(&value)));
    let id_value = id_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:val"));
    let placeholder = placeholder_doc_part_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:val"))
        .as_deref()
        .and_then(|value| decode_xml_attribute(Some(&value)));
    let first_run_xml = extract_balanced_tag_blocks(&sdt_content_xml, "w:r")
        .into_iter()
        .next();
    let style = first_run_xml.as_deref().and_then(|xml| {
        parse_run_style_in_table(xml, context, paragraph_style_id, table_run_style)
    });
    let content_text = parse_run_text(&sdt_content_xml);
    let trimmed_content_text = content_text.trim();

    if re::get(r"(?i)<w14:checkbox\b").is_some_and(|re| re.is_match(&sdt_properties_xml)) {
        let checked_tag = re::get(r"(?i)<w14:checked\b[^>]*/?>")
            .and_then(|re| re.find(&sdt_properties_xml))
            .map(|m| m.as_str().to_string());
        let checked_value = checked_tag
            .as_deref()
            .and_then(|tag| get_attribute(tag, "w14:val").or_else(|| get_attribute(tag, "w:val")));
        let checked_state_tag = re::get(r"(?i)<w14:checkedState\b[^>]*/?>")
            .and_then(|re| re.find(&sdt_properties_xml))
            .map(|m| m.as_str().to_string());
        let unchecked_state_tag = re::get(r"(?i)<w14:uncheckedState\b[^>]*/?>")
            .and_then(|re| re.find(&sdt_properties_xml))
            .map(|m| m.as_str().to_string());
        let checked_symbol = checked_state_tag
            .as_deref()
            .and_then(|tag| {
                decode_hex_code_point(
                    get_attribute(tag, "w14:val")
                        .or_else(|| get_attribute(tag, "w:val"))
                        .as_deref(),
                )
            })
            .unwrap_or_else(|| "☒".to_string());
        let unchecked_symbol = unchecked_state_tag
            .as_deref()
            .and_then(|tag| {
                decode_hex_code_point(
                    get_attribute(tag, "w14:val")
                        .or_else(|| get_attribute(tag, "w:val"))
                        .as_deref(),
                )
            })
            .unwrap_or_else(|| "☐".to_string());
        let checked = on_off_value_to_boolean(checked_value.as_deref()).or_else(|| {
            if !trimmed_content_text.is_empty() {
                Some(trimmed_content_text.contains(&checked_symbol))
            } else {
                None
            }
        });
        return Some(FormFieldRunNode {
            r#type: FormFieldRunNodeType::FormField,
            field_type: FormFieldType::Checkbox,
            source_kind: Some(FormFieldSourceKind::Sdt),
            id: id_value,
            tag,
            title,
            placeholder,
            checked: Some(checked.unwrap_or(false)),
            value: None,
            options: None,
            widget: None,
            checked_symbol: Some(checked_symbol),
            unchecked_symbol: Some(unchecked_symbol),
            style,
            link,
            source_xml: Some(sdt_xml.to_string()),
        });
    }

    if re::get(r"(?i)<w:(?:dropDownList|comboBox)\b")
        .is_some_and(|re| re.is_match(&sdt_properties_xml))
    {
        let mut options = Vec::new();
        if let Some(re) = re::get(r"(?i)<w:listItem\b[^>]*/?>") {
            for mat in re.find_iter(&sdt_properties_xml) {
                let list_item_tag = mat.as_str();
                let display_text = get_attribute(list_item_tag, "w:displayText")
                    .and_then(|value| decode_xml_attribute(Some(&value)));
                let value = get_attribute(list_item_tag, "w:value")
                    .and_then(|value| decode_xml_attribute(Some(&value)));
                let Some(fallback_text) = display_text
                    .clone()
                    .or(value.clone())
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
                else {
                    continue;
                };
                options.push(FormFieldOption {
                    display_text: fallback_text,
                    value: value
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty()),
                });
            }
        }
        let last_value_tag = re::get(r"(?i)<w:lastValue\b[^>]*/?>")
            .and_then(|re| re.find(&sdt_properties_xml))
            .map(|m| m.as_str().to_string());
        let last_value = last_value_tag
            .as_deref()
            .and_then(|tag| get_attribute(tag, "w:val"))
            .and_then(|value| decode_xml_attribute(Some(&value)))
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let selected_value = if trimmed_content_text.is_empty() {
            last_value
        } else {
            Some(trimmed_content_text.to_string())
        };
        return Some(FormFieldRunNode {
            r#type: FormFieldRunNodeType::FormField,
            field_type: FormFieldType::Dropdown,
            source_kind: Some(FormFieldSourceKind::Sdt),
            id: id_value,
            tag,
            title,
            placeholder,
            checked: None,
            value: selected_value,
            options: if options.is_empty() {
                None
            } else {
                Some(options)
            },
            widget: None,
            checked_symbol: None,
            unchecked_symbol: None,
            style,
            link,
            source_xml: Some(sdt_xml.to_string()),
        });
    }

    if re::get(r"(?i)<w:date\b").is_some_and(|re| re.is_match(&sdt_properties_xml)) {
        let full_date_tag = re::get(r"(?i)<w:fullDate\b[^>]*/?>")
            .and_then(|re| re.find(&sdt_properties_xml))
            .map(|m| m.as_str().to_string());
        let full_date = full_date_tag
            .as_deref()
            .and_then(|tag| get_attribute(tag, "w:val"))
            .and_then(|value| decode_xml_attribute(Some(&value)))
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let value = if trimmed_content_text.is_empty() {
            full_date
        } else {
            Some(content_text)
        };
        return Some(FormFieldRunNode {
            r#type: FormFieldRunNodeType::FormField,
            field_type: FormFieldType::Date,
            source_kind: Some(FormFieldSourceKind::Sdt),
            id: id_value,
            tag,
            title,
            placeholder,
            checked: None,
            value,
            options: None,
            widget: None,
            checked_symbol: None,
            unchecked_symbol: None,
            style,
            link,
            source_xml: Some(sdt_xml.to_string()),
        });
    }

    if re::get(r"(?i)<w:(?:text|richText)\b").is_some_and(|re| re.is_match(&sdt_properties_xml)) {
        return Some(FormFieldRunNode {
            r#type: FormFieldRunNodeType::FormField,
            field_type: FormFieldType::Text,
            source_kind: Some(FormFieldSourceKind::Sdt),
            id: id_value,
            tag,
            title,
            placeholder,
            checked: None,
            value: Some(content_text),
            options: None,
            widget: None,
            checked_symbol: None,
            unchecked_symbol: None,
            style,
            link,
            source_xml: Some(sdt_xml.to_string()),
        });
    }

    None
}

pub fn parse_paragraph_form_field_tokens(
    paragraph_xml: &str,
    context: &ParseContext<'_>,
    paragraph_style_id: Option<&str>,
    runs: Option<&[ParagraphRunToken]>,
) -> Vec<ParagraphFormFieldToken> {
    let borrowed = runs.map(|runs| runs.iter().map(|run| RunToken {
        xml: std::borrow::Cow::Borrowed(run.xml.as_str()), start: run.start, end: run.end,
        link: run.link.clone(), text_links: run.text_links.clone(),
    }).collect::<Vec<_>>());
    parse_paragraph_form_field_tokens_in_table(
        paragraph_xml,
        context,
        paragraph_style_id,
        borrowed.as_deref(),
        None,
    )
}

fn parse_paragraph_form_field_tokens_in_table(
    paragraph_xml: &str,
    context: &ParseContext<'_>,
    paragraph_style_id: Option<&str>,
    runs: Option<&[RunToken<'_>]>,
    table_run_style: Option<&TextStyle>,
) -> Vec<ParagraphFormFieldToken> {
    if !super::scan::contains_tag(paragraph_xml, "w:fldChar")
        && !super::scan::contains_tag(paragraph_xml, "w:sdt")
    {
        return Vec::new();
    }
    let paragraph_runs: Vec<RunToken<'_>> = runs
        .map(|r| r.to_vec())
        .unwrap_or_else(|| paragraph_runs(paragraph_xml, context));
    let story_runs: Vec<_> = paragraph_runs
        .iter()
        .map(|run| RunToken {
            xml: std::borrow::Cow::Owned(strip_text_box_content(&run.xml)),
            ..run.clone()
        })
        .collect();
    let legacy_tokens = parse_legacy_paragraph_form_field_tokens(
        paragraph_xml,
        &story_runs,
        context,
        paragraph_style_id,
        table_run_style,
    );
    let text_box_ranges = extract_balanced_tag_ranges(paragraph_xml, "w:txbxContent");
    let sdt_ranges: Vec<_> = extract_balanced_tag_ranges(paragraph_xml, "w:sdt")
        .into_iter()
        .filter(|range| {
            !text_box_ranges
                .iter()
                .any(|story| range.start >= story.start && range.end <= story.end)
        })
        .collect();
    if sdt_ranges.is_empty() {
        return legacy_tokens;
    }

    let hyperlink_ranges: Vec<_> = extract_balanced_tag_ranges(paragraph_xml, "w:hyperlink")
        .into_iter()
        .map(|range| {
            let hyperlink_xml = &paragraph_xml[range.start..range.end];
            let hyperlink_tag = re::get(r"(?i)<w:hyperlink\b[^>]*>")
                .and_then(|re| re.find(hyperlink_xml))
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            (range, hyperlink_href_from_tag(&hyperlink_tag, context))
        })
        .collect();

    let mut sdt_tokens = Vec::new();
    for range in sdt_ranges {
        let sdt_xml = &paragraph_xml[range.start..range.end];
        let link = hyperlink_ranges
            .iter()
            .find(|(hyperlink_range, href)| {
                range.start >= hyperlink_range.start
                    && range.end <= hyperlink_range.end
                    && href.is_some()
            })
            .and_then(|(_, href)| href.clone());
        if let Some(field) = parse_form_field_from_sdt_xml(
            sdt_xml,
            context,
            paragraph_style_id,
            table_run_style,
            link,
        ) {
            sdt_tokens.push(ParagraphFormFieldToken {
                start: range.start,
                end: range.end,
                field,
            });
        }
    }

    let mut combined = legacy_tokens;
    combined.extend(sdt_tokens);
    combined.sort_by_key(|token| token.start);
    combined
}

fn parse_paragraph_mark_run_style(
    paragraph_xml: &str,
    context: &ParseContext<'_>,
    paragraph_style_id: Option<&str>,
    table_run_style: Option<&TextStyle>,
) -> Option<TextStyle> {
    let paragraph_properties_xml = super::styles::direct_table_property(paragraph_xml, "w:pPr")
        .unwrap_or_default();
    let mark_run_properties_xml =
        crate::xml::extract_direct_child_tag_ranges(&paragraph_properties_xml)
            .into_iter()
            .find(|range| range.tag_name.eq_ignore_ascii_case("w:rPr"))
            .map(|range| &paragraph_properties_xml[range.start..range.end])
            .unwrap_or_default();
    let mut effective_mark_run_properties_xml = std::borrow::Cow::Borrowed(mark_run_properties_xml);
    for range in crate::xml::extract_direct_child_tag_ranges(&mark_run_properties_xml)
        .into_iter()
        .rev()
        .filter(|range| range.tag_name.eq_ignore_ascii_case("w:rPrChange"))
    {
        effective_mark_run_properties_xml.to_mut().replace_range(range.start..range.end, "");
    }
    super::style::parse_mark_run_style(
        &effective_mark_run_properties_xml,
        context,
        paragraph_style_id,
        table_run_style,
    )
}

fn parse_paragraph_mark_formatting(
    source_mark: Option<&str>,
    context: &ParseContext<'_>,
    table_run_style: Option<&TextStyle>,
) -> crate::model::ParagraphMarkFormattingSource {
    let source_mark = source_mark.unwrap_or("<w:rPr/>");
    let mut current = std::borrow::Cow::Borrowed(source_mark);
    for range in crate::xml::extract_direct_child_tag_ranges(source_mark)
        .into_iter()
        .rev()
        .filter(|range| range.tag_name.eq_ignore_ascii_case("w:rPrChange"))
    {
        current.to_mut().replace_range(range.start..range.end, "");
    }
    let character_style = super::styles::direct_table_property(&current, "w:rStyle")
        .and_then(|tag| get_attribute(tag, "w:val"))
        .and_then(|id| context.style_sheet.run_style_by_id.get(&id).cloned());
    crate::model::ParagraphMarkFormattingSource {
        default_style: super::util::merge_text_style_refs(&[
            context.style_sheet.default_run_style.as_ref(),
            table_run_style,
        ]),
        character_style,
        direct_style: super::style::parse_text_style_from_xml(
            &current,
            &context.style_sheet.theme_fonts,
        ),
    }
}

pub fn parse_paragraph(paragraph_xml: &str, context: &ParseContext<'_>) -> ParagraphNode {
    parse_paragraph_in_table(paragraph_xml, context, None)
}

pub fn parse_paragraph_in_table(
    paragraph_xml: &str,
    context: &ParseContext<'_>,
    table_paragraph_spacing: Option<&crate::model::ParagraphSpacing>,
) -> ParagraphNode {
    parse_paragraph_with_table_run_style(paragraph_xml, context, table_paragraph_spacing, None)
}

pub(crate) fn parse_paragraph_with_table_run_style(
    paragraph_xml: &str,
    context: &ParseContext<'_>,
    table_paragraph_spacing: Option<&crate::model::ParagraphSpacing>,
    table_run_style: Option<&TextStyle>,
) -> ParagraphNode {
    let mut children: Vec<ParagraphChildNode> = Vec::new();
    let paragraph_style =
        parse_paragraph_style_in_table(paragraph_xml, context, table_paragraph_spacing);
    let paragraph_mark_style = parse_paragraph_mark_run_style(
        paragraph_xml,
        context,
        paragraph_style
            .as_ref()
            .and_then(|style| style.style_id.as_deref()),
        table_run_style,
    );
    let paragraph_properties_xml = super::styles::direct_table_property(paragraph_xml, "w:pPr")
        .unwrap_or_default();
    let source_paragraph_mark_properties_xml =
        crate::xml::extract_direct_child_tag_ranges(&paragraph_properties_xml)
            .into_iter()
            .find(|range| range.tag_name.eq_ignore_ascii_case("w:rPr"))
            .map(|range| &paragraph_properties_xml[range.start..range.end]);
    let source_paragraph_mark_formatting = parse_paragraph_mark_formatting(
        source_paragraph_mark_properties_xml.as_deref(),
        context,
        table_run_style,
    );
    let paragraph_mark_deleted = source_paragraph_mark_properties_xml
        .as_deref()
        .is_some_and(|xml| super::styles::direct_table_property(xml, "w:del").is_some());
    let runs = paragraph_runs(paragraph_xml, context);
    let form_field_tokens = parse_paragraph_form_field_tokens_in_table(
        paragraph_xml,
        context,
        paragraph_style.as_ref().and_then(|s| s.style_id.as_deref()),
        Some(&runs),
        table_run_style,
    );

    enum ContentToken<'a> {
        Run {
            start: usize,
            token: &'a RunToken<'a>,
        },
        FormField {
            start: usize,
            token: &'a ParagraphFormFieldToken,
        },
        Math {
            start: usize,
            xml: &'a str,
        },
    }

    let mut content_tokens: Vec<ContentToken<'_>> = Vec::new();
    let mut form_field_token_cursor = 0usize;
    for run in &runs {
        while form_field_token_cursor < form_field_tokens.len()
            && form_field_tokens[form_field_token_cursor].end <= run.start
        {
            form_field_token_cursor += 1;
        }
        let current_form_field_token = form_field_tokens.get(form_field_token_cursor);
        let inside_form_field = current_form_field_token
            .is_some_and(|token| run.start >= token.start && run.end <= token.end);
        if inside_form_field {
            continue;
        }
        content_tokens.push(ContentToken::Run {
            start: run.start,
            token: run,
        });
    }
    for form_field_token in &form_field_tokens {
        content_tokens.push(ContentToken::FormField {
            start: form_field_token.start,
            token: form_field_token,
        });
    }
    let text_box_ranges = extract_balanced_tag_ranges(paragraph_xml, "w:txbxContent");
    for range in extract_balanced_tag_ranges(paragraph_xml, "m:oMath") {
        if !text_box_ranges
            .iter()
            .any(|story| range.start >= story.start && range.end <= story.end)
        {
            content_tokens.push(ContentToken::Math {
                start: range.start,
                xml: &paragraph_xml[range.start..range.end],
            });
        }
    }
    content_tokens.sort_by_key(|token| match token {
        ContentToken::Run { start, .. } => *start,
        ContentToken::FormField { start, .. } => *start,
        ContentToken::Math { start, .. } => *start,
    });

    for content_token in content_tokens {
        match content_token {
            ContentToken::Math { xml, .. } => {
                if let Some(math) = super::math::parse_math(xml) {
                    children.push(ParagraphChildNode::Image(math));
                } else {
                    context.push_warning(
                        "Unable to interpret an equation; source markup is preserved",
                    );
                }
            }
            ContentToken::FormField { token, .. } => {
                children.push(ParagraphChildNode::FormField(token.field.clone()));
            }
            ContentToken::Run { token: run, .. } => {
                let style = parse_run_style_in_table(
                    &run.xml,
                    context,
                    paragraph_style.as_ref().and_then(|s| s.style_id.as_deref()),
                    table_run_style,
                );
                if let Some(active_x_field) = super::scan::contains_tag(&run.xml, "w:object").then(|| parse_run_active_x_checkbox_field(
                    &run.xml, context, style.clone(), run.link.clone(),
                )).flatten() {
                    children.push(ParagraphChildNode::FormField(active_x_field));
                    continue;
                }
                let images = parse_run_image_tokens(&run.xml, context);
                // Text boxes own a separate story, including when their drawing
                // renders as a group or cannot be represented as an image.
                let run_xml_for_text = run_text_xml(&run.xml);
                let mut parsed_tokens = parse_run_text_tokens(&run_xml_for_text).into_iter()
                    .filter(|token| !token.text.is_empty() || token.note_reference.is_some()).peekable();
                let mut remaining_style = style;
                let mut ordered_children = Vec::new();
                while let Some(token) = parsed_tokens.next() {
                    ordered_children.push((
                        token.source_start,
                        ParagraphChildNode::Text(TextRunNode {
                            r#type: TextRunNodeType::Text,
                            text: token.text,
                            style: if parsed_tokens.peek().is_none() { remaining_style.take() } else { remaining_style.clone() },
                            link: run
                                .text_links
                                .iter()
                                .rev()
                                .find(|(offset, _)| *offset <= token.source_start)
                                .and_then(|(_, link)| link.clone()),
                            note_reference: token.note_reference,
                        }),
                    ));
                }
                for (source_start, mut image) in images {
                    if let Some(xml) = image.source_xml.as_deref() {
                        let active_xml = prefer_alternate_content_choice(xml);
                        let text_boxes = extract_balanced_tag_blocks(&active_xml, "w:txbxContent");
                        if !text_boxes.is_empty() {
                            image.content_nodes = Some(
                                text_boxes
                                    .iter()
                                    .flat_map(|xml| {
                                        super::document::parse_document_xml(xml, context)
                                    })
                                    .collect(),
                            );
                            image.semantic_kind = Some("text_box".into());
                        }
                    }
                    ordered_children.push((source_start, ParagraphChildNode::Image(image)));
                }
                ordered_children.sort_by_key(|(offset, _)| *offset);
                children.extend(ordered_children.into_iter().map(|(_, child)| child));
            }
        }
    }

    if children.is_empty() {
        // An empty paragraph renders at the line height of its paragraph mark
        // (the pPr>rPr formatting), so the synthetic empty run must carry that
        // style — otherwise spacer paragraphs collapse to the default font size.
        children.push(ParagraphChildNode::Text(TextRunNode {
            r#type: TextRunNodeType::Text,
            text: String::new(),
            style: paragraph_mark_style.clone(),
            link: None,
            note_reference: None,
        }));
    }

    let source_run_provenance = children
        .iter()
        .map(|child| match child {
            ParagraphChildNode::Text(run) => Some(ParagraphSourceTextPatchRun {
                style: run.style.clone(),
                link: run.link.clone(),
                note_reference: run.note_reference.clone(),
            }),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
        .map(|runs| ParagraphSourceTextPatch { runs });

    ParagraphNode {
        r#type: ParagraphNodeType::Paragraph,
        block_id: None,
        style: paragraph_style,
        paragraph_mark_style: paragraph_mark_style.clone(),
        source_paragraph_mark_style: paragraph_mark_style,
        source_paragraph_mark_formatting: Some(source_paragraph_mark_formatting),
        source_paragraph_mark_properties_xml: source_paragraph_mark_properties_xml.map(str::to_owned),
        paragraph_mark_deleted: if paragraph_mark_deleted {
            Some(true)
        } else {
            None
        },
        children,
        source_xml: Some(paragraph_xml.to_string()),
        source_text_patch: None,
        source_run_provenance,
    }
}
