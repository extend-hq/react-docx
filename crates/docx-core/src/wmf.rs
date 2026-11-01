//! Bounded playback of opaque bitmap previews with solid fills and rectangular
//! clipping. Unsupported drawing operations reject the entire conversion.

use std::fmt::Write as _;

fn u16_at(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset.checked_add(2)?)?.try_into().ok()?,
    ))
}

fn i16_at(bytes: &[u8], offset: usize) -> Option<i16> {
    u16_at(bytes, offset).map(|value| value as i16)
}

fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset.checked_add(4)?)?.try_into().ok()?,
    ))
}

fn rgb(bytes: &[u8]) -> Option<u32> {
    Some(
        (u32::from(*bytes.get(2)?) << 16)
            | (u32::from(*bytes.get(1)?) << 8)
            | u32::from(*bytes.first()?),
    )
}

struct Bitmap {
    width: usize,
    height: usize,
    pixels: Vec<u32>,
}

fn decode_dib(bytes: &[u8]) -> Option<Bitmap> {
    if u32_at(bytes, 0)? != 40 || u16_at(bytes, 12)? != 1 || u32_at(bytes, 16)? != 0 {
        return None;
    }
    let width = u32_at(bytes, 4)? as i32;
    let signed_height = u32_at(bytes, 8)? as i32;
    let height = signed_height.checked_abs()? as usize;
    if width <= 0 || height == 0 {
        return None;
    }
    let width = width as usize;
    let count = width.checked_mul(height)?;
    if width > 4096 || height > 4096 || count > 65_536 {
        return None;
    }
    let bits = usize::from(u16_at(bytes, 14)?);
    if !matches!(bits, 1 | 4 | 8 | 24) {
        return None;
    }
    let colors_used = u32_at(bytes, 32)? as usize;
    let palette_size = if bits < 24 {
        if colors_used == 0 {
            1usize << bits
        } else {
            colors_used
        }
    } else {
        if colors_used != 0 {
            return None;
        }
        0
    };
    if bits < 24 && palette_size > 1usize << bits {
        return None;
    }
    let palette_end = 40usize.checked_add(palette_size.checked_mul(4)?)?;
    let palette_bytes = bytes.get(40..palette_end)?;
    let palette: Vec<u32> = palette_bytes
        .chunks_exact(4)
        .map(rgb)
        .collect::<Option<_>>()?;
    let stride = width
        .checked_mul(bits)?
        .checked_add(31)?
        .checked_div(32)?
        .checked_mul(4)?;
    let image_bytes = stride.checked_mul(height)?;
    if bytes.len() != palette_end.checked_add(image_bytes)? {
        return None;
    }
    let pixels_bytes = &bytes[palette_end..];
    let mut pixels = Vec::with_capacity(count);
    for y in 0..height {
        let stored_y = if signed_height > 0 { height - y - 1 } else { y };
        let row = pixels_bytes.get(stored_y * stride..(stored_y + 1) * stride)?;
        for x in 0..width {
            let color = match bits {
                24 => rgb(row.get(x * 3..x * 3 + 3)?)?,
                8 => *palette.get(usize::from(*row.get(x)?))?,
                4 => *palette.get(usize::from((row.get(x / 2)? >> (4 - (x % 2) * 4)) & 15))?,
                1 => *palette.get(usize::from((row.get(x / 8)? >> (7 - x % 8)) & 1))?,
                _ => return None,
            };
            pixels.push(color);
        }
    }
    Some(Bitmap {
        width,
        height,
        pixels,
    })
}

