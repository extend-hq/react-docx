use extend_docx::{
    build_doc_model, create_minimal_docx_package, extract_chart_data, extract_document_blocks,
    package_to_bytes, parse_docx, BlockType, DocNode, OoxmlPart, ParagraphChildNode,
};

fn figure_chart(
    namespace: &str,
    relationship: &str,
    content_type: &str,
    content: &str,
) -> extend_docx::ChartData {
    let mut package = create_minimal_docx_package(Some(&format!(
        r#"
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:plot="{namespace}"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <w:body><w:p><w:r><w:drawing><wp:inline>
              <wp:extent cx="4572000" cy="2743200"/><wp:docPr id="1" name="Chart"/>
              <a:graphic><a:graphicData uri="{namespace}">
                <plot:chart r:id="rId1"/>
              </a:graphicData></a:graphic>
            </wp:inline></w:drawing></w:r></w:p></w:body>
        </w:document>"#
    )));
    let part_name = "word/charts/chart1.xml";
    package.parts.insert(
        part_name.into(),
        OoxmlPart {
            name: part_name.into(),
            content: content.into(),
        },
    );
    package
        .parts
        .get_mut("word/_rels/document.xml.rels")
        .unwrap()
        .content = format!(
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="{relationship}" Target="charts/chart1.xml"/>
        </Relationships>"#
    );
    let types = &mut package
        .parts
        .get_mut("[Content_Types].xml")
        .unwrap()
        .content;
    *types = types.replace(
        "</Types>",
        &format!(
            r#"<Override PartName="/word/charts/chart1.xml" ContentType="{content_type}"/></Types>"#
        ),
    );
    let bytes = package_to_bytes(&package).unwrap();
    let package = parse_docx(&bytes).unwrap();
    let model = build_doc_model(&package);
    let DocNode::Paragraph(paragraph) = &model.nodes[0] else {
        panic!("expected paragraph")
    };
    let ParagraphChildNode::Image(image) = &paragraph.children[0] else {
        panic!("expected chart image")
    };
    let source = image.src.as_deref().unwrap();
    assert!(source.starts_with("data:image/svg+xml"));
    let blocks = extract_document_blocks(&model);
    assert_eq!(blocks.blocks.len(), 1);
    let figure = &blocks.blocks[0];
    assert_eq!(figure.r#type, BlockType::Figure);
    let details = figure.details.to_json_value();
    assert_eq!(details["imageUrl"], source);
    extract_chart_data(&package, details["chartPartName"].as_str().unwrap()).unwrap()
}

#[test]
fn saved_chart_figure_uses_the_same_source_as_the_viewer() {
    let content = r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:chart><c:plotArea><c:lineChart><c:ser>
        <c:idx val="0"/><c:order val="0"/><c:val><c:numLit><c:ptCount val="3"/>
        <c:pt idx="0"><c:v>-4</c:v></c:pt><c:pt idx="2"><c:v>8</c:v></c:pt>
        </c:numLit></c:val></c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>"#;
    let chart = figure_chart(
        "http://schemas.openxmlformats.org/drawingml/2006/chart",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
        "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
        content,
    );
    let samples: Vec<_> = chart.series[0]
        .points
        .iter()
        .map(|p| (p.index, p.value.as_deref()))
        .collect();
    assert_eq!(samples, [(0, Some("-4")), (2, Some("8"))]);
}

#[test]
fn extended_chart_relationship_returns_a_native_figure_and_data() {
    let chart = figure_chart(
        "http://schemas.microsoft.com/office/drawing/2014/chartex",
        "http://schemas.microsoft.com/office/2014/relationships/chartEx",
        "application/vnd.ms-office.chartex+xml",
        r#"<cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex">
          <cx:chartData><cx:data id="4"><cx:numDim type="val"><cx:lvl ptCount="1">
            <cx:pt idx="0">24</cx:pt></cx:lvl></cx:numDim></cx:data></cx:chartData>
          <cx:chart><cx:plotArea><cx:plotAreaRegion>
            <cx:series layoutId="funnel"><cx:dataId val="4"/></cx:series>
          </cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>"#,
    );
    assert_eq!(chart.series[0].chart_type, "funnel");
    assert_eq!(chart.series[0].points[0].value.as_deref(), Some("24"));
}
