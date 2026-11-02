use std::collections::{BTreeMap, HashMap};

use super::{fmt::escape_xml, DocFile};

pub(super) struct LinkRange {
    pub start: u32,
    pub end: u32,
    pub instruction: String,
}

pub(super) fn spanning_links(doc: &DocFile) -> Vec<LinkRange> {
    let mut links = Vec::new();
    let Some(data) = doc.fib.table_slice(&doc.table, 16) else {
        return links;
    };
    let Some(payload) = data.len().checked_sub(4).filter(|n| n % 6 == 0) else {
        return links;
    };
    let count = payload / 6;
    let mut stack = Vec::<(u32, u8, Option<u32>)>::new();
    for index in 0..count {
        let Some(cp) = u32_at(data, index * 4) else {
            continue;
        };
        if cp >= doc.fib.ccp.text {
            continue;
        }
        let at = (count + 1) * 4 + index * 2;
        match data[at] & 0x1f {
            0x13 => stack.push((cp, data[at + 1], None)),
            0x14 => {
                if let Some(field) = stack.last_mut() {
                    field.2 = Some(cp);
                }
            }
            0x15 => {
                let Some((start, kind, Some(separator))) = stack.pop() else {
                    continue;
                };
                if start >= separator || separator >= cp || separator - start > 65536 {
                    continue;
                }
                let keyword = match kind {
                    0x03 => "REF",
                    0x05 | 0x48 => "NOTEREF",
                    0x25 => "PAGEREF",
                    0x58 => "HYPERLINK",
                    _ => continue,
                };
                if !doc.text(separator + 1, cp).contains(&13) {
                    continue;
                }
                let original = String::from_utf16_lossy(&doc.text(start + 1, separator));
                let original = original.trim_start();
                let split = original
                    .find(|c: char| c.is_whitespace() || c == '"' || c == '\\')
                    .unwrap_or(original.len());
                let tail: String = original[split..]
                    .chars()
                    .filter(|c| *c >= ' ' || matches!(c, '\t' | '\r' | '\n'))
                    .collect();
                links.push(LinkRange {
                    start: separator + 1,
                    end: cp,
                    instruction: format!("{keyword}{tail}"),
                });
            }
            _ => {}
        }
    }
    links
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(at..at.checked_add(2)?)?.try_into().ok()?,
    ))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

fn stories(doc: &DocFile) -> [(usize, u32, u32); 7] {
    let ccp = &doc.fib.ccp;
    [
        (16, 0, ccp.text),
        (17, ccp.hdd_start(), ccp.hdd),
        (18, ccp.ftn_start(), ccp.ftn),
        (
            19,
            ccp.hdd_start()
                .saturating_add(ccp.hdd)
                .saturating_add(ccp.mcr),
            ccp.atn,
        ),
        (48, ccp.edn_start(), ccp.edn),
        (57, ccp.txbx_start(), ccp.txbx),
        (59, ccp.hdr_txbx_start(), ccp.hdr_txbx),
    ]
}

#[derive(Default)]
pub(super) struct FieldText {
    pub instructions: HashMap<u32, String>,
    pub phonetic_results: HashMap<u32, String>,
}

pub(super) fn field_text(doc: &DocFile) -> FieldText {
    let mut result = FieldText::default();
    for (index, base, length) in stories(doc) {
        let Some(data) = doc.fib.table_slice(&doc.table, index) else {
            continue;
        };
        let Some(payload) = data.len().checked_sub(4).filter(|n| n % 6 == 0) else {
            continue;
        };
        let count = payload / 6;
        for field in 0..count.saturating_sub(1) {
            let at = (count + 1) * 4 + field * 2;
            if data[at] & 0x1f != 0x13 {
                continue;
            }
            let keyword = match (data[at + 1], data[at + 2] & 0x1f) {
                (0x03, 0x14) => Some("REF"),
                (0x05 | 0x48, 0x14) => Some("NOTEREF"),
                (0x25, 0x14) => Some("PAGEREF"),
                (0x58, 0x14) => Some("HYPERLINK"),
                (0x31, 0x15) => None,
                _ => continue,
            };
            let Some(start) = u32_at(data, field * 4) else {
                continue;
            };
            let Some(end) = u32_at(data, (field + 1) * 4) else {
                continue;
            };
            if start >= end || end >= length || end - start > 65536 {
                continue;
            }
            let instruction = String::from_utf16_lossy(&doc.text(base + start + 1, base + end));
            let Some(keyword) = keyword else {
                if let Some(text) = phonetic_text(&instruction) {
                    result.phonetic_results.insert(base + end, text);
                }
                continue;
            };
            let instruction = instruction.trim_start();
            let split = instruction
                .find(|c: char| c.is_whitespace() || c == '"' || c == '\\')
                .unwrap_or(instruction.len());
            if instruction[..split].eq_ignore_ascii_case(keyword) {
                continue;
            }
            let tail: String = instruction[split..]
                .chars()
                .filter(|c| *c >= ' ' || matches!(c, '\t' | '\r' | '\n'))
                .collect();
            result
                .instructions
                .insert(base + start, format!("{keyword}{tail}"));
        }
    }
    result
}

