use crate::OoxmlPackage;
use roxmltree::Node;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChartData {
    pub title: Option<String>,
    pub series: Vec<ChartSeries>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeries {
    pub chart_type: String,
    pub name: Option<String>,
    pub points: Vec<ChartPoint>,
}

/// Source indices are zero-based. Values retain their original spelling and precision.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartPoint {
    pub index: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<ChartCategory>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bubble_size: Option<String>,
}

/// A label at its stored hierarchy level, starting at zero for the leaf level.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChartCategory {
    pub level: usize,
    pub label: String,
}

fn chart_node(node: Node, name: &str) -> bool {
    node.tag_name().name() == name
        && matches!(
            node.tag_name().namespace(),
            Some(
                "http://schemas.openxmlformats.org/drawingml/2006/chart"
                    | "http://purl.oclc.org/ooxml/drawingml/chart"
            )
        )
}

fn child<'a>(node: Node<'a, 'a>, name: &str) -> Option<Node<'a, 'a>> {
    node.children().find(|n| chart_node(*n, name))
}

fn series_data(series: Node, chart_type: &str) -> ChartSeries {
    let name = child(series, "tx")
        .and_then(|tx| tx.descendants().find(|n| chart_node(*n, "v")))
        .and_then(|n| n.text())
        .map(str::to_owned);
    let mut points = BTreeMap::new();
    for channel in series.children().filter(Node::is_element) {
        let role = channel.tag_name().name();
        if !chart_node(channel, role)
            || !matches!(role, "cat" | "val" | "xVal" | "yVal" | "bubbleSize")
        {
            continue;
        }
        let Some(source) = channel.children().find(Node::is_element) else {
            continue;
        };
        let cache = source
            .children()
            .find(|n| {
                ["strCache", "numCache", "multiLvlStrCache"]
                    .iter()
                    .any(|name| chart_node(*n, name))
            })
            .unwrap_or(source);
        let mut levels: Vec<_> = cache.children().filter(|n| chart_node(*n, "lvl")).collect();
        if levels.is_empty() {
            levels.push(cache);
        }
        for (level, source) in levels.into_iter().enumerate() {
            for pt in source.children().filter(|n| chart_node(*n, "pt")) {
                let Some(index) = pt.attribute("idx").and_then(|s| s.parse::<u32>().ok()) else {
                    continue;
                };
                let value = child(pt, "v").map(|v| v.text().unwrap_or_default().to_owned());
                let point = points.entry(index).or_insert_with(|| ChartPoint {
                    index,
                    ..Default::default()
                });
                match role {
                    "cat" => {
                        if let Some(label) = value {
                            point.categories.push(ChartCategory { level, label });
                        }
                    }
                    "val" => point.value = value,
                    "xVal" => point.x = value,
                    "yVal" => point.y = value,
                    "bubbleSize" => point.bubble_size = value,
                    _ => unreachable!(),
                }
            }
        }
    }
    ChartSeries {
        chart_type: chart_type.to_owned(),
        name,
        points: points.into_values().collect(),
    }
}

/// Read the literal and cached series data for a figure's chartPartName.
/// Formula references are not evaluated. A series without cached points remains empty.
pub fn extract_chart_data(package: &OoxmlPackage, part_name: &str) -> Option<ChartData> {
    parse_chart_xml(&package.parts.get(part_name)?.content)
}

pub(crate) fn parse_chart_xml(content: &str) -> Option<ChartData> {
    let xml = roxmltree::Document::parse(content).ok()?;
    let chart = child(xml.root_element(), "chart")?;
    let plot = child(chart, "plotArea")?;
    let title = child(chart, "title")
        .and_then(|n| child(n, "tx"))
        .map(|tx| {
            tx.descendants()
                .filter(|n| {
                    chart_node(*n, "v")
                        || (n.tag_name().name() == "t"
                            && matches!(
                                n.tag_name().namespace(),
                                Some(
                                    "http://schemas.openxmlformats.org/drawingml/2006/main"
                                        | "http://purl.oclc.org/ooxml/drawingml/main"
                                )
                            ))
                })
                .filter_map(|n| n.text())
                .collect::<String>()
        })
        .filter(|s| !s.is_empty());
    let mut series = Vec::new();
    for group in plot.children().filter(Node::is_element) {
        if let Some(kind) = group.tag_name().name().strip_suffix("Chart") {
            series.extend(
                group
                    .children()
                    .filter(|n| chart_node(*n, "ser"))
                    .map(|n| series_data(n, kind)),
            );
        }
    }
    Some(ChartData { title, series })
}
