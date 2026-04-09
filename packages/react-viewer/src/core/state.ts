import type {
  DocModel,
  ParagraphNode,
  TextRunNode
} from "@extend-ai/react-docx-doc-model";
import type {
  DocxEditorSelection,
  DocxTextRange
} from "../editor";

export interface EditorHistoryEntry {
  model: DocModel;
  selection: DocxEditorSelection;
  activeTextRange?: DocxTextRange;
  pendingTypingStyle?: TextRunNode["style"];
}

export interface EditorHistoryState {
  past: EditorHistoryEntry[];
  future: EditorHistoryEntry[];
  maxEntries: number;
}

export interface EditorCompositionState {
  isComposing: boolean;
  buffer: string;
}

export interface EditorLayoutCacheState {
  version: number;
  lastMeasuredAt: number;
}

export interface EditorStateV2 {
  model: DocModel;
  selection: DocxEditorSelection;
  activeTextRange?: DocxTextRange;
  pendingTypingStyle?: TextRunNode["style"];
  history: EditorHistoryState;
  composition: EditorCompositionState;
  layoutCache: EditorLayoutCacheState;
}

export interface EditorTransactionV2 {
  type: string;
  model?: DocModel;
  selection?: DocxEditorSelection;
  activeTextRange?: DocxTextRange;
  pendingTypingStyle?: TextRunNode["style"];
  mergeWithPrevious?: boolean;
  pushHistory?: boolean;
  clearFuture?: boolean;
  updateLayoutVersion?: boolean;
}

export function createEditorStateV2(options: {
  model: DocModel;
  selection: DocxEditorSelection;
  activeTextRange?: DocxTextRange;
  pendingTypingStyle?: TextRunNode["style"];
  historyMaxEntries?: number;
}): EditorStateV2 {
  const maxEntries = Math.max(10, options.historyMaxEntries ?? 200);
  return {
    model: options.model,
    selection: options.selection,
    activeTextRange: options.activeTextRange,
    pendingTypingStyle: options.pendingTypingStyle,
    history: {
      past: [],
      future: [],
      maxEntries
    },
    composition: {
      isComposing: false,
      buffer: ""
    },
    layoutCache: {
      version: 1,
      lastMeasuredAt: Date.now()
    }
  };
}

function snapshotState(state: EditorStateV2): EditorHistoryEntry {
  return {
    model: state.model,
    selection: state.selection,
    activeTextRange: state.activeTextRange,
    pendingTypingStyle: state.pendingTypingStyle
  };
}

function trimHistory(entries: EditorHistoryEntry[], maxEntries: number): EditorHistoryEntry[] {
  if (entries.length <= maxEntries) {
    return entries;
  }
  return entries.slice(entries.length - maxEntries);
}

export function applyEditorTransactionV2(
  state: EditorStateV2,
  transaction: EditorTransactionV2
): EditorStateV2 {
  const nextModel = transaction.model ?? state.model;
  const nextSelection = transaction.selection ?? state.selection;
  const nextActiveTextRange = transaction.activeTextRange ?? state.activeTextRange;
  const nextPendingTypingStyle =
    transaction.pendingTypingStyle ?? state.pendingTypingStyle;

  const modelChanged = nextModel !== state.model;
  const selectionChanged = nextSelection !== state.selection;
  const rangeChanged = nextActiveTextRange !== state.activeTextRange;
  const styleChanged = nextPendingTypingStyle !== state.pendingTypingStyle;

  const shouldPushHistory =
    transaction.pushHistory !== false &&
    (modelChanged || selectionChanged || rangeChanged || styleChanged);

  let past = state.history.past;
  let future = state.history.future;

  if (shouldPushHistory) {
    if (transaction.mergeWithPrevious && past.length > 0) {
      past = [...past.slice(0, -1), snapshotState(state)];
    } else {
      past = [...past, snapshotState(state)];
    }
    past = trimHistory(past, state.history.maxEntries);
  }

  if (transaction.clearFuture !== false && shouldPushHistory) {
    future = [];
  }

  const nextLayoutVersion =
    transaction.updateLayoutVersion === false
      ? state.layoutCache.version
      : modelChanged
        ? state.layoutCache.version + 1
        : state.layoutCache.version;

  return {
    ...state,
    model: nextModel,
    selection: nextSelection,
    activeTextRange: nextActiveTextRange,
    pendingTypingStyle: nextPendingTypingStyle,
    history: {
      ...state.history,
      past,
      future
    },
    layoutCache: {
      version: nextLayoutVersion,
      lastMeasuredAt: Date.now()
    }
  };
}

export function undoEditorStateV2(state: EditorStateV2): EditorStateV2 {
  const previous = state.history.past[state.history.past.length - 1];
  if (!previous) {
    return state;
  }

  const updatedPast = state.history.past.slice(0, -1);
  const updatedFuture = [snapshotState(state), ...state.history.future];

  return {
    ...state,
    model: previous.model,
    selection: previous.selection,
    activeTextRange: previous.activeTextRange,
    pendingTypingStyle: previous.pendingTypingStyle,
    history: {
      ...state.history,
      past: updatedPast,
      future: updatedFuture
    },
    layoutCache: {
      version: state.layoutCache.version + 1,
      lastMeasuredAt: Date.now()
    }
  };
}

export function redoEditorStateV2(state: EditorStateV2): EditorStateV2 {
  const [next, ...remainingFuture] = state.history.future;
  if (!next) {
    return state;
  }

  const updatedPast = trimHistory(
    [...state.history.past, snapshotState(state)],
    state.history.maxEntries
  );

  return {
    ...state,
    model: next.model,
    selection: next.selection,
    activeTextRange: next.activeTextRange,
    pendingTypingStyle: next.pendingTypingStyle,
    history: {
      ...state.history,
      past: updatedPast,
      future: remainingFuture
    },
    layoutCache: {
      version: state.layoutCache.version + 1,
      lastMeasuredAt: Date.now()
    }
  };
}

export function paragraphAtSelection(
  model: DocModel,
  selection: DocxEditorSelection
): ParagraphNode | undefined {
  if (selection.kind !== "paragraph") {
    return undefined;
  }

  const node = model.nodes[selection.nodeIndex];
  return node && node.type === "paragraph" ? node : undefined;
}
