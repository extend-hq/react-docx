use std::collections::HashMap;

use crate::model::{
    NumberingAbstractDefinition, NumberingDefinitionSet, NumberingInstanceDefinition,
    NumberingLevelDefinition, NumberingLevelSuffix, NumberingPictureBulletDefinition,
};
use crate::package::OoxmlPackage;
use super::colors::normalize_hex_color;
use crate::xml::{extract_balanced_tag_blocks, get_attribute, parse_integer_attribute};

use super::context::ContentTypeLookup;
use super::relationships::{bytes_to_base64, content_type_for_part, parse_part_relationships};
use super::scan::{decode_xml_attribute, find_tag_token, starts_with_ignore_ascii_case};
use super::styles::{parse_paragraph_indent_from_xml, parse_text_style_from_xml};

/// Mirrors TypeScript `pointsToPixels`.
pub fn points_to_pixels(points: f64) -> i64 {
    ((points * 96.0) / 72.0).round().max(1.0) as i64
}

/// Mirrors TypeScript `parseCssPointValue`.
pub fn parse_css_point_value(style_value: Option<&str>, css_property: &str) -> Option<i64> {
    let style_value = style_value?;
    let property = css_property.to_ascii_lowercase();
    let mut index = 0;
    let bytes = style_value.as_bytes();

    while index < bytes.len() {
        if starts_with_ignore_ascii_case(&style_value[index..], &property) {
            let mut cursor = index + property.len();
            while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }
            if bytes.get(cursor) != Some(&b':') {
                index += 1;
                continue;
            }
            cursor += 1;
            while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }

            let value_start = cursor;
            let mut value_end = value_start;
            while value_end < bytes.len()
                && (bytes[value_end].is_ascii_digit() || bytes[value_end] == b'.')
            {
                value_end += 1;
            }

            let number_text = &style_value[value_start..value_end];
            if number_text.is_empty() {
                return None;
            }

            if !starts_with_ignore_ascii_case(&style_value[value_end..], "pt") {
                return None;
            }

            let parsed = number_text.parse::<f64>().ok()?;
            if !parsed.is_finite() || parsed <= 0.0 {
                return None;
            }

            return Some(points_to_pixels(parsed));
        }

        index += 1;
    }

    None
}

/// Mirrors TypeScript `parseNumberingPictureBulletDefinitions`.
pub fn parse_numbering_picture_bullet_definitions(
    pkg: &OoxmlPackage,
    numbering_xml: &str,
    content_types: &ContentTypeLookup,
) -> HashMap<i64, NumberingPictureBulletDefinition> {
    let mut picture_bullets = HashMap::new();
    let numbering_relationships = parse_part_relationships(pkg, "word/numbering.xml");

    for num_pic_bullet_xml in extract_balanced_tag_blocks(numbering_xml, "w:numPicBullet") {
        let num_pic_bullet_tag = find_tag_token(&num_pic_bullet_xml, "w:numPicBullet").unwrap_or_default();
        let num_pic_bullet_id = get_attribute(&num_pic_bullet_tag, "w:numPicBulletId")
            .and_then(|raw| raw.parse::<f64>().ok())
            .filter(|value| value.is_finite());
        let Some(num_pic_bullet_id) = num_pic_bullet_id else {
            continue;
        };

        let shape_tag = find_tag_token(&num_pic_bullet_xml, "v:shape");
        let shape_style = shape_tag.as_deref().and_then(|tag| get_attribute(tag, "style"));
        let width_px = parse_css_point_value(shape_style.as_deref(), "width").map(|value| value as f64);
        let height_px =
            parse_css_point_value(shape_style.as_deref(), "height").map(|value| value as f64);

        let image_tag = find_tag_token(&num_pic_bullet_xml, "v:imagedata");
        let relationship_id = image_tag.as_deref().and_then(|tag| get_attribute(tag, "r:id"));
        let image_part_name = relationship_id
            .as_ref()
            .and_then(|id| numbering_relationships.get(id).cloned());
        let image_bytes = image_part_name
            .as_ref()
            .and_then(|part_name| pkg.binary_assets.get(part_name).cloned());
        let image_content_type = image_part_name
            .as_ref()
            .and_then(|part_name| content_type_for_part(part_name, content_types));
        let src = match (&image_part_name, &image_bytes, &image_content_type) {
            (Some(_), Some(bytes), Some(content_type)) => Some(format!(
                "data:{content_type};base64,{}",
                bytes_to_base64(bytes)
            )),
            _ => None,
        };

        picture_bullets.insert(
            num_pic_bullet_id.round() as i64,
            NumberingPictureBulletDefinition {
                num_pic_bullet_id: num_pic_bullet_id.round() as i64,
                src,
                width_px,
                height_px,
                part_name: image_part_name,
                content_type: image_content_type,
            },
        );
    }

    picture_bullets
}

