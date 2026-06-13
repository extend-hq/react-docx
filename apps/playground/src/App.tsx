import * as React from "react";
import {
  type DocModel,
  type DocxBorderContext,
  type DocxBorderPreset,
  type DocxContextMenuActionId,
  type DocxContextMenuRenderProps,
  type DocxEditorController,
  DocxEditorViewer,
  type DocxSelectedFormField,
  type DocxTableContextMenuActionId,
  type DocxTableContextMenuRenderProps,
  type DocxTextRange,
  type DocxTrackedChangeCardRenderProps,
  paragraphLetterheadFloatSideAtNodeIndex,
  useDocxBorders,
  useDocxDocumentTheme,
  useDocxEditor,
  useDocxFormFields,
  useDocxLineSpacing,
  useDocxPageLayout,
  useDocxPageThumbnails,
  useDocxParagraphStyles,
  useDocxTrackChanges,
  useDocxComments,
} from "@extend-ai/react-docx";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Columns2,
  Check,
  Download,
  FileDiff,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquareText,
  Moon,
  PanelsTopLeft,
  Redo2,
  Subscript,
  Superscript,
  Trash2,
  Strikethrough,
  Sun,
  Table2,
  Underline,
  Loader2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowExpandDiagonal01Icon,
  ArrowExpandDiagonal02Icon,
  BorderAll01Icon,
  BorderBottom01Icon,
  BorderHorizontalIcon,
  BorderInnerIcon,
  BorderLeft01Icon,
  BorderNone01Icon,
  BorderRight01Icon,
  BorderTop01Icon,
  BorderVerticalIcon,
  Copy01Icon,
  FilePasteIcon,
  LineIcon,
  Scissor01Icon,
} from "@hugeicons/core-free-icons";
import { useTheme } from "next-themes";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { ButtonGroup } from "./components/ui/button-group";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { ColorPicker } from "./components/ui/color-picker";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./components/ui/context-menu";
import { Input } from "./components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "./components/ui/menubar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  createHoverCardHandle,
} from "./components/ui/hover-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import { Switch } from "./components/ui/switch";
import { Toggle } from "./components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";

const FONT_FAMILIES = [
  "Calibri",
  "Arial",
  "Times New Roman",
  "Georgia",
  "Helvetica",
  "Courier New",
] as const;

const FONT_SIZE_OPTIONS = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48,
] as const;

const LINE_SPACING_OPTIONS = [1, 1.15, 1.2, 1.5, 2, 2.5, 3] as const;
const THUMBNAIL_ROW_ESTIMATE_PX = 236;
// Rows mounted (and painted) just outside the viewport, both directions, so a
// thumbnail is already on screen by the time it scrolls into view.
const THUMBNAIL_OVERSCAN = 4;
// Surfaces warmed into the cache beyond the overscan band, symmetric so
// scrolling up is as instant as scrolling down.
const THUMBNAIL_PREFETCH_BEFORE = 4;
const THUMBNAIL_PREFETCH_AFTER = 4;
const THUMBNAIL_RENDER_IDLE_MS = 240;
const THUMBNAIL_PIXEL_RATIO = 1.25;

interface ThumbnailRenderWindowState {
  visiblePageIndexes: number[];
  prefetchPageIndexes: number[];
  key: string;
}

const EMPTY_THUMBNAIL_RENDER_WINDOW: ThumbnailRenderWindowState = {
  visiblePageIndexes: [],
  prefetchPageIndexes: [],
  key: "",
};

function buildThumbnailRenderWindowState(
  visiblePageIndexes: readonly number[],
  totalPages: number
): ThumbnailRenderWindowState {
  if (!visiblePageIndexes.length || totalPages <= 0) {
    return EMPTY_THUMBNAIL_RENDER_WINDOW;
  }

  const normalizedVisiblePageIndexes = Array.from(
    new Set(
      visiblePageIndexes
        .map((pageIndex) => Math.trunc(pageIndex))
        .filter((pageIndex) => pageIndex >= 0 && pageIndex < totalPages)
    )
  ).sort((leftPageIndex, rightPageIndex) => leftPageIndex - rightPageIndex);

  if (!normalizedVisiblePageIndexes.length) {
    return EMPTY_THUMBNAIL_RENDER_WINDOW;
  }

  const firstVisiblePageIndex = normalizedVisiblePageIndexes[0] ?? 0;
  const lastVisiblePageIndex =
    normalizedVisiblePageIndexes[normalizedVisiblePageIndexes.length - 1] ??
    firstVisiblePageIndex;
  const prefetchStartPageIndex = Math.max(
    0,
    firstVisiblePageIndex - THUMBNAIL_PREFETCH_BEFORE
  );
  const prefetchEndPageIndex = Math.min(
    totalPages - 1,
    lastVisiblePageIndex + THUMBNAIL_PREFETCH_AFTER
  );
  const prefetchPageIndexes: number[] = [];
  for (
    let pageIndex = prefetchStartPageIndex;
    pageIndex <= prefetchEndPageIndex;
    pageIndex += 1
  ) {
    prefetchPageIndexes.push(pageIndex);
  }

  return {
    visiblePageIndexes: normalizedVisiblePageIndexes,
    prefetchPageIndexes,
    key: `${normalizedVisiblePageIndexes.join(",")}|${prefetchPageIndexes.join(
      ","
    )}`,
  };
}

type BorderControlOption = {
  id: DocxBorderPreset;
  label: string;
  contexts?: DocxBorderContext[];
  separatorBefore?: boolean;
};

const BORDER_CONTROL_OPTIONS: BorderControlOption[] = [
  { id: "bottom", label: "Bottom Border" },
  { id: "top", label: "Top Border" },
  { id: "left", label: "Left Border" },
  { id: "right", label: "Right Border" },
  { id: "none", label: "No Border", separatorBefore: true },
  { id: "all", label: "All Borders" },
  { id: "outside", label: "Outside Borders" },
  { id: "inside", label: "Inside Borders", contexts: ["table"] },
  {
    id: "inside-horizontal",
    label: "Inside Horizontal Border",
    contexts: ["table"],
  },
  {
    id: "inside-vertical",
    label: "Inside Vertical Border",
    contexts: ["table"],
  },
  {
    id: "diagonal-down",
    label: "Diagonal Down Border",
    contexts: ["table"],
    separatorBefore: true,
  },
  { id: "diagonal-up", label: "Diagonal Up Border", contexts: ["table"] },
  { id: "horizontal-line", label: "Horizontal Line", separatorBefore: true },
];

function borderControlOptionIcon(optionId: DocxBorderPreset) {
  switch (optionId) {
    case "bottom":
      return BorderBottom01Icon;
    case "top":
      return BorderTop01Icon;
    case "left":
      return BorderLeft01Icon;
    case "right":
      return BorderRight01Icon;
    case "none":
      return BorderNone01Icon;
    case "all":
      return BorderAll01Icon;
    case "outside":
      return BorderAll01Icon;
    case "inside":
      return BorderInnerIcon;
    case "inside-horizontal":
      return BorderHorizontalIcon;
    case "inside-vertical":
      return BorderVerticalIcon;
    case "diagonal-down":
      return ArrowExpandDiagonal01Icon;
    case "diagonal-up":
      return ArrowExpandDiagonal02Icon;
    case "horizontal-line":
      return LineIcon;
    default:
      return BorderAll01Icon;
  }
}

const FALLBACK_PARAGRAPH_STYLE_OPTIONS = [
  { id: "Normal", name: "Body" },
  { id: "Heading1", name: "Heading 1" },
  { id: "Heading2", name: "Heading 2" },
  { id: "Heading3", name: "Heading 3" },
  { id: "Heading4", name: "Heading 4" },
  { id: "Heading5", name: "Heading 5" },
  { id: "Heading6", name: "Heading 6" },
] as const;

type ParagraphStyleOption = {
  id: string;
  name: string;
  isDefault?: boolean;
  align?: "left" | "center" | "right" | "justify";
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  runStyle?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    color?: string;
    highlight?: string;
    fontSizePt?: number;
    fontFamily?: string;
  };
};

type PreviewHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type ParagraphStyleRunStyle = NonNullable<ParagraphStyleOption["runStyle"]>;

type DocumentTheme = "light" | "dark";

type FormTextFormatOption = {
  value: string;
  label: string;
};

type FormWidgetDialogDraft = {
  text: {
    inputType: string;
    defaultText: string;
    maxLength: string;
    textFormat: string;
  };
  checkbox: {
    defaultChecked: boolean;
    sizeMode: "auto" | "exact";
    sizePt: string;
  };
};

const REGULAR_TEXT_FORMAT_OPTIONS: FormTextFormatOption[] = [
  { value: "none", label: "None" },
  { value: "uppercase", label: "Uppercase" },
  { value: "lowercase", label: "Lowercase" },
  { value: "firstCapital", label: "First capital" },
  { value: "titleCase", label: "Title case" },
];

const NUMBER_TEXT_FORMAT_OPTIONS: FormTextFormatOption[] = [
  { value: "0", label: "0" },
  { value: "0.00", label: "0.00" },
  { value: "#,##0", label: "#,##0" },
  { value: "#,##0.00", label: "#,##0.00" },
  { value: "$#,##0.00;($#,##0.00)", label: "$#,##0.00;($#,##0.00)" },
  { value: "0%", label: "0%" },
  { value: "0.00%", label: "0.00%" },
];

const TIME_TEXT_FORMAT_OPTIONS: FormTextFormatOption[] = [
  { value: "M/d/yy h:mm am/pm", label: "M/d/yy h:mm am/pm" },
  { value: "M/d/yy h:mm:ss am/pm", label: "M/d/yy h:mm:ss am/pm" },
  { value: "h:mm am/pm", label: "h:mm am/pm" },
  { value: "h:mm:ss am/pm", label: "h:mm:ss am/pm" },
  { value: "HH:mm", label: "HH:mm" },
  { value: "HH:mm:ss", label: "HH:mm:ss" },
];

const DATE_TEXT_FORMAT_OPTIONS: FormTextFormatOption[] = [
  { value: "M/d/yy", label: "M/d/yy" },
  { value: "dddd, MMMM d, yyyy", label: "dddd, MMMM d, yyyy" },
  { value: "MMMM d, yyyy", label: "MMMM d, yyyy" },
  { value: "M/d/yyyy", label: "M/d/yyyy" },
  { value: "yyyy-MM-dd", label: "yyyy-MM-dd" },
  { value: "d-MMM-yy", label: "d-MMM-yy" },
  { value: "M.d.yy", label: "M.d.yy" },
  { value: "MMM. d, yy", label: "MMM. d, yy" },
  { value: "d MMMM yyyy", label: "d MMMM yyyy" },
  { value: "MMMM yy", label: "MMMM yy" },
  { value: "MMM-yy", label: "MMM-yy" },
  { value: "M/d/yy h:mm am/pm", label: "M/d/yy h:mm am/pm" },
  { value: "M/d/yy h:mm:ss am/pm", label: "M/d/yy h:mm:ss am/pm" },
  { value: "h:mm am/pm", label: "h:mm am/pm" },
  { value: "h:mm:ss am/pm", label: "h:mm:ss am/pm" },
  { value: "HH:mm", label: "HH:mm" },
  { value: "HH:mm:ss", label: "HH:mm:ss" },
];

function formTextFormatOptionsForInputType(
  inputType: string
): FormTextFormatOption[] {
  if (inputType === "number" || inputType === "calculated") {
    return NUMBER_TEXT_FORMAT_OPTIONS;
  }
  if (inputType === "date" || inputType === "currentDate") {
    return DATE_TEXT_FORMAT_OPTIONS;
  }
  if (inputType === "currentTime") {
    return TIME_TEXT_FORMAT_OPTIONS;
  }
  return REGULAR_TEXT_FORMAT_OPTIONS;
}

