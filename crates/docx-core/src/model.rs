use std::collections::HashMap;

use serde::{Deserialize, Serialize};

fn default_text_run_type() -> TextRunNodeType {
    TextRunNodeType::Text
}

fn default_image_run_type() -> ImageRunNodeType {
    ImageRunNodeType::Image
}

fn default_form_field_run_type() -> FormFieldRunNodeType {
    FormFieldRunNodeType::FormField
}

fn default_paragraph_node_type() -> ParagraphNodeType {
    ParagraphNodeType::Paragraph
}

fn default_table_cell_node_type() -> TableCellNodeType {
    TableCellNodeType::TableCell
}

fn default_table_row_node_type() -> TableRowNodeType {
    TableRowNodeType::TableRow
}

fn default_table_node_type() -> TableNodeType {
    TableNodeType::Table
}

/// Mirrors TypeScript `ParagraphAlignment`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ParagraphAlignment {
    Left,
    Center,
    Right,
    Justify,
}

/// Mirrors TypeScript `HeadingLevel`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(into = "i64")]
pub enum HeadingLevel {
    One = 1,
    Two = 2,
    Three = 3,
    Four = 4,
    Five = 5,
    Six = 6,
}

impl<'de> Deserialize<'de> for HeadingLevel {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = i64::deserialize(deserializer)?;
        match value {
            1 => Ok(HeadingLevel::One),
            2 => Ok(HeadingLevel::Two),
            3 => Ok(HeadingLevel::Three),
            4 => Ok(HeadingLevel::Four),
            5 => Ok(HeadingLevel::Five),
            6 => Ok(HeadingLevel::Six),
            _ => Err(serde::de::Error::custom(format!(
                "invalid heading level {value}"
            ))),
        }
    }
}

impl From<HeadingLevel> for i64 {
    fn from(value: HeadingLevel) -> Self {
        value as i64
    }
}

/// Mirrors TypeScript `TextRunBorderStyle`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRunBorderStyle {
    #[serde(rename = "type")]
    pub border_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_eighth_pt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space_pt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<bool>,
}

/// Mirrors TypeScript `VerticalAlign`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VerticalAlign {
    #[serde(rename = "superscript")]
    Superscript,
    #[serde(rename = "subscript")]
    Subscript,
}

/// Mirrors TypeScript `TextStyle`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strike: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size_pt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character_spacing_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<VerticalAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_border: Option<TextRunBorderStyle>,
}

/// Mirrors TypeScript `TextRunNode.noteReference`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteReference {
    pub kind: NoteReferenceKind,
    pub id: i64,
}

/// Mirrors TypeScript `TextRunNode.noteReference.kind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NoteReferenceKind {
    #[serde(rename = "footnote")]
    Footnote,
    #[serde(rename = "endnote")]
    Endnote,
}

/// Mirrors TypeScript `TextRunNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRunNode {
    #[serde(default = "default_text_run_type", rename = "type")]
    pub r#type: TextRunNodeType,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<TextStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_reference: Option<NoteReference>,
}

/// Discriminator for `TextRunNode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextRunNodeType {
    #[serde(rename = "text")]
    Text,
}

/// Mirrors TypeScript `ImageRunNode.crop`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCrop {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_fraction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_fraction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_fraction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom_fraction: Option<f64>,
}

/// Mirrors TypeScript `ImageRunNode.floating.horizontalAlign`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageHorizontalAlign {
    Left,
    Center,
    Right,
    Inside,
    Outside,
}

/// Mirrors TypeScript `ImageRunNode.floating.verticalAlign`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageVerticalAlign {
    Top,
    Center,
    Bottom,
    Inside,
    Outside,
}

/// Mirrors TypeScript `ImageRunNode.floating.wrapType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageWrapType {
    #[serde(rename = "none")]
    WrapNone,
    #[serde(rename = "square")]
    Square,
    #[serde(rename = "tight")]
    Tight,
    #[serde(rename = "through")]
    Through,
    #[serde(rename = "topAndBottom")]
    TopAndBottom,
}

/// Mirrors TypeScript `ImageRunNode.floating.wrapText`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageWrapText {
    #[serde(rename = "bothSides")]
    BothSides,
    #[serde(rename = "left")]
    Left,
    #[serde(rename = "right")]
    Right,
    #[serde(rename = "largest")]
    Largest,
}

/// Mirrors TypeScript `ImageRunNode.floating`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFloating {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_align: Option<ImageHorizontalAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<ImageVerticalAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_relative_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_relative_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dist_l_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dist_r_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dist_t_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dist_b_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap_type: Option<ImageWrapType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap_text: Option<ImageWrapText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind_document: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z_index: Option<i64>,
}

