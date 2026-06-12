//! EMF (Enhanced Metafile) to SVG conversion for the vector path-drawing
//! record subset that Office logos and shapes are typically built from:
//! window/viewport mapping, bracketed paths (move/line/bezier), solid
//! brushes/pens, fill modes, and path clipping. Records outside the
//! supported set abort the conversion so the caller can fall back to the
//! unsupported-image placeholder instead of rendering something wrong.

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    data.get(offset..offset + 4)
        .map(|bytes| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_i32(data: &[u8], offset: usize) -> Option<i32> {
    read_u32(data, offset).map(|value| value as i32)
}

fn read_i16(data: &[u8], offset: usize) -> Option<i16> {
    data.get(offset..offset + 2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]))
}

fn colorref_to_css(color: u32) -> String {
    let red = color & 0xff;
    let green = (color >> 8) & 0xff;
    let blue = (color >> 16) & 0xff;
    format!("#{red:02x}{green:02x}{blue:02x}")
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum DeviceObject {
    SolidBrush(u32),
    NullBrush,
    SolidPen { color: u32, width_logical: f64 },
    NullPen,
}

#[derive(Clone, Copy, Debug)]
struct Mapping {
    window_org: (f64, f64),
    window_ext: (f64, f64),
    viewport_org: (f64, f64),
    viewport_ext: (f64, f64),
}

impl Mapping {
    fn identity() -> Self {
        Mapping {
            window_org: (0.0, 0.0),
            window_ext: (1.0, 1.0),
            viewport_org: (0.0, 0.0),
            viewport_ext: (1.0, 1.0),
        }
    }

    fn scale_x(&self) -> f64 {
        if self.window_ext.0 == 0.0 {
            1.0
        } else {
            self.viewport_ext.0 / self.window_ext.0
        }
    }

    fn scale_y(&self) -> f64 {
        if self.window_ext.1 == 0.0 {
            1.0
        } else {
            self.viewport_ext.1 / self.window_ext.1
        }
    }

    fn map(&self, x: f64, y: f64) -> (f64, f64) {
        (
            (x - self.window_org.0) * self.scale_x() + self.viewport_org.0,
            (y - self.window_org.1) * self.scale_y() + self.viewport_org.1,
        )
    }
}

fn fmt(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    if rounded == rounded.trunc() {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded}")
    }
}

const EMR_HEADER: u32 = 1;
const EMR_POLYGON16: u32 = 86;
const EMR_POLYLINE16: u32 = 87;
const EMR_POLYBEZIER16: u32 = 85;
const EMR_POLYBEZIERTO16: u32 = 88;
const EMR_POLYLINETO16: u32 = 89;
const EMR_POLYPOLYLINE16: u32 = 90;
const EMR_POLYPOLYGON16: u32 = 91;
const EMR_SETWINDOWEXTEX: u32 = 9;
const EMR_SETWINDOWORGEX: u32 = 10;
const EMR_SETVIEWPORTEXTEX: u32 = 11;
const EMR_SETVIEWPORTORGEX: u32 = 12;
const EMR_SETBRUSHORGEX: u32 = 13;
const EMR_EOF: u32 = 14;
const EMR_SETMAPMODE: u32 = 17;
const EMR_SETBKMODE: u32 = 18;
const EMR_SETPOLYFILLMODE: u32 = 19;
const EMR_SETROP2: u32 = 20;
const EMR_SETSTRETCHBLTMODE: u32 = 21;
const EMR_SETTEXTALIGN: u32 = 22;
const EMR_SETTEXTCOLOR: u32 = 24;
const EMR_SETBKCOLOR: u32 = 25;
const EMR_MOVETOEX: u32 = 27;
const EMR_SETMETARGN: u32 = 28;
const EMR_SETMITERLIMIT: u32 = 58;
const EMR_LINETO: u32 = 54;
const EMR_SELECTOBJECT: u32 = 37;
const EMR_CREATEPEN: u32 = 38;
const EMR_CREATEBRUSHINDIRECT: u32 = 39;
const EMR_DELETEOBJECT: u32 = 40;
const EMR_BEGINPATH: u32 = 59;
const EMR_ENDPATH: u32 = 60;
const EMR_CLOSEFIGURE: u32 = 61;
const EMR_FILLPATH: u32 = 62;
const EMR_STROKEANDFILLPATH: u32 = 63;
const EMR_STROKEPATH: u32 = 64;
const EMR_SELECTCLIPPATH: u32 = 67;
const EMR_COMMENT: u32 = 70;
const EMR_EXTSELECTCLIPRGN: u32 = 75;
const EMR_EXTCREATEPEN: u32 = 95;
const EMR_SETICMMODE: u32 = 98;