function createFormWidgetDialogDraft(
  selectedFormField?: DocxSelectedFormField
): FormWidgetDialogDraft {
  const textWidget = selectedFormField?.field.widget?.text;
  const checkboxWidget = selectedFormField?.field.widget?.checkbox;
  const maxLength = textWidget?.maxLength;
  const sizePt = checkboxWidget?.sizePt;

  return {
    text: {
      inputType: textWidget?.inputType ?? "regular",
      defaultText: textWidget?.defaultText ?? "",
      maxLength:
        Number.isFinite(maxLength) && (maxLength as number) >= 0
          ? String(Math.round(maxLength as number))
          : "",
      textFormat: textWidget?.textFormat ?? "none",
    },
    checkbox: {
      defaultChecked: Boolean(checkboxWidget?.defaultChecked),
      sizeMode: checkboxWidget?.sizeMode === "exact" ? "exact" : "auto",
      sizePt:
        Number.isFinite(sizePt) && (sizePt as number) > 0
          ? String(sizePt)
          : "10",
    },
  };
}

const HIGHLIGHT_PREVIEW_COLOR: Record<string, string> = {
  yellow: "#fff59d",
  green: "#bbf7d0",
  cyan: "#a5f3fc",
  magenta: "#f5d0fe",
  red: "#fecaca",
  blue: "#bfdbfe",
  black: "#111827",
  white: "#ffffff",
};

const HIGHLIGHT_PRESET_OPTIONS = [
  { id: "none", label: "None" },
  { id: "yellow", label: "Yellow", color: "#fff59d" },
  { id: "green", label: "Green", color: "#bbf7d0" },
  { id: "cyan", label: "Cyan", color: "#a5f3fc" },
  { id: "magenta", label: "Magenta", color: "#f5d0fe" },
  { id: "red", label: "Red", color: "#fecaca" },
  { id: "blue", label: "Blue", color: "#bfdbfe" },
] as const;

const ZOOM_PERCENT_OPTIONS = [
  50, 75, 90, 100, 110, 125, 150, 175, 200,
] as const;

const DEFAULT_HEADING_PREVIEW_RUN_STYLE: Record<
  PreviewHeadingLevel,
  ParagraphStyleRunStyle
> = {
  1: {
    fontFamily: "Calibri Light",
    fontSizePt: 16,
    bold: true,
    color: "#2f5496",
  },
  2: {
    fontFamily: "Calibri Light",
    fontSizePt: 13,
    bold: true,
    color: "#2f5496",
  },
  3: {
    fontFamily: "Calibri",
    fontSizePt: 12,
    bold: true,
    color: "#1f3763",
  },
  4: {
    fontFamily: "Calibri",
    fontSizePt: 11,
    bold: true,
    color: "#1f3763",
  },
  5: {
    fontFamily: "Calibri",
    fontSizePt: 11,
    bold: true,
    color: "#1f3763",
  },
  6: {
    fontFamily: "Calibri",
    fontSizePt: 11,
    bold: true,
    color: "#1f3763",
  },
};

function clampColorChannel(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const threeDigit = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (threeDigit?.[1]) {
    const [r, g, b] = threeDigit[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const sixDigit = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (sixDigit?.[1]) {
    return `#${sixDigit[1].toLowerCase()}`;
  }

  return undefined;
}

function parseHslColor(value?: string): [number, number, number] | undefined {
  if (!value) {
    return undefined;
  }

  const match = value
    .trim()
    .match(
      /^hsla?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%(?:\s*\/\s*\d+(?:\.\d+)?%?)?\s*\)$/i
    );
  if (!match) {
    return undefined;
  }

  const h = Number(match[1]);
  const s = Number(match[2]);
  const l = Number(match[3]);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    return undefined;
  }

  return [h, s, l];
}

function parseRgbColor(value?: string): [number, number, number] | undefined {
  if (!value) {
    return undefined;
  }

  const match = value
    .trim()
    .match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*\d+(?:\.\d+)?)?\s*\)$/i
    );
  if (!match) {
    return undefined;
  }

  const red = clampColorChannel(Number(match[1]), 0, 255);
  const green = clampColorChannel(Number(match[2]), 0, 255);
  const blue = clampColorChannel(Number(match[3]), 0, 255);
  if (![red, green, blue].every(Number.isFinite)) {
    return undefined;
  }

  return [red, green, blue];
}

function rgbToHex(red: number, green: number, blue: number): string {
  const toHex = (value: number): string =>
    Math.round(clampColorChannel(value, 0, 255)).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const safeHue = ((h % 360) + 360) % 360;
  const safeSaturation = clampColorChannel(s, 0, 100) / 100;
  const safeLightness = clampColorChannel(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * safeLightness - 1)) * safeSaturation;
  const huePrime = safeHue / 60;
  const secondComponent = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = secondComponent;
  } else if (huePrime < 2) {
    red = secondComponent;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = secondComponent;
  } else if (huePrime < 4) {
    green = secondComponent;
    blue = chroma;
  } else if (huePrime < 5) {
    red = secondComponent;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondComponent;
  }

  const matchLightness = safeLightness - chroma / 2;
  const toHex = (channel: number): string =>
    Math.round((channel + matchLightness) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function normalizeEditorColor(
  value: string | undefined,
  fallback: string
): string {
  const hex = normalizeHexColor(value);
  if (hex) {
    return hex;
  }

  const hsl = parseHslColor(value);
  if (hsl) {
    return hslToHex(hsl[0], hsl[1], hsl[2]);
  }

  const rgb = parseRgbColor(value);
  if (rgb) {
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  }

  return fallback;
}

function viewerSelectionRect(): DOMRect | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0);
  const viewerRoot = document.querySelector(
    "[data-testid='docx-editor-viewer']"
  );
  if (!viewerRoot || !viewerRoot.contains(range.commonAncestorContainer)) {
    return undefined;
  }

  const rangeRect = range.getBoundingClientRect();
  if (rangeRect.width > 0 || rangeRect.height > 0) {
    return rangeRect;
  }

  const rect = range.getClientRects()[0];
  return rect ?? undefined;
}

function headingPreviewStyle(level?: number): React.CSSProperties {
  switch (level) {
    case 1:
      return { fontSize: "1.25rem", fontWeight: 700 };
    case 2:
      return { fontSize: "1.125rem", fontWeight: 700 };
    case 3:
      return { fontSize: "1rem", fontWeight: 600 };
    case 4:
      return { fontSize: "0.95rem", fontWeight: 600 };
    case 5:
      return { fontSize: "0.9rem", fontWeight: 600 };
    case 6:
      return { fontSize: "0.875rem", fontWeight: 600 };
    default:
      return { fontSize: "0.875rem", fontWeight: 400 };
  }
}

function inferHeadingLevelFromStyleText(
  value?: string
): PreviewHeadingLevel | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/(?:^|[\s_-])(?:heading|h)\s*([1-6])(?:$|[\s_-])/i);
  if (!match?.[1]) {
    return undefined;
  }

  const level = Number(match[1]);
  return level >= 1 && level <= 6 ? (level as PreviewHeadingLevel) : undefined;
}

function resolveParagraphStyleHeadingLevel(
  option?: ParagraphStyleOption
): PreviewHeadingLevel | undefined {
  const explicit = option?.headingLevel;
  if (explicit && explicit >= 1 && explicit <= 6) {
    return explicit as PreviewHeadingLevel;
  }

  return (
    inferHeadingLevelFromStyleText(option?.id) ??
    inferHeadingLevelFromStyleText(option?.name)
  );
}

function resolveParagraphStyleRunPreview(
  option?: ParagraphStyleOption
): ParagraphStyleRunStyle | undefined {
  if (!option) {
    return undefined;
  }

  const headingLevel = resolveParagraphStyleHeadingLevel(option);
  const fallback = headingLevel
    ? DEFAULT_HEADING_PREVIEW_RUN_STYLE[headingLevel]
    : undefined;
  if (!fallback) {
    return option.runStyle;
  }

  return {
    ...fallback,
    ...(option.runStyle ?? {}),
  };
}

function resolveHighlightPreview(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const hex = normalizeHexColor(normalized);
  if (hex) {
    return hex;
  }

  if (parseHslColor(normalized)) {
    return normalized;
  }

  return HIGHLIGHT_PREVIEW_COLOR[normalized];
}

function paragraphStylePreviewStyle(
  option: ParagraphStyleOption | undefined,
  documentTheme: DocumentTheme
): React.CSSProperties {
  if (!option) {
    return {};
  }

  const headingLevel = resolveParagraphStyleHeadingLevel(option);
  const runStyle = resolveParagraphStyleRunPreview(option);
  return {
    ...headingPreviewStyle(headingLevel),
    textAlign: option.align ?? "left",
    fontFamily: runStyle?.fontFamily,
    fontSize: runStyle?.fontSizePt ? `${runStyle.fontSizePt}pt` : undefined,
    fontWeight:
      runStyle?.bold !== undefined ? (runStyle.bold ? 700 : 400) : undefined,
    fontStyle: runStyle?.italic ? "italic" : undefined,
    textDecoration: [
      runStyle?.underline ? "underline" : "",
      runStyle?.strike ? "line-through" : "",
    ]
      .filter(Boolean)
      .join(" "),
    color:
      runStyle?.color !== undefined
        ? themedPreviewColor(sanitizeColor(runStyle.color), documentTheme)
        : undefined,
    backgroundColor: resolveHighlightPreview(runStyle?.highlight),
    lineHeight: 1,
    whiteSpace: "pre-wrap",
  };
}

function sanitizeColor(value?: string): string {
  return normalizeEditorColor(value, "#111827");
}

function paragraphStylePreviewTriggerId(styleId: string): string {
  return `paragraph-style-preview-${styleId}`;
}

function contextActionIcon(
  actionId: DocxContextMenuActionId | (string & {})
): React.ReactNode {
  switch (actionId) {
    case "insert-row-above":
      return <ArrowUp className="size-4" />;
    case "insert-row-below":
      return <ArrowDown className="size-4" />;
    case "insert-column-left":
      return <ArrowLeft className="size-4" />;
    case "insert-column-right":
      return <ArrowRight className="size-4" />;
    case "delete-row":
    case "delete-column":
    case "delete-table":
      return <Trash2 className="size-4" />;
    case "image-bring-to-front":
    case "image-bring-forward":
    case "image-in-front-of-text":
      return <ArrowUp className="size-4" />;
    case "image-send-to-back":
    case "image-send-backward":
    case "image-behind-text":
      return <ArrowDown className="size-4" />;
    case "cut":
      return (
        <HugeiconsIcon
          icon={Scissor01Icon}
          strokeWidth={1.8}
          className="size-4"
        />
      );
    case "copy":
      return (
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={1.8} className="size-4" />
      );
    case "paste":
      return (
        <HugeiconsIcon
          icon={FilePasteIcon}
          strokeWidth={1.8}
          className="size-4"
        />
      );
    default:
      return null;
  }
}

function isTableContextActionId(
  actionId: DocxContextMenuActionId | (string & {})
): actionId is DocxTableContextMenuActionId {
  return (
    actionId === "insert-row-above" ||
    actionId === "insert-row-below" ||
    actionId === "insert-column-left" ||
    actionId === "insert-column-right" ||
    actionId === "delete-row" ||
    actionId === "delete-column" ||
    actionId === "delete-table"
  );
}