fn equation_arguments(input: &str) -> Option<(Vec<&str>, &str)> {
    let input = input.trim_start().strip_prefix('(')?;
    let mut depth = 1usize;
    let mut escaped = false;
    let mut start = 0;
    let mut arguments = Vec::new();
    for (index, character) in input.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    arguments.push(&input[start..index]);
                    return Some((arguments, &input[index + 1..]));
                }
            }
            ',' if depth == 1 => {
                arguments.push(&input[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    None
}

fn equation_literal(input: &str) -> Option<String> {
    let mut output = String::new();
    let mut characters = input.chars();
    while let Some(character) = characters.next() {
        match character {
            '\\' => match characters.next()? {
                escaped @ ('\\' | '(' | ')' | ',') => output.push(escaped),
                _ => return None,
            },
            character if character.is_control() => return None,
            character => output.push(character),
        }
    }
    Some(output)
}

fn phonetic_text(instruction: &str) -> Option<String> {
    static PREFIX: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(
            r#"(?i)^[ \t\r\n]*EQ[ \t\r\n]+(?:\\\*[ \t\r\n]*(?:"[^"]*"|[^ \t\r\n\\()]+)[ \t\r\n]*)*\\o[ \t\r\n]*(?:\\a[dlr][ \t\r\n]*)?"#,
        )
        .expect("valid field grammar")
    });
    static SHIFT: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)^\\s[ \t\r\n]*\\up[ \t\r\n]*[+-]?[0-9]+(?:\.[0-9]+)?[ \t\r\n]*")
            .expect("valid field grammar")
    });
    let prefix = PREFIX.find(instruction)?;
    let (overlay, tail) = equation_arguments(&instruction[prefix.end()..])?;
    if overlay.len() != 2 || !tail.trim().is_empty() {
        return None;
    }
    let raised = overlay[0].trim();
    let shift = SHIFT.find(raised)?;
    let (annotation, tail) = equation_arguments(&raised[shift.end()..])?;
    if annotation.len() != 1 || !tail.trim().is_empty() {
        return None;
    }
    let mut result = equation_literal(annotation[0])?;
    result.push_str(&equation_literal(overlay[1])?);
    Some(result)
}

pub(super) fn bookmarks(doc: &DocFile) -> BTreeMap<u32, String> {
    let mut result = BTreeMap::<u32, String>::new();
    let Some(names) = doc.fib.table_slice(&doc.table, 21) else {
        return result;
    };
    let Some(starts) = doc.fib.table_slice(&doc.table, 22) else {
        return result;
    };
    let Some(ends) = doc.fib.table_slice(&doc.table, 23) else {
        return result;
    };
    if u16_at(names, 0) != Some(0xffff) {
        return result;
    }
    let Some(count) = u16_at(names, 2) else {
        return result;
    };
    let Some(extra) = u16_at(names, 4) else {
        return result;
    };
    let Some(payload) = starts.len().checked_sub(4).filter(|n| n % 8 == 0) else {
        return result;
    };
    let records = payload / 8;
    let mut cursor = 6;
    for index in 0..usize::from(count).min(records) {
        let Some(length) = u16_at(names, cursor) else {
            break;
        };
        cursor += 2;
        let Some(text) = names.get(cursor..cursor + usize::from(length) * 2) else {
            break;
        };
        cursor += text.len() + usize::from(extra);
        let name = String::from_utf16_lossy(
            &text
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect::<Vec<_>>(),
        );
        let Some(start) = u32_at(starts, index * 4) else {
            continue;
        };
        let Some(end_index) = u16_at(starts, (records + 1) * 4 + index * 4) else {
            continue;
        };
        if usize::from(end_index) >= records {
            continue;
        }
        let Some(end) = u32_at(ends, usize::from(end_index) * 4) else {
            continue;
        };
        if name.is_empty() || start > end || end >= doc.fib.ccp.text {
            continue;
        }
        result.entry(start).or_default().push_str(&format!(
            r#"<w:bookmarkStart w:id="{index}" w:name="{}"/>"#,
            escape_xml(&name)
        ));
        result
            .entry(end)
            .or_default()
            .push_str(&format!(r#"<w:bookmarkEnd w:id="{index}"/>"#));
    }
    result
}
