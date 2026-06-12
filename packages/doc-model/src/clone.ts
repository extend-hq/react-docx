import type {
  DocModel,
  DocNode,
  FooterSection,
  HeaderSection,
  NumberingDefinitionSet,
  ParagraphBorderSet,
  ParagraphBorderStyle,
  ParagraphIndent,
  ParagraphNode,
  ParagraphNumbering,
  ParagraphSpacing,
  ParagraphStyle,
  ParagraphStyleDefinition,
  TableBorderSet,
  TableBorderStyle,
  TableBoxSpacing,
  TableCellContentNode,
  TableNode,
  TableStyle,
} from "./types";

function isParagraphCellContent(
  node: TableCellContentNode
): node is ParagraphNode {
  return node.type === "paragraph";
}

function isTableCellContentTable(
  node: TableCellContentNode
): node is TableNode {
  return node.type === "table";
}

function cloneTableCellContent(
  nodes: TableCellContentNode[]
): TableCellContentNode[] {
  return nodes.map((node) => {
    if (isParagraphCellContent(node)) {
      return cloneParagraph(node);
    }

    if (isTableCellContentTable(node)) {
      return cloneTable(node);
    }

    return node;
  });
}

function cloneParagraphNumbering(
  numbering?: ParagraphNumbering
): ParagraphNumbering | undefined {
  return numbering ? { ...numbering } : undefined;
}

function cloneParagraphSpacing(
  spacing?: ParagraphSpacing
): ParagraphSpacing | undefined {
  return spacing ? { ...spacing } : undefined;
}

function cloneParagraphIndent(
  indent?: ParagraphIndent
): ParagraphIndent | undefined {
  return indent ? { ...indent } : undefined;
}

function cloneParagraphBorderStyle(
  border?: ParagraphBorderStyle
): ParagraphBorderStyle | undefined {
  return border ? { ...border } : undefined;
}

function cloneParagraphBorderSet(
  borders?: ParagraphBorderSet
): ParagraphBorderSet | undefined {
  if (!borders) {
    return undefined;
  }

  return {
    top: cloneParagraphBorderStyle(borders.top),
    right: cloneParagraphBorderStyle(borders.right),
    bottom: cloneParagraphBorderStyle(borders.bottom),
    left: cloneParagraphBorderStyle(borders.left),
    between: cloneParagraphBorderStyle(borders.between),
    bar: cloneParagraphBorderStyle(borders.bar),
  };
}

function cloneParagraphStyle(
  style?: ParagraphStyle
): ParagraphStyle | undefined {
  if (!style) {
    return undefined;
  }

  return {
    ...style,
    numbering: cloneParagraphNumbering(style.numbering),
    spacing: cloneParagraphSpacing(style.spacing),
    indent: cloneParagraphIndent(style.indent),
    borders: cloneParagraphBorderSet(style.borders),
    dropCap: style.dropCap
      ? {
          ...style.dropCap,
        }
      : undefined,
  };
}

function cloneParagraph(paragraph: ParagraphNode): ParagraphNode {
  return {
    type: "paragraph",
    style: cloneParagraphStyle(paragraph.style),
    paragraphMarkDeleted: paragraph.paragraphMarkDeleted,
    sourceXml: paragraph.sourceXml,
    children: paragraph.children.map((child) => {
      if (child.type === "text") {
        return {
          type: "text" as const,
          text: child.text,
          style: child.style ? { ...child.style } : undefined,
          link: child.link,
        };
      }

      if (child.type === "form-field") {
        return {
          type: "form-field" as const,
          fieldType: child.fieldType,
          sourceKind: child.sourceKind,
          id: child.id,
          tag: child.tag,
          title: child.title,
          placeholder: child.placeholder,
          checked: child.checked,
          value: child.value,
          options: child.options?.map((option) => ({
            displayText: option.displayText,
            value: option.value,
          })),
          widget: child.widget
            ? {
                name: child.widget.name,
                enabled: child.widget.enabled,
                calcOnExit: child.widget.calcOnExit,
                text: child.widget.text
                  ? {
                      inputType: child.widget.text.inputType,
                      defaultText: child.widget.text.defaultText,
                      maxLength: child.widget.text.maxLength,
                      textFormat: child.widget.text.textFormat,
                    }
                  : undefined,
                checkbox: child.widget.checkbox
                  ? {
                      defaultChecked: child.widget.checkbox.defaultChecked,
                      sizeMode: child.widget.checkbox.sizeMode,
                      sizePt: child.widget.checkbox.sizePt,
                    }
                  : undefined,
                dropdown: child.widget.dropdown
                  ? {
                      defaultValue: child.widget.dropdown.defaultValue,
                    }
                  : undefined,
              }
            : undefined,
          checkedSymbol: child.checkedSymbol,
          uncheckedSymbol: child.uncheckedSymbol,
          style: child.style ? { ...child.style } : undefined,
          link: child.link,
          sourceXml: child.sourceXml,
        };
      }

      return {
        type: "image" as const,
        src: child.src,
        alt: child.alt,
        widthPx: child.widthPx,
        heightPx: child.heightPx,
        partName: child.partName,
        contentType: child.contentType,
        data: child.data ? new Uint8Array(child.data) : undefined,
        sourceXml: child.sourceXml,
        crop: child.crop ? { ...child.crop } : undefined,
        cssFilter: child.cssFilter,
        cssOpacity: child.cssOpacity,
        floating: child.floating ? { ...child.floating } : undefined,
        syntheticTextBox: child.syntheticTextBox,
        textBoxText: child.textBoxText,
      };
    }),
  };
}