function tableMenuToContextMenu(
  menu: DocxTableContextMenuRenderProps
): DocxContextMenuRenderProps {
  return {
    context: {
      kind: "table",
      tableContext: {
        tableIndex: menu.context.tableIndex,
        rowIndex: menu.context.rowIndex,
        cellIndex: menu.context.cellIndex,
      },
    },
    actions: menu.actions.map((action) => ({
      id: action.id,
      label: action.label,
      destructive: action.destructive,
    })),
    runAction: (actionId) => {
      if (isTableContextActionId(actionId)) {
        menu.runAction(actionId);
      }
    },
    closeMenu: menu.closeMenu,
    position: menu.position,
    documentTheme: menu.documentTheme,
  };
}

function shouldShowActionSeparator(
  actions: DocxContextMenuRenderProps["actions"],
  index: number
): boolean {
  if (index <= 0) {
    return false;
  }

  const action = actions[index];
  const previousAction = actions[index - 1];
  if (!action || !previousAction) {
    return false;
  }

  if (action.separatorBefore) {
    return true;
  }

  const actionId = String(action.id);
  const previousActionId = String(previousAction.id);
  const startsImageGroup =
    actionId.startsWith("image-") && !previousActionId.startsWith("image-");
  const startsDestructiveGroup =
    Boolean(action.destructive) && !previousAction.destructive;
  return startsImageGroup || startsDestructiveGroup;
}

function renderMenuAction(
  action: DocxContextMenuRenderProps["actions"][number],
  runAction: DocxContextMenuRenderProps["runAction"]
): React.ReactNode {
  const icon = action.checked ? (
    <Check className="size-4" />
  ) : (
    contextActionIcon(action.id)
  );
  if (action.children && action.children.length > 0) {
    return (
      <ContextMenuSub key={String(action.id)}>
        <ContextMenuSubTrigger disabled={action.disabled}>
          {icon || <span className="size-4" aria-hidden="true" />}
          {action.label}
          {action.shortcut ? (
            <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>
          ) : null}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56" data-docx-context-menu="true">
          {action.children.map((childAction) =>
            renderMenuAction(childAction, runAction)
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  }

  return (
    <ContextMenuItem
      key={String(action.id)}
      disabled={action.disabled}
      variant={action.destructive ? "destructive" : "default"}
      onClick={() => runAction(action.id)}
    >
      {icon || <span className="size-4" aria-hidden="true" />}
      {action.label}
      {action.shortcut ? (
        <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>
      ) : null}
    </ContextMenuItem>
  );
}

function ViewerContextMenuContentRenderer({
  menu,
}: {
  menu: DocxContextMenuRenderProps;
}): React.JSX.Element {
  const triggerId = React.useId();
  const openedRef = React.useRef(false);

  React.useLayoutEffect(() => {
    if (openedRef.current || typeof window === "undefined") {
      return;
    }

    const trigger = window.document.getElementById(triggerId);
    if (!trigger) {
      return;
    }

    openedRef.current = true;
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        buttons: 2,
        clientX: menu.position.x,
        clientY: menu.position.y,
      })
    );
  }, [menu.position.x, menu.position.y, triggerId]);

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) {
          menu.closeMenu();
        }
      }}
    >
      <ContextMenuTrigger id={triggerId} className="block size-px" />
      <ContextMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        className="w-56"
        data-docx-context-menu="true"
        data-docx-table-context-menu={
          menu.context.kind === "table" ? "true" : undefined
        }
      >
        {menu.actions.map((action, index) => (
          <React.Fragment key={String(action.id)}>
            {shouldShowActionSeparator(menu.actions, index) ? (
              <ContextMenuSeparator />
            ) : null}
            {renderMenuAction(action, menu.runAction)}
          </React.Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function themedPreviewColor(
  color: string | undefined,
  documentTheme: DocumentTheme
): string | undefined {
  if (documentTheme !== "dark") {
    return color;
  }

  if (!color) {
    return "#f3f4f6";
  }

  const normalized = color.trim().toLowerCase();
  if (
    normalized === "#000" ||
    normalized === "#000000" ||
    normalized === "#111111" ||
    normalized === "#111827" ||
    normalized === "black" ||
    normalized === "rgb(0,0,0)" ||
    normalized === "rgb(0, 0, 0)"
  ) {
    return "#f3f4f6";
  }

  return color;
}

function withAlpha(color: string, alpha: number): string {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return color;
  }

  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

type PlaygroundDocxParagraphTarget = {
  nodeIndex: number;
  textLength: number;
};

type PlaygroundDocxTableCellTarget = {
  tableIndex: number;
  rowIndex: number;
  cellIndex: number;
  paragraphIndex: number;
  textLength: number;
};

type PlaygroundDocxTestSummary = {
  fileName: string;
  status: string;
  bodyNodeCount: number;
  bodyParagraphNodeCount: number;
  bodyTableNodeCount: number;
  paragraphCount: number;
  tableCount: number;
  imageCount: number;
  formFieldCount: number;
  sectionCount: number;
  headerSectionCount: number;
  footerSectionCount: number;
  hasTitlePageSection: boolean;
  documentPageCountMetadata?: number;
  canUndo: boolean;
  canRedo: boolean;
  firstParagraph?: PlaygroundDocxParagraphTarget;
  firstTableCell?: PlaygroundDocxTableCellTarget;
};

type PlaygroundDocxTestHooks = {
  getSummary: () => PlaygroundDocxTestSummary;
  getParagraphText: (nodeIndex: number) => string;
  getTableCellText: (
    tableIndex: number,
    rowIndex: number,
    cellIndex: number
  ) => string;
  getTableShape: (
    tableIndex: number
  ) => { rowCount: number; columnCounts: number[] } | undefined;
  selectParagraph: (nodeIndex: number) => void;
  selectTableCell: (
    tableIndex: number,
    rowIndex: number,
    cellIndex: number
  ) => void;
  setActiveTextRange: (range?: DocxTextRange) => void;
  commitParagraphText: (nodeIndex: number, text: string) => void;
  commitTableCellText: (
    tableIndex: number,
    rowIndex: number,
    cellIndex: number,
    text: string
  ) => void;
  clearTableCellContents: (
    tableIndex: number,
    rowIndex: number,
    cellIndex: number
  ) => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  toggleStrike: () => void;
  setTextColor: (color?: string) => void;
  setHighlight: (highlight?: string) => void;
  setFontFamily: (fontFamily: string) => void;
  setFontSize: (fontSizePt: number) => void;
  setAlignment: (align?: "left" | "center" | "right" | "justify") => void;
  toggleList: (listType: "unordered" | "ordered") => void;
  setLineSpacing: (lineMultiple: number) => void;
  insertTable: () => void;
  insertTableRow: (
    tableIndex: number,
    rowIndex: number,
    direction: "above" | "below"
  ) => void;
  insertTableColumn: (
    tableIndex: number,
    cellIndex: number,
    direction: "left" | "right",
    rowIndex?: number
  ) => void;
  deleteTableRow: (tableIndex: number, rowIndex: number) => void;
  deleteTableColumn: (
    tableIndex: number,
    cellIndex: number,
    rowIndex?: number
  ) => void;
  undo: () => void;
  redo: () => void;
  exportDocx: () => void;
  insertImageBytes: (
    fileName: string,
    mimeType: string,
    bytes: number[]
  ) => Promise<void>;
};

declare global {
  interface Window {
    __DOCX_TEST_HOOKS__?: PlaygroundDocxTestHooks;
  }
}

function walkModelValue(
  value: unknown,
  visit: (item: Record<string, unknown>) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      walkModelValue(entry, visit);
    });
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  visit(record);
  Object.values(record).forEach((entry) => {
    walkModelValue(entry, visit);
  });
}

function textLengthFromInlineValue(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (sum, entry) => sum + textLengthFromInlineValue(entry),
      0
    );
  }

  if (!value || typeof value !== "object") {
    return 0;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (type === "text") {
    return typeof record.text === "string" ? record.text.length : 0;
  }

  return textLengthFromInlineValue(record.children);
}

function textFromInlineValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => textFromInlineValue(entry)).join("");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (type === "text") {
    return typeof record.text === "string" ? record.text : "";
  }

  return textFromInlineValue(record.children);
}

function paragraphTextLengthFromNode(
  node: DocModel["nodes"][number] | undefined
): number {
  if (!node || node.type !== "paragraph") {
    return 0;
  }

  return textLengthFromInlineValue(node.children);
}

function paragraphTextFromNode(
  node: DocModel["nodes"][number] | undefined
): string {
  if (!node || node.type !== "paragraph") {
    return "";
  }

  return textFromInlineValue(node.children);
}

function tableCellTextFromModel(
  model: DocModel,
  tableIndex: number,
  rowIndex: number,
  cellIndex: number
): string {
  const tableNode = model.nodes[tableIndex];
  if (!tableNode || tableNode.type !== "table") {
    return "";
  }

  const cell = tableNode.rows[rowIndex]?.cells[cellIndex];
  if (!cell) {
    return "";
  }

  const content = Array.isArray(cell.nodes) ? cell.nodes : [];
  return content
    .map((contentNode) => paragraphTextFromNode(contentNode))
    .filter((text) => text.length > 0)
    .join("\n");
}

function tableShapeFromModel(
  model: DocModel,
  tableIndex: number
): { rowCount: number; columnCounts: number[] } | undefined {
  const tableNode = model.nodes[tableIndex];
  if (!tableNode || tableNode.type !== "table") {
    return undefined;
  }

  return {
    rowCount: tableNode.rows.length,
    columnCounts: tableNode.rows.map((row) => row.cells.length),
  };
}

function findFirstParagraphTarget(
  model: DocModel
): PlaygroundDocxParagraphTarget | undefined {
  for (let nodeIndex = 0; nodeIndex < model.nodes.length; nodeIndex += 1) {
    const node = model.nodes[nodeIndex];
    if (node?.type !== "paragraph") {
      continue;
    }

    return {
      nodeIndex,
      textLength: paragraphTextLengthFromNode(node),
    };
  }

  return undefined;
}

function findFirstTableCellTarget(
  model: DocModel
): PlaygroundDocxTableCellTarget | undefined {
  for (let tableIndex = 0; tableIndex < model.nodes.length; tableIndex += 1) {
    const tableNode = model.nodes[tableIndex];
    if (tableNode?.type !== "table") {
      continue;
    }

    for (let rowIndex = 0; rowIndex < tableNode.rows.length; rowIndex += 1) {
      const row = tableNode.rows[rowIndex];
      for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
        const cell = row.cells[cellIndex];
        const content = Array.isArray(cell.nodes) ? cell.nodes : [];
        for (
          let paragraphIndex = 0;
          paragraphIndex < content.length;
          paragraphIndex += 1
        ) {
          const paragraphNode = content[paragraphIndex];
          if (paragraphNode?.type !== "paragraph") {
            continue;
          }

          return {
            tableIndex,
            rowIndex,
            cellIndex,
            paragraphIndex,
            textLength: paragraphTextLengthFromNode(paragraphNode),
          };
        }
      }
    }
  }

  return undefined;
}

