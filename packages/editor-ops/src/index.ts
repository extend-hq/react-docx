import type {
  DocModel,
  FormFieldRunNode,
  HeadingLevel,
  ImageRunNode,
  ParagraphAlignment,
  ParagraphNode,
  TableCellContentNode,
  TableNode,
  ParagraphStyle,
  TextRunNode,
  TextStyle
} from "@extend-ai/react-docx-doc-model";
import { cloneDocModel } from "@extend-ai/react-docx-doc-model";

export interface InsertParagraphOptions {
  paragraphStyle?: ParagraphStyle;
  runStyle?: TextStyle;
}

export interface UpdateTextOptions {
  insertedStyle?: TextStyle;
}

function paragraphFromText(text: string, options?: InsertParagraphOptions): ParagraphNode {
  return {
    type: "paragraph",
    style: options?.paragraphStyle,
    children: [{ type: "text", text, style: options?.runStyle }]
  };
}

function getParagraph(model: DocModel, nodeIndex: number): ParagraphNode | undefined {
  const node = model.nodes[nodeIndex];
  if (!node || node.type !== "paragraph") {
    return undefined;
  }
  return node;
}

function ensureTextRun(paragraph: ParagraphNode, runIndex: number): TextRunNode {
  let textRunCount = -1;

  for (const child of paragraph.children) {
    if (child.type !== "text") {
      continue;
    }

    textRunCount += 1;
    if (textRunCount === runIndex) {
      return child;
    }
  }

  const created: TextRunNode = {
    type: "text",
    text: "",
    style: {}
  };

  paragraph.children.push(created);
  return created;
}

function textRuns(paragraph: ParagraphNode): TextRunNode[] {
  return paragraph.children.filter((child): child is TextRunNode => child.type === "text");
}

function cloneTextRun(run: TextRunNode): TextRunNode {
  return {
    type: "text",
    text: run.text,
    style: run.style ? { ...run.style } : undefined,
    link: run.link,
    noteReference: run.noteReference ? { ...run.noteReference } : undefined
  };
}

function noteReferencesEqual(left?: TextRunNode["noteReference"], right?: TextRunNode["noteReference"]): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.kind === right.kind && left.id === right.id;
}

function cloneFormFieldRun(run: FormFieldRunNode): FormFieldRunNode {
  return {
    type: "form-field",
    fieldType: run.fieldType,
    sourceKind: run.sourceKind,
    id: run.id,
    tag: run.tag,
    title: run.title,
    placeholder: run.placeholder,
    checked: run.checked,
    value: run.value,
    options: run.options?.map((option) => ({
      displayText: option.displayText,
      value: option.value
    })),
    widget: run.widget
      ? {
          name: run.widget.name,
          enabled: run.widget.enabled,
          calcOnExit: run.widget.calcOnExit,
          text: run.widget.text
            ? {
                inputType: run.widget.text.inputType,
                defaultText: run.widget.text.defaultText,
                maxLength: run.widget.text.maxLength,
                textFormat: run.widget.text.textFormat
              }
            : undefined,
          checkbox: run.widget.checkbox
            ? {
                defaultChecked: run.widget.checkbox.defaultChecked,
                sizeMode: run.widget.checkbox.sizeMode,
                sizePt: run.widget.checkbox.sizePt
              }
            : undefined,
          dropdown: run.widget.dropdown
            ? {
                defaultValue: run.widget.dropdown.defaultValue
              }
            : undefined
        }
      : undefined,
    checkedSymbol: run.checkedSymbol,
    uncheckedSymbol: run.uncheckedSymbol,
    style: run.style ? { ...run.style } : undefined,
    link: run.link,
    sourceXml: run.sourceXml
  };
}

function cloneImageRun(run: ImageRunNode): ImageRunNode {
  return {
    type: "image",
    src: run.src,
    alt: run.alt,
    widthPx: run.widthPx,
    heightPx: run.heightPx,
    partName: run.partName,
    contentType: run.contentType,
    data: run.data ? new Uint8Array(run.data) : undefined,
    floating: run.floating ? { ...run.floating } : undefined,
    syntheticTextBox: run.syntheticTextBox,
    textBoxText: run.textBoxText
  };
}

function cloneParagraphChildRun(
  run: ParagraphNode["children"][number]
): ParagraphNode["children"][number] {
  if (run.type === "text") {
    return cloneTextRun(run);
  }

  if (run.type === "form-field") {
    return cloneFormFieldRun(run);
  }

  return cloneImageRun(run);
}

function cloneTextStyle(style?: TextStyle): TextStyle | undefined {
  return style ? { ...style } : undefined;
}

function textStylesEqual(left?: TextStyle, right?: TextStyle): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function mergeAdjacentRuns(runs: TextRunNode[]): TextRunNode[] {
  const merged: TextRunNode[] = [];

  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      textStylesEqual(previous.style, run.style) &&
      previous.link === run.link &&
      noteReferencesEqual(previous.noteReference, run.noteReference)
    ) {
      previous.text += run.text;
      continue;
    }

    merged.push(cloneTextRun(run));
  }

  return merged;
}