function cloneTableBoxSpacing(
  spacing?: TableBoxSpacing
): TableBoxSpacing | undefined {
  if (!spacing) {
    return undefined;
  }

  return {
    topTwips: spacing.topTwips,
    rightTwips: spacing.rightTwips,
    bottomTwips: spacing.bottomTwips,
    leftTwips: spacing.leftTwips,
  };
}

function cloneTableBorderStyle(
  border?: TableBorderStyle
): TableBorderStyle | undefined {
  if (!border) {
    return undefined;
  }

  return {
    type: border.type,
    color: border.color,
    sizeEighthPt: border.sizeEighthPt,
  };
}

function cloneTableBorderSet(
  borders?: TableBorderSet
): TableBorderSet | undefined {
  if (!borders) {
    return undefined;
  }

  return {
    top: cloneTableBorderStyle(borders.top),
    right: cloneTableBorderStyle(borders.right),
    bottom: cloneTableBorderStyle(borders.bottom),
    left: cloneTableBorderStyle(borders.left),
    insideH: cloneTableBorderStyle(borders.insideH),
    insideV: cloneTableBorderStyle(borders.insideV),
    tl2br: cloneTableBorderStyle(borders.tl2br),
    tr2bl: cloneTableBorderStyle(borders.tr2bl),
  };
}

function cloneTableFloatingStyle(
  floating?: NonNullable<TableStyle["floating"]>
): NonNullable<TableStyle["floating"]> | undefined {
  if (!floating) {
    return undefined;
  }

  return {
    xTwips: floating.xTwips,
    yTwips: floating.yTwips,
    leftFromTextTwips: floating.leftFromTextTwips,
    rightFromTextTwips: floating.rightFromTextTwips,
    topFromTextTwips: floating.topFromTextTwips,
    bottomFromTextTwips: floating.bottomFromTextTwips,
    horizontalAnchor: floating.horizontalAnchor,
    verticalAnchor: floating.verticalAnchor,
    horizontalAlign: floating.horizontalAlign,
    verticalAlign: floating.verticalAlign,
  };
}

function cloneTable(table: TableNode): TableNode {
  return {
    type: "table",
    sourceXml: table.sourceXml,
    style: table.style
      ? {
          widthTwips: table.style.widthTwips,
          indentTwips: table.style.indentTwips,
          layout: table.style.layout,
          cellSpacingTwips: table.style.cellSpacingTwips,
          floating: cloneTableFloatingStyle(table.style.floating),
          cellMarginTwips: cloneTableBoxSpacing(table.style.cellMarginTwips),
          columnWidthsTwips: table.style.columnWidthsTwips
            ? [...table.style.columnWidthsTwips]
            : undefined,
          borders: cloneTableBorderSet(table.style.borders),
        }
      : undefined,
    rows: table.rows.map((row) => ({
      type: "table-row",
      style: row.style ? { ...row.style } : undefined,
      cells: row.cells.map((cell) => ({
        type: "table-cell",
        style: cell.style
          ? {
              ...cell.style,
              marginTwips: cloneTableBoxSpacing(cell.style.marginTwips),
              borders: cloneTableBorderSet(cell.style.borders),
            }
          : undefined,
        nodes: cloneTableCellContent(cell.nodes),
      })),
    })),
  };
}

