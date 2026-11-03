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

    let payload = if mm == 0x66 {
        payload.get(1 + usize::from(*payload.first()?)..)?
    } else {
        payload
    };
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
                let name_len = usize::from(*bytes.get(body_start + 33)?);
                let body = bytes.get(body_start + 36 + name_len..body_start + rec_len)?;
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
        0xF01A | 0xF01B => {
            let base_instance = if rec_type == 0xF01A { 0x3D4 } else { 0x216 };
            let offset = if instance == base_instance + 1 {
                32
            } else {
                16
            };
            let size = read_u32(body, offset)? as usize;
            if size > 64 * 1024 * 1024 {
                return None;
            }
            let saved = read_u32(body, offset + 28)? as usize;
            let data = body.get(offset + 34..offset + 34 + saved)?;
            let data = match *body.get(offset + 32)? {
                0 => miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(data, size).ok()?,
                0xFE => data.to_vec(),
                _ => return None,
            };
            if data.len() != size {
                return None;
            }
            let (extension, mime) = if rec_type == 0xF01A {
                ("emf", "image/x-emf")
            } else {
                ("wmf", "image/x-wmf")
            };
            Some((data, extension, mime))
        }
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

pub(super) struct FloatingImage {
    pub anchor: super::textboxes::Spa,
    pub image: InlineImage,
    pub tiled: bool,
}

type Blip = (Vec<u8>, &'static str, &'static str);

fn records(mut bytes: &[u8]) -> impl Iterator<Item = (u16, u16, &[u8])> {
    std::iter::from_fn(move || {
        let header = read_u16(bytes, 0)?;
        let kind = read_u16(bytes, 2)?;
        let len = read_u32(bytes, 4)? as usize;
        let body = bytes.get(8..8usize.checked_add(len)?)?;
        bytes = &bytes[8 + len..];
        Some((header, kind, body))
    })
}

fn bstore(bytes: &[u8], word: &[u8], depth: usize, blips: &mut Vec<Option<Blip>>) {
    if depth > 16 {
        return;
    }
    for (header, kind, body) in records(bytes) {
        if kind == 0xF007 {
            let image = body
                .get(33)
                .and_then(|name_len| find_blip(body.get(36 + usize::from(*name_len)..)?, 0))
                .or_else(|| {
                    let offset = read_u32(body, 28)? as usize;
                    let (header, kind, body) = records(word.get(offset..)?).next()?;
                    decode_blip(kind, header >> 4, body)
                });
            blips.push(image);
        } else if header & 15 == 15 {
            bstore(body, word, depth + 1, blips);
        }
    }
}

fn picture_shapes(
    bytes: &[u8],
    depth: usize,
    pictures: &mut std::collections::HashMap<u32, (usize, bool)>,
) {
    if depth > 16 {
        return;
    }
    for (header, kind, body) in records(bytes) {
        if kind == 0xF004 {
            let mut id = None;
            let mut pib = None;
            let mut fill = None;
            let mut fill_type = 0;
            for (header, kind, data) in records(body) {
                match kind {
                    0xF00A => id = read_u32(data, 0),
                    0xF00B | 0xF121 | 0xF122 => {
                        for property in data.chunks_exact(6).take((header >> 4) as usize) {
                            let op = read_u16(property, 0).unwrap_or(0);
                            if op & 0xBFFF == 0x0104 {
                                pib = read_u32(property, 2).and_then(|v| v.checked_sub(1));
                            } else if op & 0xBFFF == 0x0186 {
                                fill = read_u32(property, 2).and_then(|v| v.checked_sub(1));
                            } else if op == 0x0180 {
                                fill_type = read_u32(property, 2).unwrap_or(0);
                            }
                        }
                    }
                    _ => {}
                }
            }
            if let (Some(id), Some((index, tiled))) = (
                id,
                pib.map(|p| (p, false))
                    .or_else(|| fill.map(|p| (p, matches!(fill_type, 1 | 2)))),
            ) {
                pictures.insert(id, (index as usize, tiled));
            }
        } else if header & 15 == 15 {
            picture_shapes(body, depth + 1, pictures);
        }
    }
}