function formFieldDisplayValue(field: FormFieldRunNode): string {
  switch (field.fieldType) {
    case "checkbox":
      return field.checked ?? field.widget?.checkbox?.defaultChecked
        ? field.checkedSymbol ?? "☒"
        : field.uncheckedSymbol ?? "☐";
    case "dropdown":
      return field.value ?? field.options?.[0]?.displayText ?? "";
    case "date":
    case "text":
      return field.value ?? field.widget?.text?.defaultText ?? "";
    default:
      return "";
  }
}

function splitRunsAtOffset(
  runs: TextRunNode[],
  offset: number
): {
  left: TextRunNode[];
  right: TextRunNode[];
} {
  const safeOffset = Math.max(0, offset);
  const left: TextRunNode[] = [];
  const right: TextRunNode[] = [];
  let cursor = 0;

  for (const run of runs) {
    const runLength = run.text.length;
    const runStart = cursor;
    const runEnd = runStart + runLength;
    cursor = runEnd;

    if (runEnd <= safeOffset) {
      left.push(cloneTextRun(run));
      continue;
    }

    if (runStart >= safeOffset) {
      right.push(cloneTextRun(run));
      continue;
    }

    const localSplit = Math.max(0, Math.min(runLength, safeOffset - runStart));
    const before = run.text.slice(0, localSplit);
    const after = run.text.slice(localSplit);
    if (before.length > 0) {
      left.push({
        type: "text",
        text: before,
        style: cloneTextStyle(run.style),
        link: run.link,
        noteReference: run.noteReference ? { ...run.noteReference } : undefined
      });
    }
    if (after.length > 0) {
      right.push({
        type: "text",
        text: after,
        style: cloneTextStyle(run.style),
        link: run.link,
        noteReference: run.noteReference ? { ...run.noteReference } : undefined
      });
    }
  }

  return { left, right };
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  const leftRemaining = left.length - prefixLength;
  const rightRemaining = right.length - prefixLength;
  const limit = Math.min(leftRemaining, rightRemaining);
  let matched = 0;

  while (
    matched < limit &&
    left[left.length - 1 - matched] === right[right.length - 1 - matched]
  ) {
    matched += 1;
  }

  return matched;
}

function distributeTextAcrossRuns(
  text: string,
  templateRuns: TextRunNode[],
  options?: UpdateTextOptions
): TextRunNode[] {
  const normalizedText = text ?? "";
  if (templateRuns.length === 0) {
    return [
      {
        type: "text",
        text: normalizedText,
        style: cloneTextStyle(options?.insertedStyle)
      }
    ];
  }

  const originalRuns = templateRuns.map(cloneTextRun);
  const originalText = originalRuns.map((run) => run.text).join("");
  if (originalText === normalizedText) {
    return originalRuns;
  }

  const prefixLength = commonPrefixLength(originalText, normalizedText);
  const suffixLength = commonSuffixLength(originalText, normalizedText, prefixLength);
  const removeStart = prefixLength;
  const removeEnd = Math.max(removeStart, originalText.length - suffixLength);
  const insertedText = normalizedText.slice(prefixLength, normalizedText.length - suffixLength);

  const splitBefore = splitRunsAtOffset(originalRuns, removeStart);
  const splitAfter = splitRunsAtOffset(splitBefore.right, removeEnd - removeStart);
  const leftRuns = splitBefore.left;
  const rightRuns = splitAfter.right;

  const insertedRuns: TextRunNode[] = [];
  if (insertedText.length > 0) {
    const previousRun = leftRuns[leftRuns.length - 1];
    const nextRun = rightRuns[0];
    const inferredLink =
      previousRun?.link && nextRun?.link && previousRun.link === nextRun.link
        ? previousRun.link
        : previousRun?.link ?? nextRun?.link;

    insertedRuns.push({
      type: "text",
      text: insertedText,
      style: cloneTextStyle(options?.insertedStyle ?? previousRun?.style ?? nextRun?.style),
      link: inferredLink
    });
  }

  const merged = mergeAdjacentRuns([...leftRuns, ...insertedRuns, ...rightRuns]);
  if (merged.length > 0) {
    return merged;
  }

  return [
    {
      type: "text",
      text: "",
      style: cloneTextStyle(options?.insertedStyle ?? templateRuns[0]?.style),
      link: templateRuns[0]?.link
    }
  ];
}

