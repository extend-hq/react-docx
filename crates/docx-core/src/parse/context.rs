use std::cell::RefCell;
use std::collections::HashMap;

use crate::model::{
    ParagraphSpacing, ParagraphStyle, ParagraphStyleDefinition, TableBoxSpacing, TableBorderSet,
    TableFloating, TableLayout, TextStyle,
};
use crate::package::OoxmlPart;

/// Mirrors TypeScript `ContentTypeLookup`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ContentTypeLookup {
    pub default_by_extension: HashMap<String, String>,
    pub override_by_part_name: HashMap<String, String>,
}

/// Mirrors TypeScript `ThemeFontMap`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ThemeFontMap {
    pub major_latin: Option<String>,
    pub minor_latin: Option<String>,
    pub major_east_asia: Option<String>,
    pub minor_east_asia: Option<String>,
    pub major_complex_script: Option<String>,
    pub minor_complex_script: Option<String>,
}

/// Mirrors TypeScript `ThemeColorMap`.
pub type ThemeColorMap = HashMap<String, String>;

/// Mirrors TypeScript `TableConditionalStyleType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TableConditionalStyleType {
    WholeTable,
    FirstRow,
    LastRow,
    FirstCol,
    LastCol,
    Band1Horz,
    Band2Horz,
    Band1Vert,
    Band2Vert,
    NwCell,
    NeCell,
    SwCell,
    SeCell,
}

impl TableConditionalStyleType {
    pub const ALL: [TableConditionalStyleType; 13] = [
        TableConditionalStyleType::WholeTable,
        TableConditionalStyleType::FirstRow,
        TableConditionalStyleType::LastRow,
        TableConditionalStyleType::FirstCol,
        TableConditionalStyleType::LastCol,
        TableConditionalStyleType::Band1Horz,
        TableConditionalStyleType::Band2Horz,
        TableConditionalStyleType::Band1Vert,
        TableConditionalStyleType::Band2Vert,
        TableConditionalStyleType::NwCell,
        TableConditionalStyleType::NeCell,
        TableConditionalStyleType::SwCell,
        TableConditionalStyleType::SeCell,
    ];
}

/// Mirrors TypeScript `ParsedTableLook`.
#[derive(Clone, Debug, PartialEq)]
pub struct ParsedTableLook {
    pub first_row: bool,
    pub last_row: bool,
    pub first_col: bool,
    pub last_col: bool,
    pub no_h_band: bool,
    pub no_v_band: bool,
    pub row_band_size: i64,
    pub col_band_size: i64,
}

/// Mirrors TypeScript `ParsedTableProperties`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ParsedTableProperties {
    pub width_twips: Option<i64>,
    pub indent_twips: Option<i64>,
    pub layout: Option<TableLayout>,
    pub cell_spacing_twips: Option<i64>,
    pub cell_margin_twips: Option<TableBoxSpacing>,
    pub floating: Option<TableFloating>,
}

/// Mirrors TypeScript `ParsedTableStyleCondition`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ParsedTableStyleCondition {
    pub row_background_color: Option<String>,
    pub cell_background_color: Option<String>,
    pub paragraph_align: Option<crate::model::ParagraphAlignment>,
    pub run_style: Option<TextStyle>,
    pub table_borders: Option<TableBorderSet>,
    pub cell_borders: Option<TableBorderSet>,
    pub table_properties: Option<ParsedTableProperties>,
    pub table_look: Option<ParsedTableLook>,
}

/// Mirrors TypeScript `ParsedTableStyleDefinition`.
#[derive(Clone, Debug, PartialEq)]
pub struct ParsedTableStyleDefinition {
    pub id: String,
    pub based_on_id: Option<String>,
    pub name: String,
    pub conditions: HashMap<TableConditionalStyleType, ParsedTableStyleCondition>,
    pub floating: Option<TableFloating>,
    pub properties: Option<ParsedTableProperties>,
}

/// Mirrors TypeScript `ParsedStyleSheet`.
#[derive(Clone, Debug, PartialEq)]
pub struct ParsedStyleSheet {
    pub paragraph_styles: Vec<ParagraphStyleDefinition>,
    pub paragraph_style_by_id: HashMap<String, ParagraphStyleDefinition>,
    pub run_style_by_id: HashMap<String, TextStyle>,
    pub table_style_by_id: HashMap<String, ParsedTableStyleDefinition>,
    /// Table styles' own `w:pPr` spacing (basedOn-resolved). ECMA-376 layers
    /// table-style paragraph properties between document defaults and
    /// paragraph styles for every paragraph inside a styled table.
    pub table_paragraph_spacing_by_style_id: HashMap<String, ParagraphSpacing>,
    pub default_paragraph_style: Option<ParagraphStyle>,
    pub default_paragraph_style_id: Option<String>,
    pub default_run_style: Option<TextStyle>,
    pub theme_fonts: ThemeFontMap,
    pub theme_colors: ThemeColorMap,
}

impl ParsedStyleSheet {
    pub fn empty() -> Self {
        empty_style_sheet()
    }
}

/// Mirrors TypeScript `EMPTY_STYLE_SHEET`.
pub fn empty_style_sheet() -> ParsedStyleSheet {
    ParsedStyleSheet {
        paragraph_styles: Vec::new(),
        paragraph_style_by_id: HashMap::new(),
        run_style_by_id: HashMap::new(),
        table_style_by_id: HashMap::new(),
        table_paragraph_spacing_by_style_id: HashMap::new(),
        default_paragraph_style: None,
        default_paragraph_style_id: None,
        default_run_style: None,
        theme_fonts: ThemeFontMap::default(),
        theme_colors: ThemeColorMap::new(),
    }
}

pub fn default_table_look() -> ParsedTableLook {
    ParsedTableLook {
        first_row: false,
        last_row: false,
        first_col: false,
        last_col: false,
        no_h_band: true,
        no_v_band: true,
        row_band_size: 1,
        col_band_size: 1,
    }
}

/// Mirrors TypeScript `ParseContext`.
pub struct ParseContext<'a> {
    pub relationships: HashMap<String, String>,
    pub content_types: ContentTypeLookup,
    pub parts: &'a HashMap<String, OoxmlPart>,
    pub binary_assets: &'a HashMap<String, Vec<u8>>,
    pub style_sheet: ParsedStyleSheet,
    pub warnings: RefCell<Vec<String>>,
}

impl<'a> ParseContext<'a> {
    pub fn push_warning(&self, message: impl Into<String>) {
        self.warnings.borrow_mut().push(message.into());
    }
}
