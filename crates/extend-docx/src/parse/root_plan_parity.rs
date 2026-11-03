#[test]
fn cached_plans_preserve_distinct_roots_through_eviction() {
    for value in (0..48).chain((0..48).rev()) {
        for name in ["document", "styles", "hdr", "ftr"] {
            let xml = format!("<?xml version=\"1.0\"?>\r\n<w:{name} xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:q=\"urn:cache:{value}\" xmlns=\"urn:unused\"><w:p><w:r><w:t>Text &amp; detail</w:t></w:r></w:p></w:{name}>");
            let expected = super::normalize_xml(&xml).unwrap();
            let (actual, index) = super::normalize_prolog_xml(&xml).unwrap();
            assert_eq!(actual, expected);
            assert!(index.serialization_equivalent());
        }
    }
}