function distributeTextAcrossParagraphChildren(
  paragraph: ParagraphNode,
  text: string,
  options?: UpdateTextOptions
): ParagraphNode["children"] {
  const hasNonTextRuns = paragraph.children.some((child) => child.type !== "text");
  if (!hasNonTextRuns) {
    return distributeTextAcrossRuns(text, textRuns(paragraph), options);
  }

  const textGroups: TextRunNode[][] = [];
  const anchors: Array<Exclude<ParagraphNode["children"][number], TextRunNode>> = [];
  let currentGroup: TextRunNode[] = [];

  for (const child of paragraph.children) {
    if (child.type === "text") {
      currentGroup.push(cloneTextRun(child));
      continue;
    }

    textGroups.push(currentGroup);
    currentGroup = [];
    anchors.push(
      child.type === "form-field"
        ? cloneFormFieldRun(child)
        : cloneImageRun(child)
    );
  }
  textGroups.push(currentGroup);

  const allAnchorsAreImages = anchors.length > 0 && anchors.every((anchor) => anchor.type === "image");
  if (allAnchorsAreImages) {
    const originalSegmentTexts = textGroups.map((group) => group.map((run) => run.text).join(""));
    const originalText = originalSegmentTexts.join("");
    const originalAnchorOffsets: number[] = [];
    let originalOffsetCursor = 0;
    for (let index = 0; index < anchors.length; index += 1) {
      originalOffsetCursor += originalSegmentTexts[index]?.length ?? 0;
      originalAnchorOffsets.push(originalOffsetCursor);
    }

    const prefixLength = (() => {
      const limit = Math.min(originalText.length, text.length);
      let index = 0;
      while (index < limit && originalText[index] === text[index]) {
        index += 1;
      }
      return index;
    })();
    const suffixLength = (() => {
      const remainingOriginal = originalText.length - prefixLength;
      const remainingNext = text.length - prefixLength;
      const limit = Math.min(remainingOriginal, remainingNext);
      let index = 0;
      while (
        index < limit &&
        originalText[originalText.length - 1 - index] === text[text.length - 1 - index]
      ) {
        index += 1;
      }
      return index;
    })();
    const replacedOriginalStart = prefixLength;
    const replacedOriginalEnd = Math.max(replacedOriginalStart, originalText.length - suffixLength);
    const replacedNextEnd = Math.max(replacedOriginalStart, text.length - suffixLength);
    const delta = replacedNextEnd - replacedOriginalEnd;
    const remappedAnchorOffsets = originalAnchorOffsets.map((anchorOffset) => {
      if (anchorOffset < replacedOriginalStart) {
        return anchorOffset;
      }
      if (anchorOffset >= replacedOriginalEnd) {
        return anchorOffset + delta;
      }
      return replacedOriginalStart;
    });

    const segments: string[] = [];
    let cursor = 0;
    remappedAnchorOffsets.forEach((anchorOffset) => {
      const safeAnchorOffset = Math.max(cursor, Math.min(anchorOffset, text.length));
      segments.push(text.slice(cursor, safeAnchorOffset));
      cursor = safeAnchorOffset;
    });
    segments.push(text.slice(cursor));

    const nextChildren: ParagraphNode["children"] = [];
    for (let index = 0; index < textGroups.length; index += 1) {
      const templateRuns = textGroups[index];
      const segmentText = segments[index] ?? "";

      if (templateRuns.length > 0) {
        nextChildren.push(...distributeTextAcrossRuns(segmentText, templateRuns, options));
      } else if (segmentText.length > 0) {
        nextChildren.push({
          type: "text",
          text: segmentText,
          style: cloneTextStyle(options?.insertedStyle)
        });
      }

      if (index < anchors.length) {
        nextChildren.push(cloneParagraphChildRun(anchors[index]));
      }
    }

    if (nextChildren.length > 0) {
      return nextChildren;
    }
  }

  const segments: string[] = [];
  let cursor = 0;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const anchorText = anchor.type === "form-field" ? formFieldDisplayValue(anchor) : "";
    if (!anchorText) {
      return distributeTextAcrossRuns(text, textRuns(paragraph), options);
    }

    const anchorIndex = text.indexOf(anchorText, cursor);
    if (anchorIndex < 0) {
      segments.push(text.slice(cursor));
      cursor = text.length;
      break;
    }

    segments.push(text.slice(cursor, anchorIndex));
    cursor = anchorIndex + anchorText.length;
  }

  segments.push(text.slice(cursor));
  while (segments.length < textGroups.length) {
    segments.push("");
  }

  const nextChildren: ParagraphNode["children"] = [];
  for (let index = 0; index < textGroups.length; index += 1) {
    const templateRuns = textGroups[index];
    const segmentText = segments[index] ?? "";

    if (templateRuns.length > 0) {
      nextChildren.push(...distributeTextAcrossRuns(segmentText, templateRuns, options));
    } else if (segmentText.length > 0) {
      nextChildren.push({
        type: "text",
        text: segmentText,
        style: cloneTextStyle(options?.insertedStyle)
      });
    }

    if (index < anchors.length) {
      nextChildren.push(cloneParagraphChildRun(anchors[index]));
    }
  }

  if (nextChildren.length > 0) {
    return nextChildren;
  }

  return [
    {
      type: "text",
      text: "",
      style: cloneTextStyle(options?.insertedStyle)
    }
  ];
}

