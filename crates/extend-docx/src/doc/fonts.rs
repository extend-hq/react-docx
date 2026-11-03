//! Font table (SttbfFfn, [MS-DOC] 2.9.281): maps the ftc indices used by
//! character sprms to font names.

pub struct FontTable {
    names: Vec<String>,
}

impl FontTable {
    pub fn empty() -> FontTable {
        FontTable { names: Vec::new() }
    }

    pub fn parse(sttbf_ffn: &[u8]) -> FontTable {
        let mut names = Vec::new();
        let mut pos;

        let read_u16 = |bytes: &[u8], offset: usize| -> Option<u16> {
            bytes
                .get(offset..offset + 2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        };

        let Some(first) = read_u16(sttbf_ffn, 0) else {
            return FontTable { names };
        };
        let count;
        if first == 0xFFFF {
            count = read_u16(sttbf_ffn, 2).unwrap_or(0) as usize;
            pos = 6; // marker + cData + cbExtra
        } else {
            count = first as usize;
            pos = 4; // cData + cbExtra
        }

        for _ in 0..count {
            let Some(&cb_ffn_m1) = sttbf_ffn.get(pos) else {
                break;
            };
            let entry_end = pos + 1 + cb_ffn_m1 as usize;
            let Some(entry) = sttbf_ffn.get(pos + 1..entry_end) else {
                break;
            };
            // FFN fixed header after the size byte: detail flags (1), wWeight
            // (2), chs (1), ixchSzAlt (1), panose (10), fs (24) = 39 bytes,
            // then the UTF-16 null-terminated primary name.
            const NAME_OFFSET: usize = 39;
            let mut name = String::new();
            let mut offset = NAME_OFFSET;
            while offset + 2 <= entry.len() {
                let unit = u16::from_le_bytes([entry[offset], entry[offset + 1]]);
                if unit == 0 {
                    break;
                }
                name.push_str(&String::from_utf16_lossy(&[unit]));
                offset += 2;
            }
            names.push(name);
            pos = entry_end;
        }

        FontTable { names }
    }

    pub fn name(&self, ftc: u16) -> Option<String> {
        self.names
            .get(ftc as usize)
            .filter(|name| !name.is_empty())
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ffn_entry(name: &str) -> Vec<u8> {
        let mut body = vec![0u8; 39];
        for unit in name.encode_utf16() {
            body.extend_from_slice(&unit.to_le_bytes());
        }
        body.extend_from_slice(&0u16.to_le_bytes());
        let mut entry = vec![body.len() as u8];
        entry.extend_from_slice(&body);
        entry
    }

    #[test]
    fn parses_font_names() {
        let mut sttbf = Vec::new();
        sttbf.extend_from_slice(&0xFFFFu16.to_le_bytes());
        sttbf.extend_from_slice(&2u16.to_le_bytes());
        sttbf.extend_from_slice(&0u16.to_le_bytes());
        sttbf.extend_from_slice(&ffn_entry("Times New Roman"));
        sttbf.extend_from_slice(&ffn_entry("Arial"));

        let table = FontTable::parse(&sttbf);
        assert_eq!(table.name(0).as_deref(), Some("Times New Roman"));
        assert_eq!(table.name(1).as_deref(), Some("Arial"));
        assert_eq!(table.name(9), None);
    }
}