/// Mirrors TypeScript `parseNumberingLevelDefinition`.
pub fn parse_numbering_level_definition(
    level_xml: &str,
    picture_bullets_by_id: &HashMap<i64, NumberingPictureBulletDefinition>,
) -> Option<NumberingLevelDefinition> {
    if level_xml.is_empty() {
        return None;
    }

    let level_tag = find_tag_token(level_xml, "w:lvl").unwrap_or_default();
    let ilvl = get_attribute(&level_tag, "w:ilvl")
        .and_then(|raw| raw.parse::<f64>().ok())
        .filter(|value| value.is_finite())?;

    let start_tag = find_tag_token(level_xml, "w:start");
    let num_fmt_tag = find_tag_token(level_xml, "w:numFmt");
    let lvl_text_tag = find_tag_token(level_xml, "w:lvlText");
    let suffix_tag = find_tag_token(level_xml, "w:suff");
    let level_run_properties_xml = extract_balanced_tag_blocks(level_xml, "w:rPr")
        .into_iter()
        .next()
        .or_else(|| find_tag_token(level_xml, "w:rPr"))
        .unwrap_or_default();
    let level_paragraph_properties_xml = extract_balanced_tag_blocks(level_xml, "w:pPr")
        .into_iter()
        .next()
        .or_else(|| find_tag_token(level_xml, "w:pPr"))
        .unwrap_or_default();
    let level_fonts_tag = find_tag_token(&level_run_properties_xml, "w:rFonts");
    let level_color_tag = find_tag_token(&level_run_properties_xml, "w:color");
    let level_run_style = parse_text_style_from_xml(&level_run_properties_xml, &Default::default());
    let picture_bullet_tag = find_tag_token(level_xml, "w:lvlPicBulletId");
    let suffix_raw = suffix_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:val"))
        .map(|value| value.to_ascii_lowercase());
    let picture_bullet_id = picture_bullet_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:val"))
        .and_then(|raw| raw.parse::<f64>().ok())
        .filter(|value| value.is_finite());

    let bullet_font_family = level_fonts_tag
        .as_deref()
        .and_then(|tag| {
            get_attribute(tag, "w:ascii")
                .or_else(|| get_attribute(tag, "w:hAnsi"))
                .or_else(|| get_attribute(tag, "w:eastAsia"))
                .or_else(|| get_attribute(tag, "w:cs"))
        })
        .and_then(|value| decode_xml_attribute(Some(&value)))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let bullet_color = level_color_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:val"))
        .as_deref()
        .and_then(|value| normalize_hex_color(Some(value)));

    let suffix = match suffix_raw.as_deref() {
        Some("tab") => Some(NumberingLevelSuffix::Tab),
        Some("space") => Some(NumberingLevelSuffix::Space),
        Some("nothing") => Some(NumberingLevelSuffix::Nothing),
        _ => None,
    };

    let indent = if level_paragraph_properties_xml.is_empty() {
        None
    } else {
        parse_paragraph_indent_from_xml(&level_paragraph_properties_xml)
    };

    let rounded_picture_bullet_id = picture_bullet_id.map(|value| value.round() as i64);

    Some(NumberingLevelDefinition {
        ilvl: ilvl.round().max(0.0) as i64,
        start: start_tag
            .as_deref()
            .and_then(|tag| parse_integer_attribute(tag, "w:val")),
        format: num_fmt_tag.as_deref().and_then(|tag| get_attribute(tag, "w:val")),
        text: lvl_text_tag.as_deref().and_then(|tag| get_attribute(tag, "w:val")),
        suffix,
        indent,
        run_style: level_run_style,
        bullet_font_family,
        bullet_color,
        picture_bullet_id: rounded_picture_bullet_id,
        picture_bullet: rounded_picture_bullet_id
            .and_then(|id| picture_bullets_by_id.get(&id).cloned()),
    })
}