export function splitParagraphChildrenAtTextOffsets(
  paragraph: ParagraphNode,
  text: string,
  startOffset: number,
  endOffset: number,
  options?: {
    beforeInsertedStyle?: TextStyle;
    afterInsertedStyle?: TextStyle;
  }
): {
  beforeChildren: ParagraphNode["children"];
  afterChildren: ParagraphNode["children"];
} {
  const normalizedText = text ?? "";
  const safeStart = Math.max(0, Math.min(Math.round(startOffset), normalizedText.length));
  const safeEnd = Math.max(safeStart, Math.min(Math.round(endOffset), normalizedText.length));
  const hasNonTextRuns = paragraph.children.some((child) => child.type !== "text");

  if (!hasNonTextRuns) {
    return {
      beforeChildren: distributeTextAcrossRuns(
        normalizedText.slice(0, safeStart),
        textRuns(paragraph),
        { insertedStyle: options?.beforeInsertedStyle }
      ),
      afterChildren: distributeTextAcrossRuns(
        normalizedText.slice(safeEnd),
        textRuns(paragraph),
        { insertedStyle: options?.afterInsertedStyle }
      )
    };
  }

  const textGroups: TextRunNode[][] = [];
  const anchors: Array<Exclude<ParagraphNode["children"][number], TextRunNode>> = [];
  let currentGroup: TextRunNode[] = [];

  for (const child of paragraph.children) {
    if (child.type === "text") {
      currentGroup.push(cloneTextRun(child));
      continue;
    }

    textGroups.push(currentGroup);
    currentGroup = [];
    anchors.push(
      child.type === "form-field"
        ? cloneFormFieldRun(child)
        : cloneImageRun(child)
    );
  }
  textGroups.push(currentGroup);

  let segments: string[] | undefined;
  let anchorOffsets: number[] | undefined;

  const allAnchorsAreImages = anchors.length > 0 && anchors.every((anchor) => anchor.type === "image");
  if (allAnchorsAreImages) {
    const originalSegmentTexts = textGroups.map((group) => group.map((run) => run.text).join(""));
    const originalText = originalSegmentTexts.join("");
    const originalAnchorOffsets: number[] = [];
    let originalOffsetCursor = 0;
    for (let index = 0; index < anchors.length; index += 1) {
      originalOffsetCursor += originalSegmentTexts[index]?.length ?? 0;
      originalAnchorOffsets.push(originalOffsetCursor);
    }

    const prefixLength = commonPrefixLength(originalText, normalizedText);
    const suffixLength = commonSuffixLength(originalText, normalizedText, prefixLength);
    const replacedOriginalStart = prefixLength;
    const replacedOriginalEnd = Math.max(replacedOriginalStart, originalText.length - suffixLength);
    const replacedNextEnd = Math.max(replacedOriginalStart, normalizedText.length - suffixLength);
    const delta = replacedNextEnd - replacedOriginalEnd;
    const remappedAnchorOffsets = originalAnchorOffsets.map((anchorOffset) => {
      if (anchorOffset < replacedOriginalStart) {
        return anchorOffset;
      }
      if (anchorOffset >= replacedOriginalEnd) {
        return anchorOffset + delta;
      }
      return replacedOriginalStart;
    });

    const nextSegments: string[] = [];
    let cursor = 0;
    remappedAnchorOffsets.forEach((anchorOffset) => {
      const safeAnchorOffset = Math.max(cursor, Math.min(anchorOffset, normalizedText.length));
      nextSegments.push(normalizedText.slice(cursor, safeAnchorOffset));
      cursor = safeAnchorOffset;
    });
    nextSegments.push(normalizedText.slice(cursor));
    segments = nextSegments;
    anchorOffsets = remappedAnchorOffsets;
  } else {
    const nextSegments: string[] = [];
    const nextAnchorOffsets: number[] = [];
    let cursor = 0;

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const anchorText = anchor.type === "form-field" ? formFieldDisplayValue(anchor) : "";
      if (!anchorText) {
        segments = undefined;
        anchorOffsets = undefined;
        break;
      }

      const anchorIndex = normalizedText.indexOf(anchorText, cursor);
      if (anchorIndex < 0) {
        nextSegments.push(normalizedText.slice(cursor));
        cursor = normalizedText.length;
        break;
      }

      nextSegments.push(normalizedText.slice(cursor, anchorIndex));
      cursor = anchorIndex + anchorText.length;
      nextAnchorOffsets.push(anchorIndex);
    }

    if (nextSegments.length > 0 || anchors.length === 0) {
      nextSegments.push(normalizedText.slice(cursor));
      while (nextSegments.length < textGroups.length) {
        nextSegments.push("");
      }
      segments = nextSegments;
      anchorOffsets = nextAnchorOffsets;
    }
  }

  if (!segments || !anchorOffsets) {
    return {
      beforeChildren: distributeTextAcrossRuns(
        normalizedText.slice(0, safeStart),
        textRuns(paragraph),
        { insertedStyle: options?.beforeInsertedStyle }
      ),
      afterChildren: distributeTextAcrossRuns(
        normalizedText.slice(safeEnd),
        textRuns(paragraph),
        { insertedStyle: options?.afterInsertedStyle }
      )
    };
  }

  const beforeChildren: ParagraphNode["children"] = [];
  const afterChildren: ParagraphNode["children"] = [];
  let cursor = 0;

  for (let index = 0; index < textGroups.length; index += 1) {
    const templateRuns = textGroups[index];
    const segmentText = segments[index] ?? "";
    const segmentStart = cursor;
    const segmentEnd = segmentStart + segmentText.length;
    cursor = segmentEnd;

    const beforePart =
      safeStart <= segmentStart
        ? ""
        : segmentText.slice(0, Math.max(0, Math.min(segmentText.length, safeStart - segmentStart)));
    const afterPart =
      safeEnd >= segmentEnd
        ? ""
        : segmentText.slice(Math.max(0, Math.min(segmentText.length, safeEnd - segmentStart)));

    if (templateRuns.length > 0) {
      if (beforePart.length > 0) {
        beforeChildren.push(
          ...distributeTextAcrossRuns(beforePart, templateRuns, {
            insertedStyle: options?.beforeInsertedStyle
          })
        );
      }
      if (afterPart.length > 0) {
        afterChildren.push(
          ...distributeTextAcrossRuns(afterPart, templateRuns, {
            insertedStyle: options?.afterInsertedStyle
          })
        );
      }
    } else {
      if (beforePart.length > 0) {
        beforeChildren.push({
          type: "text",
          text: beforePart,
          style: cloneTextStyle(options?.beforeInsertedStyle)
        });
      }
      if (afterPart.length > 0) {
        afterChildren.push({
          type: "text",
          text: afterPart,
          style: cloneTextStyle(options?.afterInsertedStyle)
        });
      }
    }

    if (index < anchors.length) {
      const anchor = cloneParagraphChildRun(anchors[index]);
      const anchorOffset = anchorOffsets[index] ?? segmentEnd;
      if (anchorOffset <= safeStart) {
        beforeChildren.push(anchor);
      } else if (anchorOffset >= safeEnd) {
        afterChildren.push(anchor);
      } else {
        beforeChildren.push(anchor);
      }
    }
  }

  if (beforeChildren.length === 0) {
    beforeChildren.push({
      type: "text",
      text: "",
      style: cloneTextStyle(options?.beforeInsertedStyle)
    });
  }

  if (afterChildren.length === 0) {
    afterChildren.push({
      type: "text",
      text: "",
      style: cloneTextStyle(options?.afterInsertedStyle)
    });
  }

  return {
    beforeChildren,
    afterChildren
  };
}