#[derive(Clone, Copy)]
struct Rect {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

impl Rect {
    fn intersect(self, other: Self) -> Self {
        let left = self.left.max(other.left);
        let top = self.top.max(other.top);
        Self {
            left,
            top,
            right: self.right.min(other.right).max(left),
            bottom: self.bottom.min(other.bottom).max(top),
        }
    }
}

#[derive(Clone)]
struct Context {
    anisotropic: bool,
    window_origin: Option<(f64, f64)>,
    window_extent: Option<(f64, f64)>,
    viewport_origin: (f64, f64),
    viewport_extent: (f64, f64),
    brush: Option<u32>,
    clip: Rect,
}

impl Context {
    fn matrix(&self) -> Option<(f64, f64, f64, f64)> {
        if !self.anisotropic {
            return None;
        }
        let (window_x, window_y) = self.window_origin?;
        let (window_width, window_height) = self.window_extent?;
        let sx = self.viewport_extent.0 / window_width;
        let sy = self.viewport_extent.1 / window_height;
        Some((
            sx,
            sy,
            self.viewport_origin.0 - window_x * sx,
            self.viewport_origin.1 - window_y * sy,
        ))
    }

    fn mapped_rect(&self, left: f64, top: f64, right: f64, bottom: f64) -> Option<Rect> {
        let (sx, sy, tx, ty) = self.matrix()?;
        let (x1, x2) = (left * sx + tx, right * sx + tx);
        let (y1, y2) = (top * sy + ty, bottom * sy + ty);
        Some(Rect {
            left: x1.min(x2),
            top: y1.min(y2),
            right: x1.max(x2),
            bottom: y1.max(y2),
        })
    }
}

fn pair(payload: &[u8]) -> Option<(f64, f64)> {
    if payload.len() != 4 {
        return None;
    }
    Some((
        f64::from(i16_at(payload, 2)?),
        f64::from(i16_at(payload, 0)?),
    ))
}

fn begin_drawing(
    output: &mut String,
    definitions: &mut String,
    context: &Context,
    index: usize,
) -> Option<()> {
    let clip = context.clip;
    let (sx, sy, tx, ty) = context.matrix()?;
    write!(definitions, "<clipPath id=\"c{index}\" clipPathUnits=\"userSpaceOnUse\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"/></clipPath>", clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top).ok()?;
    write!(
        output,
        "<g clip-path=\"url(#c{index})\"><g transform=\"matrix({sx} 0 0 {sy} {tx} {ty})\">"
    )
    .ok()?;
    Some(())
}

pub(crate) fn wmf_bitmap_preview_to_svg(bytes: &[u8]) -> Option<String> {
    if u32_at(bytes, 0)? != 0x9ac6_cdd7 || u16_at(bytes, 4)? != 0 || u32_at(bytes, 16)? != 0 {
        return None;
    }
    let mut checksum = 0;
    for offset in (0..20).step_by(2) {
        checksum ^= u16_at(bytes, offset)?;
    }
    if checksum != u16_at(bytes, 20)? {
        return None;
    }
    let width = i32::from(i16_at(bytes, 10)?) - i32::from(i16_at(bytes, 6)?);
    let height = i32::from(i16_at(bytes, 12)?) - i32::from(i16_at(bytes, 8)?);
    let units = u16_at(bytes, 14)?;
    if width <= 0 || height <= 0 || units == 0 {
        return None;
    }
    let header = bytes.get(22..40)?;
    if !matches!(u16_at(header, 0)?, 1 | 2)
        || u16_at(header, 2)? != 9
        || u16_at(header, 4)? != 0x0300
        || u16_at(header, 16)? != 0
    {
        return None;
    }
    let length = (u32_at(header, 6)? as usize)
        .checked_mul(2)?
        .checked_add(22)?;
    if length != bytes.len() {
        return None;
    }
    let object_count = usize::from(u16_at(header, 10)?);
    let maximum_record = u32_at(header, 12)? as usize;
    if object_count > 1024 || maximum_record < 3 {
        return None;
    }
    let width = f64::from(width);
    let height = f64::from(height);
    let mut context = Context {
        anisotropic: false,
        window_origin: None,
        window_extent: None,
        viewport_origin: (0.0, 0.0),
        viewport_extent: (width, height),
        brush: None,
        clip: Rect {
            left: 0.0,
            top: 0.0,
            right: width,
            bottom: height,
        },
    };
    let mut brushes = vec![None; object_count];
    let mut saved = Vec::new();
    let mut definitions = String::new();
    let mut output = String::new();
    let mut offset = 40;
    let mut records = 0usize;
    let mut drawings = 0usize;
    let mut bitmaps = 0usize;
    let mut ended = false;
    while offset < length {
        records += 1;
        if records > 4096 {
            return None;
        }
        let words = u32_at(bytes, offset)? as usize;
        if words < 3 || words > maximum_record {
            return None;
        }
        let end = offset.checked_add(words.checked_mul(2)?)?;
        let payload = bytes.get(offset.checked_add(6)?..end)?;
        let function = u16_at(bytes, offset + 4)?;
        offset = end;
        match function {
            0x0000 => {
                if !payload.is_empty() || offset != length || !saved.is_empty() {
                    return None;
                }
                ended = true;
                break;
            }
            0x0103 => {
                if payload.len() != 2 || u16_at(payload, 0)? != 8 {
                    return None;
                }
                context.anisotropic = true;
            }
            0x020b => context.window_origin = Some(pair(payload)?),
            0x020c => {
                let extent = pair(payload)?;
                if extent.0 == 0.0 || extent.1 == 0.0 {
                    return None;
                }
                context.window_extent = Some(extent);
            }
            0x020d => context.viewport_origin = pair(payload)?,
            0x020e => {
                let extent = pair(payload)?;
                if extent.0 == 0.0 || extent.1 == 0.0 {
                    return None;
                }
                context.viewport_extent = extent;
            }
            0x001e => {
                if !payload.is_empty() || saved.len() >= 64 {
                    return None;
                }
                saved.push(context.clone());
            }
            0x0127 => {
                if payload.len() != 2 || i16_at(payload, 0)? != -1 {
                    return None;
                }
                context = saved.pop()?;
            }
            0x02fc => {
                if payload.len() != 8 || u16_at(payload, 0)? != 0 {
                    return None;
                }
                let color = u32_at(payload, 2)?;
                if color >> 24 != 0 {
                    return None;
                }
                let rgb = ((color & 255) << 16) | (color & 0xff00) | ((color >> 16) & 255);
                *brushes.iter_mut().find(|brush| brush.is_none())? = Some(rgb);
            }
            0x012d => {
                if payload.len() != 2 {
                    return None;
                }
                context.brush = Some((*brushes.get(usize::from(u16_at(payload, 0)?))?)?);
            }
            0x0201 => {
                if payload.len() != 4 {
                    return None;
                }
            }
            0x0102 => {
                if !matches!(payload.len(), 2 | 4) || !matches!(u16_at(payload, 0)?, 1 | 2) {
                    return None;
                }
            }
            0x012e => {
                if !matches!(payload.len(), 2 | 4) {
                    return None;
                }
            }
            0x0149 => return None,
            0x0416 => {
                if payload.len() != 8 {
                    return None;
                }
                let clip = context.mapped_rect(
                    f64::from(i16_at(payload, 6)?),
                    f64::from(i16_at(payload, 4)?),
                    f64::from(i16_at(payload, 2)?),
                    f64::from(i16_at(payload, 0)?),
                )?;
                context.clip = context.clip.intersect(clip);
            }
            0x061d => {
                if payload.len() != 12 {
                    return None;
                }
                let color = match u32_at(payload, 0)? {
                    0x00f0_0021 => context.brush?,
                    0x0000_0042 => 0,
                    0x00ff_0062 => 0xff_ffff,
                    _ => return None,
                };
                let h = i32::from(i16_at(payload, 4)?);
                let w = i32::from(i16_at(payload, 6)?);
                let y = i32::from(i16_at(payload, 8)?);
                let x = i32::from(i16_at(payload, 10)?);
                if w <= 0 || h <= 0 {
                    return None;
                }
                begin_drawing(&mut output, &mut definitions, &context, drawings)?;
                write!(output, "<rect x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" fill=\"#{color:06x}\"/></g></g>").ok()?;
                drawings += 1;
            }
            0x0940 => {
                if u32_at(payload, 0)? != 0x00cc_0020
                    || i16_at(payload, 4)? != 0
                    || i16_at(payload, 6)? != 0
                {
                    return None;
                }
                let h = i16_at(payload, 8)?;
                let w = i16_at(payload, 10)?;
                let y = i32::from(i16_at(payload, 12)?);
                let x = i32::from(i16_at(payload, 14)?);
                if h <= 0 || w <= 0 {
                    return None;
                }
                let bitmap = decode_dib(payload.get(16..)?)?;
                if bitmap.width != w as usize || bitmap.height != h as usize {
                    return None;
                }
                begin_drawing(&mut output, &mut definitions, &context, drawings)?;
                for row in 0..bitmap.height {
                    let pixels = &bitmap.pixels[row * bitmap.width..(row + 1) * bitmap.width];
                    let mut column = 0;
                    while column < bitmap.width {
                        let color = pixels[column];
                        let end = pixels[column..]
                            .iter()
                            .position(|pixel| *pixel != color)
                            .map_or(bitmap.width, |offset| column + offset);
                        write!(output, "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"1\" fill=\"#{color:06x}\"/>", x + column as i32, y + row as i32, end - column).ok()?;
                        column = end;
                    }
                }
                output.push_str("</g></g>");
                drawings += 1;
                bitmaps += 1;
            }
            _ => return None,
        }
        if output.len() > 8 * 1024 * 1024 {
            return None;
        }
    }
    if !ended || bitmaps == 0 {
        return None;
    }
    Some(format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {width} {height}\"><defs>{definitions}</defs>{output}</svg>", width * 96.0 / f64::from(units), height * 96.0 / f64::from(units)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(function: u16, payload: &[u8]) -> Vec<u8> {
        assert_eq!(payload.len() % 2, 0);
        let mut output = (((payload.len() + 6) / 2) as u32).to_le_bytes().to_vec();
        output.extend(function.to_le_bytes());
        output.extend(payload);
        output
    }

    fn words(values: &[i16]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect()
    }

    fn dib(bits: u16, height: i32, colors: &[u32], rows: &[u8]) -> Vec<u8> {
        let mut bytes = 40u32.to_le_bytes().to_vec();
        bytes.extend(2i32.to_le_bytes());
        bytes.extend(height.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(bits.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        bytes.extend((rows.len() as u32).to_le_bytes());
        bytes.extend([0; 8]);
        bytes.extend((colors.len() as u32).to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        for color in colors {
            bytes.extend([*color as u8, (*color >> 8) as u8, (*color >> 16) as u8, 0]);
        }
        bytes.extend(rows);
        bytes
    }

    fn rgb_dib() -> Vec<u8> {
        dib(
            24,
            2,
            &[],
            &[255, 0, 0, 255, 255, 255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0],
        )
    }

    fn blit(bitmap: &[u8]) -> Vec<u8> {
        let mut payload = 0x00cc_0020u32.to_le_bytes().to_vec();
        payload.extend(words(&[0, 0, 2, 2, 0, 0]));
        payload.extend(bitmap);
        record(0x0940, &payload)
    }

    fn metafile(middle: &[Vec<u8>]) -> Vec<u8> {
        let mut records = vec![
            record(0x0103, &words(&[8])),
            record(0x020b, &words(&[0, 0])),
            record(0x020c, &words(&[2, 2])),
        ];
        records.extend_from_slice(middle);
        records.push(record(0, &[]));
        let mut bytes = 0x9ac6_cdd7u32.to_le_bytes().to_vec();
        bytes.extend(words(&[0, 0, 0, 2, 2, 96]));
        bytes.extend([0; 4]);
        let checksum = (0..20)
            .step_by(2)
            .fold(0, |value, offset| value ^ u16_at(&bytes, offset).unwrap());
        bytes.extend(checksum.to_le_bytes());
        bytes.extend(words(&[1, 9, 0x0300]));
        bytes.extend(((18 + records.iter().map(Vec::len).sum::<usize>()) as u32 / 2).to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend((records.iter().map(Vec::len).max().unwrap() as u32 / 2).to_le_bytes());
        bytes.extend(0u16.to_le_bytes());
        for record in records {
            bytes.extend(record);
        }
        bytes
    }

    #[test]
    fn opaque_rgb_dib_preserves_bgr_rows_and_padding() {
        let bitmap = decode_dib(&rgb_dib()).unwrap();
        assert_eq!(bitmap.pixels, [0xff0000, 0x00ff00, 0x0000ff, 0xffffff]);
        let top_down = dib(
            24,
            -2,
            &[],
            &[0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0],
        );
        assert_eq!(decode_dib(&top_down).unwrap().pixels, bitmap.pixels);
        let mut stale_size = rgb_dib();
        stale_size[20..24].copy_from_slice(&999u32.to_le_bytes());
        assert_eq!(decode_dib(&stale_size).unwrap().pixels, bitmap.pixels);
        let svg = wmf_bitmap_preview_to_svg(&metafile(&[blit(&rgb_dib())])).unwrap();
        assert!(svg.contains("x=\"0\" y=\"0\" width=\"1\" height=\"1\" fill=\"#ff0000\""));
        assert!(svg.contains("x=\"0\" y=\"1\" width=\"1\" height=\"1\" fill=\"#0000ff\""));
    }

    #[test]
    fn indexed_dibs_use_rgb_palettes_and_most_significant_bits_first() {
        let colors = [0xff0000, 0x0000ff];
        for (bits, rows) in [
            (1, vec![0x80, 0, 0, 0, 0x40, 0, 0, 0]),
            (4, vec![0x10, 0, 0, 0, 0x01, 0, 0, 0]),
            (8, vec![1, 0, 0, 0, 0, 1, 0, 0]),
        ] {
            assert_eq!(
                decode_dib(&dib(bits, 2, &colors, &rows)).unwrap().pixels,
                [0xff0000, 0x0000ff, 0x0000ff, 0xff0000]
            );
        }
        assert!(decode_dib(&dib(8, 2, &colors, &[2, 0, 0, 0, 0, 0, 0, 0])).is_none());
    }

    #[test]
    fn source_copy_and_solid_pattern_fills_preserve_draw_order() {
        let brush = record(0x02fc, &[0, 0, 255, 255, 255, 0, 0, 0]);
        let select = record(0x012d, &words(&[0]));
        let mut fill = 0x00f0_0021u32.to_le_bytes().to_vec();
        fill.extend(words(&[2, 2, 0, 0]));
        let svg = wmf_bitmap_preview_to_svg(&metafile(&[
            brush.clone(),
            select,
            record(0x061d, &fill),
            blit(&rgb_dib()),
        ]))
        .unwrap();
        assert!(
            svg.find("height=\"2\" fill=\"#ffffff\"").unwrap()
                < svg.find("fill=\"#ff0000\"").unwrap()
        );
        assert!(wmf_bitmap_preview_to_svg(&metafile(&[
            brush,
            record(0x061d, &fill),
            blit(&rgb_dib())
        ]))
        .is_none());
        let mut unsupported = blit(&rgb_dib());
        unsupported[6..10].copy_from_slice(&0x0066_0046u32.to_le_bytes());
        assert!(wmf_bitmap_preview_to_svg(&metafile(&[unsupported])).is_none());
    }

    #[test]
    fn clipping_and_saved_mapping_remain_local_to_each_draw() {
        let svg = wmf_bitmap_preview_to_svg(&metafile(&[
            record(0x001e, &[]),
            record(0x0416, &words(&[1, 1, 0, 0])),
            record(0x020d, &words(&[1, 1])),
            record(0x020e, &words(&[4, -4])),
            blit(&rgb_dib()),
            record(0x0127, &words(&[-1])),
            blit(&rgb_dib()),
        ]))
        .unwrap();
        assert!(svg.contains("matrix(-2 0 0 2 1 1)"));
        assert!(svg.contains("matrix(1 0 0 1 0 0)"));
        assert!(svg.contains("id=\"c0\" clipPathUnits=\"userSpaceOnUse\"><rect x=\"0\" y=\"0\" width=\"1\" height=\"1\""));
        assert!(svg.contains("id=\"c1\" clipPathUnits=\"userSpaceOnUse\"><rect x=\"0\" y=\"0\" width=\"2\" height=\"2\""));
    }

    #[test]
    fn optional_reserved_state_words_do_not_change_opaque_bitmap_pixels() {
        let direct = wmf_bitmap_preview_to_svg(&metafile(&[blit(&rgb_dib())])).unwrap();
        let with_state = wmf_bitmap_preview_to_svg(&metafile(&[
            record(0x0201, &[255, 255, 255, 0]),
            record(0x012e, &words(&[0, 0])),
            record(0x0102, &words(&[1, 0])),
            record(0x001e, &[]),
            blit(&rgb_dib()),
            record(0x0127, &words(&[-1])),
        ]))
        .unwrap();
        assert_eq!(direct, with_state);
    }

    #[test]
    fn nondefault_layout_rejects_asymmetric_bitmap_playback() {
        let direct = wmf_bitmap_preview_to_svg(&metafile(&[blit(&rgb_dib())])).unwrap();
        assert!(direct.contains("x=\"0\" y=\"0\" width=\"1\" height=\"1\" fill=\"#ff0000\""));
        assert!(direct.contains("x=\"1\" y=\"0\" width=\"1\" height=\"1\" fill=\"#00ff00\""));
        for layout in [1, 2, 4, 8] {
            assert!(wmf_bitmap_preview_to_svg(&metafile(&[
                record(0x0149, &words(&[layout, 0])),
                blit(&rgb_dib()),
            ]))
            .is_none());
        }
        let text_alignment = wmf_bitmap_preview_to_svg(&metafile(&[
            record(0x012e, &words(&[1, 0])),
            blit(&rgb_dib()),
        ]))
        .unwrap();
        assert_eq!(direct, text_alignment);
    }

    #[test]
    fn malformed_or_unsupported_input_never_returns_partial_artwork() {
        let valid = metafile(&[blit(&rgb_dib())]);
        for length in [0, 20, 22, 39, valid.len() - 1] {
            assert!(wmf_bitmap_preview_to_svg(&valid[..length]).is_none());
        }
        let mut bad_checksum = valid.clone();
        bad_checksum[20] ^= 1;
        assert!(wmf_bitmap_preview_to_svg(&bad_checksum).is_none());
        let mut bad_record = valid.clone();
        bad_record[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(wmf_bitmap_preview_to_svg(&bad_record).is_none());
        for extra in [
            record(0x0415, &words(&[1, 1, 0, 0])),
            record(0x001e, &[]),
            record(0x0214, &words(&[1, 1])),
        ] {
            assert!(wmf_bitmap_preview_to_svg(&metafile(&[blit(&rgb_dib()), extra])).is_none());
        }
        let mut cropped = blit(&rgb_dib());
        cropped[12..14].copy_from_slice(&1i16.to_le_bytes());
        assert!(wmf_bitmap_preview_to_svg(&metafile(&[cropped])).is_none());
        let mut compressed = rgb_dib();
        compressed[16..20].copy_from_slice(&1u32.to_le_bytes());
        assert!(decode_dib(&compressed).is_none());
    }
}