fn shape_anchor(
    bytes: &[u8],
    parent: Option<(super::textboxes::Spa, [i32; 4])>,
    anchors: &mut std::collections::HashMap<u32, super::textboxes::Spa>,
) -> Option<super::textboxes::Spa> {
    let id = records(bytes)
        .find(|r| r.1 == 0xF00A)
        .and_then(|r| read_u32(r.2, 0))?;
    if let Some(anchor) = anchors.get(&id) {
        return Some(*anchor);
    }
    let (mut anchor, bounds) = parent?;
    let child = records(bytes).find(|r| r.1 == 0xF00F)?.2;
    let rect: Vec<i32> = child
        .chunks_exact(4)
        .take(4)
        .map(|b| i32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    if rect.len() != 4 {
        return None;
    }
    let map = |value: i32, origin: i32, end: i32, target: i32, target_end: i32| -> Option<i32> {
        let extent = i64::from(end) - i64::from(origin);
        if extent == 0 {
            return None;
        }
        let delta = (i128::from(value) - i128::from(origin))
            * (i128::from(target_end) - i128::from(target));
        i32::try_from(i128::from(target) + delta / i128::from(extent)).ok()
    };
    let left = map(rect[0], bounds[0], bounds[2], anchor.left, anchor.right)?;
    let right = map(rect[2], bounds[0], bounds[2], anchor.left, anchor.right)?;
    let top = map(rect[1], bounds[1], bounds[3], anchor.top, anchor.bottom)?;
    let bottom = map(rect[3], bounds[1], bounds[3], anchor.top, anchor.bottom)?;
    anchor.shape_id = id;
    anchor.left = left;
    anchor.right = right;
    anchor.top = top;
    anchor.bottom = bottom;
    anchors.insert(id, anchor);
    Some(anchor)
}

fn group_anchors(
    bytes: &[u8],
    depth: usize,
    parent: Option<(super::textboxes::Spa, [i32; 4])>,
    anchors: &mut std::collections::HashMap<u32, super::textboxes::Spa>,
) {
    if depth > 16 {
        return;
    }
    for (header, kind, body) in records(bytes) {
        if kind == 0xF003 {
            let group = records(body).find(|r| r.1 == 0xF004).map(|r| r.2);
            let frame = group.and_then(|group| {
                let anchor = shape_anchor(group, parent, anchors)?;
                let bounds = records(group).find(|r| r.1 == 0xF009)?.2;
                let mut rect = [0i32; 4];
                for (index, value) in rect.iter_mut().enumerate() {
                    *value = read_u32(bounds, index * 4)? as i32;
                }
                Some((anchor, rect))
            });
            group_anchors(body, depth + 1, frame, anchors);
        } else if kind == 0xF004 {
            shape_anchor(body, parent, anchors);
        } else if header & 15 == 15 {
            group_anchors(body, depth + 1, parent, anchors);
        }
    }
}

pub(super) fn shape_anchors(
    doc: &super::DocFile,
    header: bool,
) -> std::collections::HashMap<u32, super::textboxes::Spa> {
    use super::fib::fcidx;
    let (index, base, len) = if header {
        (
            fcidx::PLCF_SPA_HDR,
            doc.fib.ccp.hdd_start(),
            doc.fib.ccp.hdd,
        )
    } else {
        (fcidx::PLCF_SPA_MOM, 0, doc.fib.ccp.text)
    };
    let spas = doc
        .fib
        .table_slice(&doc.table, index)
        .and_then(|plc| super::textboxes::parse_spas(plc, base, len).ok())
        .unwrap_or_default();
    let mut anchors = spas.into_iter().map(|spa| (spa.shape_id, spa)).collect();
    let Some(data) = doc.fib.table_slice(&doc.table, fcidx::DGG_INFO) else {
        return anchors;
    };
    let Some((_, _, global)) = records(data).next() else {
        return anchors;
    };
    let mut cursor = 8 + global.len();
    while let Some(&story) = data.get(cursor) {
        cursor += 1;
        let Some((_, kind, drawing)) = records(&data[cursor..]).next() else {
            break;
        };
        cursor += 8 + drawing.len();
        if kind != 0xF002 {
            break;
        }
        if story == u8::from(header) {
            group_anchors(drawing, 0, None, &mut anchors);
        }
    }
    anchors
}

pub(super) fn floating_images(doc: &super::DocFile) -> Vec<FloatingImage> {
    use super::fib::fcidx;
    let Some(data) = doc.fib.table_slice(&doc.table, fcidx::DGG_INFO) else {
        return Vec::new();
    };
    let Some((_, kind, global)) = records(data).next() else {
        return Vec::new();
    };
    if kind != 0xF000 {
        return Vec::new();
    }
    let mut blips = Vec::new();
    bstore(global, &doc.word, 0, &mut blips);
    let mut cursor = 8 + global.len();
    let mut images = Vec::new();
    while let Some(&story) = data.get(cursor) {
        cursor += 1;
        let Some((_, kind, drawing)) = records(&data[cursor..]).next() else {
            break;
        };
        cursor += 8 + drawing.len();
        if kind != 0xF002 {
            break;
        }
        if story > 1 {
            continue;
        }
        let anchors = shape_anchors(doc, story == 1);
        let mut pictures = std::collections::HashMap::new();
        picture_shapes(drawing, 0, &mut pictures);
        for anchor in anchors.into_values() {
            let Some(&(index, tiled)) = pictures.get(&anchor.shape_id) else {
                continue;
            };
            let Some(Some((bytes, extension, content_type))) = blips.get(index) else {
                continue;
            };
            let width = i64::from(anchor.right) - i64::from(anchor.left);
            let height = i64::from(anchor.bottom) - i64::from(anchor.top);
            if width <= 0 || height <= 0 {
                continue;
            }
            images.push(FloatingImage {
                anchor,
                tiled,
                image: InlineImage {
                    bytes: bytes.clone(),
                    extension,
                    content_type,
                    width_emu: width as u64 * 635,
                    height_emu: height as u64 * 635,
                },
            });
        }
    }
    images.sort_by_key(|image| (image.anchor.anchor_cp, image.anchor.shape_id));
    images
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