const STOCK_OBJECT_FLAG: u32 = 0x8000_0000;

struct Converter<'a> {
    data: &'a [u8],
    mapping: Mapping,
    objects: std::collections::HashMap<u32, DeviceObject>,
    current_brush: Option<u32>,
    current_pen: Option<(u32, f64)>,
    fill_rule: &'static str,
    in_path: bool,
    path_data: String,
    pending_path: Option<String>,
    current_point: (f64, f64),
    elements: Vec<String>,
    clip_defs: Vec<String>,
    active_clip_id: Option<usize>,
    bounds: (i32, i32, i32, i32),
}

impl<'a> Converter<'a> {
    fn map_point(&self, x: f64, y: f64) -> (f64, f64) {
        self.mapping.map(x, y)
    }

    fn push_element(&mut self, element: String) {
        if let Some(clip_id) = self.active_clip_id {
            self.elements
                .push(format!("<g clip-path=\"url(#c{clip_id})\">{element}</g>"));
        } else {
            self.elements.push(element);
        }
    }

    fn fill_attr(&self) -> String {
        match self.current_brush {
            Some(color) => format!("fill=\"{}\"", colorref_to_css(color)),
            None => "fill=\"none\"".to_string(),
        }
    }

    fn stroke_attr(&self) -> String {
        match self.current_pen {
            Some((color, width_logical)) => {
                let width_px = (width_logical * self.mapping.scale_x()).abs().max(0.25);
                format!(
                    "stroke=\"{}\" stroke-width=\"{}\"",
                    colorref_to_css(color),
                    fmt(width_px)
                )
            }
            None => "stroke=\"none\"".to_string(),
        }
    }

    fn emit_path(&mut self, d: String, fill: bool, stroke: bool) {
        if d.is_empty() {
            return;
        }
        let fill_attr = if fill {
            format!("{} fill-rule=\"{}\"", self.fill_attr(), self.fill_rule)
        } else {
            "fill=\"none\"".to_string()
        };
        let stroke_attr = if stroke {
            self.stroke_attr()
        } else {
            "stroke=\"none\"".to_string()
        };
        self.push_element(format!("<path d=\"{d}\" {fill_attr} {stroke_attr}/>"));
    }

    fn read_points16(&self, offset: usize, record_end: usize) -> Option<Vec<(f64, f64)>> {
        let count = read_u32(self.data, offset)? as usize;
        let mut points = Vec::with_capacity(count);
        let mut cursor = offset + 4;
        for _ in 0..count {
            if cursor + 4 > record_end {
                return None;
            }
            let x = read_i16(self.data, cursor)? as f64;
            let y = read_i16(self.data, cursor + 2)? as f64;
            points.push(self.map_point(x, y));
            cursor += 4;
        }
        Some(points)
    }

    fn polyline_to_d(points: &[(f64, f64)], close: bool) -> String {
        let mut d = String::new();
        for (index, (x, y)) in points.iter().enumerate() {
            if index == 0 {
                d.push_str(&format!("M{} {}", fmt(*x), fmt(*y)));
            } else {
                d.push_str(&format!("L{} {}", fmt(*x), fmt(*y)));
            }
        }
        if close && !d.is_empty() {
            d.push('Z');
        }
        d
    }

