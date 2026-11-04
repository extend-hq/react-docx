use super::{comments::xst, fmt::escape_xml, sprm};

pub(super) fn authors(table: &[u8]) -> Vec<String> {
    if table.len() < 6 || table[..2] != [0xff, 0xff] {
        return Vec::new();
    }
    let count = u16::from_le_bytes([table[2], table[3]]);
    let extra = u16::from_le_bytes([table[4], table[5]]) as usize;
    let mut pos = 6;
    let mut names = Vec::new();
    for _ in 0..count {
        if table.get(pos..pos + 2) == Some(&[0xff, 0xff]) {
            names.push(String::new());
            pos += 2 + extra;
            continue;
        }
        let Some((name, end)) = xst(table, pos) else {
            break;
        };
        names.push(name);
        pos = end + extra;
    }
    names
}

#[derive(Default)]
pub(super) struct Mark {
    author: Option<usize>,
    date: Option<u32>,
}

impl Mark {
    pub fn open(&self, tag: &str, id: u32, authors: &[String]) -> String {
        let mut xml = format!(r#"<w:{tag} w:id="{id}""#);
        if let Some(author) = self
            .author
            .and_then(|i| authors.get(i))
            .filter(|s| !s.is_empty())
        {
            xml.push_str(&format!(r#" w:author="{}""#, escape_xml(author)));
        }
        if let Some(date) = self.date.and_then(date_time) {
            xml.push_str(&format!(r#" w:date="{date}""#));
        }
        xml.push('>');
        xml
    }
}

fn date_time(value: u32) -> Option<String> {
    let minute = value & 63;
    let hour = value >> 6 & 31;
    let day = value >> 11 & 31;
    let month = value >> 16 & 15;
    let year = 1900 + (value >> 20 & 511);
    (minute < 60 && hour < 24 && (1..=31).contains(&day) && (1..=12).contains(&month))
        .then(|| format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:00"))
}

pub(super) fn marks(properties: &[u8], deleted: bool) -> (Option<Mark>, Option<Mark>) {
    if !deleted && memchr::memmem::find(properties, &[0x01, 0x08]).is_none() {
        return (None, None);
    }
    let mut inserted = false;
    let (mut ins, mut del) = (Mark::default(), Mark::default());
    for p in sprm::iterate(properties) {
        match p.opcode {
            0x0801 => match p.byte() {
                0 => inserted = false,
                1 => inserted = true,
                0x81 => inserted = !inserted,
                _ => {}
            },
            0x4804 => ins.author = usize::try_from(p.i16_operand()).ok(),
            0x6805 => ins.date = Some(p.u32_operand()),
            0x4863 => del.author = usize::try_from(p.i16_operand()).ok(),
            0x6864 => del.date = Some(p.u32_operand()),
            _ => {}
        }
    }
    (inserted.then_some(ins), deleted.then_some(del))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_persisted_revision_metadata_without_inventing_a_zone() {
        let names = authors(&[255, 255, 2, 0, 0, 0, 0, 0, 1, 0, 65, 0]);
        let date = ((2025u32 - 1900) << 20) | (12 << 16) | (31 << 11) | (16 << 6) | 35;
        let mut chpx = vec![0x01, 0x08, 1, 0x04, 0x48, 1, 0, 0x05, 0x68];
        chpx.extend_from_slice(&date.to_le_bytes());
        let (insertion, deletion) = marks(&chpx, false);
        assert!(deletion.is_none());
        assert_eq!(
            insertion.unwrap().open("ins", 8, &names),
            r#"<w:ins w:id="8" w:author="A" w:date="2025-12-31T16:35:00">"#
        );
        assert!(date_time(0).is_none());
    }
}