/// Mirrors TypeScript `ImageRunNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRunNode {
    #[serde(default = "default_image_run_type", rename = "type")]
    pub r#type: ImageRunNodeType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_xml: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crop: Option<ImageCrop>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css_filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css_opacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub floating: Option<ImageFloating>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synthetic_text_box: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_box_text: Option<String>,
}

/// Discriminator for `ImageRunNode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageRunNodeType {
    #[serde(rename = "image")]
    Image,
}

/// Mirrors TypeScript `FormFieldType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormFieldType {
    #[serde(rename = "checkbox")]
    Checkbox,
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "date")]
    Date,
    #[serde(rename = "dropdown")]
    Dropdown,
}

/// Mirrors TypeScript `FormFieldSourceKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FormFieldSourceKind {
    #[serde(rename = "sdt")]
    Sdt,
    #[serde(rename = "legacy")]
    Legacy,
}

/// Mirrors TypeScript `FormFieldOption`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormFieldOption {
    pub display_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// Mirrors TypeScript `FormFieldTextWidgetSettings`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormFieldTextWidgetSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_format: Option<String>,
}

/// Mirrors TypeScript `FormFieldCheckboxWidgetSettings`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormFieldCheckboxWidgetSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_mode: Option<FormFieldCheckboxSizeMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_pt: Option<f64>,
}

/// Mirrors TypeScript `FormFieldCheckboxWidgetSettings.sizeMode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FormFieldCheckboxSizeMode {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "exact")]
    Exact,
}

/// Mirrors TypeScript `FormFieldDropdownWidgetSettings`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormFieldDropdownWidgetSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
}

/// Mirrors TypeScript `FormFieldWidgetSettings`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormFieldWidgetSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calc_on_exit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<FormFieldTextWidgetSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkbox: Option<FormFieldCheckboxWidgetSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropdown: Option<FormFieldDropdownWidgetSettings>,
}

/// Mirrors TypeScript `FormFieldRunNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormFieldRunNode {
    #[serde(default = "default_form_field_run_type", rename = "type")]
    pub r#type: FormFieldRunNodeType,
    pub field_type: FormFieldType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<FormFieldSourceKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<FormFieldOption>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widget: Option<FormFieldWidgetSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unchecked_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<TextStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_xml: Option<String>,
}

/// Discriminator for `FormFieldRunNode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FormFieldRunNodeType {
    #[serde(rename = "form-field")]
    FormField,
}

/// Mirrors TypeScript `ParagraphChildNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParagraphChildNode {
    Text(TextRunNode),
    Image(ImageRunNode),
    FormField(FormFieldRunNode),
}

/// Mirrors TypeScript `ParagraphNumbering`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphNumbering {
    pub num_id: i64,
    pub ilvl: i64,
}

/// Mirrors TypeScript `ParagraphSpacing.lineRule`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParagraphLineRule {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "exact")]
    Exact,
    #[serde(rename = "atLeast")]
    AtLeast,
}

/// Mirrors TypeScript `ParagraphSpacing`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphSpacing {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_rule: Option<ParagraphLineRule>,
}

/// Mirrors TypeScript `ParagraphIndent`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphIndent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_line_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hanging_twips: Option<i64>,
}

/// Mirrors TypeScript `ParagraphBorderStyle`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphBorderStyle {
    #[serde(rename = "type")]
    pub border_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_eighth_pt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space_pt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<bool>,
}

/// Mirrors TypeScript `ParagraphBorderSet`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphBorderSet {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<ParagraphBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<ParagraphBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<ParagraphBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<ParagraphBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub between: Option<ParagraphBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bar: Option<ParagraphBorderStyle>,
}

/// Mirrors TypeScript `ParagraphTabStop.alignment`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ParagraphTabStopAlignment {
    Left,
    Center,
    Right,
    Decimal,
    Bar,
}

/// Mirrors TypeScript `ParagraphTabStop.leader`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParagraphTabStopLeader {
    #[serde(rename = "none")]
    LeaderNone,
    #[serde(rename = "dot")]
    Dot,
    #[serde(rename = "hyphen")]
    Hyphen,
    #[serde(rename = "underscore")]
    Underscore,
    #[serde(rename = "middleDot")]
    MiddleDot,
}

/// Mirrors TypeScript `ParagraphTabStop`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphTabStop {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<ParagraphTabStopAlignment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leader: Option<ParagraphTabStopLeader>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_twips: Option<i64>,
}

/// Mirrors TypeScript `ParagraphStyle.dropCap.type`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParagraphDropCapType {
    #[serde(rename = "drop")]
    Drop,
    #[serde(rename = "margin")]
    Margin,
}

/// Mirrors TypeScript `ParagraphStyle.dropCap`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphDropCap {
    #[serde(rename = "type")]
    pub drop_cap_type: ParagraphDropCapType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_anchor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_anchor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_space_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_space_twips: Option<i64>,
}