/// Mirrors TypeScript `parseNumberingDefinitions`.
pub fn parse_numbering_definitions(
    pkg: &OoxmlPackage,
    content_types: &ContentTypeLookup,
) -> Option<NumberingDefinitionSet> {
    let numbering_xml = pkg.parts.get("word/numbering.xml")?.content.as_str();
    let picture_bullets_by_id =
        parse_numbering_picture_bullet_definitions(pkg, numbering_xml, content_types);

    let parsed_abstracts: Vec<IntermediateAbstractDefinition> =
        extract_balanced_tag_blocks(numbering_xml, "w:abstractNum")
            .into_iter()
            .filter_map(|abstract_xml| {
                let abstract_tag =
                    find_tag_token(&abstract_xml, "w:abstractNum").unwrap_or_default();
                let abstract_num_id = get_attribute(&abstract_tag, "w:abstractNumId")
                    .and_then(|raw| raw.parse::<f64>().ok())
                    .filter(|value| value.is_finite())?;

                let style_link_tag = find_tag_token(&abstract_xml, "w:styleLink");
                let num_style_link_tag = find_tag_token(&abstract_xml, "w:numStyleLink");
                let mut levels: Vec<NumberingLevelDefinition> =
                    extract_balanced_tag_blocks(&abstract_xml, "w:lvl")
                        .into_iter()
                        .filter_map(|level_xml| {
                            parse_numbering_level_definition(&level_xml, &picture_bullets_by_id)
                        })
                        .collect();
                levels.sort_by_key(|level| level.ilvl);

                Some(IntermediateAbstractDefinition {
                    abstract_num_id: abstract_num_id.round() as i64,
                    style_link: style_link_tag
                        .as_deref()
                        .and_then(|tag| get_attribute(tag, "w:val")),
                    num_style_link: num_style_link_tag
                        .as_deref()
                        .and_then(|tag| get_attribute(tag, "w:val")),
                    levels,
                })
            })
            .collect();

    let mut style_linked_levels = HashMap::new();
    for abstract_definition in &parsed_abstracts {
        if let Some(style_link) = abstract_definition.style_link.as_deref() {
            if !abstract_definition.levels.is_empty() {
                style_linked_levels.insert(style_link.to_string(), abstract_definition.levels.clone());
            }
        }
    }

    let abstracts: Vec<NumberingAbstractDefinition> = parsed_abstracts
        .into_iter()
        .map(|abstract_definition| {
            let linked_levels = if !abstract_definition.levels.is_empty() {
                abstract_definition.levels
            } else {
                abstract_definition
                    .num_style_link
                    .as_deref()
                    .and_then(|style_link| style_linked_levels.get(style_link).cloned())
                    .unwrap_or_default()
            };

            NumberingAbstractDefinition {
                abstract_num_id: abstract_definition.abstract_num_id,
                levels: linked_levels,
            }
        })
        .collect();

    let instances: Vec<NumberingInstanceDefinition> =
        extract_balanced_tag_blocks(numbering_xml, "w:num")
            .into_iter()
            .filter_map(|num_xml| {
                let num_tag = find_tag_token(&num_xml, "w:num").unwrap_or_default();
                let num_id = get_attribute(&num_tag, "w:numId")
                    .and_then(|raw| raw.parse::<f64>().ok())
                    .filter(|value| value.is_finite())?;

                let abstract_num_id_tag = find_tag_token(&num_xml, "w:abstractNumId");
                let abstract_num_id = abstract_num_id_tag
                    .as_deref()
                    .and_then(|tag| get_attribute(tag, "w:val"))
                    .and_then(|raw| raw.parse::<f64>().ok())
                    .filter(|value| value.is_finite())?;

                let mut level_start_overrides = HashMap::new();
                let mut level_overrides = Vec::new();

                for override_xml in extract_balanced_tag_blocks(&num_xml, "w:lvlOverride") {
                    let override_tag =
                        find_tag_token(&override_xml, "w:lvlOverride").unwrap_or_default();
                    let override_level = get_attribute(&override_tag, "w:ilvl")
                        .and_then(|raw| raw.parse::<f64>().ok())
                        .filter(|value| value.is_finite())?;

                    let start_override_tag = find_tag_token(&override_xml, "w:startOverride");
                    let start_override = start_override_tag
                        .as_deref()
                        .and_then(|tag| parse_integer_attribute(tag, "w:val"));
                    if let Some(start_override) = start_override.filter(|value| *value > 0) {
                        level_start_overrides
                            .insert(override_level.round().max(0.0) as i64, start_override);
                    }

                    if let Some(level_xml) =
                        extract_balanced_tag_blocks(&override_xml, "w:lvl").into_iter().next()
                    {
                        if let Some(parsed_level) =
                            parse_numbering_level_definition(&level_xml, &picture_bullets_by_id)
                        {
                            level_overrides.push(parsed_level);
                        }
                    }
                }

                Some(NumberingInstanceDefinition {
                    num_id: num_id.round() as i64,
                    abstract_num_id: abstract_num_id.round() as i64,
                    level_start_overrides: if level_start_overrides.is_empty() {
                        None
                    } else {
                        Some(
                            level_start_overrides
                                .into_iter()
                                .map(|(key, value)| (key.to_string(), value))
                                .collect(),
                        )
                    },
                    level_overrides: if level_overrides.is_empty() {
                        None
                    } else {
                        Some(level_overrides)
                    },
                })
            })
            .collect();

    if abstracts.is_empty() && instances.is_empty() {
        return None;
    }

    Some(NumberingDefinitionSet {
        abstracts,
        instances,
    })
}

struct IntermediateAbstractDefinition {
    abstract_num_id: i64,
    style_link: Option<String>,
    num_style_link: Option<String>,
    levels: Vec<NumberingLevelDefinition>,
}