function cloneParagraph(paragraph: ParagraphNode): ParagraphNode {
  return {
    type: "paragraph",
    style: paragraph.style ? { ...paragraph.style } : undefined,
    sourceXml: paragraph.sourceXml,
    children: paragraph.children.map(cloneParagraphChildRun)
  };
}

export function insertParagraph(
  model: DocModel,
  text: string,
  index = model.nodes.length,
  options?: InsertParagraphOptions
): DocModel {
  const next = cloneDocModel(model);
  const safeIndex = Math.max(0, Math.min(index, next.nodes.length));
  next.nodes.splice(safeIndex, 0, paragraphFromText(text, options));
  return next;
}

export function removeParagraph(model: DocModel, index: number): DocModel {
  const next = cloneDocModel(model);
  const node = getParagraph(next, index);
  if (!node) {
    return next;
  }

  next.nodes.splice(index, 1);

  if (!next.nodes.some((candidate) => candidate.type === "paragraph")) {
    next.nodes.push(paragraphFromText(""));
  }

  return next;
}

export function duplicateParagraph(model: DocModel, index: number): DocModel {
  const next = cloneDocModel(model);
  const node = getParagraph(next, index);
  if (!node) {
    return next;
  }

  next.nodes.splice(index + 1, 0, cloneParagraph(node));
  return next;
}

export function updateParagraphText(
  model: DocModel,
  index: number,
  text: string,
  options?: UpdateTextOptions
): DocModel {
  const next = cloneDocModel(model);
  const paragraph = getParagraph(next, index);
  if (!paragraph) {
    return next;
  }

  paragraph.children = distributeTextAcrossParagraphChildren(paragraph, text, options);
  paragraph.sourceXml = undefined;

  return next;
}