/// Mirrors TypeScript `ParagraphStyle`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<ParagraphAlignment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading_level: Option<HeadingLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub numbering: Option<ParagraphNumbering>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spacing: Option<ParagraphSpacing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent: Option<ParagraphIndent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borders: Option<ParagraphBorderSet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_stops: Option<Vec<ParagraphTabStop>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contextual_spacing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_next: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widow_control: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_break_before: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drop_cap: Option<ParagraphDropCap>,
}

/// Mirrors TypeScript `ParagraphNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphNode {
    #[serde(default = "default_paragraph_node_type", rename = "type")]
    pub r#type: ParagraphNodeType,
    pub children: Vec<ParagraphChildNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<ParagraphStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paragraph_mark_deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_xml: Option<String>,
}

/// Discriminator for `ParagraphNode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParagraphNodeType {
    #[serde(rename = "paragraph")]
    Paragraph,
}

/// Mirrors TypeScript `TableBoxSpacing`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableBoxSpacing {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_twips: Option<i64>,
}

/// Mirrors TypeScript `TableBorderStyle`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableBorderStyle {
    #[serde(rename = "type")]
    pub border_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_eighth_pt: Option<f64>,
}

/// Mirrors TypeScript `TableBorderSet`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableBorderSet {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<TableBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<TableBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<TableBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<TableBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inside_h: Option<TableBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inside_v: Option<TableBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tl2br: Option<TableBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tr2bl: Option<TableBorderStyle>,
}

/// Mirrors TypeScript `TableCellStyle.verticalAlign`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TableCellVerticalAlign {
    Top,
    Center,
    Bottom,
}

/// Mirrors TypeScript `TableCellStyle`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCellStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid_span: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_span: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v_merge_continuation: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margin_twips: Option<TableBoxSpacing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<TableCellVerticalAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borders: Option<TableBorderSet>,
}

/// Mirrors TypeScript `TableCellContentNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TableCellContentNode {
    Paragraph(ParagraphNode),
    Table(Box<TableNode>),
}

/// Mirrors TypeScript `TableCellNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCellNode {
    #[serde(default = "default_table_cell_node_type", rename = "type")]
    pub r#type: TableCellNodeType,
    pub nodes: Vec<TableCellContentNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<TableCellStyle>,
}

/// Discriminator for `TableCellNode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TableCellNodeType {
    #[serde(rename = "table-cell")]
    TableCell,
}

/// Mirrors TypeScript `TableRowStyle.heightRule`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TableRowHeightRule {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "atLeast")]
    AtLeast,
    #[serde(rename = "exact")]
    Exact,
}

/// Mirrors TypeScript `TableRowStyle`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_rule: Option<TableRowHeightRule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cant_split: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_header: Option<bool>,
}

/// Mirrors TypeScript `TableRowNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowNode {
    #[serde(default = "default_table_row_node_type", rename = "type")]
    pub r#type: TableRowNodeType,
    pub cells: Vec<TableCellNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<TableRowStyle>,
}

/// Discriminator for `TableRowNode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TableRowNodeType {
    #[serde(rename = "table-row")]
    TableRow,
}

/// Mirrors TypeScript `TableStyle.layout`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TableLayout {
    #[serde(rename = "fixed")]
    Fixed,
    #[serde(rename = "autofit")]
    Autofit,
}

/// Mirrors TypeScript `TableStyle.floating`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableFloating {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_from_text_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_from_text_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_from_text_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom_from_text_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_anchor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_anchor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_align: Option<ImageHorizontalAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<ImageVerticalAlign>,
}

/// Mirrors TypeScript `TableStyle`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<TableLayout>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_spacing_twips: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_margin_twips: Option<TableBoxSpacing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_widths_twips: Option<Vec<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borders: Option<TableBorderSet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub floating: Option<TableFloating>,
}

/// Mirrors TypeScript `TableNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableNode {
    #[serde(default = "default_table_node_type", rename = "type")]
    pub r#type: TableNodeType,
    pub rows: Vec<TableRowNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<TableStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_xml: Option<String>,
}

/// Discriminator for `TableNode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TableNodeType {
    #[serde(rename = "table")]
    Table,
}

/// Mirrors TypeScript `DocNode`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DocNode {
    Paragraph(ParagraphNode),
    Table(TableNode),
}

/// Mirrors TypeScript `HeaderSection`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderSection {
    pub part_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_type: Option<String>,
    pub nodes: Vec<DocNode>,
}

/// Mirrors TypeScript `FooterSection`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FooterSection {
    pub part_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_type: Option<String>,
    pub nodes: Vec<DocNode>,
}

