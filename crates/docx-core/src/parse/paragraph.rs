use crate::model::{
    FormFieldCheckboxSizeMode, FormFieldCheckboxWidgetSettings, FormFieldDropdownWidgetSettings,
    FormFieldOption, FormFieldRunNode, FormFieldRunNodeType, FormFieldSourceKind, FormFieldTextWidgetSettings,
    FormFieldType, FormFieldWidgetSettings, NoteReference, NoteReferenceKind, ParagraphChildNode,
    ParagraphNode, ParagraphNodeType, TextRunNode, TextRunNodeType, TextStyle,
};
use crate::parse::context::ParseContext;
use crate::parse::re;
use crate::parse::images::parse_run_images;
use crate::parse::style::{parse_paragraph_style_in_table, parse_run_style};
use crate::parse::util::{
    decode_hex_code_point, decode_xml_attribute, normalize_legacy_form_display_value,
    on_off_value_to_boolean, parse_on_off_tag_value, parse_relationships_from_parts, prefer_alternate_content_choice,
    strip_text_box_content,
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
}

#[derive(Clone, Debug)]
pub struct ParsedRunTextToken {
    pub text: String,
    pub note_reference: Option<NoteReference>,
}

pub fn parse_run_text_tokens(run_xml: &str) -> Vec<ParsedRunTextToken> {
    let normalized_run_xml = prefer_alternate_content_choice(run_xml);
    let token_pattern = re::get_unchecked(
        r#"(?is)<w:t\b[^>]*>([\s\S]*?)</w:t>|<a:t\b[^>]*>([\s\S]*?)</a:t>|<w:footnoteReference\b[^>]*w:id="(-?\d+)"[^>]*/>|<w:endnoteReference\b[^>]*w:id="(-?\d+)"[^>]*/>|<w:tab\b[^>]*/>|<a:tab\b[^>]*/>|<w:br\b[^>]*/>|<w:cr\b[^>]*/>|<a:br\b[^>]*/>|</w:p>"#,
    );
    let mut parts = Vec::new();
    for caps in token_pattern.captures_iter(&normalized_run_xml) {
        if let Some(m) = caps.get(1) {
            parts.push(ParsedRunTextToken {
                text: decode_xml_entities(m.as_str()),
                note_reference: None,
            });
            continue;
        }
        if let Some(m) = caps.get(2) {
            parts.push(ParsedRunTextToken {
                text: decode_xml_entities(m.as_str()),
                note_reference: None,
            });
            continue;
        }
        if let Some(m) = caps.get(3) {
            let reference_id: i64 = m.as_str().parse().unwrap_or(0);
            if reference_id > 0 {
                parts.push(ParsedRunTextToken {
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
            if reference_id > 0 {
                parts.push(ParsedRunTextToken {
                    text: String::new(),
                    note_reference: Some(NoteReference {
                        kind: NoteReferenceKind::Endnote,
                        id: reference_id,
                    }),
                });
            }
            continue;
        }
        let marker = caps.get(0).map(|m| m.as_str().to_ascii_lowercase()).unwrap_or_default();
        if marker == "</w:p>" {
            parts.push(ParsedRunTextToken {
                text: "\n".to_string(),
                note_reference: None,
            });
        } else if marker.starts_with("<w:tab") || marker.starts_with("<a:tab") {
            parts.push(ParsedRunTextToken {
                text: "\t".to_string(),
                note_reference: None,
            });
        } else {
            parts.push(ParsedRunTextToken {
                text: "\n".to_string(),
                note_reference: None,
            });
        }
    }
    parts
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
        return Some(if target.contains('#') {
            target.to_string()
        } else {
            format!("{target}#{anchor}")
        });
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
    let instruction = decode_xml_entities(raw_instruction)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if !re::get_unchecked(r"(?i)\bHYPERLINK\b").is_match(&instruction) {
        return None;
    }
    let anchor_match = re::get(r#"(?i)\\l\s+"([^"]+)""#)
        .and_then(|re| re.captures(&instruction))
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
    let explicit_target_match = re::get(r#"(?i)\bHYPERLINK\b\s+(?:"([^"]+)"|([^\s\\]+))"#)
        .and_then(|re| re.captures(&instruction))
        .and_then(|c| c.get(1).or_else(|| c.get(2)).map(|m| m.as_str().to_string()));
    if let Some(target) = explicit_target_match {
        if let Some(ref anchor) = anchor_match {
            if !target.contains('#') {
                return Some(format!("{target}#{anchor}"));
            }
        }
        return Some(target);
    }
    anchor_match.map(|a| format!("#{a}"))
}

pub fn parse_paragraph_runs(paragraph_xml: &str, context: &ParseContext<'_>) -> Vec<ParagraphRunToken> {
    let run_ranges = extract_balanced_tag_ranges(paragraph_xml, "w:r");
    if run_ranges.is_empty() {
        return Vec::new();
    }

    let hyperlink_ranges: Vec<_> = extract_balanced_tag_ranges(paragraph_xml, "w:hyperlink")
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

    let mut field_links_by_run: std::collections::HashMap<usize, String> = std::collections::HashMap::new();
    let mut field_depth = 0i64;
    let mut instruction_parts: Vec<String> = Vec::new();
    let mut active_field_link: Option<String> = None;

    for (run_index, range) in run_ranges.iter().enumerate() {
        let run_xml = &paragraph_xml[range.start..range.end];
        let begin_count = re::get(r#"(?i)<w:fldChar\b[^>]*w:fldCharType="begin"[^>]*/?>"#)
            .map(|re| re.find_iter(run_xml).count())
            .unwrap_or(0) as i64;
        let separate_count = re::get(r#"(?i)<w:fldChar\b[^>]*w:fldCharType="separate"[^>]*/?>"#)
            .map(|re| re.find_iter(run_xml).count())
            .unwrap_or(0) as i64;
        let end_count = re::get(r#"(?i)<w:fldChar\b[^>]*w:fldCharType="end"[^>]*/?>"#)
            .map(|re| re.find_iter(run_xml).count())
            .unwrap_or(0) as i64;

        if begin_count > 0 && field_depth == 0 {
            instruction_parts.clear();
            active_field_link = None;
        }
        field_depth += begin_count;

        if field_depth > 0 && active_field_link.is_none() {
            let instr_re = re::get_unchecked(r"(?is)<w:instrText\b[^>]*>([\s\S]*?)</w:instrText>");
            for caps in instr_re.captures_iter(run_xml) {
                if let Some(m) = caps.get(1) {
                    instruction_parts.push(m.as_str().to_string());
                }
            }
        }

        if field_depth > 0 && active_field_link.is_none() && separate_count > 0 {
            active_field_link = hyperlink_href_from_field_instruction(&instruction_parts.join(" "));
        }

        if field_depth > 0 {
            if let Some(ref link) = active_field_link {
                if re::get(r"(?i)<(?:w:t|a:t)\b").is_some_and(|re| re.is_match(run_xml))
                    || re::get(r"(?i)<w:(?:drawing|pict)\b")
                        .is_some_and(|re| re.is_match(run_xml))
                {
                    field_links_by_run.insert(run_index, link.clone());
                }
            }
        }

        if end_count > 0 {
            field_depth = (field_depth - end_count).max(0);
            if field_depth == 0 {
                instruction_parts.clear();
                active_field_link = None;
            }
        }
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
            let link = hyperlink_href.or_else(|| field_links_by_run.get(&run_index).cloned());
            ParagraphRunToken {
                xml: paragraph_xml[range.start..range.end].to_string(),
                start: range.start,
                end: range.end,
                link,
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
    if !re::get(r#"(?i)input\s+type\s*=\s*"checkbox""#)
        .is_some_and(|re| re.is_match(&markup))
    {
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
    runs: &[ParagraphRunToken],
    context: &ParseContext<'_>,
    paragraph_style_id: Option<&str>,
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
    let fallback_result_text = normalize_legacy_form_display_value(
        Some(&result_runs.iter().map(|r| parse_run_text(&r.xml)).collect::<String>()),
    );
    let style_run_xml = result_runs
        .iter()
        .find(|run| {
            !parse_run_text(&run.xml).trim().is_empty()
                || re::get(r"(?i)<w:sym\b").is_some_and(|re| re.is_match(&run.xml))
        })
        .or_else(|| runs.get(start_run_index))
        .map(|r| r.xml.as_str());
    let style = style_run_xml.and_then(|xml| parse_run_style(xml, context, paragraph_style_id));
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
                .and_then(|xml| extract_balanced_tag_blocks(xml, "w:checkBox").into_iter().next())
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
            let checked = parse_on_off_tag_value(checked_tag.as_deref(), &["w:val"]).or(default_checked);
            let size_value = size_tag.as_deref().and_then(|t| parse_integer_attribute(t, "w:val"));
            let size_pt = size_value.filter(|v| *v > 0).map(|v| ((v as f64) / 2.0 * 100.0).round() / 100.0);
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
                .and_then(|xml| extract_balanced_tag_blocks(xml, "w:ddList").into_iter().next())
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
                options: if options.is_empty() { None } else { Some(options) },
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
                .and_then(|xml| extract_balanced_tag_blocks(xml, "w:textInput").into_iter().next())
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
    runs: &[ParagraphRunToken],
    context: &ParseContext<'_>,
    paragraph_style_id: Option<&str>,
) -> Vec<ParagraphFormFieldToken> {
    if runs.is_empty() {
        return Vec::new();
    }
    let mut tokens = Vec::new();
    let mut stack: Vec<(
        usize,
        Option<usize>,
        Vec<String>,
        Option<String>,
    )> = Vec::new();
    let inline_token_pattern = re::get_unchecked(
        r#"(?is)<w:fldChar\b[^>]*\bw:fldCharType="(begin|separate|end)"[^>]*>([\s\S]*?)</w:fldChar>|<w:fldChar\b[^>]*\bw:fldCharType="(begin|separate|end)"[^>]*/>|<w:instrText\b[^>]*>([\s\S]*?)</w:instrText>"#,);

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
    let style = first_run_xml
        .as_deref()
        .and_then(|xml| parse_run_style(xml, context, paragraph_style_id));
    let content_text = parse_run_text(&sdt_content_xml);
    let trimmed_content_text = content_text.trim();

    if re::get(r"(?i)<w14:checkbox\b")
        .is_some_and(|re| re.is_match(&sdt_properties_xml))
    {
        let checked_tag = re::get(r"(?i)<w14:checked\b[^>]*/?>")
            .and_then(|re| re.find(&sdt_properties_xml))
            .map(|m| m.as_str().to_string());
        let checked_value = checked_tag.as_deref().and_then(|tag| {
            get_attribute(tag, "w14:val").or_else(|| get_attribute(tag, "w:val"))
        });
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
                    value: value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()),
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
            options: if options.is_empty() { None } else { Some(options) },
            widget: None,
            checked_symbol: None,
            unchecked_symbol: None,
            style,
            link,
            source_xml: Some(sdt_xml.to_string()),
        });
    }

    if re::get(r"(?i)<w:date\b")
        .is_some_and(|re| re.is_match(&sdt_properties_xml))
    {
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

    if re::get(r"(?i)<w:(?:text|richText)\b")
        .is_some_and(|re| re.is_match(&sdt_properties_xml))
    {
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
    let paragraph_runs: Vec<ParagraphRunToken> = runs
        .map(|r| r.to_vec())
        .unwrap_or_else(|| parse_paragraph_runs(paragraph_xml, context));
    let legacy_tokens =
        parse_legacy_paragraph_form_field_tokens(paragraph_xml, &paragraph_runs, context, paragraph_style_id);
    let sdt_ranges = extract_balanced_tag_ranges(paragraph_xml, "w:sdt");
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
        if let Some(field) = parse_form_field_from_sdt_xml(sdt_xml, context, paragraph_style_id, link) {
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
) -> Option<TextStyle> {
    let paragraph_properties_xml = extract_balanced_tag_blocks(paragraph_xml, "w:pPr")
        .into_iter()
        .next()
        .unwrap_or_default();
    let mark_run_properties_xml = extract_balanced_tag_blocks(&paragraph_properties_xml, "w:rPr")
        .into_iter()
        .next()
        .unwrap_or_default();
    let synthetic_mark_run_xml = format!("<w:r>{}</w:r>", mark_run_properties_xml);
    parse_run_style(&synthetic_mark_run_xml, context, paragraph_style_id)
}

pub fn parse_paragraph(paragraph_xml: &str, context: &ParseContext<'_>) -> ParagraphNode {
    parse_paragraph_in_table(paragraph_xml, context, None)
}

pub fn parse_paragraph_in_table(
    paragraph_xml: &str,
    context: &ParseContext<'_>,
    table_paragraph_spacing: Option<&crate::model::ParagraphSpacing>,
) -> ParagraphNode {
    let mut children: Vec<ParagraphChildNode> = Vec::new();
    let paragraph_style =
        parse_paragraph_style_in_table(paragraph_xml, context, table_paragraph_spacing);
    let paragraph_mark_deleted = re::get_unchecked(r"(?is)<w:pPr\b[\s\S]*?<w:rPr\b[\s\S]*?<w:del\b").is_match(paragraph_xml);
    let runs = parse_paragraph_runs(paragraph_xml, context);
    let form_field_tokens = parse_paragraph_form_field_tokens(
        paragraph_xml,
        context,
        paragraph_style.as_ref().and_then(|s| s.style_id.as_deref()),
        Some(&runs),
    );

    enum ContentToken<'a> {
        Run { start: usize, token: &'a ParagraphRunToken },
        FormField { start: usize, token: &'a ParagraphFormFieldToken },
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
        let inside_form_field = current_form_field_token.is_some_and(|token| {
            run.start >= token.start && run.end <= token.end
        });
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
    content_tokens.sort_by_key(|token| match token {
        ContentToken::Run { start, .. } => *start,
        ContentToken::FormField { start, .. } => *start,
    });

    for content_token in content_tokens {
        match content_token {
            ContentToken::FormField { token, .. } => {
                children.push(ParagraphChildNode::FormField(token.field.clone()));
            }
            ContentToken::Run { token: run, .. } => {
                let style = parse_run_style(
                    &run.xml,
                    context,
                    paragraph_style.as_ref().and_then(|s| s.style_id.as_deref()),
                );
                if let Some(active_x_field) =
                    parse_run_active_x_checkbox_field(&run.xml, context, style.clone(), run.link.clone())
                {
                    children.push(ParagraphChildNode::FormField(active_x_field));
                    continue;
                }
                let images = parse_run_images(&run.xml, context);
                let run_xml_for_text = if images.iter().any(|image| image.synthetic_text_box.unwrap_or(false)) {
                    strip_text_box_content(&run.xml)
                } else {
                    run.xml.clone()
                };
                let parsed_tokens = parse_run_text_tokens(&run_xml_for_text);
                for token in parsed_tokens {
                    if token.text.is_empty() && token.note_reference.is_none() {
                        continue;
                    }
                    children.push(ParagraphChildNode::Text(TextRunNode {
                        r#type: TextRunNodeType::Text,
                        text: token.text,
                        style: style.clone(),
                        link: run.link.clone(),
                        note_reference: token.note_reference,
                    }));
                }
                for image in images {
                    children.push(ParagraphChildNode::Image(image));
                }
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
            style: parse_paragraph_mark_run_style(
                paragraph_xml,
                context,
                paragraph_style.as_ref().and_then(|s| s.style_id.as_deref()),
            ),
            link: None,
            note_reference: None,
        }));
    }

    ParagraphNode {
        r#type: ParagraphNodeType::Paragraph,
        style: paragraph_style,
        paragraph_mark_deleted: if paragraph_mark_deleted { Some(true) } else { None },
        children,
        source_xml: Some(paragraph_xml.to_string()),
    }
}