export function updateTableCellText(
  model: DocModel,
  tableIndex: number,
  rowIndex: number,
  cellIndex: number,
  text: string,
  options?: UpdateTextOptions
): DocModel {
  const next = cloneDocModel(model);
  const tableNode = next.nodes[tableIndex];
  if (!tableNode || tableNode.type !== "table") {
    return next;
  }

  const row = tableNode.rows[rowIndex];
  const cell = row?.cells[cellIndex];
  if (!cell) {
    return next;
  }

  const paragraphs = cell.nodes.filter((node): node is ParagraphNode => node.type === "paragraph");
  const incomingParagraphTexts = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  if (incomingParagraphTexts.length === 0) {
    incomingParagraphTexts.push("");
  }

  if (paragraphs.length === 0) {
    cell.nodes.push(paragraphFromText(incomingParagraphTexts[0] ?? "", {
      runStyle: cloneTextStyle(options?.insertedStyle)
    }));
    tableNode.sourceXml = undefined;
    return next;
  }

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphText = incomingParagraphTexts[paragraphIndex] ?? "";
    paragraph.children = distributeTextAcrossParagraphChildren(paragraph, paragraphText, options);
    paragraph.sourceXml = undefined;
  });

  if (incomingParagraphTexts.length > paragraphs.length) {
    for (let paragraphIndex = paragraphs.length; paragraphIndex < incomingParagraphTexts.length; paragraphIndex += 1) {
      cell.nodes.push(paragraphFromText(incomingParagraphTexts[paragraphIndex] ?? "", {
        runStyle: cloneTextStyle(options?.insertedStyle)
      }));
    }
  }

  tableNode.sourceXml = undefined;
  return next;
}

export function updateTableCellParagraphText(
  model: DocModel,
  tableIndex: number,
  rowIndex: number,
  cellIndex: number,
  paragraphIndex: number,
  text: string,
  options?: UpdateTextOptions
): DocModel {
  const next = cloneDocModel(model);
  const tableNode = next.nodes[tableIndex];
  if (!tableNode || tableNode.type !== "table") {
    return next;
  }

  const row = tableNode.rows[rowIndex];
  const cell = row?.cells[cellIndex];
  const paragraph = cell?.nodes.filter((node): node is ParagraphNode => node.type === "paragraph")[paragraphIndex];

  if (!cell || !paragraph) {
    return next;
  }

  paragraph.children = distributeTextAcrossParagraphChildren(paragraph, text, options);
  paragraph.sourceXml = undefined;
  tableNode.sourceXml = undefined;

  return next;
}

export function updateTableCellParagraphTextRecursive(
  model: DocModel,
  tableIndex: number,
  rowIndex: number,
  cellIndex: number,
  paragraphIndex: number,
  text: string,
  options?: UpdateTextOptions
): DocModel {
  const next = cloneDocModel(model);
  const tableNode = next.nodes[tableIndex];
  if (!tableNode || tableNode.type !== "table") {
    return next;
  }

  const row = tableNode.rows[rowIndex];
  const cell = row?.cells[cellIndex];
  if (!cell) {
    return next;
  }

  const targetParagraphIndex = Math.max(0, Math.round(paragraphIndex));
  let paragraphCursor = 0;

  const updateInNodes = (
    nodes: TableCellContentNode[],
    ancestorTables: TableNode[]
  ): boolean => {
    for (const node of nodes) {
      if (node.type === "paragraph") {
        if (paragraphCursor !== targetParagraphIndex) {
          paragraphCursor += 1;
          continue;
        }

        node.children = distributeTextAcrossParagraphChildren(node, text, options);
        node.sourceXml = undefined;
        ancestorTables.forEach((ancestorTable) => {
          ancestorTable.sourceXml = undefined;
        });
        return true;
      }

      ancestorTables.push(node);
      for (const nestedRow of node.rows) {
        for (const nestedCell of nestedRow.cells) {
          if (updateInNodes(nestedCell.nodes, ancestorTables)) {
            ancestorTables.pop();
            return true;
          }
        }
      }
      ancestorTables.pop();
    }

    return false;
  };

  updateInNodes(cell.nodes, [tableNode]);
  return next;
}

function mutateParagraphTextRuns(model: DocModel, transform: (run: TextRunNode) => void): void {
  for (const node of model.nodes) {
    if (node.type === "paragraph") {
      for (const child of node.children) {
        if (child.type === "text") {
          transform(child);
        }
      }
      node.sourceXml = undefined;
      continue;
    }

      for (const row of node.rows) {
      for (const cell of row.cells) {
        for (const paragraph of cell.nodes.filter((child): child is ParagraphNode => child.type === "paragraph")) {
          for (const child of paragraph.children) {
            if (child.type === "text") {
              transform(child);
            }
          }
          paragraph.sourceXml = undefined;
        }
      }
    }
    node.sourceXml = undefined;
  }
}