/// Mirrors TypeScript `DocumentSection`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSection {
    pub start_node_index: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_properties_xml: Option<String>,
    pub header_sections: Vec<HeaderSection>,
    pub footer_sections: Vec<FooterSection>,
}

/// Mirrors TypeScript `ParagraphStyleDefinition`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphStyleDefinition {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub based_on_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_style_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<ParagraphAlignment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading_level: Option<HeadingLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub numbering: Option<ParagraphNumbering>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spacing: Option<ParagraphSpacing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent: Option<ParagraphIndent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borders: Option<ParagraphBorderSet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_stops: Option<Vec<ParagraphTabStop>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contextual_spacing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_next: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widow_control: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_break_before: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_style: Option<TextStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_priority: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_default: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_primary: Option<bool>,
}

/// Mirrors TypeScript `NumberingLevelDefinition.suffix`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NumberingLevelSuffix {
    #[serde(rename = "tab")]
    Tab,
    #[serde(rename = "space")]
    Space,
    #[serde(rename = "nothing")]
    Nothing,
}

/// Mirrors TypeScript `NumberingLevelDefinition`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberingLevelDefinition {
    pub ilvl: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<NumberingLevelSuffix>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent: Option<ParagraphIndent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_style: Option<TextStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bullet_font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bullet_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture_bullet_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture_bullet: Option<NumberingPictureBulletDefinition>,
}

/// Mirrors TypeScript `NumberingAbstractDefinition`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberingAbstractDefinition {
    pub abstract_num_id: i64,
    pub levels: Vec<NumberingLevelDefinition>,
}

/// Mirrors TypeScript `NumberingInstanceDefinition`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberingInstanceDefinition {
    pub num_id: i64,
    pub abstract_num_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_start_overrides: Option<HashMap<String, i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_overrides: Option<Vec<NumberingLevelDefinition>>,
}

/// Mirrors TypeScript `NumberingDefinitionSet`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberingDefinitionSet {
    pub abstracts: Vec<NumberingAbstractDefinition>,
    pub instances: Vec<NumberingInstanceDefinition>,
}

/// Mirrors TypeScript `NumberingPictureBulletDefinition`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberingPictureBulletDefinition {
    pub num_pic_bullet_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
}

/// Mirrors TypeScript `DocumentNoteDefinition`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentNoteDefinition {
    pub id: i64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<DocNode>>,
}

/// Mirrors TypeScript `DocumentCommentDefinition`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCommentDefinition {
    pub id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initials: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved: Option<bool>,
}

/// Mirrors TypeScript `DocumentCompatibilitySettings`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCompatibilitySettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suppress_spacing_before_after_page_break: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_printer_metrics: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_fixed_html_paragraph_spacing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub do_not_break_wrapped_tables: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub do_not_break_constrained_forced_table: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub even_and_odd_headers: Option<bool>,
}

/// Mirrors TypeScript `DocModel.metadata`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocModelMetadata {
    pub source_parts: i64,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_page_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_open_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_properties_xml: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sections: Option<Vec<DocumentSection>>,
    pub header_sections: Vec<HeaderSection>,
    pub footer_sections: Vec<FooterSection>,
    pub paragraph_styles: Vec<ParagraphStyleDefinition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_paragraph_style_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub numbering_definitions: Option<NumberingDefinitionSet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatibility: Option<DocumentCompatibilitySettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footnotes: Option<Vec<DocumentNoteDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endnotes: Option<Vec<DocumentNoteDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<Vec<DocumentCommentDefinition>>,
}

/// Mirrors TypeScript `DocModel`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocModel {
    pub nodes: Vec<DocNode>,
    pub metadata: DocModelMetadata,
}

#[cfg(test)]
mod deserialize_tests {
    use super::{DocModel, DocNode};

    #[test]
    fn deserializes_minimal_js_doc_model() {
        let json = r#"{"nodes":[{"type":"paragraph","children":[{"type":"text","text":"Hi"}]}],"metadata":{"sourceParts":1,"warnings":[],"headerSections":[],"footerSections":[],"paragraphStyles":[]}}"#;
        let model: DocModel = serde_json::from_str(json).expect("should deserialize");
        assert_eq!(model.nodes.len(), 1);
    }

    #[test]
    fn deserializes_heading_level_two() {
        let json = include_str!("../../../tmp/second_node_h2.json");
        let node: DocNode = serde_json::from_str(json).expect("heading level 2");
        assert!(matches!(node, DocNode::Paragraph(_)));
    }

    #[test]
    fn deserializes_align_center() {
        let json = include_str!("../../../tmp/second_node_align.json");
        let node: DocNode = serde_json::from_str(json).expect("align center");
        assert!(matches!(node, DocNode::Paragraph(_)));
    }
}
