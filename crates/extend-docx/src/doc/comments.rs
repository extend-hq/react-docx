use super::{fib::fcidx, DocFile};

pub(super) struct Comment {
    pub reference_cp: u32,
    pub text_start: u32,
    pub text_end: u32,
    pub author: String,
    pub initials: String,
}

fn u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

pub(super) fn xst(bytes: &[u8], offset: usize) -> Option<(String, usize)> {
    let count = u16_at(bytes, offset)? as usize;
    let end = offset.checked_add(2 + count * 2)?;
    let units = bytes
        .get(offset + 2..end)?
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .collect::<Vec<_>>();
    Some((String::from_utf16_lossy(&units), end))
}

pub(super) fn parse(doc: &DocFile) -> Vec<Comment> {
    let Some(refs) = doc.fib.table_slice(&doc.table, fcidx::PLCFAND_REF) else {
        return Vec::new();
    };
    let Some(text) = doc.fib.table_slice(&doc.table, fcidx::PLCFAND_TXT) else {
        return Vec::new();
    };
    let Some(payload) = refs.len().checked_sub(4).filter(|n| n % 34 == 0) else {
        return Vec::new();
    };
    let count = payload / 34;
    let owners = doc
        .fib
        .table_slice(&doc.table, fcidx::GRP_XST_ATN_OWNERS)
        .unwrap_or_default();
    let mut authors = Vec::new();
    let mut offset = 0;
    while let Some((author, end)) = xst(owners, offset) {
        authors.push(author);
        offset = end;
    }
    let base = doc
        .fib
        .ccp
        .hdd_start()
        .saturating_add(doc.fib.ccp.hdd)
        .saturating_add(doc.fib.ccp.mcr);
    (0..count)
        .filter_map(|index| {
            let reference_cp = u32_at(refs, index * 4)?;
            let start = u32_at(text, index * 4)?;
            let end = u32_at(text, (index + 1) * 4)?;
            if reference_cp >= doc.fib.ccp.text || start > end || end > doc.fib.ccp.atn {
                return None;
            }
            let atrd = (count + 1) * 4 + index * 30;
            let initials = xst(refs.get(atrd..atrd + 20)?, 0)
                .map(|v| v.0)
                .unwrap_or_default();
            let author = authors
                .get(u16_at(refs, atrd + 20)? as usize)
                .cloned()
                .unwrap_or_default();
            Some(Comment {
                reference_cp,
                text_start: base + start,
                text_end: base + end,
                author,
                initials,
            })
        })
        .collect()
}
