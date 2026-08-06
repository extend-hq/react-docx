use std::fs;
use std::path::PathBuf;

use docx_core::doc::{parse_doc, DocFile};
use docx_core::{
    build_doc_model, DocNode, ImageRunNode, ImageWrapText, ImageWrapType, TableNode,
};

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures-doc")
        .join(name);
    fs::read(&path).unwrap_or_else(|error| panic!("read fixture {path:?}: {error}"))
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures-doc")
        .join(name)
}

fn main_text(name: &str) -> String {
    let doc = DocFile::open(&fixture(name)).expect("open doc");
    String::from_utf16_lossy(&doc.text(0, doc.fib.ccp.text))
}

#[test]
fn extracts_text_from_textutil_doc() {
    let text = main_text("simple-textutil.doc");
    assert!(text.contains("Hello plain paragraph one."), "text: {text:?}");
    assert!(text.contains("Bold centered"));
    assert!(text.contains("Big red Arial"));
    assert!(text.contains("Cell A1"));
    assert!(
        text.contains("caf\u{E9}"),
        "expected accented text, got: {text:?}"
    );
    assert!(
        text.contains('\u{201C}') || text.contains('\u{201D}'),
        "expected smart quotes"
    );
}

fn model_text(model: &docx_core::DocModel) -> String {
    let mut text = String::new();
    for node in &model.nodes {
        collect_node_text(node, &mut text);
    }
    text
}

fn collect_node_text(node: &DocNode, out: &mut String) {
    match node {
        DocNode::Paragraph(paragraph) => {
            for child in &paragraph.children {
                if let docx_core::ParagraphChildNode::Text(run) = child {
                    out.push_str(&run.text);
                }
            }
            out.push('\n');
        }
        DocNode::Table(table) => {
            for row in &table.rows {
                for cell in &row.cells {
                    for content in &cell.nodes {
                        if let docx_core::TableCellContentNode::Paragraph(paragraph) = content {
                            for child in &paragraph.children {
                                if let docx_core::ParagraphChildNode::Text(run) = child {
                                    out.push_str(&run.text);
                                }
                            }
                            out.push('\n');
                        }
                    }
                }
            }
        }
    }
}

fn collect_node_images<'a>(node: &'a DocNode, out: &mut Vec<&'a ImageRunNode>) {
    match node {
        DocNode::Paragraph(paragraph) => {
            for child in &paragraph.children {
                if let docx_core::ParagraphChildNode::Image(image) = child {
                    out.push(image);
                }
            }
        }
        DocNode::Table(table) => collect_table_images(table, out),
    }
}

fn collect_table_images<'a>(table: &'a TableNode, out: &mut Vec<&'a ImageRunNode>) {
    for row in &table.rows {
        for cell in &row.cells {
            for content in &cell.nodes {
                match content {
                    docx_core::TableCellContentNode::Paragraph(paragraph) => {
                        for child in &paragraph.children {
                            if let docx_core::ParagraphChildNode::Image(image) = child {
                                out.push(image);
                            }
                        }
                    }
                    docx_core::TableCellContentNode::Table(table) => {
                        collect_table_images(table, out);
                    }
                }
            }
        }
    }
}

fn collect_images(nodes: &[DocNode]) -> Vec<&ImageRunNode> {
    let mut images = Vec::new();
    for node in nodes {
        collect_node_images(node, &mut images);
    }
    images
}

#[test]
fn full_pipeline_textutil_doc() {
    let pkg = parse_doc(&fixture("simple-textutil.doc")).expect("parse_doc");
    let model = build_doc_model(&pkg);
    let text = model_text(&model);
    assert!(text.contains("Hello plain paragraph one."), "{text}");
    assert!(text.contains("Cell A1"), "missing table cell text: {text}");
    assert!(
        model.nodes.iter().any(|node| matches!(node, DocNode::Table(_))),
        "expected a table node"
    );
    assert!(model.metadata.sections.is_some());
    assert!(!model.metadata.paragraph_styles.is_empty(), "styles missing");
}

#[test]
fn full_pipeline_libreoffice_invoice() {
    let pkg = parse_doc(&fixture("Downloadable-Word-Invoice-Template.doc")).expect("parse_doc");
    let model = build_doc_model(&pkg);
    let text = model_text(&model);
    assert!(text.to_lowercase().contains("invoice"), "{text}");
    assert!(
        model.nodes.iter().any(|node| matches!(node, DocNode::Table(_))),
        "expected tables in invoice"
    );
}

#[test]
fn full_pipeline_testpage_and_invoice_template() {
    for name in ["DOCX_TestPage.doc", "InvoiceTemplate.doc"] {
        let pkg = parse_doc(&fixture(name)).expect(name);
        let model = build_doc_model(&pkg);
        assert!(!model.nodes.is_empty(), "{name}: empty model");
    }
}

#[test]
fn imports_main_story_textbox_at_legacy_shape_anchor() {
    let package = parse_doc(&fixture("DOCX_TestPage.doc")).expect("parse textbox fixture");
    let document_xml = &package.parts["word/document.xml"].content;
    assert!(document_xml.contains("<w:txbxContent>"));
    assert!(document_xml.contains("Office"));
    assert!(document_xml.contains("2019 / 365"));

    let model = build_doc_model(&package);
    let images = collect_images(&model.nodes);
    let text_box = images
        .into_iter()
        .find(|image| {
            image.synthetic_text_box == Some(true)
                && image
                    .source_xml
                    .as_deref()
                    .is_some_and(|xml| xml.contains("Office") && xml.contains("2019 / 365"))
        })
        .expect("main-story textbox image");
    assert!(text_box.width_px.is_some_and(|width| width > 1.0));
    assert!(text_box.height_px.is_some_and(|height| height > 1.0));
    let floating = text_box.floating.as_ref().expect("textbox anchor geometry");
    assert_eq!(floating.wrap_type, Some(ImageWrapType::WrapNone));
    assert_eq!(floating.wrap_text, Some(ImageWrapText::BothSides));
    assert!(model.metadata.warnings.is_empty(), "{:?}", model.metadata.warnings);
}