function buildDocxTestSummary(
  editor: DocxEditorController
): PlaygroundDocxTestSummary {
  let paragraphCount = 0;
  let tableCount = 0;
  let imageCount = 0;
  let formFieldCount = 0;
  walkModelValue(editor.model.nodes, (item) => {
    const type = typeof item.type === "string" ? item.type : undefined;
    if (type === "paragraph") {
      paragraphCount += 1;
    } else if (type === "table") {
      tableCount += 1;
    } else if (type === "image") {
      imageCount += 1;
    } else if (type === "form-field") {
      formFieldCount += 1;
    }
  });

  const bodyParagraphNodeCount = editor.model.nodes.filter(
    (node) => node.type === "paragraph"
  ).length;
  const bodyTableNodeCount = editor.model.nodes.filter(
    (node) => node.type === "table"
  ).length;
  const sections = editor.model.metadata.sections ?? [];

  return {
    fileName: editor.fileName,
    status: editor.status,
    bodyNodeCount: editor.model.nodes.length,
    bodyParagraphNodeCount,
    bodyTableNodeCount,
    paragraphCount,
    tableCount,
    imageCount,
    formFieldCount,
    sectionCount: sections.length,
    headerSectionCount: editor.model.metadata.headerSections.length,
    footerSectionCount: editor.model.metadata.footerSections.length,
    hasTitlePageSection: sections.some((section) =>
      /<w:titlePg\b[^>]*\/?>/i.test(section.sectionPropertiesXml ?? "")
    ),
    documentPageCountMetadata: editor.model.metadata.documentPageCount,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    firstParagraph: findFirstParagraphTarget(editor.model),
    firstTableCell: findFirstTableCellTarget(editor.model),
  };
}

function parseToolbarSectionColumns(
  sectionPropertiesXml?: string
): { count: number; gapPx: number } | undefined {
  if (!sectionPropertiesXml) {
    return undefined;
  }

  const columnsTag = sectionPropertiesXml.match(/<w:cols\b[^>]*\/?>/i)?.[0];
  if (!columnsTag) {
    return undefined;
  }

  const countRaw = columnsTag.match(/\bw:num="(\d+)"/i)?.[1];
  const count = countRaw ? Number(countRaw) : 1;
  if (!Number.isFinite(count) || count <= 1) {
    return undefined;
  }

  const gapRaw = columnsTag.match(/\bw:space="(\d+)"/i)?.[1];
  const gapTwips = gapRaw ? Number(gapRaw) : 720;
  const gapPx = Math.max(0, Math.round((gapTwips * 96) / 1440));

  return {
    count: Math.max(2, Math.round(count)),
    gapPx,
  };
}

