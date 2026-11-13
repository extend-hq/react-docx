import * as React from "react";
import {
  type DocModel,
  type DocxBorderContext,
  type DocxBorderPreset,
  type DocxContextMenuActionId,
  type DocxContextMenuRenderProps,
  type DocxCommentCardRenderProps,
  type DocxEditorController,
  DocxEditorViewer,
  type DocxSelectedFormField,
  type DocxTableContextMenuActionId,
  type DocxTableContextMenuRenderProps,
  type DocxTextRange,
  type DocxTrackedChangeCardRenderProps,
  type ViewerZoomLevel,
  type ViewerZoomState,
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
  Baseline,
  Bold,
  Check,
  Code,
  Columns2,
  Download,
  FileText,
  FolderOpen,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChevronsUpDown,
  ListOrdered,
  Lock,
  Minus,
  Moon,
  MoveHorizontal,
  Plus,
  Proportions,
  RectangleVertical,
  Redo2,
  Ruler,
  Scaling,
  Settings2,
  Strikethrough,
  Subscript,
  Sun,
  Superscript,
  Table2,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Trash2,
  Underline,
  Undo2,
  Upload,
  X,
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

import { BlockInspector } from "@/components/block-inspector";
import {
  keepSelection,
  RibbonButton,
  RibbonColorButton,
  RibbonDivider,
  RibbonGroup,
  RibbonMenuButton,
  RibbonToggle,
} from "@/components/ribbon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubPopup,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { createWelcomeDocumentModel, WELCOME_FILE_NAME } from "@/lib/welcome-document";

const RIBBON_TABS = ["Home", "Insert", "Layout", "Review", "View", "Developer"] as const;
// Word files, and OpenDocument text (opened view-only).
const SUPPORTED_DOCUMENT_ACCEPT =
  ".docx,.doc,.dot,.dotx,.docm,.dotm,.odt,.ott,.odm,.otm,.oth,.fodt";
const SUPPORTED_DOCUMENT_FILE_NAME =
  /\.(?:(?:doc|dot)[xm]?|odt|ott|odm|otm|oth|fodt)$/i;
type RibbonTab = (typeof RIBBON_TABS)[number];

const REVISION_DISPLAY_ITEMS = [
  { value: "balloons", label: "Balloons" },
  { value: "inline", label: "Inline" },
];

const FORM_TEXT_INPUT_TYPE_ITEMS = [
  { value: "regular", label: "Regular text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "currentDate", label: "Current date" },
  { value: "currentTime", label: "Current time" },
  { value: "calculated", label: "Calculated" },
];

const CHECKBOX_DEFAULT_ITEMS = [
  { value: "not-checked", label: "Not checked" },
  { value: "checked", label: "Checked" },
];

const CHECKBOX_SIZE_ITEMS = [
  { value: "auto", label: "Auto" },
  { value: "exact", label: "Exactly" },
];

const statusIconButtonClass =
  "flex items-center justify-center rounded-sm text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-white/5";

/** Read-only page setup value shown in the Layout tab. */
function RibbonInfo({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function CountBadge({ count }: { count: number }): React.JSX.Element {
  return (
    <span className="rounded-full bg-brand/10 px-1.5 text-[11px] font-medium text-brand tabular-nums">
      {count}
    </span>
  );
}

function countWordsInText(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function countWordsInNodes(nodes: readonly unknown[]): number {
  let total = 0;
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    const record = node as Record<string, unknown>;
    if (record.type === "paragraph") {
      total += countWordsInText(textFromInlineValue(record.children));
    } else if (record.type === "table" && Array.isArray(record.rows)) {
      for (const row of record.rows as Array<{ cells?: Array<{ nodes?: unknown[] }> }>) {
        for (const cell of row.cells ?? []) {
          total += countWordsInNodes(cell.nodes ?? []);
        }
      }
    }
  }
  return total;
}

const PAGE_SIZE_NAMES: Array<{ name: string; widthIn: number; heightIn: number }> = [
  { name: "Letter", widthIn: 8.5, heightIn: 11 },
  { name: "Legal", widthIn: 8.5, heightIn: 14 },
  { name: "A4", widthIn: 8.27, heightIn: 11.69 },
  { name: "A5", widthIn: 5.83, heightIn: 8.27 },
  { name: "Executive", widthIn: 7.25, heightIn: 10.5 },
];

function formatInches(px: number): string {
  return `${Number((px / 96).toFixed(2))}"`;
}

function describePageSize(widthPx: number, heightPx: number): string {
  const shortIn = Math.min(widthPx, heightPx) / 96;
  const longIn = Math.max(widthPx, heightPx) / 96;
  const named = PAGE_SIZE_NAMES.find(
    (size) =>
      Math.abs(size.widthIn - shortIn) < 0.05 &&
      Math.abs(size.heightIn - longIn) < 0.05
  );
  return named?.name ?? `${formatInches(widthPx)} × ${formatInches(heightPx)}`;
}

function describeMargins(margins: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): string {
  const values = [margins.top, margins.right, margins.bottom, margins.left];
  if (values.every((value) => Math.abs(value - values[0]) < 0.5)) {
    return Math.abs(values[0] - 96) < 0.5 ? `Normal (1")` : formatInches(values[0]);
  }
  return `${formatInches(margins.top)} top · ${formatInches(margins.left)} left`;
}

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
const FONT_FAMILY_ITEMS = FONT_FAMILIES.map((value) => ({ value, label: value }));
const FONT_SIZE_ITEMS = FONT_SIZE_OPTIONS.map((value) => ({
  value: String(value),
  label: String(value),
}));
const LINE_SPACING_ITEMS = LINE_SPACING_OPTIONS.map((value) => ({
  value: String(value),
  label: `${value}x`,
}));
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
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
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
  10, 25, 50, 75, 90, 100, 110, 125, 150, 175, 200,
] as const;

const ZOOM_PERCENT_ITEMS = ZOOM_PERCENT_OPTIONS.map((value) => ({
  value: String(value),
  label: `${value}%`,
}));

const ZOOM_ITEMS = [
  { value: "automatic", label: "Automatic" },
  { value: "fit-page", label: "Fit page" },
  { value: "fit-width", label: "Fit width" },
  ...ZOOM_PERCENT_ITEMS,
];

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
        <ContextMenuSubPopup className="w-56" data-docx-context-menu="true">
          {action.children.map((childAction) =>
            renderMenuAction(childAction, runAction)
          )}
        </ContextMenuSubPopup>
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
      <ContextMenuPopup
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
      </ContextMenuPopup>
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
  semanticModelVersion: 1;
  semanticModelDigest: string;
  bodyNodeCount: number;
  bodyParagraphNodeCount: number;
  bodyTableNodeCount: number;
  paragraphCount: number;
  tableCount: number;
  imageCount: number;
  formFieldCount: number;
  trackedChangeCount: number;
  commentCount: number;
  resolvedCommentCount: number;
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

type PlaygroundDocxTextLocation = DocxTextRange["start"]["location"];

type PlaygroundDocxLocationState = {
  location: PlaygroundDocxTextLocation;
  text: string;
  digest: string;
  alignment: "left" | "center" | "right" | "justify" | null;
  listType: "unordered" | "ordered" | null;
  lineMultiple: number;
};

type PlaygroundDocxRangeState = {
  range: DocxTextRange;
  text: string;
  digest: string;
  styles: Array<{
    bold: boolean | null;
    italic: boolean | null;
    underline: boolean | null;
    strike: boolean | null;
    color: string | null;
    highlight: string | null;
    fontFamily: string | null;
    fontSizePt: number | null;
  }>;
};

type PlaygroundDocxActionState = {
  selection: DocxEditorController["selection"];
  activeTextRange: DocxTextRange | null;
  selectedParagraphLocation: PlaygroundDocxTextLocation;
  selectedRunStyle: PlaygroundDocxRangeState["styles"][number];
  semanticModelDigest: string;
  canUndo: boolean;
  canRedo: boolean;
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
  getActionState: () => PlaygroundDocxActionState;
  getLocationState: (
    location: PlaygroundDocxTextLocation
  ) => PlaygroundDocxLocationState | undefined;
  getRangeState: (range: DocxTextRange) => PlaygroundDocxRangeState | undefined;
  getTrackedChanges: () => DocxEditorController["trackedChanges"];
  getComments: () => DocxEditorController["comments"];
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
  getTrackedChange: (
    index: number
  ) => DocxEditorController["trackedChanges"][number];
  getComment: (commentId: number) => DocxEditorController["comments"][number];
  acceptTrackedChange: (index: number) => void;
  rejectTrackedChange: (index: number) => void;
  acceptTrackedChangeHandle: (
    change: DocxEditorController["trackedChanges"][number]
  ) => void;
  setCommentResolvedHandle: (
    comment: DocxEditorController["comments"][number],
    resolved: boolean
  ) => void;
  createComment: (
    text: string,
    options?: Parameters<DocxEditorController["createComment"]>[1]
  ) => number;
  setCommentResolved: (commentId: number, resolved: boolean) => void;
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

const TEST_MODEL_IGNORED_KEYS = new Set([
  "blockId",
  "data",
  "documentLoadNonce",
  "isNew",
  "resolutionDirty",
  "sourceFontFamily",
  "sourceResolved",
  "sourceFingerprint",
  "sourceRunProvenance",
  "sourceTextPatch",
  "sourceTextPatches",
  "sourceParagraphXml",
  "sourceXml",
  "src",
]);

function hashTestValue(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalizeTestModelValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeTestModelValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (value instanceof Uint8Array) {
    const byteString = Array.from(value, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return {
      byteLength: value.byteLength,
      digest: [
        hashTestValue(byteString, 0x811c9dc5),
        hashTestValue(byteString, 0x9e3779b9),
      ].join(""),
    };
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .filter(
      (key) => !TEST_MODEL_IGNORED_KEYS.has(key) && record[key] !== undefined
    )
    .sort()
    .reduce<Record<string, unknown>>((canonical, key) => {
      canonical[key] = canonicalizeTestModelValue(record[key]);
      return canonical;
    }, {});
}

function semanticTestValueDigest(value: unknown): string {
  const canonicalBody = JSON.stringify(canonicalizeTestModelValue(value));
  return [
    hashTestValue(canonicalBody, 0x811c9dc5),
    hashTestValue(canonicalBody, 0x9e3779b9),
    hashTestValue(canonicalBody, 0x85ebca6b),
    hashTestValue(canonicalBody, 0xc2b2ae35),
  ].join("");
}

function semanticTestModelDigest(
  model: DocModel,
  trackedChanges: DocxEditorController["trackedChanges"]
): string {
  return semanticTestValueDigest({
    nodes: model.nodes,
    comments: model.metadata.comments ?? [],
    trackedChanges,
  });
}

function sameTestLocation(
  left: PlaygroundDocxTextLocation,
  right: PlaygroundDocxTextLocation
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "paragraph" && right.kind === "paragraph") {
    return left.nodeIndex === right.nodeIndex;
  }
  if (left.kind === "table-cell" && right.kind === "table-cell") {
    return (
      left.tableIndex === right.tableIndex &&
      left.rowIndex === right.rowIndex &&
      left.cellIndex === right.cellIndex &&
      left.paragraphIndex === right.paragraphIndex
    );
  }
  return false;
}

function selectedTestLocation(
  editor: DocxEditorController
): PlaygroundDocxTextLocation {
  if (editor.activeTextRange) {
    return editor.activeTextRange.start.location;
  }
  if (editor.selection.kind === "paragraph") {
    return editor.selection;
  }
  return {
    ...editor.selection,
    paragraphIndex: 0,
  };
}

function paragraphAtTestLocation(
  model: DocModel,
  location: PlaygroundDocxTextLocation
) {
  if (location.kind === "paragraph") {
    const node = model.nodes[location.nodeIndex];
    return node?.type === "paragraph" ? node : undefined;
  }
  const table = model.nodes[location.tableIndex];
  if (!table || table.type !== "table") {
    return undefined;
  }
  const node =
    table.rows[location.rowIndex]?.cells[location.cellIndex]?.nodes[
      location.paragraphIndex
    ];
  return node?.type === "paragraph" ? node : undefined;
}

function buildDocxLocationState(
  editor: DocxEditorController,
  location: PlaygroundDocxTextLocation
): PlaygroundDocxLocationState | undefined {
  const paragraph = paragraphAtTestLocation(editor.model, location);
  if (!paragraph) {
    return undefined;
  }
  const isSelected = sameTestLocation(selectedTestLocation(editor), location);
  const listType = isSelected
    ? editor.hasUnorderedList
      ? "unordered"
      : editor.hasOrderedList
      ? "ordered"
      : null
    : paragraph.style?.numbering?.numId
    ? "ordered"
    : null;
  const lineMultiple = isSelected
    ? editor.selectedLineSpacing.multiple
    : paragraph.style?.spacing?.lineTwips
    ? Number((paragraph.style.spacing.lineTwips / 240).toFixed(3))
    : 1;
  return {
    location,
    text: paragraphTextFromNode(paragraph),
    digest: semanticTestValueDigest(paragraph),
    alignment: paragraph.style?.align ?? null,
    listType,
    lineMultiple,
  };
}

function testTextStyleSnapshot(value: unknown) {
  const style =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    bold: typeof style.bold === "boolean" ? style.bold : null,
    italic: typeof style.italic === "boolean" ? style.italic : null,
    underline: typeof style.underline === "boolean" ? style.underline : null,
    strike: typeof style.strike === "boolean" ? style.strike : null,
    color: typeof style.color === "string" ? style.color : null,
    highlight: typeof style.highlight === "string" ? style.highlight : null,
    fontFamily: typeof style.fontFamily === "string" ? style.fontFamily : null,
    fontSizePt: typeof style.fontSizePt === "number" ? style.fontSizePt : null,
  };
}

function buildDocxRangeState(
  model: DocModel,
  range: DocxTextRange
): PlaygroundDocxRangeState | undefined {
  if (!sameTestLocation(range.start.location, range.end.location)) {
    return undefined;
  }
  const paragraph = paragraphAtTestLocation(model, range.start.location);
  if (!paragraph) {
    return undefined;
  }
  const start = Math.max(0, Math.round(range.start.offset));
  const end = Math.max(start, Math.round(range.end.offset));
  const segments: Array<{
    text: string;
    style: ReturnType<typeof testTextStyleSnapshot>;
  }> = [];
  let cursor = 0;
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.type === "text") {
      const fullText = typeof record.text === "string" ? record.text : "";
      const segmentStart = cursor;
      const segmentEnd = cursor + fullText.length;
      cursor = segmentEnd;
      const overlapStart = Math.max(start, segmentStart);
      const overlapEnd = Math.min(end, segmentEnd);
      if (overlapStart < overlapEnd) {
        segments.push({
          text: fullText.slice(
            overlapStart - segmentStart,
            overlapEnd - segmentStart
          ),
          style: testTextStyleSnapshot(record.style),
        });
      }
      return;
    }
    collect(record.children);
  };
  collect(paragraph.children);

  return {
    range,
    text: segments.map((segment) => segment.text).join(""),
    digest: semanticTestValueDigest(segments),
    styles: segments.map((segment) => segment.style),
  };
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
    semanticModelVersion: 1,
    semanticModelDigest: semanticTestModelDigest(
      editor.model,
      editor.trackedChanges
    ),
    bodyNodeCount: editor.model.nodes.length,
    bodyParagraphNodeCount,
    bodyTableNodeCount,
    paragraphCount,
    tableCount,
    imageCount,
    formFieldCount,
    trackedChangeCount: editor.trackedChanges.length,
    commentCount: editor.comments.length,
    resolvedCommentCount: editor.comments.filter(
      (comment) => comment.resolved === true
    ).length,
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

const WELCOME_DOCUMENT = createWelcomeDocumentModel();

function PlaygroundApp(): React.JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const editor = useDocxEditor({
    starterModel: WELCOME_DOCUMENT,
    initialFileName: WELCOME_FILE_NAME,
  });
  const [showBlocks, setShowBlocks] = React.useState(false);
  const blockViewerRootRef = React.useRef<HTMLDivElement>(null);
  const { documentTheme, setDocumentTheme } = useDocxDocumentTheme(editor);
  const { layout: pageLayout } = useDocxPageLayout(editor);
  const [navigationPaneOpen, setNavigationPaneOpen] = React.useState(false);
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
    enabled: navigationPaneOpen,
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
    pageIndexes: navigationPaneOpen ? undefined : EMPTY_THUMBNAIL_RENDER_WINDOW.visiblePageIndexes,
    maxWidthPx: 148,
    pixelRatio: THUMBNAIL_PIXEL_RATIO,
    minRasterIntervalMs: 80,
    renderWindow: navigationPaneOpen
      ? {
          visiblePageIndexes: thumbnailRenderWindow.visiblePageIndexes,
          prefetchPageIndexes: thumbnailRenderWindow.prefetchPageIndexes,
        }
      : undefined,
  });
  React.useEffect(() => {
    if (!navigationPaneOpen) {
      updateThumbnailRenderWindow([]);
      return;
    }

    updateThumbnailRenderWindow(
      thumbnailVirtualItems.map((virtualItem) => virtualItem.index)
    );
  }, [thumbnailVirtualItems, navigationPaneOpen, updateThumbnailRenderWindow]);
  React.useEffect(() => {
    if (navigationPaneOpen) {
      thumbnailVirtualizer.measure();
    }
  }, [thumbnailPageCount, thumbnailVirtualizer, navigationPaneOpen]);
  const { paragraphStyles, selectedParagraphStyleId, setParagraphStyle } =
    useDocxParagraphStyles(editor);
  const { lineSpacing, setLineSpacing } = useDocxLineSpacing(editor);
  const { borderContext, activeBorderPresets, applyBorderPreset } =
    useDocxBorders(editor);
  const { selectedFormField, updateSelectedFormFieldWidget } =
    useDocxFormFields(editor);
  const [revisionDisplay, setRevisionDisplay] = React.useState<"balloons" | "inline">("balloons");
  const { showTrackedChanges, setShowTrackedChanges } =
    useDocxTrackChanges(editor);
  const { comments, showComments, setShowComments } = useDocxComments(editor);
  const [themeReady, setThemeReady] = React.useState(false);

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
  const [zoomPercent, setZoomPercent] = React.useState<ViewerZoomLevel>(
    () => pageLayout.viewportDefaults.zoomPercent
  );
  const [readOnlyRequested, setIsReadOnly] = React.useState(false);
  // OpenDocument files open view-only whatever the toggle says.
  const viewOnlyReason = editor.viewOnlyReason;
  const isReadOnly = readOnlyRequested || Boolean(viewOnlyReason);
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
        SUPPORTED_DOCUMENT_FILE_NAME.test(candidate.name)
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
      getActionState: () => ({
        selection: editor.selection,
        activeTextRange: editor.activeTextRange ?? null,
        selectedParagraphLocation: selectedTestLocation(editor),
        selectedRunStyle: testTextStyleSnapshot(editor.selectedRunStyle),
        semanticModelDigest: semanticTestModelDigest(
          editor.model,
          editor.trackedChanges
        ),
        canUndo: editor.canUndo,
        canRedo: editor.canRedo,
      }),
      getLocationState: (location: PlaygroundDocxTextLocation) => {
        return buildDocxLocationState(editor, location);
      },
      getRangeState: (range: DocxTextRange) => {
        return buildDocxRangeState(editor.model, range);
      },
      getTrackedChanges: () => editor.trackedChanges,
      getComments: () => editor.comments,
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
      getTrackedChange: (index: number) => {
        const change = editor.trackedChanges[index];
        if (!change) {
          throw new Error(`Tracked change ${index} does not exist`);
        }
        return change;
      },
      getComment: (commentId: number) => {
        const comment = editor.comments.find(
          (candidate) => candidate.commentId === commentId
        );
        if (!comment) {
          throw new Error(`Comment ${commentId} does not exist`);
        }
        return comment;
      },
      acceptTrackedChange: (index: number) => {
        const change = editor.trackedChanges[index];
        if (!change) {
          throw new Error(`Tracked change ${index} does not exist`);
        }
        const result = editor.acceptTrackedChange(change);
        if (!result.ok) {
          throw new Error(`Accept tracked change failed: ${result.reason}`);
        }
      },
      rejectTrackedChange: (index: number) => {
        const change = editor.trackedChanges[index];
        if (!change) {
          throw new Error(`Tracked change ${index} does not exist`);
        }
        const result = editor.rejectTrackedChange(change);
        if (!result.ok) {
          throw new Error(`Reject tracked change failed: ${result.reason}`);
        }
      },
      acceptTrackedChangeHandle: (
        change: DocxEditorController["trackedChanges"][number]
      ) => {
        const result = editor.acceptTrackedChange(change);
        if (!result.ok) {
          throw new Error(`Accept tracked change failed: ${result.reason}`);
        }
      },
      createComment: (
        text: string,
        options?: Parameters<DocxEditorController["createComment"]>[1]
      ) => {
        const result = editor.createComment(text, options);
        if (!result.ok) {
          throw new Error(`Create comment failed: ${result.reason}`);
        }
        return result.commentId;
      },
      setCommentResolved: (commentId: number, resolved: boolean) => {
        const comment = editor.comments.find(
          (candidate) => candidate.commentId === commentId
        );
        if (!comment) {
          throw new Error(`Comment ${commentId} does not exist`);
        }
        const result = editor.setCommentResolved(comment, resolved);
        if (!result.ok) {
          throw new Error(`Set comment resolution failed: ${result.reason}`);
        }
      },
      setCommentResolvedHandle: (
        comment: DocxEditorController["comments"][number],
        resolved: boolean
      ) => {
        const result = editor.setCommentResolved(comment, resolved);
        if (!result.ok) {
          throw new Error(`Set comment resolution failed: ${result.reason}`);
        }
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
  const paragraphStyleOptions = React.useMemo<ParagraphStyleOption[]>(
    () => paragraphStyles.length > 0
      ? paragraphStyles
      : [...FALLBACK_PARAGRAPH_STYLE_OPTIONS],
    [paragraphStyles]
  );
  const paragraphStyleItems = React.useMemo(
    () => paragraphStyleOptions.map((option) => ({ value: option.id, label: option.name })),
    [paragraphStyleOptions]
  );
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
  const pageGapBackgroundColor = "var(--canvas)";
  const renderTrackedChangeCard = React.useCallback(
    (props: DocxTrackedChangeCardRenderProps): React.ReactNode => (
      <div style={{ ...props.style, padding: "4px 8px", borderLeft: `2px solid ${props.accentColor}`,
        color: isDark ? "#f8fafc" : "#111111", fontFamily: '"Times New Roman", serif', fontSize: 11,
        lineHeight: 1.15, boxSizing: "border-box" }}>
        <div className="flex items-start justify-between gap-2">
          <strong>{props.change.author?.trim() || "Unknown author"}</strong>
          {props.formattedDate ? <span style={{ fontSize: 10 }}>{props.formattedDate}</span> : null}
        </div>
        <p style={{ margin: "2px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          <strong>{props.kindLabel}{props.content || props.snippet ? ":" : ""}</strong>{" "}{props.content ?? props.snippet}
        </p>
      </div>
    ), [isDark]
  );
  const renderCommentCard = React.useCallback(
    (props: DocxCommentCardRenderProps): React.ReactNode => {
      const noteBackground = isDark
        ? "rgba(15, 23, 42, 0.94)"
        : "rgba(255, 255, 255, 0.9)";
      const borderColor = isDark
        ? "rgba(148, 163, 184, 0.22)"
        : "rgba(15, 23, 42, 0.1)";
      const secondaryColor = isDark ? "#94a3b8" : "#64748b";
      const snippetStyle: React.CSSProperties = {
        color: isDark ? "#cbd5e1" : "#334155",
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
        overflow: "hidden",
      };

      return (
        <div
          className="pointer-events-none overflow-hidden rounded-sm px-1.5 py-1 text-[9px] leading-3"
          style={{
            ...props.style,
            border: `1px solid ${borderColor}`,
            borderLeft: `2px solid ${props.accentColor}`,
            backgroundColor: noteBackground,
            color: isDark ? "#f8fafc" : "#111827",
            boxShadow: isDark
              ? "0 1px 3px rgba(2, 6, 23, 0.45)"
              : "0 1px 2px rgba(15, 23, 42, 0.08)",
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="m-0 min-w-0 flex-1 truncate font-semibold">
              {props.comment.author?.trim() || "Unknown author"}
            </p>
            {props.formattedDate ? (
              <span className="shrink-0" style={{ color: secondaryColor }}>
                {props.formattedDate}
              </span>
            ) : null}
          </div>
          <p className="m-0 mt-0.5" style={snippetStyle}>
            {props.snippet}
          </p>
        </div>
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
      const currentPercent =
        typeof current === "number" ? current : editor.getResolvedZoom();
      const exactIndex = options.findIndex((value) => value === currentPercent);
      if (exactIndex >= 0) {
        const nextIndex = Math.max(
          0,
          Math.min(options.length - 1, exactIndex + direction)
        );
        return options[nextIndex] ?? currentPercent;
      }

      if (direction > 0) {
        return (
          options.find((value) => value > currentPercent) ??
          options[options.length - 1] ??
          currentPercent
        );
      }

      const reverse = [...options].reverse();
      return (
        reverse.find((value) => value < currentPercent) ??
        options[0] ??
        currentPercent
      );
    });
  }, [editor]);

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

  const [ribbonTab, setRibbonTab] = React.useState<RibbonTab>("Home");
  const [fontColor, setFontColor] = React.useState("#C00000");
  const [highlightColor, setHighlightColor] = React.useState("#FFFF00");
  const [resolvedZoom, setResolvedZoom] = React.useState(
    pageLayout.viewportDefaults.zoomPercent
  );
  const deferredNodes = React.useDeferredValue(editor.model.nodes);
  const wordCount = React.useMemo(
    () => countWordsInNodes(deferredNodes),
    [deferredNodes]
  );
  const isEditable = !isReadOnly && !editor.isImporting;
  const pageSizeLabel = describePageSize(
    pageLayout.pageWidthPx,
    pageLayout.pageHeightPx
  );
  const marginLabel = describeMargins(pageLayout.marginsPx);
  const orientationLabel =
    pageLayout.pageWidthPx > pageLayout.pageHeightPx ? "Landscape" : "Portrait";
  const columnsLabel = activeSectionColumns
    ? `${activeSectionColumns.count} columns`
    : "1 column";
  const stylePreviewTheme: DocumentTheme = isDark ? "dark" : "light";
  const titleButton = "h-7 text-[13px] font-normal sm:h-7";

  const homeRibbon = (
    <>
      <RibbonGroup>
        <RibbonButton
          label="Undo"
          shortcut="⌘Z"
          disabled={!editor.canUndo}
          onClick={editor.undo}
          {...keepSelection}
        >
          <Undo2 />
        </RibbonButton>
        <RibbonButton
          label="Redo"
          shortcut="⌘⇧Z"
          disabled={!editor.canRedo}
          onClick={editor.redo}
          {...keepSelection}
        >
          <Redo2 />
        </RibbonButton>
      </RibbonGroup>

      <RibbonGroup className="gap-1">
        <Select
          items={FONT_FAMILY_ITEMS}
          value={selectedRunStyle?.fontFamily ?? "Calibri"}
          disabled={!isEditable}
          onValueChange={(value: string | null) => {
            if (value) {
              editor.setFontFamily(value);
            }
          }}
        >
          <SelectTrigger
            aria-label="Font"
            className="w-36 min-w-0 text-[13px]"
            size="sm"
          >
            <SelectValue className="truncate" />
          </SelectTrigger>
          <SelectPopup>
            {FONT_FAMILIES.map((fontFamily) => (
              <SelectItem key={fontFamily} value={fontFamily}>
                <span className="block truncate" style={{ fontFamily }}>
                  {fontFamily}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          items={FONT_SIZE_ITEMS}
          value={String(Math.round(selectedRunStyle?.fontSizePt ?? 12))}
          disabled={!isEditable}
          onValueChange={(value: string | null) => {
            const nextSize = Number(value);
            if (value && Number.isFinite(nextSize)) {
              editor.setFontSize(nextSize);
            }
          }}
        >
          <SelectTrigger
            aria-label="Font size"
            className="w-16 min-w-0 text-[13px]"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {FONT_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </RibbonGroup>

      <RibbonGroup>
        <RibbonButton
          label="Bold"
          shortcut="⌘B"
          active={Boolean(selectedRunStyle?.bold)}
          disabled={!isEditable}
          onClick={editor.toggleBold}
          {...keepSelection}
        >
          <Bold />
        </RibbonButton>
        <RibbonButton
          label="Italic"
          shortcut="⌘I"
          active={Boolean(selectedRunStyle?.italic)}
          disabled={!isEditable}
          onClick={editor.toggleItalic}
          {...keepSelection}
        >
          <Italic />
        </RibbonButton>
        <RibbonButton
          label="Underline"
          shortcut="⌘U"
          active={Boolean(selectedRunStyle?.underline)}
          disabled={!isEditable}
          onClick={editor.toggleUnderline}
          {...keepSelection}
        >
          <Underline />
        </RibbonButton>
        <RibbonButton
          label="Strikethrough"
          active={Boolean(selectedRunStyle?.strike)}
          disabled={!isEditable}
          onClick={editor.toggleStrike}
          {...keepSelection}
        >
          <Strikethrough />
        </RibbonButton>
        <RibbonButton
          label="Subscript"
          shortcut="⌘="
          active={selectedRunStyle?.verticalAlign === "subscript"}
          disabled={!isEditable}
          onClick={editor.toggleSubscript}
          {...keepSelection}
        >
          <Subscript />
        </RibbonButton>
        <RibbonButton
          label="Superscript"
          shortcut="⌘⇧="
          active={selectedRunStyle?.verticalAlign === "superscript"}
          disabled={!isEditable}
          onClick={editor.toggleSuperscript}
          {...keepSelection}
        >
          <Superscript />
        </RibbonButton>
        <RibbonColorButton
          palette="highlight"
          label="Text highlight color"
          clearLabel="No color"
          color={highlightColor}
          disabled={!isEditable}
          icon={<Highlighter />}
          onApply={(color) => editor.setHighlight(color.toLowerCase())}
          onClear={() => editor.setHighlight(undefined)}
          onColorChange={setHighlightColor}
        />
        <RibbonColorButton
          palette="font"
          label="Font color"
          clearLabel="Automatic"
          color={fontColor}
          disabled={!isEditable}
          icon={<Baseline />}
          onApply={(color) =>
            editor.setTextColor(normalizeEditorColor(color, "#111827"))
          }
          onClear={() => editor.setTextColor(undefined)}
          onColorChange={setFontColor}
        />
      </RibbonGroup>

      <RibbonGroup>
        <RibbonButton
          label="Bullets"
          active={editor.hasUnorderedList}
          disabled={!isEditable}
          onClick={() => editor.toggleList("unordered")}
          {...keepSelection}
        >
          <List />
        </RibbonButton>
        <RibbonButton
          label="Numbering"
          active={editor.hasOrderedList}
          disabled={!isEditable}
          onClick={() => editor.toggleList("ordered")}
          {...keepSelection}
        >
          <ListOrdered />
        </RibbonButton>
        <RibbonButton
          label="Align left"
          shortcut="⌘L"
          active={
            selectedParagraph?.style?.align === "left" ||
            !selectedParagraph?.style?.align
          }
          disabled={!isEditable}
          onClick={() => editor.setAlignment("left")}
          {...keepSelection}
        >
          <TextAlignStart />
        </RibbonButton>
        <RibbonButton
          label="Center"
          shortcut="⌘E"
          active={selectedParagraph?.style?.align === "center"}
          disabled={!isEditable}
          onClick={() => editor.setAlignment("center")}
          {...keepSelection}
        >
          <TextAlignCenter />
        </RibbonButton>
        <RibbonButton
          label="Align right"
          shortcut="⌘R"
          active={selectedParagraph?.style?.align === "right"}
          disabled={!isEditable}
          onClick={() => editor.setAlignment("right")}
          {...keepSelection}
        >
          <TextAlignEnd />
        </RibbonButton>
        <RibbonButton
          label="Justify"
          shortcut="⌘J"
          active={selectedParagraph?.style?.align === "justify"}
          disabled={!isEditable}
          onClick={() => editor.setAlignment("justify")}
          {...keepSelection}
        >
          <TextAlignJustify />
        </RibbonButton>
        <Menu>
          <MenuTrigger
            render={
              <RibbonMenuButton
                label="Line and paragraph spacing"
                showLabel={false}
                icon={<ListChevronsUpDown />}
                disabled={!isEditable}
              />
            }
          />
          <MenuPopup align="start" className="w-40">
            <MenuGroup>
              <MenuGroupLabel>Line spacing</MenuGroupLabel>
              <MenuRadioGroup
                value={selectedLineSpacingValue}
                onValueChange={(value: string) => {
                  const nextSpacing = Number(value);
                  if (Number.isFinite(nextSpacing)) {
                    setLineSpacing(nextSpacing);
                  }
                }}
              >
                {LINE_SPACING_OPTIONS.map((spacing) => (
                  <MenuRadioItem key={spacing} value={String(spacing)}>
                    {Number.isInteger(spacing) ? spacing.toFixed(1) : String(spacing)}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </MenuPopup>
        </Menu>
        <Menu>
          <MenuTrigger
            render={
              <RibbonMenuButton
                label={borderTriggerLabel}
                showLabel={false}
                disabled={!isEditable}
                icon={
                  <HugeiconsIcon
                    icon={borderTriggerIcon}
                    strokeWidth={1.8}
                    className="size-4"
                  />
                }
              >
                {borderActiveCountBadge ? (
                  <Badge
                    variant="secondary"
                    className="h-4 min-w-4 px-1 text-[10px]"
                  >
                    {borderActiveCountBadge}
                  </Badge>
                ) : null}
              </RibbonMenuButton>
            }
          />
          <MenuPopup align="start" className="w-60">
            {BORDER_CONTROL_OPTIONS.map((option) => {
              const enabledForContext =
                !option.contexts || option.contexts.includes(borderContext);
              return (
                <React.Fragment key={option.id}>
                  {option.separatorBefore ? <MenuSeparator /> : null}
                  <MenuCheckboxItem
                    checked={activeBorderPresets[option.id]}
                    disabled={!enabledForContext}
                    closeOnClick={false}
                    onCheckedChange={() => {
                      if (enabledForContext) {
                        applyBorderPreset(option.id);
                      }
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <HugeiconsIcon
                        icon={borderControlOptionIcon(option.id)}
                        strokeWidth={1.8}
                        className="size-4 text-muted-foreground"
                      />
                      {option.label}
                    </span>
                  </MenuCheckboxItem>
                </React.Fragment>
              );
            })}
          </MenuPopup>
        </Menu>
      </RibbonGroup>

      <RibbonGroup>
        <Select
          items={paragraphStyleItems}
          value={selectedParagraphStyleValue}
          disabled={!isEditable}
          onOpenChange={setIsParagraphStyleMenuOpen}
          onValueChange={(value: string | null) => {
            if (value) {
              setParagraphStyle(value);
            }
          }}
        >
          <SelectTrigger
            aria-label="Styles"
            className="w-40 min-w-0 text-[13px]"
            size="sm"
          >
            <SelectValue className="truncate">
              {selectedParagraphStyleLabel}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup className="min-w-56">
            {isParagraphStyleMenuOpen
              ? paragraphStyleOptions.map((option) => {
                  const preview = paragraphStylePreviewStyle(
                    option,
                    stylePreviewTheme
                  );
                  return (
                    <SelectItem key={option.id} value={option.id}>
                      <span
                        className="block truncate py-0.5"
                        style={{
                          ...preview,
                          fontSize: preview.fontSize
                            ? `min(${preview.fontSize}, 18px)`
                            : undefined,
                          lineHeight: 1.25,
                        }}
                      >
                        {option.name}
                      </span>
                    </SelectItem>
                  );
                })
              : null}
          </SelectPopup>
        </Select>
      </RibbonGroup>
    </>
  );

  const insertRibbon = (
    <>
      <RibbonGroup>
        <RibbonButton
          label="Table"
          showLabel
          disabled={!isEditable}
          onClick={editor.insertTable}
          {...keepSelection}
        >
          <Table2 />
        </RibbonButton>
        <RibbonButton
          label="Pictures"
          showLabel
          disabled={!isEditable}
          onClick={() => imageInputRef.current?.click()}
          {...keepSelection}
        >
          <ImagePlus />
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup>
        <RibbonButton
          label="Link"
          shortcut="⌘K"
          showLabel
          disabled={!isEditable}
          onClick={openLinkEditor}
          {...keepSelection}
        >
          <Link2 />
        </RibbonButton>
      </RibbonGroup>
    </>
  );

  const layoutRibbon = (
    <>
      <RibbonGroup className="gap-1 pe-3">
        <RibbonInfo icon={<Ruler />} label="Margins" value={marginLabel} />
        <RibbonInfo
          icon={<RectangleVertical />}
          label="Orientation"
          value={orientationLabel}
        />
        <RibbonInfo icon={<Proportions />} label="Size" value={pageSizeLabel} />
        <RibbonInfo icon={<Columns2 />} label="Columns" value={columnsLabel} />
      </RibbonGroup>
      <span className="px-3 text-xs text-muted-foreground">
        Page setup is read from the open document.
      </span>
    </>
  );

  const reviewRibbon = (
    <>
      <RibbonGroup className="gap-1">
        <RibbonToggle
          label="Show tracked changes"
          checked={showTrackedChanges}
          onCheckedChange={setShowTrackedChanges}
        >
          {editor.trackedChanges.length > 0 ? (
            <CountBadge count={editor.trackedChanges.length} />
          ) : null}
        </RibbonToggle>
        <Select
          items={REVISION_DISPLAY_ITEMS}
          value={revisionDisplay}
          disabled={!showTrackedChanges}
          onValueChange={(value: string | null) => {
            if (value === "balloons" || value === "inline") {
              setRevisionDisplay(value);
            }
          }}
        >
          <SelectTrigger
            aria-label="Revision display"
            className="w-28 min-w-0 text-[13px]"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {REVISION_DISPLAY_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </RibbonGroup>
      <RibbonGroup>
        <RibbonToggle
          label="Show comments"
          checked={showComments}
          onCheckedChange={setShowComments}
        >
          {comments.length > 0 ? <CountBadge count={comments.length} /> : null}
        </RibbonToggle>
      </RibbonGroup>
    </>
  );

  const viewRibbon = (
    <>
      <RibbonGroup className="gap-1">
        <RibbonToggle
          label="Navigation pane"
          checked={navigationPaneOpen}
          onCheckedChange={setNavigationPaneOpen}
        />
        <RibbonToggle
          label="Dark page"
          checked={documentTheme === "dark"}
          onCheckedChange={(checked) =>
            setDocumentTheme(checked ? "dark" : "light")
          }
        />
      </RibbonGroup>
      <RibbonGroup>
        <RibbonButton
          label="Zoom out"
          disabled={
            typeof zoomPercent === "number" &&
            zoomPercent <= ZOOM_PERCENT_OPTIONS[0]
          }
          onClick={() => shiftZoom(-1)}
        >
          <ZoomOut />
        </RibbonButton>
        <RibbonButton label="100%" showLabel onClick={() => setZoomPercent(100)} />
        <RibbonButton
          label="Zoom in"
          disabled={
            typeof zoomPercent === "number" &&
            zoomPercent >= ZOOM_PERCENT_OPTIONS[ZOOM_PERCENT_OPTIONS.length - 1]
          }
          onClick={() => shiftZoom(1)}
        >
          <ZoomIn />
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup>
        <RibbonButton
          label="One page"
          showLabel
          active={zoomPercent === "fit-page"}
          onClick={() => setZoomPercent("fit-page")}
        >
          <RectangleVertical />
        </RibbonButton>
        <RibbonButton
          label="Page width"
          showLabel
          active={zoomPercent === "fit-width"}
          onClick={() => setZoomPercent("fit-width")}
        >
          <MoveHorizontal />
        </RibbonButton>
        <RibbonButton
          label="Automatic"
          showLabel
          active={zoomPercent === "automatic"}
          onClick={() => setZoomPercent("automatic")}
        >
          <Scaling />
        </RibbonButton>
      </RibbonGroup>
    </>
  );

  const developerRibbon = (
    <>
      <RibbonGroup className="gap-1">
        <RibbonToggle label="Blocks" checked={showBlocks} onCheckedChange={setShowBlocks} />
        <RibbonButton
          label="Form field properties"
          showLabel
          disabled={!selectedFormField || !isEditable}
          onClick={() => setFormWidgetDialogOpen(true)}
        >
          <Settings2 />
        </RibbonButton>
      </RibbonGroup>
      <RibbonGroup className="gap-4 px-3 text-xs">
        {__DOCX_BUILD__ ? (
          <a
            href="/build-info.json"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:underline"
            title={`Rust source ${__DOCX_BUILD__.rustSourceSha256}; WASM ${__DOCX_BUILD__.wasmSha256}`}
          >
            <span className="text-muted-foreground">Build</span>
            <span className="font-mono font-medium">
              {__DOCX_BUILD__.gitRevision.slice(0, 7)}
              {__DOCX_BUILD__.sourceDirty ? " (local)" : ""}
            </span>
          </a>
        ) : (
          <span className="text-muted-foreground">Build info unavailable in dev</span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Selection</span>
          <span className="font-medium capitalize">
            {editor.selection.kind.replace("-", " ")}
          </span>
        </span>
      </RibbonGroup>
    </>
  );

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-chrome text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_DOCUMENT_ACCEPT}
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

      {/* Title bar */}
      <header className="flex h-11 shrink-0 items-center gap-3 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground">
            <FileText className="size-4" />
          </div>
          <span className="truncate text-[13px] font-semibold">
            {editor.fileName || "Document1"}
          </span>
          {isReadOnly ? (
            <Badge
              className="rounded px-1.5 text-[10px]"
              title={viewOnlyReason}
              variant="outline"
            >
              {viewOnlyReason ? "View-only" : "Read-only"}
            </Badge>
          ) : null}
          <span className="hidden truncate text-xs text-muted-foreground md:inline">
            React DOCX Playground
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            className={titleButton}
            size="sm"
            variant="ghost"
            disabled={editor.isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            {editor.isImporting ? <Spinner className="size-4" /> : <FolderOpen />}
            {editor.isImporting ? "Opening…" : "Open"}
          </Button>
          <Button
            className={titleButton}
            size="sm"
            variant="ghost"
            disabled={editor.isImporting || Boolean(viewOnlyReason)}
            title={viewOnlyReason}
            onClick={editor.exportDocx}
          >
            <Download />
            Download
          </Button>
          <Button
            className={titleButton}
            size="sm"
            variant="ghost"
            render={<a href="/vanilla.html" />}
          >
            <Code />
            Vanilla JS
          </Button>
          <RibbonDivider />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                  className="size-7 sm:size-7"
                  disabled={!themeReady}
                  onClick={() => setTheme(isDark ? "light" : "dark")}
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              {isDark ? <Sun /> : <Moon />}
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {isDark ? "Light mode" : "Dark mode"}
            </TooltipPopup>
          </Tooltip>
        </div>
      </header>

      {/* Ribbon */}
      <Tabs
        className="shrink-0 gap-0 px-2 pb-2"
        value={ribbonTab}
        onValueChange={(value) => setRibbonTab(value as RibbonTab)}
      >
        <div className="flex items-center gap-2">
          <TabsList
            className="h-8 gap-0.5 p-0 *:data-[slot=tab-indicator]:bg-brand *:data-[slot=tabs-tab]:hover:bg-black/5 dark:*:data-[slot=tabs-tab]:hover:bg-white/5"
            variant="underline"
          >
            {RIBBON_TABS.map((name) => (
              <TabsTab
                key={name}
                value={name}
                className="h-7 grow-0 rounded-sm px-2.5 text-[13px] font-normal text-foreground/75 hover:text-foreground data-active:font-semibold data-active:text-brand"
              >
                {name}
              </TabsTab>
            ))}
          </TabsList>
          <div className="ms-auto flex items-center">
            <RibbonToggle
              label="Read only"
              checked={isReadOnly}
              onCheckedChange={setIsReadOnly}
            />
          </div>
        </div>
        <div className="mt-1 flex h-11 items-center overflow-x-auto rounded-lg border bg-background px-2 shadow-xs/5 [scrollbar-width:none]">
          <TabsPanel className="flex items-center" value="Home">
            {homeRibbon}
          </TabsPanel>
          <TabsPanel className="flex items-center" value="Insert">
            {insertRibbon}
          </TabsPanel>
          <TabsPanel className="flex items-center" value="Layout">
            {layoutRibbon}
          </TabsPanel>
          <TabsPanel className="flex items-center" value="Review">
            {reviewRibbon}
          </TabsPanel>
          <TabsPanel className="flex items-center" value="View">
            {viewRibbon}
          </TabsPanel>
          <TabsPanel className="flex items-center" value="Developer">
            {developerRibbon}
          </TabsPanel>
        </div>
      </Tabs>

      {/* Document canvas */}
      <main className="flex min-h-0 min-w-0 flex-1 border-t">
        {navigationPaneOpen ? (
          <aside
            aria-label="Navigation"
            className="flex w-60 shrink-0 flex-col border-e bg-background"
          >
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b ps-3 pe-1.5">
              <span className="text-[13px] font-semibold">Navigation</span>
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                {thumbnailPageCount} {thumbnailPageCount === 1 ? "page" : "pages"}
              </span>
              <Button
                aria-label="Close navigation pane"
                className="size-6 sm:size-6"
                onClick={() => setNavigationPaneOpen(false)}
                size="icon-xs"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
            <div
              ref={thumbnailScrollRef}
              className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
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
                  const isCurrent = thumbnail.pageNumber === editor.currentPage;

                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      style={{
                        left: 0,
                        position: "absolute",
                        top: 0,
                        transform: `translateY(${virtualItem.start}px)`,
                        width: "100%",
                      }}
                    >
                      <button
                        type="button"
                        aria-label={`Page ${thumbnail.pageNumber}`}
                        aria-current={isCurrent ? "page" : undefined}
                        title={
                          thumbnail.error
                            ? thumbnail.error.message
                            : `${Math.round(thumbnail.sourceWidthPx)} × ${Math.round(
                                thumbnail.sourceHeightPx
                              )} · ${thumbnail.isMounted ? thumbnail.status : "offscreen render"}`
                        }
                        onClick={() => scrollToPage(thumbnail.pageIndex)}
                        className="group flex w-full flex-col items-center gap-1.5 rounded-md p-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div
                          className={cn(
                            "overflow-hidden rounded-[2px] bg-white shadow-xs ring-1 ring-black/10",
                            isCurrent && "ring-2 ring-brand"
                          )}
                          style={{
                            width: `${thumbnail.widthPx}px`,
                            height: `${thumbnail.heightPx}px`,
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
                            }}
                          />
                        </div>
                        <span
                          className={cn(
                            "text-[11px] tabular-nums text-muted-foreground",
                            isCurrent && "font-semibold text-brand"
                          )}
                        >
                          {thumbnail.pageNumber}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        ) : null}

        <div
          ref={viewerScrollRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-canvas"
        >
          <div className="flex min-h-full min-w-full w-max justify-center px-6 py-5">
            <div ref={blockViewerRootRef}>
              <DocxEditorViewer
                editor={editor}
                zoom={zoomPercent}
                onZoomChange={(state) => setResolvedZoom(state.resolvedZoom)}
                pageGapBackgroundColor={pageGapBackgroundColor}
                pageVirtualization={{}}
                mode={isReadOnly ? "read-only" : "edit"}
                showTrackedChanges={showTrackedChanges}
                revisionDisplay={revisionDisplay}
                renderTrackedChangeCard={renderTrackedChangeCard}
                showComments={showComments}
                renderCommentCard={renderCommentCard}
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

        {showBlocks ? (
          <BlockInspector model={editor.model} rootRef={blockViewerRootRef} />
        ) : null}
      </main>

      {/* Status bar */}
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-chrome px-3 text-[11px] text-foreground/70">
        <span className="tabular-nums">
          Page {Math.max(1, editor.currentPage)} of {thumbnailPageCount}
        </span>
        <span className="hidden tabular-nums sm:inline">
          {wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {editor.isImporting ? <Spinner className="size-3" /> : null}
          <span className="truncate">{editor.status}</span>
        </span>
        <div className="flex-1" />
        {isReadOnly ? (
          <span className="hidden items-center gap-1 sm:flex" title={viewOnlyReason}>
            <Lock className="size-3" />
            {viewOnlyReason ? "View-only" : "Read-only"}
          </span>
        ) : null}
        <div className="flex items-center gap-1">
          <button
            aria-label="Zoom out"
            className={cn(statusIconButtonClass, "size-5")}
            onClick={() => shiftZoom(-1)}
            type="button"
          >
            <Minus className="size-3" />
          </button>
          <Slider
            aria-label="Zoom level"
            className="w-24 **:data-[slot=slider-control]:min-w-0 **:data-[slot=slider-indicator]:bg-foreground/40 **:data-[slot=slider-thumb]:size-3 sm:**:data-[slot=slider-thumb]:size-3"
            min={ZOOM_PERCENT_OPTIONS[0]}
            max={ZOOM_PERCENT_OPTIONS[ZOOM_PERCENT_OPTIONS.length - 1]}
            value={Math.round(resolvedZoom)}
            onValueChange={(value) =>
              setZoomPercent(Array.isArray(value) ? value[0] : value)
            }
          />
          <button
            aria-label="Zoom in"
            className={cn(statusIconButtonClass, "size-5")}
            onClick={() => shiftZoom(1)}
            type="button"
          >
            <Plus className="size-3" />
          </button>
          <Select
            items={ZOOM_ITEMS}
            value={String(zoomPercent)}
            onValueChange={(value: string | null) => {
              if (!value) {
                return;
              }
              const parsed = Number(value);
              setZoomPercent(
                Number.isFinite(parsed) ? parsed : (value as ViewerZoomLevel)
              );
            }}
          >
            <SelectTrigger
              aria-label="Zoom"
              className="min-h-5 w-11 min-w-0 shrink-0 justify-end rounded-sm border-transparent bg-transparent px-1 text-[11px] text-foreground/70 shadow-none before:hidden hover:bg-black/5 sm:min-h-5 sm:text-[11px] dark:bg-transparent dark:hover:bg-white/5 [&_[data-slot=select-icon]]:hidden"
              size="sm"
            >
              <SelectValue className="tabular-nums">
                {`${Math.round(resolvedZoom)}%`}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" side="top" alignItemWithTrigger={false}>
              {ZOOM_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </footer>

      {isReadOnly && isImportDragOver ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-brand/60 bg-background px-10 py-8 text-center shadow-lg">
            <Upload className="size-6 text-brand" />
            <div className="text-sm font-medium">Drop a Word or OpenDocument file to open it</div>
            <div className="text-xs text-muted-foreground">
              Read-only mode blocks editing, but opening files still works.
            </div>
          </div>
        </div>
      ) : null}

      <Dialog
        open={formWidgetDialogOpen && Boolean(selectedFormField)}
        onOpenChange={handleFormWidgetDialogOpenChange}
      >
        <DialogPopup className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Form field properties</DialogTitle>
            <DialogDescription>
              Configure the selected Word form widget.
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
            {selectedFormField ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-1 rounded-md border bg-muted p-2 text-xs sm:grid-cols-2">
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
                        items={FORM_TEXT_INPUT_TYPE_ITEMS}
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
                        <SelectPopup>
                          {FORM_TEXT_INPUT_TYPE_ITEMS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
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
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
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
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
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
                        <span className="text-xs text-destructive-foreground">
                          Enter a number greater than or equal to 0.
                        </span>
                      ) : null}
                    </div>

                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {selectedFormFieldFormatLabel}
                      </span>
                      <Select
                        items={selectedFormFieldFormatOptions}
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
                        <SelectPopup className="w-max min-w-(--anchor-width) overflow-x-visible">
                          {selectedFormFieldFormatOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
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
                        items={CHECKBOX_DEFAULT_ITEMS}
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
                        <SelectPopup>
                          {CHECKBOX_DEFAULT_ITEMS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>

                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        Checkbox size
                      </span>
                      <Select
                        items={CHECKBOX_SIZE_ITEMS}
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
                        <SelectPopup>
                          {CHECKBOX_SIZE_ITEMS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>

                    {(formWidgetDraft?.checkbox.sizeMode ?? "auto") === "exact" ? (
                      <div className="grid gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          Exact size (pt)
                        </span>
                        <Input
                          type="number"
                          min={1}
                          step={0.5}
                          value={formWidgetDraft?.checkbox.sizePt ?? "10"}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
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
                          <span className="text-xs text-destructive-foreground">
                            Enter a number greater than 0.
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </DialogPanel>

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
        </DialogPopup>
      </Dialog>

      {linkHoverCard && !linkEditorOpen ? (
        <div
          className="fixed z-50 rounded-lg border bg-popover px-2 py-1.5 text-xs shadow-md"
          style={{
            top: linkHoverCard.top,
            left: linkHoverCard.left,
            transform: "translate(-50%, 0)",
          }}
        >
          <div className="flex items-center gap-2">
            <a
              href={linkHoverCard.href}
              target={linkHoverCard.href.startsWith("#") ? undefined : "_blank"}
              rel={
                linkHoverCard.href.startsWith("#")
                  ? undefined
                  : "noreferrer noopener"
              }
              className="max-w-[280px] truncate text-brand underline"
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
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Edit link
          </p>
          <Input
            value={linkEditorValue}
            size="sm"
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
            <Button variant="outline" size="sm" onClick={removeLinkFromEditor}>
              Remove
            </Button>
            <Button size="sm" onClick={applyLinkFromEditor}>
              Apply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ZoomTestHarness(): React.JSX.Element {
  const editor = useDocxEditor();
  const [wide, setWide] = React.useState(true);
  const [level, setLevel] = React.useState<ViewerZoomLevel>("fit-width");
  const [state, setState] = React.useState<ViewerZoomState>({
    level,
    resolvedZoom: 100,
  });
  const controlled =
    new URLSearchParams(window.location.search).get("controlled") === "1";
  const changeZoom = (next: ViewerZoomLevel): void => {
    editor.setZoom(next);
  };

  return (
    <div style={{ padding: 16 }}>
      <button type="button" onClick={() => setWide((value) => !value)}>
        Resize viewport
      </button>
      <button type="button" onClick={() => changeZoom("fit-width")}>
        Fit width
      </button>
      <button type="button" onClick={() => changeZoom("fit-page")}>
        Fit page
      </button>
      <button type="button" onClick={() => changeZoom("automatic")}>
        Automatic
      </button>
      <button type="button" onClick={() => changeZoom(125)}>
        125%
      </button>
      <button
        type="button"
        onClick={() => changeZoom(editor.getResolvedZoom() + 10)}
      >
        Zoom in
      </button>
      <button
        type="button"
        onClick={() => changeZoom(editor.getResolvedZoom() - 10)}
      >
        Zoom out
      </button>
      <output data-testid="zoom-state">
        {state.level}:{state.resolvedZoom}
      </output>
      <div
        data-testid="zoom-viewport"
        style={{
          boxSizing: "border-box",
          width: wide ? 1200 : 600,
          height: wide ? 900 : 500,
          padding: 20,
          overflow: "auto",
        }}
      >
        <DocxEditorViewer
          editor={editor}
          mode="read-only"
          pageVirtualization={{ enabled: false }}
          {...(controlled ? { zoom: level } : { defaultZoom: "fit-width" })}
          onZoomChange={(next) => {
            setState(next);
            if (controlled) {
              setLevel(next.level);
            }
          }}
        />
      </div>
    </div>
  );
}

export function App(): React.JSX.Element {
  return new URLSearchParams(window.location.search).get("zoom-harness") === "1"
    ? <ZoomTestHarness />
    : <PlaygroundApp />;
}

export default App;