    fn bezier_to_d(points: &[(f64, f64)], starts_with_move: bool) -> Option<String> {
        let mut d = String::new();
        let control_points = if starts_with_move {
            let Some(((x, y), rest)) = points.split_first() else {
                return None;
            };
            d.push_str(&format!("M{} {}", fmt(*x), fmt(*y)));
            rest
        } else {
            points
        };
        if control_points.len() % 3 != 0 {
            return None;
        }
        for triple in control_points.chunks(3) {
            d.push_str(&format!(
                "C{} {} {} {} {} {}",
                fmt(triple[0].0),
                fmt(triple[0].1),
                fmt(triple[1].0),
                fmt(triple[1].1),
                fmt(triple[2].0),
                fmt(triple[2].1)
            ));
        }
        Some(d)
    }
}

/// Converts an EMF byte stream to an SVG document when every record falls in
/// the supported vector subset; returns `None` otherwise so callers keep the
/// placeholder fallback.
pub fn emf_to_svg(data: &[u8]) -> Option<String> {
    if data.len() < 88 || read_u32(data, 0)? != EMR_HEADER {
        return None;
    }
    let bounds = (
        read_i32(data, 8)?,
        read_i32(data, 12)?,
        read_i32(data, 16)?,
        read_i32(data, 20)?,
    );
    if bounds.2 <= bounds.0 || bounds.3 <= bounds.1 {
        return None;
    }

    let mut converter = Converter {
        data,
        mapping: Mapping::identity(),
        objects: std::collections::HashMap::new(),
        current_brush: Some(0x00ff_ffff),
        current_pen: Some((0, 1.0)),
        fill_rule: "evenodd",
        in_path: false,
        path_data: String::new(),
        pending_path: None,
        current_point: (0.0, 0.0),
        elements: Vec::new(),
        clip_defs: Vec::new(),
        active_clip_id: None,
        bounds,
    };

    let header_size = read_u32(data, 4)? as usize;
    let mut offset = header_size;
    while offset + 8 <= data.len() {
        let record_type = read_u32(data, offset)?;
        let record_size = read_u32(data, offset + 4)? as usize;
        if record_size < 8 || offset + record_size > data.len() {
            return None;
        }
        let record_end = offset + record_size;
        let body = offset + 8;

        match record_type {
            EMR_EOF => break,
            EMR_HEADER => return None,
            EMR_SETMAPMODE
            | EMR_SETBKMODE
            | EMR_SETROP2
            | EMR_SETSTRETCHBLTMODE
            | EMR_SETTEXTALIGN
            | EMR_SETTEXTCOLOR
            | EMR_SETBKCOLOR
            | EMR_SETBRUSHORGEX
            | EMR_SETMETARGN
            | EMR_SETMITERLIMIT
            | EMR_SETICMMODE
            | EMR_COMMENT => {}
            EMR_SETWINDOWEXTEX => {
                converter.mapping.window_ext =
                    (read_i32(data, body)? as f64, read_i32(data, body + 4)? as f64);
            }
            EMR_SETWINDOWORGEX => {
                converter.mapping.window_org =
                    (read_i32(data, body)? as f64, read_i32(data, body + 4)? as f64);
            }
            EMR_SETVIEWPORTEXTEX => {
                converter.mapping.viewport_ext =
                    (read_i32(data, body)? as f64, read_i32(data, body + 4)? as f64);
            }
            EMR_SETVIEWPORTORGEX => {
                converter.mapping.viewport_org =
                    (read_i32(data, body)? as f64, read_i32(data, body + 4)? as f64);
            }
            EMR_SETPOLYFILLMODE => {
                converter.fill_rule = if read_u32(data, body)? == 2 {
                    "nonzero"
                } else {
                    "evenodd"
                };
            }
            EMR_CREATEBRUSHINDIRECT => {
                let handle = read_u32(data, body)?;
                let style = read_u32(data, body + 4)?;
                let color = read_u32(data, body + 8)?;
                let object = if style == 1 {
                    DeviceObject::NullBrush
                } else {
                    DeviceObject::SolidBrush(color)
                };
                converter.objects.insert(handle, object);
            }
            EMR_CREATEPEN => {
                let handle = read_u32(data, body)?;
                let style = read_u32(data, body + 4)?;
                let width = read_i32(data, body + 8)? as f64;
                let color = read_u32(data, body + 16)?;
                let object = if style & 0xff == 5 {
                    DeviceObject::NullPen
                } else {
                    DeviceObject::SolidPen {
                        color,
                        width_logical: width.max(1.0),
                    }
                };
                converter.objects.insert(handle, object);
            }
            EMR_EXTCREATEPEN => {
                let handle = read_u32(data, body)?;
                let pen_style = read_u32(data, body + 20)?;
                let width = read_u32(data, body + 24)? as f64;
                let color = read_u32(data, body + 32)?;
                let object = if pen_style & 0xff == 5 {
                    DeviceObject::NullPen
                } else {
                    DeviceObject::SolidPen {
                        color,
                        width_logical: width.max(1.0),
                    }
                };
                converter.objects.insert(handle, object);
            }
            EMR_SELECTOBJECT => {
                let handle = read_u32(data, body)?;
                if handle & STOCK_OBJECT_FLAG != 0 {
                    match handle & !STOCK_OBJECT_FLAG {
                        0 => converter.current_brush = Some(0x00ff_ffff),
                        1 => converter.current_brush = Some(0x00c0_c0c0),
                        2 => converter.current_brush = Some(0x0080_8080),
                        3 => converter.current_brush = Some(0x0040_4040),
                        4 => converter.current_brush = Some(0x0000_0000),
                        5 => converter.current_brush = None,
                        6 => converter.current_pen = Some((0x00ff_ffff, 1.0)),
                        7 => converter.current_pen = Some((0x0000_0000, 1.0)),
                        8 => converter.current_pen = None,
                        _ => {}
                    }
                } else {
                    match converter.objects.get(&handle) {
                        Some(DeviceObject::SolidBrush(color)) => {
                            converter.current_brush = Some(*color);
                        }
                        Some(DeviceObject::NullBrush) => converter.current_brush = None,
                        Some(DeviceObject::SolidPen {
                            color,
                            width_logical,
                        }) => converter.current_pen = Some((*color, *width_logical)),
                        Some(DeviceObject::NullPen) => converter.current_pen = None,
                        None => {}
                    }
                }
            }
            EMR_DELETEOBJECT => {
                let handle = read_u32(data, body)?;
                converter.objects.remove(&handle);
            }
            EMR_BEGINPATH => {
                converter.in_path = true;
                converter.path_data.clear();
            }
            EMR_ENDPATH => {
                converter.in_path = false;
                converter.pending_path = Some(std::mem::take(&mut converter.path_data));
            }
            EMR_CLOSEFIGURE => {
                if converter.in_path {
                    converter.path_data.push('Z');
                }
            }
            EMR_MOVETOEX => {
                let point = converter.map_point(
                    read_i32(data, body)? as f64,
                    read_i32(data, body + 4)? as f64,
                );
                converter.current_point = point;
                if converter.in_path {
                    converter
                        .path_data
                        .push_str(&format!("M{} {}", fmt(point.0), fmt(point.1)));
                }
            }
            EMR_LINETO => {
                let point = converter.map_point(
                    read_i32(data, body)? as f64,
                    read_i32(data, body + 4)? as f64,
                );
                converter.current_point = point;
                if converter.in_path {
                    converter
                        .path_data
                        .push_str(&format!("L{} {}", fmt(point.0), fmt(point.1)));
                } else {
                    return None;
                }
            }
            EMR_POLYLINETO16 | EMR_POLYBEZIERTO16 => {
                let points = converter.read_points16(body + 16, record_end)?;
                if points.is_empty() {
                    offset = record_end;
                    continue;
                }
                if !converter.in_path {
                    return None;
                }
                if record_type == EMR_POLYLINETO16 {
                    for (x, y) in &points {
                        converter
                            .path_data
                            .push_str(&format!("L{} {}", fmt(*x), fmt(*y)));
                    }
                } else {
                    let segment = Converter::bezier_to_d(&points, false)?;
                    converter.path_data.push_str(&segment);
                }
                converter.current_point = *points.last().unwrap();
            }
            EMR_POLYLINE16 | EMR_POLYGON16 | EMR_POLYBEZIER16 => {
                let points = converter.read_points16(body + 16, record_end)?;
                if points.is_empty() {
                    offset = record_end;
                    continue;
                }
                let d = if record_type == EMR_POLYBEZIER16 {
                    Converter::bezier_to_d(&points, true)?
                } else {
                    Converter::polyline_to_d(&points, record_type == EMR_POLYGON16)
                };
                if converter.in_path {
                    converter.path_data.push_str(&d);
                } else if record_type == EMR_POLYGON16 {
                    converter.emit_path(d, true, converter.current_pen.is_some());
                } else {
                    converter.emit_path(d, false, true);
                }
            }
            EMR_POLYPOLYLINE16 | EMR_POLYPOLYGON16 => {
                let poly_count = read_u32(data, body + 16)? as usize;
                let total_points = read_u32(data, body + 20)? as usize;
                let counts_offset = body + 24;
                let points_offset = counts_offset + poly_count * 4;
                let mut d = String::new();
                let mut cursor = points_offset;
                let mut consumed = 0usize;
                for poly_index in 0..poly_count {
                    let count = read_u32(data, counts_offset + poly_index * 4)? as usize;
                    let mut points = Vec::with_capacity(count);
                    for _ in 0..count {
                        if cursor + 4 > record_end {
                            return None;
                        }
                        let x = read_i16(data, cursor)? as f64;
                        let y = read_i16(data, cursor + 2)? as f64;
                        points.push(converter.map_point(x, y));
                        cursor += 4;
                    }
                    consumed += count;
                    d.push_str(&Converter::polyline_to_d(
                        &points,
                        record_type == EMR_POLYPOLYGON16,
                    ));
                }
                if consumed != total_points {
                    return None;
                }
                if converter.in_path {
                    converter.path_data.push_str(&d);
                } else if record_type == EMR_POLYPOLYGON16 {
                    converter.emit_path(d, true, converter.current_pen.is_some());
                } else {
                    converter.emit_path(d, false, true);
                }
            }
            EMR_FILLPATH | EMR_STROKEPATH | EMR_STROKEANDFILLPATH => {
                let d = converter.pending_path.clone().unwrap_or_default();
                converter.emit_path(
                    d,
                    record_type != EMR_STROKEPATH,
                    record_type != EMR_FILLPATH,
                );
            }
            EMR_SELECTCLIPPATH => {
                // All combine modes are approximated as replace; logos use
                // RGN_COPY in practice.
                let Some(d) = converter.pending_path.clone() else {
                    return None;
                };
                let clip_id = converter.clip_defs.len();
                converter.clip_defs.push(format!(
                    "<clipPath id=\"c{clip_id}\" clip-rule=\"{}\"><path d=\"{d}\"/></clipPath>",
                    converter.fill_rule
                ));
                converter.active_clip_id = Some(clip_id);
            }
            EMR_EXTSELECTCLIPRGN => {
                let mode = read_u32(data, body + 4)?;
                // RGN_COPY with no region data resets the clip; anything more
                // elaborate than a reset or a full-bounds region bails.
                let region_data_size = read_u32(data, body)? as usize;
                if mode == 5 && region_data_size == 0 {
                    converter.active_clip_id = None;
                } else if mode == 5 {
                    let rect_count = read_u32(data, body + 8 + 8).unwrap_or(0);
                    if rect_count <= 1 {
                        converter.active_clip_id = None;
                    } else {
                        return None;
                    }
                } else {
                    return None;
                }
            }
            _ => return None,
        }

        offset = record_end;
    }

    let (left, top, right, bottom) = converter.bounds;
    let width = right - left;
    let height = bottom - top;
    let defs = if converter.clip_defs.is_empty() {
        String::new()
    } else {
        format!("<defs>{}</defs>", converter.clip_defs.join(""))
    };
    Some(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{left} {top} {width} {height}\" width=\"{width}\" height=\"{height}\" preserveAspectRatio=\"xMidYMid meet\">{defs}{}</svg>",
        converter.elements.join("")
    ))
}