export function replaceText(model: DocModel, searchValue: string | RegExp, replacement: string): DocModel {
  const next = cloneDocModel(model);

  mutateParagraphTextRuns(next, (run) => {
    run.text = run.text.replace(searchValue, replacement);
  });

  return next;
}

export function setParagraphHeading(
  model: DocModel,
  nodeIndex: number,
  headingLevel?: HeadingLevel
): DocModel {
  const next = cloneDocModel(model);
  const paragraph = getParagraph(next, nodeIndex);
  if (!paragraph) {
    return next;
  }

  paragraph.style = {
    ...(paragraph.style ?? {}),
    headingLevel
  };
  paragraph.sourceXml = undefined;

  return next;
}

export function setParagraphAlignment(
  model: DocModel,
  nodeIndex: number,
  align?: ParagraphAlignment
): DocModel {
  const next = cloneDocModel(model);
  const paragraph = getParagraph(next, nodeIndex);
  if (!paragraph) {
    return next;
  }

  paragraph.style = {
    ...(paragraph.style ?? {}),
    align
  };
  paragraph.sourceXml = undefined;

  return next;
}

export function applyRunStyle(
  model: DocModel,
  nodeIndex: number,
  runIndex: number,
  style: Partial<TextStyle>
): DocModel {
  const next = cloneDocModel(model);
  const paragraph = getParagraph(next, nodeIndex);
  if (!paragraph) {
    return next;
  }

  const textRun = ensureTextRun(paragraph, runIndex);
  textRun.style = {
    ...(textRun.style ?? {}),
    ...style
  };
  paragraph.sourceXml = undefined;

  return next;
}

export function toggleRunStyleFlag(
  model: DocModel,
  nodeIndex: number,
  runIndex: number,
  key: "bold" | "italic" | "underline" | "strike"
): DocModel {
  const next = cloneDocModel(model);
  const paragraph = getParagraph(next, nodeIndex);
  if (!paragraph) {
    return next;
  }

  const textRun = ensureTextRun(paragraph, runIndex);
  const current = Boolean(textRun.style?.[key]);
  textRun.style = {
    ...(textRun.style ?? {}),
    [key]: !current
  };
  paragraph.sourceXml = undefined;

  return next;
}

export function setRunHighlight(
  model: DocModel,
  nodeIndex: number,
  runIndex: number,
  highlight?: string
): DocModel {
  return applyRunStyle(model, nodeIndex, runIndex, { highlight });
}

export function setRunColor(
  model: DocModel,
  nodeIndex: number,
  runIndex: number,
  color?: string
): DocModel {
  return applyRunStyle(model, nodeIndex, runIndex, { color });
}

export function copyParagraphs(model: DocModel, startIndex: number, endIndex = startIndex): ParagraphNode[] {
  const start = Math.max(0, Math.min(startIndex, model.nodes.length - 1));
  const end = Math.max(start, Math.min(endIndex, model.nodes.length - 1));

  const paragraphs: ParagraphNode[] = [];
  for (let index = start; index <= end; index += 1) {
    const node = model.nodes[index];
    if (node?.type === "paragraph") {
      paragraphs.push(cloneParagraph(node));
    }
  }

  return paragraphs;
}

export function pasteParagraphs(model: DocModel, index: number, paragraphs: ParagraphNode[]): DocModel {
  const next = cloneDocModel(model);
  const safeIndex = Math.max(0, Math.min(index, next.nodes.length));
  const copies = paragraphs.map(cloneParagraph);
  next.nodes.splice(safeIndex, 0, ...copies);
  return next;
}

export function serializeParagraphsForClipboard(paragraphs: ParagraphNode[]): string {
  return JSON.stringify(
    paragraphs.map((paragraph) => ({
      type: "paragraph",
      style: paragraph.style ?? undefined,
      sourceXml: paragraph.sourceXml,
      children: paragraph.children.map((run) =>
        run.type === "text"
          ? {
              type: "text" as const,
              text: run.text,
              style: run.style ?? undefined,
              link: run.link
            }
          : run.type === "form-field"
            ? cloneFormFieldRun(run)
          : {
              type: "image" as const,
              src: run.src,
              alt: run.alt,
              widthPx: run.widthPx,
              heightPx: run.heightPx,
              partName: run.partName,
              contentType: run.contentType,
              data: run.data ? Array.from(run.data) : undefined,
              floating: run.floating ? { ...run.floating } : undefined,
              syntheticTextBox: run.syntheticTextBox,
              textBoxText: run.textBoxText
            }
      )
    }))
  );
}

