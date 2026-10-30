use docx_core::emf::emf_to_svg;

fn vector_drawing() -> Vec<u8> {
    let mut bytes = vec![0u8; 88];
    bytes[0..4].copy_from_slice(&1u32.to_le_bytes());
    bytes[4..8].copy_from_slice(&88u32.to_le_bytes());
    bytes[16..20].copy_from_slice(&100i32.to_le_bytes());
    bytes[20..24].copy_from_slice(&100i32.to_le_bytes());
    bytes[40..44].copy_from_slice(&0x464d4520u32.to_le_bytes());
    let records: &[(u32, &[u32])] = &[
        (39, &[1, 0, 0x00332211, 0]),
        (37, &[1]),
        (30, &[0, 0, 80, 80]),
        (59, &[]),
        (27, &[10, 10]),
        (54, &[90, 10]),
        (54, &[50, 90]),
        (61, &[]),
        (60, &[]),
        (62, &[0, 0, 100, 100]),
        (14, &[0, 0, 20]),
    ];
    for (kind, payload) in records {
        bytes.extend(kind.to_le_bytes());
        bytes.extend((8u32 + payload.len() as u32 * 4).to_le_bytes());
        for value in *payload {
            bytes.extend(value.to_le_bytes());
        }
    }
    let size = bytes.len() as u32;
    bytes[48..52].copy_from_slice(&size.to_le_bytes());
    bytes[52..56].copy_from_slice(&(records.len() as u32 + 1).to_le_bytes());
    bytes
}

#[test]
fn converts_filled_and_clipped_paths() {
    let svg = emf_to_svg(&vector_drawing()).expect("convert vector drawing");
    assert!(svg.starts_with("<svg "));
    assert!(svg.contains("viewBox=\"0 0 100 100\""));
    assert!(svg.contains("M10 10L90 10L50 90Z"));
    assert!(svg.contains("fill=\"#112233\""));
    assert!(svg.contains("clip-path="));
}

#[test]
fn bails_on_incompatible_record_payload() {
    let mut bytes = vector_drawing();
    bytes[88..92].copy_from_slice(&84u32.to_le_bytes());
    assert!(emf_to_svg(&bytes).is_none());
}

#[test]
fn bails_on_non_emf_bytes() {
    assert!(emf_to_svg(&[0u8; 16]).is_none());
    assert!(emf_to_svg(b"invalid vector drawing").is_none());
}