#[test]
fn imports_header_footer_story_textbox_and_field_results() {
    let package = parse_doc(&fixture("Sellers-Property-Disclosure-Statement.doc"))
        .expect("parse header textbox fixture");
    let model = build_doc_model(&package);
    let text_box = model
        .metadata
        .header_sections
        .iter()
        .flat_map(|section| collect_images(&section.nodes))
        .chain(
            model
                .metadata
                .footer_sections
                .iter()
                .flat_map(|section| collect_images(&section.nodes)),
        )
        .find(|image| {
            image.synthetic_text_box == Some(true)
                && image.source_xml.as_deref().is_some_and(|xml| {
                    xml.contains("PAGE") && xml.contains("NUMPAGES")
                })
        })
        .expect("header-story textbox image");
    assert!(text_box.floating.is_some());
    assert!(model.metadata.warnings.is_empty(), "{:?}", model.metadata.warnings);
}

/// A genuine Microsoft Word-authored binary file (not a converter product).
#[test]
fn full_pipeline_word_authored_sample() {
    let pkg = parse_doc(&fixture("word-authored-sample.doc")).expect("parse");
    let model = build_doc_model(&pkg);
    let text = model_text(&model);
    assert!(text.contains("Lorem ipsum dolor sit amet"), "{text}");
    let table = model
        .nodes
        .iter()
        .find_map(|node| match node {
            DocNode::Table(table) => Some(table),
            _ => None,
        })
        .expect("table");
    assert_eq!(table.rows.len(), 6);
    assert_eq!(table.rows[0].cells.len(), 4);
    assert!(model.metadata.numbering_definitions.is_some());
    assert!(model.metadata.warnings.is_empty(), "{:?}", model.metadata.warnings);
}

/// Fidelity check: a .doc produced from a .docx must yield (near-)identical
/// model content to the original .docx through the shared pipeline.
#[test]
fn doc_matches_docx_twin() {
    let pairs = [
        "DOCX_TestPage",
        "Downloadable-Word-Invoice-Template",
        "InvoiceTemplate",
        "patient_original (3)",
        "Sellers-Property-Disclosure-Statement",
        "CS-AA-FM027 Disney PnS Service Request Form Ver. 05",
    ];
    if let Some(missing) = pairs
        .iter()
        .map(|base| format!("{base}.docx"))
        .find(|name| !fixture_path(name).exists())
    {
        eprintln!("skipping optional DOCX twin comparison; missing {missing}");
        return;
    }
    for base in pairs {
        let doc_model = build_doc_model(
            &parse_doc(&fixture(&format!("{base}.doc"))).unwrap_or_else(|e| panic!("{base}: {e}")),
        );
        let docx_model =
            build_doc_model(&docx_core::parse_docx(&fixture(&format!("{base}.docx"))).expect(base));

        // Text containment: most docx text lines must appear in the doc model.
        // Compare on alphanumerics only — checkbox form fields are modeled as
        // FormField nodes on the docx path but inline glyphs on the doc path.
        let normalize_line = |line: &str| -> String {
            line.chars().filter(|ch| ch.is_alphanumeric()).collect()
        };
        let normalize = |text: &str| -> Vec<String> {
            text.lines()
                .map(normalize_line)
                .filter(|line| !line.is_empty())
                .collect()
        };
        let doc_text_joined = normalize_line(&model_text(&doc_model));
        let docx_lines = normalize(&model_text(&docx_model));
        let matched = docx_lines
            .iter()
            .filter(|line| doc_text_joined.contains(*line))
            .count();
        let ratio = if docx_lines.is_empty() {
            1.0
        } else {
            matched as f64 / docx_lines.len() as f64
        };
        assert!(
            ratio >= 0.9,
            "{base}: only {matched}/{} docx text lines found in doc model",
            docx_lines.len()
        );

        // Structural parity.
        let table_count = |model: &docx_core::DocModel| {
            model
                .nodes
                .iter()
                .filter(|node| matches!(node, DocNode::Table(_)))
                .count()
        };
        assert_eq!(
            table_count(&doc_model),
            table_count(&docx_model),
            "{base}: table count mismatch"
        );

        // Headers/footers survive when the source has them.
        let docx_has_headers = !docx_model.metadata.header_sections.is_empty();
        if docx_has_headers {
            assert!(
                !doc_model.metadata.header_sections.is_empty(),
                "{base}: headers lost in .doc path"
            );
        }

        // Page geometry must match (layout-fidelity critical).
        let page_size = |model: &docx_core::DocModel| -> Option<(String, String)> {
            let xml = model.metadata.section_properties_xml.clone()?;
            let width = xml.split("w:pgSz").nth(1)?.split("w:w=\"").nth(1)?
                .split('"').next()?.to_string();
            let height = xml.split("w:pgSz").nth(1)?.split("w:h=\"").nth(1)?
                .split('"').next()?.to_string();
            Some((width, height))
        };
        assert_eq!(
            page_size(&doc_model),
            page_size(&docx_model),
            "{base}: page size mismatch"
        );
    }
}

#[test]
fn extracts_text_from_libreoffice_docs() {
    let text = main_text("DOCX_TestPage.doc");
    assert!(!text.is_empty());

    let invoice = main_text("Downloadable-Word-Invoice-Template.doc");
    assert!(
        invoice.to_lowercase().contains("invoice"),
        "invoice text: {:?}",
        &invoice[..invoice.len().min(400)]
    );
}