function cloneDocNode(node: DocNode): DocNode {
  return node.type === "paragraph" ? cloneParagraph(node) : cloneTable(node);
}

function cloneNumberingDefinitions(
  numberingDefinitions?: NumberingDefinitionSet
): NumberingDefinitionSet | undefined {
  if (!numberingDefinitions) {
    return undefined;
  }

  return {
    abstracts: numberingDefinitions.abstracts.map((abstractDefinition) => ({
      abstractNumId: abstractDefinition.abstractNumId,
      levels: abstractDefinition.levels.map((level) => ({
        ...level,
        runStyle: level.runStyle ? { ...level.runStyle } : undefined,
        pictureBullet: level.pictureBullet
          ? { ...level.pictureBullet }
          : undefined,
      })),
    })),
    instances: numberingDefinitions.instances.map((instanceDefinition) => ({
      numId: instanceDefinition.numId,
      abstractNumId: instanceDefinition.abstractNumId,
      levelStartOverrides: instanceDefinition.levelStartOverrides
        ? { ...instanceDefinition.levelStartOverrides }
        : undefined,
      levelOverrides: instanceDefinition.levelOverrides
        ? instanceDefinition.levelOverrides.map((level) => ({
            ...level,
            runStyle: level.runStyle ? { ...level.runStyle } : undefined,
            pictureBullet: level.pictureBullet
              ? { ...level.pictureBullet }
              : undefined,
          }))
        : undefined,
    })),
  };
}

export function cloneDocModel(model: DocModel): DocModel {
  return {
    nodes: model.nodes.map(cloneDocNode),
    metadata: {
      sourceParts: model.metadata.sourceParts,
      warnings: [...model.metadata.warnings],
      documentPageCount: model.metadata.documentPageCount,
      documentOpenTag: model.metadata.documentOpenTag,
      documentBackgroundColor: model.metadata.documentBackgroundColor,
      sectionPropertiesXml: model.metadata.sectionPropertiesXml,
      sections: model.metadata.sections?.map((section) => ({
        startNodeIndex: section.startNodeIndex,
        sectionPropertiesXml: section.sectionPropertiesXml,
        headerSections: (section.headerSections ?? []).map((headerSection) => ({
          partName: headerSection.partName,
          referenceType: headerSection.referenceType,
          nodes: headerSection.nodes.map(cloneDocNode),
        })),
        footerSections: (section.footerSections ?? []).map((footerSection) => ({
          partName: footerSection.partName,
          referenceType: footerSection.referenceType,
          nodes: footerSection.nodes.map(cloneDocNode),
        })),
      })),
      headerSections: (model.metadata.headerSections ?? []).map((section) => ({
        partName: section.partName,
        referenceType: section.referenceType,
        nodes: section.nodes.map(cloneDocNode),
      })),
      footerSections: (model.metadata.footerSections ?? []).map((section) => ({
        partName: section.partName,
        referenceType: section.referenceType,
        nodes: section.nodes.map(cloneDocNode),
      })),
      paragraphStyles: (model.metadata.paragraphStyles ?? []).map((style) => ({
        ...style,
        runStyle: style.runStyle ? { ...style.runStyle } : undefined,
        numbering: cloneParagraphNumbering(style.numbering),
        spacing: cloneParagraphSpacing(style.spacing),
        indent: cloneParagraphIndent(style.indent),
        borders: cloneParagraphBorderSet(style.borders),
      })),
      defaultParagraphStyleId: model.metadata.defaultParagraphStyleId,
      numberingDefinitions: cloneNumberingDefinitions(
        model.metadata.numberingDefinitions
      ),
      compatibility: model.metadata.compatibility
        ? { ...model.metadata.compatibility }
        : undefined,
      footnotes: model.metadata.footnotes?.map((note) => ({
        ...note,
        nodes: note.nodes?.map(cloneDocNode),
      })),
      endnotes: model.metadata.endnotes?.map((note) => ({
        ...note,
        nodes: note.nodes?.map(cloneDocNode),
      })),
      comments: model.metadata.comments?.map((comment) => ({ ...comment })),
    },
  };
}