export function parseParagraphsFromClipboard(input: string): ParagraphNode[] | undefined {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const normalized: ParagraphNode[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const value = item as Partial<ParagraphNode>;
      if (value.type !== "paragraph" || !Array.isArray(value.children)) {
        continue;
      }

      const children: ParagraphNode["children"] = [];
      for (const run of value.children) {
        if (!run || typeof run !== "object") {
          continue;
        }

        if (run.type === "text" && typeof run.text === "string") {
          children.push({
            type: "text",
            text: run.text,
            style: run.style ? { ...run.style } : undefined,
            link: typeof run.link === "string" ? run.link : undefined
          });
          continue;
        }

        if (run.type === "image") {
          children.push({
            type: "image",
            src: run.src,
            alt: run.alt,
            widthPx: run.widthPx,
            heightPx: run.heightPx,
            partName: run.partName,
            contentType: run.contentType,
            data: Array.isArray(run.data) ? new Uint8Array(run.data) : undefined,
            floating: run.floating && typeof run.floating === "object" ? { ...run.floating } : undefined,
            syntheticTextBox: Boolean(run.syntheticTextBox),
            textBoxText:
              typeof run.textBoxText === "string" ? run.textBoxText : undefined
          });
          continue;
        }

        if (run.type === "form-field") {
          const options = Array.isArray(run.options)
            ? run.options.reduce<NonNullable<FormFieldRunNode["options"]>>((collected, option) => {
                if (!option || typeof option !== "object") {
                  return collected;
                }

                const displayText = typeof option.displayText === "string" ? option.displayText : undefined;
                if (!displayText) {
                  return collected;
                }

                collected.push({
                  displayText,
                  value: typeof option.value === "string" ? option.value : undefined
                });
                return collected;
              }, [])
            : undefined;
          const widget =
            run.widget && typeof run.widget === "object"
              ? {
                  name: typeof run.widget.name === "string" ? run.widget.name : undefined,
                  enabled: typeof run.widget.enabled === "boolean" ? run.widget.enabled : undefined,
                  calcOnExit:
                    typeof run.widget.calcOnExit === "boolean" ? run.widget.calcOnExit : undefined,
                  text:
                    run.widget.text && typeof run.widget.text === "object"
                      ? {
                          inputType:
                            typeof run.widget.text.inputType === "string"
                              ? run.widget.text.inputType
                              : undefined,
                          defaultText:
                            typeof run.widget.text.defaultText === "string"
                              ? run.widget.text.defaultText
                              : undefined,
                          maxLength:
                            typeof run.widget.text.maxLength === "number"
                              ? run.widget.text.maxLength
                              : undefined,
                          textFormat:
                            typeof run.widget.text.textFormat === "string"
                              ? run.widget.text.textFormat
                              : undefined
                        }
                      : undefined,
                  checkbox:
                    run.widget.checkbox && typeof run.widget.checkbox === "object"
                      ? {
                          defaultChecked:
                            typeof run.widget.checkbox.defaultChecked === "boolean"
                              ? run.widget.checkbox.defaultChecked
                              : undefined,
                          sizeMode:
                            run.widget.checkbox.sizeMode === "auto" ||
                            run.widget.checkbox.sizeMode === "exact"
                              ? run.widget.checkbox.sizeMode
                              : undefined,
                          sizePt:
                            typeof run.widget.checkbox.sizePt === "number"
                              ? run.widget.checkbox.sizePt
                              : undefined
                        }
                      : undefined,
                  dropdown:
                    run.widget.dropdown && typeof run.widget.dropdown === "object"
                      ? {
                          defaultValue:
                            typeof run.widget.dropdown.defaultValue === "string"
                              ? run.widget.dropdown.defaultValue
                              : undefined
                        }
                      : undefined
                }
              : undefined;

          children.push({
            type: "form-field",
            fieldType: run.fieldType,
            sourceKind:
              run.sourceKind === "legacy" || run.sourceKind === "sdt" ? run.sourceKind : undefined,
            id: typeof run.id === "number" ? run.id : undefined,
            tag: typeof run.tag === "string" ? run.tag : undefined,
            title: typeof run.title === "string" ? run.title : undefined,
            placeholder: typeof run.placeholder === "string" ? run.placeholder : undefined,
            checked: typeof run.checked === "boolean" ? run.checked : undefined,
            value: typeof run.value === "string" ? run.value : undefined,
            options: options && options.length > 0 ? options : undefined,
            widget,
            checkedSymbol: typeof run.checkedSymbol === "string" ? run.checkedSymbol : undefined,
            uncheckedSymbol: typeof run.uncheckedSymbol === "string" ? run.uncheckedSymbol : undefined,
            style: run.style ? { ...run.style } : undefined,
            link: typeof run.link === "string" ? run.link : undefined,
            sourceXml: typeof run.sourceXml === "string" ? run.sourceXml : undefined
          });
        }
      }

      normalized.push({
        type: "paragraph",
        style: value.style ? { ...value.style } : undefined,
        sourceXml: typeof value.sourceXml === "string" ? value.sourceXml : undefined,
        children: children.length > 0 ? children : [{ type: "text", text: "" }]
      });
    }

    return normalized.length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
}
