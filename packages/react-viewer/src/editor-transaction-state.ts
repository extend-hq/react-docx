export const EDITOR_HISTORY_LIMIT = 100;

export interface EditorHistorySnapshot<Model, Selection, TextRange> {
  model: Model;
  selection: Selection;
  activeTextRange?: TextRange;
}

export interface EditorHistory<Model, Selection, TextRange> {
  past: EditorHistorySnapshot<Model, Selection, TextRange>[];
  future: EditorHistorySnapshot<Model, Selection, TextRange>[];
}

export interface TransactionalEditorState<
  Model,
  Selection,
  TextRange,
  PendingStyle
> {
  model: Model;
  selection: Selection;
  activeTextRange?: TextRange;
  pendingRunStyle?: PendingStyle;
  history: EditorHistory<Model, Selection, TextRange>;
}

export interface TransactionalEditorStatePatch<
  Model,
  Selection,
  TextRange,
  PendingStyle
> {
  model?: Model;
  selection?: Selection;
  activeTextRange?: TextRange;
  pendingRunStyle?: PendingStyle;
}

export type TransactionalEditorStateAction<
  Model,
  Selection,
  TextRange,
  PendingStyle
> =
  | {
      type: "commit";
      patch: TransactionalEditorStatePatch<
        Model,
        Selection,
        TextRange,
        PendingStyle
      >;
      pushHistory?: boolean;
    }
  | { type: "undo" }
  | { type: "redo" }
  | {
      type: "replace-history";
      history: EditorHistory<Model, Selection, TextRange>;
    };

export interface TransactionalEditorStateAdapter<
  Model,
  Selection,
  TextRange,
  PendingStyle
> {
  cloneSelection: (selection: Selection) => Selection;
  cloneTextRange: (range?: TextRange) => TextRange | undefined;
  clonePendingStyle: (style?: PendingStyle) => PendingStyle | undefined;
  sameSelection: (a: Selection, b: Selection) => boolean;
  sameTextRange: (a?: TextRange, b?: TextRange) => boolean;
  samePendingStyle: (a?: PendingStyle, b?: PendingStyle) => boolean;
  normalizeCursor: (
    model: Model,
    selection: Selection,
    activeTextRange?: TextRange
  ) => {
    selection: Selection;
    activeTextRange?: TextRange;
  };
}

function owns(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Creates the pure reducer that owns the editor model, logical cursor, pending
 * typing style, and undo history. DOM selection restoration and UI status are
 * intentionally not part of this state machine.
 */
export function createTransactionalEditorStateReducer<
  Model,
  Selection,
  TextRange,
  PendingStyle
>(
  adapter: TransactionalEditorStateAdapter<
    Model,
    Selection,
    TextRange,
    PendingStyle
  >
): (
  state: TransactionalEditorState<Model, Selection, TextRange, PendingStyle>,
  action: TransactionalEditorStateAction<
    Model,
    Selection,
    TextRange,
    PendingStyle
  >
) => TransactionalEditorState<Model, Selection, TextRange, PendingStyle> {
  const snapshot = (
    state: TransactionalEditorState<Model, Selection, TextRange, PendingStyle>
  ): EditorHistorySnapshot<Model, Selection, TextRange> => ({
    model: state.model,
    selection: adapter.cloneSelection(state.selection),
    activeTextRange: adapter.cloneTextRange(state.activeTextRange),
  });

  const restore = (
    state: TransactionalEditorState<Model, Selection, TextRange, PendingStyle>,
    restoredSnapshot: EditorHistorySnapshot<Model, Selection, TextRange>,
    history: EditorHistory<Model, Selection, TextRange>
  ): TransactionalEditorState<Model, Selection, TextRange, PendingStyle> => {
    const cursor = adapter.normalizeCursor(
      restoredSnapshot.model,
      adapter.cloneSelection(restoredSnapshot.selection),
      adapter.cloneTextRange(restoredSnapshot.activeTextRange)
    );

    return {
      model: restoredSnapshot.model,
      selection: adapter.cloneSelection(cursor.selection),
      activeTextRange: adapter.cloneTextRange(cursor.activeTextRange),
      pendingRunStyle: undefined,
      history,
    };
  };

  return (state, action) => {
    if (action.type === "replace-history") {
      if (action.history === state.history) {
        return state;
      }
      return {
        ...state,
        history: action.history,
      };
    }

    if (action.type === "undo") {
      const restoredSnapshot = state.history.past.at(-1);
      if (!restoredSnapshot) {
        return state;
      }

      return restore(state, restoredSnapshot, {
        past: state.history.past.slice(0, -1),
        future: [snapshot(state), ...state.history.future].slice(
          0,
          EDITOR_HISTORY_LIMIT
        ),
      });
    }

    if (action.type === "redo") {
      const restoredSnapshot = state.history.future[0];
      if (!restoredSnapshot) {
        return state;
      }

      return restore(state, restoredSnapshot, {
        past: [...state.history.past, snapshot(state)].slice(
          -EDITOR_HISTORY_LIMIT
        ),
        future: state.history.future.slice(1),
      });
    }

    const hasModelPatch = owns(action.patch, "model");
    const hasSelectionPatch = owns(action.patch, "selection");
    const hasTextRangePatch = owns(action.patch, "activeTextRange");
    const hasPendingStylePatch = owns(action.patch, "pendingRunStyle");
    const nextModel = hasModelPatch
      ? (action.patch.model as Model)
      : state.model;
    const requestedSelection = hasSelectionPatch
      ? (action.patch.selection as Selection)
      : state.selection;
    const requestedTextRange = hasTextRangePatch
      ? action.patch.activeTextRange
      : state.activeTextRange;
    const cursor = adapter.normalizeCursor(
      nextModel,
      requestedSelection,
      requestedTextRange
    );
    const nextSelection = adapter.cloneSelection(cursor.selection);
    const nextTextRange = adapter.cloneTextRange(cursor.activeTextRange);
    const nextPendingStyle = hasPendingStylePatch
      ? adapter.clonePendingStyle(action.patch.pendingRunStyle)
      : state.pendingRunStyle;
    const modelChanged = nextModel !== state.model;
    const selectionChanged = !adapter.sameSelection(
      state.selection,
      nextSelection
    );
    const textRangeChanged = !adapter.sameTextRange(
      state.activeTextRange,
      nextTextRange
    );
    const pendingStyleChanged = !adapter.samePendingStyle(
      state.pendingRunStyle,
      nextPendingStyle
    );

    if (
      !modelChanged &&
      !selectionChanged &&
      !textRangeChanged &&
      !pendingStyleChanged
    ) {
      return state;
    }

    const history = modelChanged
      ? action.pushHistory !== false
        ? {
            past: [
              ...state.history.past.slice(-(EDITOR_HISTORY_LIMIT - 1)),
              snapshot(state),
            ],
            future: [],
          }
        : state.history.future.length > 0
        ? {
            past: state.history.past,
            future: [],
          }
        : state.history
      : state.history;

    return {
      model: nextModel,
      selection: selectionChanged ? nextSelection : state.selection,
      activeTextRange: textRangeChanged ? nextTextRange : state.activeTextRange,
      pendingRunStyle: pendingStyleChanged
        ? nextPendingStyle
        : state.pendingRunStyle,
      history,
    };
  };
}
