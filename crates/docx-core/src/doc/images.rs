//! Inline pictures: a run with fSpec and character 0x01 carries
//! sprmCPicLocation, an offset to a PICF structure ([MS-DOC] 2.9.190) in the
//! Data stream. Word 97+ stores the actual bitmap inside an OfficeArt
//! ([MS-ODRAW]) record stream following the PICF header.

#[derive(Debug, Clone)]
pub struct InlineImage {
    pub bytes: Vec<u8>,
    pub extension: &'static str,
    pub content_type: &'static str,
    pub width_emu: u64,
    pub height_emu: u64,
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes
        .get(offset..offset + 2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes
        .get(offset..offset + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

pub fn extract_image(data_stream: &[u8], fc: u32) -> Option<InlineImage> {
    let base = fc as usize;
    let lcb = read_u32(data_stream, base)? as usize;
    let cb_header = read_u16(data_stream, base + 4)? as usize;
    if cb_header < 0x2C || lcb < cb_header {
        return None;
    }
    let mm = read_u16(data_stream, base + 6)?;

    // Display size: dxaGoal/dyaGoal twips scaled by mx/my (per-mille).
    let dxa_goal = read_u16(data_stream, base + 28)? as i64;
    let dya_goal = read_u16(data_stream, base + 30)? as i64;
    let mx = read_u16(data_stream, base + 32)? as i64;
    let my = read_u16(data_stream, base + 34)? as i64;
    let scale = |goal: i64, factor: i64| -> u64 {
        let factor = if factor == 0 { 1000 } else { factor };
        let twips = goal * factor / 1000;
        (twips.max(0) as u64) * 635 // twips -> EMU
    };
    let width_emu = scale(dxa_goal, mx);
    let height_emu = scale(dya_goal, my);

    let payload = data_stream.get(base + cb_header..base + lcb)?;

    // mm 0x64/0x66: OfficeArt inline shape; otherwise legacy metafile storage
    // we do not support.
    if mm != 0x64 && mm != 0x66 {
        return None;
    }

    let (bytes, extension, content_type) = find_blip(payload, 0)?;
    Some(InlineImage {
        bytes,
        extension,
        content_type,
        width_emu,
        height_emu,
    })
}

/// Walks an OfficeArt record stream (descending into containers) until a
/// renderable blip record is found.
fn find_blip(bytes: &[u8], depth: usize) -> Option<(Vec<u8>, &'static str, &'static str)> {
    if depth > 8 {
        return None;
    }
    let mut pos = 0usize;
    while pos + 8 <= bytes.len() {
        let ver_inst = read_u16(bytes, pos)?;
        let rec_type = read_u16(bytes, pos + 2)?;
        let rec_len = read_u32(bytes, pos + 4)? as usize;
        let body_start = pos + 8;
        let is_container = ver_inst & 0x000F == 0x000F;
        let instance = ver_inst >> 4;

        if (0xF018..=0xF117).contains(&rec_type) {
            let body = bytes.get(body_start..(body_start + rec_len).min(bytes.len()))?;
            if let Some(result) = decode_blip(rec_type, instance, body) {
                return Some(result);
            }
        } else if rec_type == 0xF007 {
            // OfficeArtFBSE: 36-byte header, embedded blip may follow.
            if rec_len > 36 {
                let body = bytes.get(body_start + 36..(body_start + rec_len).min(bytes.len()))?;
                if let Some(result) = find_blip(body, depth + 1) {
                    return Some(result);
                }
            }
        } else if is_container {
            let body = bytes.get(body_start..(body_start + rec_len).min(bytes.len()))?;
            if let Some(result) = find_blip(body, depth + 1) {
                return Some(result);
            }
        }
        pos = body_start + rec_len;
    }
    None
}

fn decode_blip(
    rec_type: u16,
    instance: u16,
    body: &[u8],
) -> Option<(Vec<u8>, &'static str, &'static str)> {
    // Tagged bitmap blips: N UIDs (16 bytes each) + 1 tag byte + data. The
    // "+1" instance variant carries a second UID.
    let tagged = |base_instance: u16,
                  extension: &'static str,
                  content_type: &'static str|
     -> Option<(Vec<u8>, &'static str, &'static str)> {
        let uid_count = if instance == base_instance + 1 { 2 } else { 1 };
        let data_start = uid_count * 16 + 1;
        let data = body.get(data_start..)?;
        if data.is_empty() {
            return None;
        }
        Some((data.to_vec(), extension, content_type))
    };

    match rec_type {
        0xF01D => tagged(0x46A, "jpeg", "image/jpeg"),
        0xF02A => tagged(0x6E2, "jpeg", "image/jpeg"), // JPEG (CMYK variant record)
        0xF01E => tagged(0x6E0, "png", "image/png"),
        0xF029 => tagged(0x6E4, "tiff", "image/tiff"),
        0xF01F => {
            // DIB: BMP without the 14-byte file header; reconstruct it.
            let uid_count = if instance == 0x7A9 { 2 } else { 1 };
            let data_start = uid_count * 16 + 1;
            let dib = body.get(data_start..)?;
            Some((dib_to_bmp(dib)?, "bmp", "image/bmp"))
        }
        // EMF/WMF/PICT (0xF01A-0xF01C) are not browser-renderable; skip.
        _ => None,
    }
}

fn dib_to_bmp(dib: &[u8]) -> Option<Vec<u8>> {
    let bi_size = read_u32(dib, 0)? as usize;
    if bi_size < 40 || dib.len() < bi_size {
        return None;
    }
    let bit_count = read_u16(dib, 14)? as usize;
    let clr_used = read_u32(dib, 32)? as usize;
    let palette_entries = if clr_used != 0 {
        clr_used
    } else if bit_count <= 8 {
        1usize << bit_count
    } else {
        0
    };
    let pixel_offset = 14 + bi_size + palette_entries * 4;

    let mut bmp = Vec::with_capacity(14 + dib.len());
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&((14 + dib.len()) as u32).to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&(pixel_offset as u32).to_le_bytes());
    bmp.extend_from_slice(dib);
    Some(bmp)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_picf_with_png(png: &[u8]) -> Vec<u8> {
        // Escher: OfficeArtSpContainer (0xF004) wrapping a PNG blip (0xF01E).
        let mut blip = Vec::new();
        blip.extend_from_slice(&((0x6E0u16 << 4) | 0x0).to_le_bytes());
        blip.extend_from_slice(&0xF01Eu16.to_le_bytes());
        blip.extend_from_slice(&((16 + 1 + png.len()) as u32).to_le_bytes());
        blip.extend_from_slice(&[0u8; 16]); // UID
        blip.push(0xFF); // tag
        blip.extend_from_slice(png);

        let mut container = Vec::new();
        container.extend_from_slice(&0x000Fu16.to_le_bytes());
        container.extend_from_slice(&0xF004u16.to_le_bytes());
        container.extend_from_slice(&(blip.len() as u32).to_le_bytes());
        container.extend_from_slice(&blip);

        let cb_header = 0x44usize;
        let mut picf = vec![0u8; cb_header];
        let lcb = (cb_header + container.len()) as u32;
        picf[..4].copy_from_slice(&lcb.to_le_bytes());
        picf[4..6].copy_from_slice(&(cb_header as u16).to_le_bytes());
        picf[6..8].copy_from_slice(&0x64u16.to_le_bytes()); // mm = MM_SHAPE
        picf[28..30].copy_from_slice(&1440u16.to_le_bytes()); // dxaGoal 1 inch
        picf[30..32].copy_from_slice(&720u16.to_le_bytes()); // dyaGoal 0.5 inch
        picf[32..34].copy_from_slice(&1000u16.to_le_bytes()); // mx
        picf[34..36].copy_from_slice(&500u16.to_le_bytes()); // my -> 0.25 inch
        picf.extend_from_slice(&container);
        picf
    }

    #[test]
    fn extracts_png_blip_with_scaling() {
        let png = b"\x89PNG\r\n\x1a\nfakepngdata";
        let data_stream = build_picf_with_png(png);
        let image = extract_image(&data_stream, 0).expect("image");
        assert_eq!(image.extension, "png");
        assert_eq!(image.bytes, png);
        assert_eq!(image.width_emu, 1440 * 635);
        assert_eq!(image.height_emu, 360 * 635);
    }

    #[test]
    fn rejects_unsupported_storage() {
        let mut picf = vec![0u8; 0x44];
        picf[..4].copy_from_slice(&0x44u32.to_le_bytes());
        picf[4..6].copy_from_slice(&0x44u16.to_le_bytes());
        picf[6..8].copy_from_slice(&0x08u16.to_le_bytes());
        assert!(extract_image(&picf, 0).is_none());
    }
}
