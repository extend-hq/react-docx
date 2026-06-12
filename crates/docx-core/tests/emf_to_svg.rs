use docx_core::emf::emf_to_svg;

/// Real-world vector logo EMF (paths + solid brushes + clip paths) must
/// convert to SVG instead of falling back to the unsupported-image badge.
#[test]
fn converts_vector_logo_emf_to_svg() {
    let bytes = include_bytes!("fixtures-emf/vector-logo.emf");
    let svg = emf_to_svg(bytes).expect("vector EMF converts");
    assert!(svg.starts_with("<svg "));
    assert!(svg.contains("viewBox=\"0 0 500 91\""));
    // 76 EMR_FILLPATH records in the logo.
    let path_count = svg.matches("<path ").count();
    assert!(
        path_count >= 70,
        "expected the logo's fill paths, got {path_count}"
    );
    assert!(svg.contains("fill=\"#"), "expected solid brush fills");
}

/// EMFs containing records outside the supported vector subset (here a
/// truncated/garbage record) must return None so the placeholder remains.
#[test]
fn bails_on_unsupported_records() {
    let bytes = include_bytes!("fixtures-emf/vector-logo.emf");
    let mut corrupted = bytes.to_vec();
    // Rewrite the first post-header record's type to EMR_EXTTEXTOUTW (84),
    // which the converter does not support.
    let header_size = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    corrupted[header_size..header_size + 4].copy_from_slice(&84u32.to_le_bytes());
    assert!(emf_to_svg(&corrupted).is_none());
}

/// Non-EMF bytes never convert.
#[test]
fn bails_on_non_emf_bytes() {
    assert!(emf_to_svg(&[0u8; 16]).is_none());
    assert!(emf_to_svg(b"not an emf at all, just some text padding").is_none());
}