export function App(): React.JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const editor = useDocxEditor();
  const { documentTheme, setDocumentTheme } = useDocxDocumentTheme(editor);
  const { layout: pageLayout } = useDocxPageLayout(editor);
  const [thumbnailsSheetOpen, setThumbnailsSheetOpen] = React.useState(false);
  const thumbnailScrollRef = React.useRef<HTMLDivElement | null>(null);
  const thumbnailPageCount = Math.max(1, editor.totalPages);
  const [thumbnailRenderWindow, setThumbnailRenderWindow] =
    React.useState<ThumbnailRenderWindowState>(EMPTY_THUMBNAIL_RENDER_WINDOW);
  const updateThumbnailRenderWindow = React.useCallback(
    (visiblePageIndexes: readonly number[]) => {
      const nextRenderWindow = buildThumbnailRenderWindowState(
        visiblePageIndexes,
        thumbnailPageCount
      );
      setThumbnailRenderWindow((currentRenderWindow) =>
        currentRenderWindow.key === nextRenderWindow.key
          ? currentRenderWindow
          : nextRenderWindow
      );
    },
    [thumbnailPageCount]
  );
  const thumbnailVirtualizer = useVirtualizer({
    count: thumbnailPageCount,
    enabled: thumbnailsSheetOpen,
    estimateSize: () => THUMBNAIL_ROW_ESTIMATE_PX,
    getScrollElement: () => thumbnailScrollRef.current,
    initialRect: {
      height: 640,
      width: 384,
    },
    isScrollingResetDelay: THUMBNAIL_RENDER_IDLE_MS,
    // Snapshot thumbnails paint synchronously (sub-millisecond), so we keep a
    // generous overscan and render continuously — including mid-scroll — rather
    // than blanking the rail while the user scrolls.
    overscan: THUMBNAIL_OVERSCAN,
    onChange: (instance) => {
      updateThumbnailRenderWindow(
        instance.getVirtualItems().map((item) => item.index)
      );
    },
  });
  const thumbnailVirtualItems = thumbnailVirtualizer.getVirtualItems();
  const { thumbnails } = useDocxPageThumbnails(editor, {
    maxWidthPx: 148,
    pixelRatio: THUMBNAIL_PIXEL_RATIO,
    minRasterIntervalMs: 80,
    renderWindow: thumbnailsSheetOpen
      ? {
          visiblePageIndexes: thumbnailRenderWindow.visiblePageIndexes,
          prefetchPageIndexes: thumbnailRenderWindow.prefetchPageIndexes,
        }
      : undefined,
  });
  React.useEffect(() => {
    if (!thumbnailsSheetOpen) {
      updateThumbnailRenderWindow([]);
      return;
    }

    updateThumbnailRenderWindow(
      thumbnailVirtualItems.map((virtualItem) => virtualItem.index)
    );
  }, [
    thumbnailVirtualItems,
    thumbnailsSheetOpen,
    updateThumbnailRenderWindow,
  ]);
  React.useEffect(() => {
    if (thumbnailsSheetOpen) {
      thumbnailVirtualizer.measure();
    }
  }, [thumbnailPageCount, thumbnailVirtualizer, thumbnailsSheetOpen]);
  const { paragraphStyles, selectedParagraphStyleId, setParagraphStyle } =
    useDocxParagraphStyles(editor);
  const { lineSpacing, setLineSpacing } = useDocxLineSpacing(editor);
  const { borderContext, activeBorderPresets, applyBorderPreset } =
    useDocxBorders(editor);
  const { selectedFormField, updateSelectedFormFieldWidget } =
    useDocxFormFields(editor);
  const { showTrackedChanges, setShowTrackedChanges } =
    useDocxTrackChanges(editor);
  const { comments, showComments, setShowComments } = useDocxComments(editor);
  const [themeReady, setThemeReady] = React.useState(false);
  const paragraphStylePreviewHandle = React.useMemo(
    () => createHoverCardHandle<ParagraphStyleOption>(),
    []
  );

  type TextRangeBoundaryLike = {
    location: {
      kind: "paragraph" | "table-cell";
      nodeIndex?: number;
      tableIndex?: number;
      rowIndex?: number;
      cellIndex?: number;
      paragraphIndex?: number;
    };
  };

  const isParagraphLocationEqual = React.useCallback(
    (left: TextRangeBoundaryLike, right: TextRangeBoundaryLike): boolean => {
      if (left.location.kind !== right.location.kind) {
        return false;
      }

      if (left.location.kind === "paragraph") {
        return left.location.nodeIndex === right.location.nodeIndex;
      }

      return (
        left.location.tableIndex === right.location.tableIndex &&
        left.location.rowIndex === right.location.rowIndex &&
        left.location.cellIndex === right.location.cellIndex &&
        left.location.paragraphIndex === right.location.paragraphIndex
      );
    },
    []
  );

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const viewerScrollRef = React.useRef<HTMLDivElement | null>(null);
  const fileDragDepthRef = React.useRef(0);
  const [linkEditorOpen, setLinkEditorOpen] = React.useState(false);
  const [linkEditorValue, setLinkEditorValue] = React.useState("");
  const [linkEditorPosition, setLinkEditorPosition] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const [linkHoverCard, setLinkHoverCard] = React.useState<{
    top: number;
    left: number;
    href: string;
  } | null>(null);
  const [zoomPercent, setZoomPercent] = React.useState<number>(
    () => pageLayout.viewportDefaults.zoomPercent
  );
  const [isReadOnly, setIsReadOnly] = React.useState(false);
  const [isImportDragOver, setIsImportDragOver] = React.useState(false);
  const [isParagraphStyleMenuOpen, setIsParagraphStyleMenuOpen] =
    React.useState(false);
  const [formWidgetDialogOpen, setFormWidgetDialogOpen] = React.useState(false);
  const [formWidgetDraft, setFormWidgetDraft] = React.useState<
    FormWidgetDialogDraft | undefined
  >(undefined);
  const activeSectionColumns = React.useMemo(() => {
    const activeNodeIndex =
      editor.selection.kind === "paragraph"
        ? editor.selection.nodeIndex
        : editor.selection.tableIndex;
    const letterheadColumns =
      editor.selection.kind === "paragraph" &&
      paragraphLetterheadFloatSideAtNodeIndex(
        editor.model.nodes,
        editor.selection.nodeIndex
      )
        ? { count: 2, gapPx: 28 }
        : undefined;
    const sections = editor.model.metadata.sections ?? [];
    const activeSection = sections
      .filter((section) => section.startNodeIndex <= activeNodeIndex)
      .at(-1);
    return (
      letterheadColumns ??
      parseToolbarSectionColumns(activeSection?.sectionPropertiesXml) ??
      parseToolbarSectionColumns(editor.model.metadata.sectionPropertiesXml) ??
      pageLayout.columns
    );
  }, [
    editor.model.nodes,
    editor.model.metadata.sectionPropertiesXml,
    editor.model.metadata.sections,
    editor.selection,
    pageLayout.columns,
  ]);

  React.useEffect(() => {
    setThemeReady(true);
  }, []);

  const hasFilePayload = React.useCallback(
    (dataTransfer: DataTransfer | null) => {
      return Array.from(dataTransfer?.types ?? []).includes("Files");
    },
    []
  );

  const extractDroppedDocxFile = React.useCallback(
    (dataTransfer: DataTransfer | null): File | undefined => {
      return Array.from(dataTransfer?.files ?? []).find((candidate) =>
        /\.docx?$/i.test(candidate.name)
      );
    },
    []
  );

  const scrollToPage = React.useCallback((pageIndex: number): void => {
    const viewerScrollElement = viewerScrollRef.current;
    if (!viewerScrollElement) {
      return;
    }

    const targetPage = viewerScrollElement.querySelector<HTMLElement>(
      `[data-docx-page-index="${Math.max(0, Math.round(pageIndex))}"]`
    );
    if (!targetPage) {
      return;
    }

    targetPage.scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
  }, []);

  React.useEffect(() => {
    if (!isReadOnly || typeof window === "undefined") {
      fileDragDepthRef.current = 0;
      setIsImportDragOver(false);
      return;
    }

    const onWindowDragEnter = (event: DragEvent): void => {
      if (!hasFilePayload(event.dataTransfer)) {
        return;
      }

      fileDragDepthRef.current += 1;
      setIsImportDragOver(true);
    };

    const onWindowDragOver = (event: DragEvent): void => {
      if (!hasFilePayload(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setIsImportDragOver(true);
    };

    const onWindowDragLeave = (event: DragEvent): void => {
      if (event.relatedTarget === null) {
        fileDragDepthRef.current = 0;
        setIsImportDragOver(false);
        return;
      }

      if (!hasFilePayload(event.dataTransfer)) {
        return;
      }

      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) {
        setIsImportDragOver(false);
      }
    };

    const onWindowDrop = (event: DragEvent): void => {
      fileDragDepthRef.current = 0;
      setIsImportDragOver(false);

      if (event.defaultPrevented || !hasFilePayload(event.dataTransfer)) {
        return;
      }

      const file = extractDroppedDocxFile(event.dataTransfer);
      if (!file) {
        return;
      }

      event.preventDefault();
      void editor.importDocxFile(file);
    };

    window.addEventListener("dragenter", onWindowDragEnter);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", onWindowDrop);

    return () => {
      window.removeEventListener("dragenter", onWindowDragEnter);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("dragleave", onWindowDragLeave);
      window.removeEventListener("drop", onWindowDrop);
      fileDragDepthRef.current = 0;
      setIsImportDragOver(false);
    };
  }, [editor, extractDroppedDocxFile, hasFilePayload, isReadOnly]);

  React.useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") {
      return;
    }

    window.__DOCX_TEST_HOOKS__ = {
      getSummary: () => buildDocxTestSummary(editor),
      getParagraphText: (nodeIndex: number) => {
        return paragraphTextFromNode(editor.model.nodes[nodeIndex]);
      },
      getTableCellText: (
        tableIndex: number,
        rowIndex: number,
        cellIndex: number
      ) => {
        return tableCellTextFromModel(
          editor.model,
          tableIndex,
          rowIndex,
          cellIndex
        );
      },
      getTableShape: (tableIndex: number) => {
        return tableShapeFromModel(editor.model, tableIndex);
      },
      selectParagraph: (nodeIndex: number) => {
        editor.selectParagraph(nodeIndex);
      },
      selectTableCell: (
        tableIndex: number,
        rowIndex: number,
        cellIndex: number
      ) => {
        editor.selectTableCell(tableIndex, rowIndex, cellIndex);
      },
      setActiveTextRange: (range?: DocxTextRange) => {
        editor.setActiveTextRange(range);
      },
      commitParagraphText: (nodeIndex: number, text: string) => {
        editor.commitParagraphText(nodeIndex, text);
      },
      commitTableCellText: (
        tableIndex: number,
        rowIndex: number,
        cellIndex: number,
        text: string
      ) => {
        editor.commitTableCellText(tableIndex, rowIndex, cellIndex, text);
      },
      clearTableCellContents: (
        tableIndex: number,
        rowIndex: number,
        cellIndex: number
      ) => {
        editor.clearTableCellContents(tableIndex, [{ rowIndex, cellIndex }]);
      },
      toggleBold: () => {
        editor.toggleBold();
      },
      toggleItalic: () => {
        editor.toggleItalic();
      },
      toggleUnderline: () => {
        editor.toggleUnderline();
      },
      toggleStrike: () => {
        editor.toggleStrike();
      },
      setTextColor: (color?: string) => {
        editor.setTextColor(color);
      },
      setHighlight: (highlight?: string) => {
        editor.setHighlight(highlight);
      },
      setFontFamily: (fontFamily: string) => {
        editor.setFontFamily(fontFamily);
      },
      setFontSize: (fontSizePt: number) => {
        editor.setFontSize(fontSizePt);
      },
      setAlignment: (align?: "left" | "center" | "right" | "justify") => {
        editor.setAlignment(align);
      },
      toggleList: (listType: "unordered" | "ordered") => {
        editor.toggleList(listType);
      },
      setLineSpacing: (lineMultiple: number) => {
        editor.setLineSpacing(lineMultiple);
      },
      insertTable: () => {
        editor.insertTable();
      },
      insertTableRow: (
        tableIndex: number,
        rowIndex: number,
        direction: "above" | "below"
      ) => {
        editor.insertTableRow(tableIndex, rowIndex, direction);
      },
      insertTableColumn: (
        tableIndex: number,
        cellIndex: number,
        direction: "left" | "right",
        rowIndex?: number
      ) => {
        editor.insertTableColumn(tableIndex, cellIndex, direction, rowIndex);
      },
      deleteTableRow: (tableIndex: number, rowIndex: number) => {
        editor.deleteTableRow(tableIndex, rowIndex);
      },
      deleteTableColumn: (
        tableIndex: number,
        cellIndex: number,
        rowIndex?: number
      ) => {
        editor.deleteTableColumn(tableIndex, cellIndex, rowIndex);
      },
      undo: () => {
        editor.undo();
      },
      redo: () => {
        editor.redo();
      },
      exportDocx: () => {
        editor.exportDocx();
      },
      insertImageBytes: async (
        fileName: string,
        mimeType: string,
        bytes: number[]
      ) => {
        const file = new File([new Uint8Array(bytes)], fileName, {
          type: mimeType,
        });
        await editor.insertImageFile(file);
      },
    };

    return () => {
      if (window.__DOCX_TEST_HOOKS__) {
        delete window.__DOCX_TEST_HOOKS__;
      }
    };
  }, [editor]);

  const selectedParagraph = editor.selectedParagraph;
  const selectedRunStyle = editor.selectedRunStyle;
  const selectedLineSpacingValue = React.useMemo(() => {
    const current = Number.isFinite(lineSpacing.multiple)
      ? lineSpacing.multiple
      : 1;
    const nearest = LINE_SPACING_OPTIONS.reduce((closest, candidate) => {
      return Math.abs(candidate - current) < Math.abs(closest - current)
        ? candidate
        : closest;
    }, LINE_SPACING_OPTIONS[0]);
    return String(nearest);
  }, [lineSpacing.multiple]);
  const textColorValue = sanitizeColor(selectedRunStyle?.color);
  const highlightColorValue = normalizeEditorColor(
    resolveHighlightPreview(selectedRunStyle?.highlight),
    "#fff59d"
  );
  const hasExpandedTextSelection = Boolean(
    editor.activeTextRange &&
      (editor.activeTextRange.start.offset !==
        editor.activeTextRange.end.offset ||
        !isParagraphLocationEqual(
          editor.activeTextRange.start,
          editor.activeTextRange.end
        ))
  );
  const selectedHighlightPresetId = (() => {
    const normalized = (selectedRunStyle?.highlight ?? "").trim().toLowerCase();
    const matchedPreset = HIGHLIGHT_PRESET_OPTIONS.find(
      (preset) => preset.id === normalized
    );
    return matchedPreset?.id ?? "custom";
  })();
  const paragraphStyleOptions: ParagraphStyleOption[] =
    paragraphStyles.length > 0
      ? paragraphStyles
      : [...FALLBACK_PARAGRAPH_STYLE_OPTIONS];
  const selectedParagraphStyleValue =
    selectedParagraphStyleId ??
    paragraphStyleOptions.find(
      (option) => "isDefault" in option && option.isDefault
    )?.id ??
    paragraphStyleOptions[0]?.id ??
    "Normal";
  const selectedParagraphStyleLabel =
    paragraphStyleOptions.find(
      (option) => option.id === selectedParagraphStyleValue
    )?.name ?? "Body";
  const selectedParagraphStyleOption: ParagraphStyleOption =
    paragraphStyleOptions.find(
      (option) => option.id === selectedParagraphStyleValue
    ) ??
      paragraphStyleOptions[0] ?? { id: "Normal", name: "Body" };
  const enabledBorderControlOptions = React.useMemo(
    () =>
      BORDER_CONTROL_OPTIONS.filter(
        (option) => !option.contexts || option.contexts.includes(borderContext)
      ),
    [borderContext]
  );
  const activeBorderControlOptions = React.useMemo(
    () =>
      enabledBorderControlOptions.filter(
        (option) => activeBorderPresets[option.id]
      ),
    [activeBorderPresets, enabledBorderControlOptions]
  );
  const borderTriggerLabel =
    activeBorderControlOptions.length === 1
      ? activeBorderControlOptions[0].label
      : "Borders";
  const borderTriggerIcon = borderControlOptionIcon(
    activeBorderControlOptions.length === 1
      ? activeBorderControlOptions[0].id
      : "all"
  );
  const borderActiveCountBadge =
    activeBorderControlOptions.length > 1
      ? activeBorderControlOptions.length
      : undefined;
  const currentTheme = (resolvedTheme ?? theme ?? "light") as
    | "light"
    | "dark"
    | "system";

  React.useEffect(() => {
    if (!selectedFormField) {
      setFormWidgetDialogOpen(false);
      setFormWidgetDraft(undefined);
    }
  }, [selectedFormField]);

  React.useEffect(() => {
    if (!formWidgetDialogOpen || !selectedFormField) {
      return;
    }
    setFormWidgetDraft(createFormWidgetDialogDraft(selectedFormField));
  }, [formWidgetDialogOpen, selectedFormField]);

  const updateFormWidgetDraft = React.useCallback(
    (
      updater: (draft: FormWidgetDialogDraft) => FormWidgetDialogDraft
    ): void => {
      setFormWidgetDraft((currentDraft) =>
        updater(currentDraft ?? createFormWidgetDialogDraft(selectedFormField))
      );
    },
    [selectedFormField]
  );

  const hasInvalidFormWidgetMaxLength = React.useMemo(() => {
    if (
      !selectedFormField ||
      (selectedFormField.field.fieldType !== "text" &&
        selectedFormField.field.fieldType !== "date")
    ) {
      return false;
    }

    const rawValue = formWidgetDraft?.text.maxLength.trim() ?? "";
    if (!rawValue) {
      return false;
    }

    const parsed = Number(rawValue);
    return !Number.isFinite(parsed) || parsed < 0;
  }, [formWidgetDraft, selectedFormField]);

  const hasInvalidFormWidgetCheckboxSize = React.useMemo(() => {
    if (selectedFormField?.field.fieldType !== "checkbox") {
      return false;
    }
    if ((formWidgetDraft?.checkbox.sizeMode ?? "auto") !== "exact") {
      return false;
    }

    const parsed = Number(formWidgetDraft?.checkbox.sizePt.trim() ?? "");
    return !Number.isFinite(parsed) || parsed <= 0;
  }, [formWidgetDraft, selectedFormField]);

  const selectedFormFieldInputType =
    formWidgetDraft?.text.inputType ?? "regular";
  const selectedFormFieldFormatOptions = React.useMemo(
    () => formTextFormatOptionsForInputType(selectedFormFieldInputType),
    [selectedFormFieldInputType]
  );
  const selectedFormFieldEffectiveTextFormatValue = React.useMemo(() => {
    const draftValue = formWidgetDraft?.text.textFormat?.trim() ?? "";
    if (
      draftValue &&
      selectedFormFieldFormatOptions.some(
        (option) => option.value === draftValue
      )
    ) {
      return draftValue;
    }
    return selectedFormFieldFormatOptions[0]?.value ?? "none";
  }, [formWidgetDraft?.text.textFormat, selectedFormFieldFormatOptions]);
  const selectedFormFieldDefaultValueLabel = React.useMemo(() => {
    if (selectedFormFieldInputType === "calculated") {
      return "Expression";
    }
    if (selectedFormFieldInputType === "number") {
      return "Default number";
    }
    if (
      selectedFormFieldInputType === "date" ||
      selectedFormFieldInputType === "currentDate"
    ) {
      return "Default date";
    }
    if (selectedFormFieldInputType === "currentTime") {
      return "Default time";
    }
    return "Default text";
  }, [selectedFormFieldInputType]);
  const selectedFormFieldDefaultValueDisabled =
    selectedFormFieldInputType === "currentDate" ||
    selectedFormFieldInputType === "currentTime";
  const selectedFormFieldDefaultValuePlaceholder =
    selectedFormFieldDefaultValueDisabled
      ? selectedFormFieldInputType === "currentDate"
        ? "Auto-generated from current date"
        : "Auto-generated from current time"
      : selectedFormFieldInputType === "calculated"
      ? "Enter expression"
      : `Enter ${selectedFormFieldDefaultValueLabel.toLowerCase()}`;
  const selectedFormFieldFormatLabel =
    selectedFormFieldInputType === "number" ||
    selectedFormFieldInputType === "calculated"
      ? "Number format"
      : selectedFormFieldInputType === "date" ||
        selectedFormFieldInputType === "currentDate"
      ? "Date format"
      : selectedFormFieldInputType === "currentTime"
      ? "Time format"
      : "Text format";
  const selectedFormFieldFormatSelectWidthCh = React.useMemo(() => {
    const maxLabelLength = selectedFormFieldFormatOptions.reduce(
      (largest, option) => {
        return Math.max(largest, option.label.length);
      },
      0
    );
    return Math.max(16, Math.min(44, maxLabelLength + 6));
  }, [selectedFormFieldFormatOptions]);

  const canSaveFormWidgetDialog = Boolean(
    selectedFormField &&
      formWidgetDraft &&
      !hasInvalidFormWidgetMaxLength &&
      !hasInvalidFormWidgetCheckboxSize
  );

  const handleSaveFormWidgetDialog = React.useCallback(() => {
    if (!selectedFormField || !formWidgetDraft) {
      return;
    }

    if (
      selectedFormField.field.fieldType === "text" ||
      selectedFormField.field.fieldType === "date"
    ) {
      const maxLengthRaw = formWidgetDraft.text.maxLength.trim();
      const parsedMaxLength = Number(maxLengthRaw);
      const nextMaxLength =
        maxLengthRaw === ""
          ? undefined
          : Number.isFinite(parsedMaxLength) && parsedMaxLength >= 0
          ? Math.round(parsedMaxLength)
          : undefined;
      updateSelectedFormFieldWidget({
        text: {
          inputType: formWidgetDraft.text.inputType,
          defaultText: formWidgetDraft.text.defaultText,
          maxLength: nextMaxLength,
          textFormat:
            formWidgetDraft.text.textFormat === "none"
              ? undefined
              : formWidgetDraft.text.textFormat,
        },
      });
    } else if (selectedFormField.field.fieldType === "checkbox") {
      const checkboxSizeMode = formWidgetDraft.checkbox.sizeMode;
      const parsedCheckboxSize = Number(formWidgetDraft.checkbox.sizePt.trim());
      updateSelectedFormFieldWidget({
        checkbox: {
          defaultChecked: formWidgetDraft.checkbox.defaultChecked,
          sizeMode: checkboxSizeMode,
          sizePt:
            checkboxSizeMode === "exact" &&
            Number.isFinite(parsedCheckboxSize) &&
            parsedCheckboxSize > 0
              ? Number(parsedCheckboxSize.toFixed(2))
              : undefined,
        },
      });
    }

    setFormWidgetDialogOpen(false);
  }, [formWidgetDraft, selectedFormField, updateSelectedFormFieldWidget]);

  const handleCancelFormWidgetDialog = React.useCallback(() => {
    setFormWidgetDialogOpen(false);
    setFormWidgetDraft(createFormWidgetDialogDraft(selectedFormField));
  }, [selectedFormField]);

  const handleFormWidgetDialogOpenChange = React.useCallback(
    (open: boolean) => {
      setFormWidgetDraft(createFormWidgetDialogDraft(selectedFormField));
      setFormWidgetDialogOpen(open);
    },
    [selectedFormField]
  );

  const isDark = currentTheme === "dark";
  const zoomScale = zoomPercent / 100;
  const paragraphPreviewSurfaceStyle: React.CSSProperties =
    documentTheme === "dark"
      ? {
          backgroundColor: "#111827",
          color: "#f3f4f6",
          borderColor: "#374151",
        }
      : {
          backgroundColor: "#ffffff",
          color: "#111827",
          borderColor: "#d4d4d8",
        };
  const paragraphPreviewSecondaryTextColor =
    documentTheme === "dark" ? "#9ca3af" : "#6b7280";
  const pageGapBackgroundColor = "hsl(var(--background))";
  const renderTrackedChangeCard = React.useCallback(
    (props: DocxTrackedChangeCardRenderProps): React.ReactNode => {
      const iconForKind =
        props.change.kind === "insertion"
          ? Upload
          : props.change.kind === "deletion"
          ? Strikethrough
          : props.change.kind === "move-from"
          ? Undo2
          : props.change.kind === "move-to"
          ? Redo2
          : props.change.kind === "paragraph-format-change"
          ? AlignLeft
          : FileDiff;
      const chipBackground = withAlpha(props.accentColor, isDark ? 0.3 : 0.16);

      return (
        <Card
          size="sm"
          className="pointer-events-none gap-1 py-2"
          style={{
            ...props.style,
            borderLeft: `3px solid ${props.accentColor}`,
            boxShadow: isDark
              ? "0 2px 8px rgba(2, 6, 23, 0.7)"
              : "0 2px 6px rgba(15, 23, 42, 0.16)",
          }}
        >
          <CardHeader className="px-3 pb-0">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="min-w-0 text-xs leading-4 text-foreground">
                <span className="truncate">
                  {props.change.author?.trim() || "Unknown author"}
                </span>
              </CardTitle>
              {props.formattedDate ? (
                <span className="shrink-0 text-[10px] leading-4 text-muted-foreground">
                  {props.formattedDate}
                </span>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-1 px-3 pt-0">
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                color: props.accentColor,
                backgroundColor: chipBackground,
              }}
            >
              {React.createElement(iconForKind, {
                className: "size-3.5 shrink-0",
              })}
              {props.kindLabel}
            </span>
            <CardDescription className="text-[11px] leading-4">
              {props.snippet}
            </CardDescription>
          </CardContent>
        </Card>
      );
    },
    [isDark]
  );
  const renderContextMenu = React.useCallback(
    (props: DocxContextMenuRenderProps): React.ReactNode => {
      return <ViewerContextMenuContentRenderer menu={props} />;
    },
    []
  );
  const renderTableContextMenu = React.useCallback(
    (props: DocxTableContextMenuRenderProps): React.ReactNode => {
      return (
        <ViewerContextMenuContentRenderer
          menu={tableMenuToContextMenu(props)}
        />
      );
    },
    []
  );

  const onImport = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    await editor.importDocxFile(file);
  };

  const onInsertImage = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    await editor.insertImageFile(file);
  };

  const preserveTextSelectionOnMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      event.preventDefault();
    },
    []
  );
  const preserveTextSelectionOnPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>): void => {
      event.preventDefault();
    },
    []
  );

  const openLinkEditor = React.useCallback((): void => {
    const rect = viewerSelectionRect();
    if (!rect) {
      editor.setStatus("Select text inside the document to add a link");
      return;
    }

    if (!hasExpandedTextSelection && !editor.selectedLink) {
      editor.setStatus("Select text to add a link");
      return;
    }

    setLinkEditorPosition({
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
    });
    setLinkEditorValue(editor.selectedLink ?? "");
    setLinkEditorOpen(true);
  }, [editor, hasExpandedTextSelection]);

  const closeLinkEditor = React.useCallback((): void => {
    setLinkEditorOpen(false);
  }, []);

  const applyLinkFromEditor = React.useCallback((): void => {
    editor.setLink(linkEditorValue);
    setLinkEditorOpen(false);
  }, [editor, linkEditorValue]);

  const removeLinkFromEditor = React.useCallback((): void => {
    editor.setLink(undefined);
    setLinkEditorOpen(false);
  }, [editor]);

  const shiftZoom = React.useCallback((direction: -1 | 1): void => {
    const options = [...ZOOM_PERCENT_OPTIONS];
    setZoomPercent((current) => {
      const exactIndex = options.findIndex((value) => value === current);
      if (exactIndex >= 0) {
        const nextIndex = Math.max(
          0,
          Math.min(options.length - 1, exactIndex + direction)
        );
        return options[nextIndex] ?? current;
      }

      if (direction > 0) {
        return (
          options.find((value) => value > current) ??
          options[options.length - 1] ??
          current
        );
      }

      const reverse = [...options].reverse();
      return reverse.find((value) => value < current) ?? options[0] ?? current;
    });
  }, []);

  React.useEffect(() => {
    const hasCollapsedSelectionInLink = Boolean(
      editor.activeTextRange &&
        editor.activeTextRange.start.offset ===
          editor.activeTextRange.end.offset &&
        isParagraphLocationEqual(
          editor.activeTextRange.start,
          editor.activeTextRange.end
        ) &&
        editor.selectedLink
    );

    if (!hasCollapsedSelectionInLink || !editor.selectedLink) {
      setLinkHoverCard(null);
      return;
    }

    const rect = viewerSelectionRect();
    if (!rect) {
      setLinkHoverCard(null);
      return;
    }

    setLinkHoverCard({
      top: rect.bottom + 8,
      left: rect.left + rect.width / 2,
      href: editor.selectedLink,
    });
  }, [editor.activeTextRange, editor.selectedLink, isParagraphLocationEqual]);

  return (
    <div className="h-screen bg-muted/30 text-foreground">
      <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-3 p-4">
        <Card className="gap-3">
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="ml-auto flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {editor.status}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDocumentTheme(
                      documentTheme === "dark" ? "light" : "dark"
                    )
                  }
                >
                  {documentTheme === "dark" ? (
                    <Moon className="size-3.5" />
                  ) : (
                    <Sun className="size-3.5" />
                  )}
                  Document
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTheme(isDark ? "light" : "dark")}
                  disabled={!themeReady}
                >
                  {isDark ? (
                    <Sun className="size-3.5" />
                  ) : (
                    <Moon className="size-3.5" />
                  )}
                  Theme
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.doc"
                className="hidden"
                onChange={(event) => void onImport(event)}
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void onInsertImage(event)}
              />
              <ButtonGroup>
                <Button
                  variant="outline"
                  onClick={editor.undo}
                  disabled={!editor.canUndo}
                >
                  <Undo2 />
                  Undo
                </Button>
                <Button
                  variant="outline"
                  onClick={editor.redo}
                  disabled={!editor.canRedo}
                >
                  <Redo2 />
                  Redo
                </Button>
              </ButtonGroup>

              <HoverCard handle={paragraphStylePreviewHandle}>
                {({ payload }) => {
                  const previewOption = payload as
                    | ParagraphStyleOption
                    | undefined;
                  return (
                    <>
                      <Select
                        value={selectedParagraphStyleValue}
                        onOpenChange={(open) => {
                          setIsParagraphStyleMenuOpen(open);
                          if (!open) {
                            paragraphStylePreviewHandle.close();
                            return;
                          }

                          window.requestAnimationFrame(() => {
                            paragraphStylePreviewHandle.open(
                              paragraphStylePreviewTriggerId(
                                selectedParagraphStyleValue
                              )
                            );
                          });
                        }}
                        onValueChange={(value: string | null) => {
                          if (!value) {
                            return;
                          }

                          setParagraphStyle(value);
                        }}
                      >
                        <SelectTrigger className="min-w-[130px] w-auto">
                          <SelectValue className="truncate">
                            {selectedParagraphStyleLabel}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-[210px]">
                          {paragraphStyleOptions.map((option) => {
                            const previewTriggerId =
                              paragraphStylePreviewTriggerId(option.id);
                            return (
                              <SelectItem
                                key={option.id}
                                value={option.id}
                                className="relative min-w-[190px]"
                                onPointerEnter={() => {
                                  paragraphStylePreviewHandle.open(
                                    previewTriggerId
                                  );
                                }}
                                onFocus={() => {
                                  paragraphStylePreviewHandle.open(
                                    previewTriggerId
                                  );
                                }}
                              >
                                <span className="block truncate">
                                  {option.name}
                                </span>
                                <HoverCardTrigger
                                  id={previewTriggerId}
                                  handle={paragraphStylePreviewHandle}
                                  payload={option}
                                  delay={0}
                                  closeDelay={120}
                                  render={
                                    <span className="absolute inset-0 block" />
                                  }
                                />
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {isParagraphStyleMenuOpen && previewOption ? (
                        <HoverCardContent
                          side="right"
                          align="start"
                          sideOffset={10}
                          alignOffset={-4}
                          className="w-[260px] p-3"
                        >
                          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Style Preview
                          </p>
                          <div
                            className="mt-2 rounded-sm border p-2.5"
                            style={paragraphPreviewSurfaceStyle}
                          >
                            <p
                              style={paragraphStylePreviewStyle(
                                previewOption,
                                documentTheme
                              )}
                            >
                              {previewOption.name}
                            </p>
                            <p
                              className="mt-1 text-[11px]"
                              style={{
                                textAlign: previewOption.align ?? "left",
                                color: paragraphPreviewSecondaryTextColor,
                              }}
                            >
                              The quick brown fox jumps over the lazy dog.
                            </p>
                          </div>
                        </HoverCardContent>
                      ) : null}
                    </>
                  );
                }}
              </HoverCard>

              <Select
                value={selectedRunStyle?.fontFamily ?? "Calibri"}
                onValueChange={(value: string | null) => {
                  if (!value) {
                    return;
                  }

                  editor.setFontFamily(value);
                }}
              >
                <SelectTrigger className="min-w-[165px] w-auto">
                  <SelectValue placeholder="Font" className="truncate" />
                </SelectTrigger>
                <SelectContent>
                  {FONT_FAMILIES.map((fontFamily) => (
                    <SelectItem key={fontFamily} value={fontFamily}>
                      <span className="block truncate" style={{ fontFamily }}>
                        {fontFamily}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={String(Math.round(selectedRunStyle?.fontSizePt ?? 12))}
                onValueChange={(value: string | null) => {
                  if (!value) {
                    return;
                  }

                  const nextSize = Number(value);
                  if (!Number.isFinite(nextSize)) {
                    return;
                  }

                  editor.setFontSize(nextSize);
                }}
              >
                <SelectTrigger className="min-w-[95px] w-auto">
                  <SelectValue placeholder="Size" className="truncate" />
                </SelectTrigger>
                <SelectContent>
                  {FONT_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} pt
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        aria-label="Line spacing"
                      />
                    }
                  >
                    <AlignJustify className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Line spacing</TooltipContent>
                </Tooltip>
                <Select
                  value={selectedLineSpacingValue}
                  onValueChange={(value: string | null) => {
                    if (!value) {
                      return;
                    }

                    const nextSpacing = Number(value);
                    if (!Number.isFinite(nextSpacing)) {
                      return;
                    }

                    setLineSpacing(nextSpacing);
                  }}
                >
                  <SelectTrigger className="min-w-[110px] w-auto">
                    <SelectValue
                      placeholder="Line space"
                      className="truncate"
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {LINE_SPACING_OPTIONS.map((spacing) => (
                      <SelectItem key={spacing} value={String(spacing)}>
                        {spacing}x
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <ButtonGroup>
                <Toggle
                  pressed={Boolean(selectedRunStyle?.bold)}
                  onPressedChange={editor.toggleBold}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <Bold />
                  Bold
                </Toggle>
                <Toggle
                  pressed={Boolean(selectedRunStyle?.italic)}
                  onPressedChange={editor.toggleItalic}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <Italic />
                  Italic
                </Toggle>
                <Toggle
                  pressed={Boolean(selectedRunStyle?.underline)}
                  onPressedChange={editor.toggleUnderline}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <Underline />
                  Underline
                </Toggle>
                <Toggle
                  pressed={Boolean(selectedRunStyle?.strike)}
                  onPressedChange={editor.toggleStrike}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <Strikethrough />
                  Strike
                </Toggle>
                <Toggle
                  pressed={selectedRunStyle?.verticalAlign === "superscript"}
                  onPressedChange={editor.toggleSuperscript}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <Superscript />
                  Superscript
                </Toggle>
                <Toggle
                  pressed={selectedRunStyle?.verticalAlign === "subscript"}
                  onPressedChange={editor.toggleSubscript}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <Subscript />
                  Subscript
                </Toggle>
              </ButtonGroup>

              <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2 py-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Text
                </span>
                <ColorPicker
                  color={textColorValue}
                  onChange={(color: string) => {
                    editor.setTextColor(normalizeEditorColor(color, "#111827"));
                  }}
                  triggerClassName="h-7 min-w-[170px]"
                  onTriggerMouseDown={preserveTextSelectionOnMouseDown}
                  onTriggerPointerDown={preserveTextSelectionOnPointerDown}
                />
              </div>

              <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2 py-1">
                <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Highlighter className="size-3" />
                  Highlight
                </span>
                <ColorPicker
                  color={highlightColorValue}
                  onChange={(color: string) => {
                    editor.setHighlight(normalizeEditorColor(color, "#fff59d"));
                  }}
                  triggerClassName="h-7 min-w-[170px]"
                  onTriggerMouseDown={preserveTextSelectionOnMouseDown}
                  onTriggerPointerDown={preserveTextSelectionOnPointerDown}
                />
              </div>

              <ButtonGroup>
                <Button
                  variant="outline"
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                  onClick={openLinkEditor}
                >
                  <Link2 />
                  Link
                </Button>
              </ButtonGroup>

              <ButtonGroup>
                <Toggle
                  pressed={
                    selectedParagraph?.style?.align === "left" ||
                    !selectedParagraph?.style?.align
                  }
                  onPressedChange={() => editor.setAlignment("left")}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <AlignLeft />
                  Left
                </Toggle>
                <Toggle
                  pressed={selectedParagraph?.style?.align === "center"}
                  onPressedChange={() => editor.setAlignment("center")}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <AlignCenter />
                  Center
                </Toggle>
                <Toggle
                  pressed={selectedParagraph?.style?.align === "right"}
                  onPressedChange={() => editor.setAlignment("right")}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <AlignRight />
                  Right
                </Toggle>
                <Toggle
                  pressed={selectedParagraph?.style?.align === "justify"}
                  onPressedChange={() => editor.setAlignment("justify")}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <AlignJustify />
                  Justify
                </Toggle>
              </ButtonGroup>

              <ButtonGroup>
                <Toggle
                  pressed={editor.hasUnorderedList}
                  onClick={() => editor.toggleList("unordered")}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <List />
                  Bullet
                </Toggle>
                <Toggle
                  pressed={editor.hasOrderedList}
                  onClick={() => editor.toggleList("ordered")}
                  onMouseDown={preserveTextSelectionOnMouseDown}
                  onPointerDown={preserveTextSelectionOnPointerDown}
                >
                  <ListOrdered />
                  Numbered
                </Toggle>
              </ButtonGroup>

              <ButtonGroup>
                <div className="border-input bg-input/20 dark:bg-input/30 h-8 rounded-md border px-2 py-1.5 text-xs/relaxed text-muted-foreground flex items-center gap-2">
                  <Columns2 className="size-3.5" />
                  <span>
                    {activeSectionColumns
                      ? `${activeSectionColumns.count} columns`
                      : "1 column"}
                  </span>
                </div>
              </ButtonGroup>

              <ButtonGroup>
                <Button
                  variant="outline"
                  onClick={() => setThumbnailsSheetOpen(true)}
                >
                  <PanelsTopLeft />
                  Pages
                </Button>
              </ButtonGroup>

              <ButtonGroup>
                <DropdownMenu>
                  <DropdownMenuTrigger className="border-input bg-input/20 dark:bg-input/30 dark:hover:bg-input/50 hover:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/30 h-8 rounded-md border px-2 py-1.5 text-xs/relaxed transition-colors focus-visible:ring-2 flex items-center gap-2 outline-none">
                    <HugeiconsIcon
                      icon={borderTriggerIcon}
                      strokeWidth={1.8}
                      className="size-3.5 text-muted-foreground"
                    />
                    <span className="truncate">{borderTriggerLabel}</span>
                    {borderActiveCountBadge ? (
                      <Badge
                        variant="secondary"
                        className="h-4 min-w-4 px-1 text-[10px]"
                      >
                        {borderActiveCountBadge}
                      </Badge>
                    ) : null}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56">
                    {BORDER_CONTROL_OPTIONS.map((option) => {
                      const enabledForContext =
                        !option.contexts ||
                        option.contexts.includes(borderContext);
                      const checked = activeBorderPresets[option.id];
                      const BorderOptionIcon = borderControlOptionIcon(
                        option.id
                      );

                      return (
                        <React.Fragment key={option.id}>
                          {option.separatorBefore ? (
                            <DropdownMenuSeparator />
                          ) : null}
                          <DropdownMenuCheckboxItem
                            checked={checked}
                            disabled={!enabledForContext}
                            closeOnClick={false}
                            onCheckedChange={() => {
                              if (!enabledForContext) {
                                return;
                              }
                              applyBorderPreset(option.id);
                            }}
                          >
                            <HugeiconsIcon
                              icon={BorderOptionIcon}
                              strokeWidth={1.8}
                              className="size-3.5 text-muted-foreground"
                            />
                            {option.label}
                          </DropdownMenuCheckboxItem>
                        </React.Fragment>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>

              <ButtonGroup>
                <Button
                  variant="outline"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImagePlus />
                  Image
                </Button>
                <Button variant="outline" onClick={editor.insertTable}>
                  <Table2 />
                  Table
                </Button>
              </ButtonGroup>

              <ButtonGroup>
                <Button
                  variant="outline"
                  onClick={() => shiftZoom(-1)}
                  disabled={zoomPercent <= ZOOM_PERCENT_OPTIONS[0]}
                >
                  <ZoomOut />
                  Zoom Out
                </Button>
                <Select
                  value={String(zoomPercent)}
                  onValueChange={(value: string | null) => {
                    if (!value) {
                      return;
                    }

                    const parsed = Number(value);
                    if (!Number.isFinite(parsed)) {
                      return;
                    }

                    setZoomPercent(parsed);
                  }}
                >
                  <SelectTrigger className="min-w-[98px] w-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ZOOM_PERCENT_OPTIONS.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={() => shiftZoom(1)}
                  disabled={
                    zoomPercent >=
                    ZOOM_PERCENT_OPTIONS[ZOOM_PERCENT_OPTIONS.length - 1]
                  }
                >
                  <ZoomIn />
                  Zoom In
                </Button>
              </ButtonGroup>

              <ButtonGroup>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={editor.isImporting}
                >
                  {editor.isImporting ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Upload />
                  )}
                  {editor.isImporting ? "Loading…" : "Import"}
                </Button>
                <Button
                  onClick={editor.exportDocx}
                  disabled={editor.isImporting}
                >
                  <Download />
                  Download
                </Button>
              </ButtonGroup>

              <ButtonGroup>
                <div className="flex items-center gap-2 px-2">
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <FileDiff className="h-4 w-4" />
                    Show edits
                  </span>
                  <Switch
                    checked={showTrackedChanges}
                    onCheckedChange={setShowTrackedChanges}
                  />
                </div>
                <Separator orientation="vertical" className="h-6" />
                <div className="flex items-center gap-2 px-2">
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <MessageSquareText className="h-4 w-4" />
                    Show comments
                    {comments.length > 0 ? (
                      <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-medium text-amber-600">
                        {comments.length}
                      </span>
                    ) : null}
                  </span>
                  <Switch
                    checked={showComments}
                    onCheckedChange={setShowComments}
                  />
                </div>
                <Separator orientation="vertical" className="h-6" />
                <div className="flex items-center gap-2 px-2">
                  <span className="text-sm text-muted-foreground">
                    Read only
                  </span>
                  <Switch
                    checked={isReadOnly}
                    onCheckedChange={setIsReadOnly}
                  />
                </div>
              </ButtonGroup>
            </div>
          </CardContent>
        </Card>

        <div
          ref={viewerScrollRef}
          className="relative min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/40 p-4"
        >
          {isReadOnly && isImportDragOver ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-background/75 p-6 backdrop-blur-[1px]">
              <div className="flex max-w-sm items-center gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-sm">
                <Upload className="size-5 text-primary" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Drop a DOCX file to import
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Read-only mode blocks editing, but import is still allowed
                    in the playground.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          <div className="mx-auto flex min-h-full justify-center">
            <div style={{ zoom: zoomScale }}>
              <DocxEditorViewer
                editor={editor}
                pageGapBackgroundColor={pageGapBackgroundColor}
                mode={isReadOnly ? "read-only" : "edit"}
                showTrackedChanges={showTrackedChanges}
                renderTrackedChangeCard={renderTrackedChangeCard}
                showComments={showComments}
                renderContextMenu={renderContextMenu}
                renderTableContextMenu={renderTableContextMenu}
                onFormFieldDoubleClick={(location) => {
                  editor.selectFormField(location);
                  setFormWidgetDialogOpen(true);
                }}
              />
            </div>
          </div>
        </div>

        <Sheet open={thumbnailsSheetOpen} onOpenChange={setThumbnailsSheetOpen}>
          <SheetContent side="right" className="w-[24rem] sm:max-w-[24rem]">
            <SheetHeader className="pb-3">
              <SheetTitle>Page Thumbnails</SheetTitle>
              <SheetDescription>
                Jump to any page from independent thumbnail renders.
              </SheetDescription>
            </SheetHeader>

            <div
              ref={thumbnailScrollRef}
              className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
            >
              <div
                style={{
                  height: `${thumbnailVirtualizer.getTotalSize()}px`,
                  position: "relative",
                  width: "100%",
                }}
              >
                {thumbnailVirtualItems.map((virtualItem) => {
                  const thumbnail = thumbnails[virtualItem.index];
                  if (!thumbnail) {
                    return null;
                  }

                  const rotatePreview = thumbnail.widthPx > thumbnail.heightPx;
                  const previewWidthPx = rotatePreview
                    ? thumbnail.heightPx
                    : thumbnail.widthPx;
                  const previewHeightPx = rotatePreview
                    ? thumbnail.widthPx
                    : thumbnail.heightPx;

                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      style={{
                        left: 0,
                        paddingBottom: "0.75rem",
                        position: "absolute",
                        top: 0,
                        transform: `translateY(${virtualItem.start}px)`,
                        width: "100%",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          scrollToPage(thumbnail.pageIndex);
                          setThumbnailsSheetOpen(false);
                        }}
                        className="bg-card hover:bg-accent/60 border-border flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors"
                      >
                        <div className="flex min-w-10 flex-col items-center gap-1 pt-1">
                          <span className="text-xs font-medium text-foreground">
                            {thumbnail.pageNumber}
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            {thumbnail.status}
                          </span>
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <div className="bg-muted/60 ring-border/70 flex min-h-[10rem] items-center justify-center overflow-hidden rounded-md p-3 ring-1">
                            <div
                              style={{
                                width: `${previewWidthPx}px`,
                                height: `${previewHeightPx}px`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <canvas
                                ref={thumbnail.canvasRef}
                                width={thumbnail.pixelWidthPx}
                                height={thumbnail.pixelHeightPx}
                                style={{
                                  width: `${thumbnail.widthPx}px`,
                                  height: `${thumbnail.heightPx}px`,
                                  display: "block",
                                  transform: rotatePreview
                                    ? "rotate(90deg)"
                                    : undefined,
                                  transformOrigin: "center center",
                                }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>
                              {Math.round(thumbnail.sourceWidthPx)} x{" "}
                              {Math.round(thumbnail.sourceHeightPx)}
                            </span>
                            {!thumbnail.isMounted ? (
                              <span>Offscreen render</span>
                            ) : thumbnail.error ? (
                              <span>{thumbnail.error.message}</span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <Dialog
          open={formWidgetDialogOpen && Boolean(selectedFormField)}
          onOpenChange={handleFormWidgetDialogOpenChange}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Form Field Settings</DialogTitle>
              <DialogDescription>
                Configure the selected Word form widget.
              </DialogDescription>
            </DialogHeader>

            {selectedFormField ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-1 rounded-md border bg-muted/40 p-2 text-xs sm:grid-cols-2">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-medium capitalize">
                    {selectedFormField.field.fieldType}
                  </span>
                  <span className="text-muted-foreground">Source</span>
                  <span className="font-medium capitalize">
                    {selectedFormField.field.sourceKind ?? "sdt"}
                  </span>
                </div>

                {selectedFormField.field.fieldType === "text" ||
                selectedFormField.field.fieldType === "date" ? (
                  <div className="space-y-3">
                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        Text field type
                      </span>
                      <Select
                        value={formWidgetDraft?.text.inputType ?? "regular"}
                        onValueChange={(value: string | null) => {
                          if (!value) {
                            return;
                          }
                          const nextFormatOptions =
                            formTextFormatOptionsForInputType(value);
                          updateFormWidgetDraft((draft) => ({
                            ...draft,
                            text: {
                              ...draft.text,
                              inputType: value,
                              textFormat: nextFormatOptions.some(
                                (option) =>
                                  option.value ===
                                  (draft.text.textFormat?.trim() ?? "")
                              )
                                ? draft.text.textFormat
                                : nextFormatOptions[0]?.value ??
                                  draft.text.textFormat,
                            },
                          }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="regular">Regular text</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                          <SelectItem value="currentDate">
                            Current date
                          </SelectItem>
                          <SelectItem value="currentTime">
                            Current time
                          </SelectItem>
                          <SelectItem value="calculated">Calculated</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {selectedFormFieldDefaultValueLabel}
                      </span>
                      <Input
                        value={formWidgetDraft?.text.defaultText ?? ""}
                        placeholder={selectedFormFieldDefaultValuePlaceholder}
                        disabled={selectedFormFieldDefaultValueDisabled}
                        onChange={(
                          event: React.ChangeEvent<HTMLInputElement>
                        ) => {
                          const nextValue = event.target.value;
                          updateFormWidgetDraft((draft) => ({
                            ...draft,
                            text: {
                              ...draft.text,
                              defaultText: nextValue,
                            },
                          }));
                        }}
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        Maximum length
                      </span>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Unlimited"
                        value={formWidgetDraft?.text.maxLength ?? ""}
                        onChange={(
                          event: React.ChangeEvent<HTMLInputElement>
                        ) => {
                          const nextValue = event.target.value;
                          updateFormWidgetDraft((draft) => ({
                            ...draft,
                            text: {
                              ...draft.text,
                              maxLength: nextValue,
                            },
                          }));
                        }}
                      />
                      {hasInvalidFormWidgetMaxLength ? (
                        <span className="text-xs text-destructive">
                          Enter a number greater than or equal to 0.
                        </span>
                      ) : null}
                    </div>

                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {selectedFormFieldFormatLabel}
                      </span>
                      <Select
                        value={selectedFormFieldEffectiveTextFormatValue}
                        onValueChange={(value: string | null) => {
                          if (!value) {
                            return;
                          }
                          updateFormWidgetDraft((draft) => ({
                            ...draft,
                            text: {
                              ...draft.text,
                              textFormat: value,
                            },
                          }));
                        }}
                      >
                        <SelectTrigger
                          className="max-w-full"
                          style={{
                            width: `${selectedFormFieldFormatSelectWidthCh}ch`,
                          }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-max min-w-(--anchor-width) overflow-x-visible">
                          {selectedFormFieldFormatOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}

                {selectedFormField.field.fieldType === "checkbox" ? (
                  <div className="space-y-3">
                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        Default value
                      </span>
                      <Select
                        value={
                          formWidgetDraft?.checkbox.defaultChecked
                            ? "checked"
                            : "not-checked"
                        }
                        onValueChange={(value: string | null) => {
                          if (!value) {
                            return;
                          }
                          updateFormWidgetDraft((draft) => ({
                            ...draft,
                            checkbox: {
                              ...draft.checkbox,
                              defaultChecked: value === "checked",
                            },
                          }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not-checked">
                            Not checked
                          </SelectItem>
                          <SelectItem value="checked">Checked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        Checkbox size
                      </span>
                      <Select
                        value={formWidgetDraft?.checkbox.sizeMode ?? "auto"}
                        onValueChange={(value: string | null) => {
                          if (!value) {
                            return;
                          }
                          const nextMode = value === "exact" ? "exact" : "auto";
                          updateFormWidgetDraft((draft) => ({
                            ...draft,
                            checkbox: {
                              ...draft.checkbox,
                              sizeMode: nextMode,
                              sizePt:
                                nextMode === "exact"
                                  ? draft.checkbox.sizePt || "10"
                                  : draft.checkbox.sizePt,
                            },
                          }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto</SelectItem>
                          <SelectItem value="exact">Exactly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {(formWidgetDraft?.checkbox.sizeMode ?? "auto") ===
                    "exact" ? (
                      <div className="grid gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          Exact size (pt)
                        </span>
                        <Input
                          type="number"
                          min={1}
                          step={0.5}
                          value={formWidgetDraft?.checkbox.sizePt ?? "10"}
                          onChange={(
                            event: React.ChangeEvent<HTMLInputElement>
                          ) => {
                            const nextValue = event.target.value;
                            updateFormWidgetDraft((draft) => ({
                              ...draft,
                              checkbox: {
                                ...draft.checkbox,
                                sizeMode: "exact",
                                sizePt: nextValue,
                              },
                            }));
                          }}
                        />
                        {hasInvalidFormWidgetCheckboxSize ? (
                          <span className="text-xs text-destructive">
                            Enter a number greater than 0.
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={handleCancelFormWidgetDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveFormWidgetDialog}
                disabled={!canSaveFormWidgetDialog}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {linkHoverCard && !linkEditorOpen ? (
          <div
            className="fixed z-50 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-md"
            style={{
              top: linkHoverCard.top,
              left: linkHoverCard.left,
              transform: "translate(-50%, 0)",
            }}
          >
            <div className="flex items-center gap-2">
              <a
                href={linkHoverCard.href}
                target={
                  linkHoverCard.href.startsWith("#") ? undefined : "_blank"
                }
                rel={
                  linkHoverCard.href.startsWith("#")
                    ? undefined
                    : "noreferrer noopener"
                }
                className="max-w-[280px] truncate text-blue-600 underline"
              >
                {linkHoverCard.href}
              </a>
              <Button
                variant="outline"
                size="xs"
                onMouseDown={preserveTextSelectionOnMouseDown}
                onClick={openLinkEditor}
              >
                Edit
              </Button>
            </div>
          </div>
        ) : null}

        {linkEditorOpen && linkEditorPosition ? (
          <div
            className="fixed z-[60] w-[320px] rounded-lg border bg-popover p-3 shadow-lg"
            style={{
              top: linkEditorPosition.top,
              left: linkEditorPosition.left,
              transform: "translate(-50%, 0)",
            }}
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Edit Link
            </p>
            <Input
              value={linkEditorValue}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setLinkEditorValue(event.target.value)
              }
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLinkFromEditor();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeLinkEditor();
                }
              }}
              placeholder="https://example.com"
              autoFocus
            />
            <div className="mt-2 flex items-center justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={closeLinkEditor}>
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={removeLinkFromEditor}
              >
                Remove
              </Button>
              <Button size="sm" onClick={applyLinkFromEditor}>
                Apply
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default App;
