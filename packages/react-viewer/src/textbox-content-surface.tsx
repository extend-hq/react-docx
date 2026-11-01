import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

export type TextBoxPendingDraft = {
  text: string;
  ownsSelection: boolean;
  settle: (accepted: boolean) => void;
};

export type TextBoxDraftReader = () => TextBoxPendingDraft | undefined;

export type RegisterTextBoxDraft = (reader: TextBoxDraftReader) => () => void;

type TextBoxContentSurfaceProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "contentEditable" | "dangerouslySetInnerHTML"
> & {
  contentEditable: boolean;
  structured?: boolean;
  value: string;
  onTextCommit: (text: string) => boolean | void;
  registerPendingDraft?: RegisterTextBoxDraft;
  resetRevision?: number;
};

function EditableSurface({
  children,
  contentEditable,
  value,
  onTextCommit,
  onFocus,
  onBlur,
  onInput,
  onCompositionStart,
  onCompositionEnd,
  registerPendingDraft,
  resetRevision,
  ...attributes
}: Omit<TextBoxContentSurfaceProps, "structured">): React.ReactElement {
  const markup = renderToStaticMarkup(<>{children}</>);
  const initialMarkup = React.useRef({ __html: markup });
  const elementRef = React.useRef<HTMLDivElement>(null);
  const focused = React.useRef(false);
  const editing = React.useRef(false);
  const composing = React.useRef(false);
  const revision = React.useRef(0);
  const pendingCommit = React.useRef<string | undefined>(undefined);
  const model = React.useRef({ value, markup, contentEditable, resetRevision });

  const settleDraft = React.useCallback((text: string, accepted: boolean, draftRevision: number): void => {
    if (draftRevision !== revision.current) return;
    const element = elementRef.current;
    if (!accepted) {
      pendingCommit.current = undefined;
      editing.current = false;
      if (element) element.innerHTML = model.current.markup;
      return;
    }
    pendingCommit.current = text === model.current.value ? undefined : text;
    editing.current = Boolean(element && element.innerText !== text);
  }, []);

  const readPendingDraft = React.useCallback<TextBoxDraftReader>(() => {
    const element = elementRef.current;
    if (!element || (!editing.current && !composing.current && pendingCommit.current === undefined)) {
      return undefined;
    }
    const text = element.innerText;
    if (text === model.current.value && pendingCommit.current === undefined) return undefined;
    const draftRevision = revision.current;
    const selection = element.ownerDocument.getSelection();
    const ownsSelection = Boolean(
      element.isConnected && element.ownerDocument.activeElement === element &&
      selection && selection.rangeCount > 0 &&
      element.contains(selection.anchorNode) && element.contains(selection.focusNode)
    );
    return { text, ownsSelection, settle: (accepted) => settleDraft(text, accepted, draftRevision) };
  }, [settleDraft]);

  React.useLayoutEffect(() => registerPendingDraft?.(readPendingDraft), [registerPendingDraft, readPendingDraft]);

  const commit = (element: HTMLDivElement): void => {
    const text = element.innerText;
    const draftRevision = revision.current;
    settleDraft(text, true, draftRevision);
    if (text === model.current.value) return;
    try {
      if (onTextCommit(text) === false) settleDraft(text, false, draftRevision);
    } catch (error) {
      settleDraft(text, false, draftRevision);
      throw error;
    }
  };

  React.useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const previous = model.current;
    const valueChanged = previous.value !== value;
    const resetChanged = previous.resetRevision !== resetRevision;
    const acknowledgesDraft = !resetChanged && valueChanged && pendingCommit.current === value;
    model.current = { value, markup, contentEditable, resetRevision };
    if (valueChanged || resetChanged) {
      revision.current += 1;
      pendingCommit.current = undefined;
      editing.current = acknowledgesDraft && element.innerText !== value;
      if (resetChanged) composing.current = false;
    }

    if (
      previous.contentEditable &&
      !contentEditable &&
      editing.current &&
      !valueChanged
    ) {
      commit(element);
    }
    if (focused.current && !resetChanged && (!valueChanged || acknowledgesDraft) && contentEditable) return;
    if (pendingCommit.current !== undefined && pendingCommit.current !== value) {
      return;
    }
    pendingCommit.current = undefined;
    if (element.innerHTML !== markup) element.innerHTML = markup;
  });

  return (
    <div
      {...attributes}
      ref={elementRef}
      contentEditable={contentEditable}
      dangerouslySetInnerHTML={initialMarkup.current}
      onFocus={(event) => {
        focused.current = true;
        onFocus?.(event);
      }}
      onInput={(event) => {
        if (contentEditable) {
          revision.current += 1;
          editing.current = true;
        }
        onInput?.(event);
      }}
      onCompositionStart={(event) => {
        revision.current += 1;
        composing.current = true;
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        revision.current += 1;
        composing.current = false;
        if (contentEditable && event.currentTarget.innerText !== model.current.value) editing.current = true;
        onCompositionEnd?.(event);
      }}
      onBlur={(event) => {
        focused.current = false;
        composing.current = false;
        if (editing.current) commit(event.currentTarget);
        onBlur?.(event);
        if (
          pendingCommit.current === undefined &&
          event.currentTarget.innerHTML !== model.current.markup
        ) {
          event.currentTarget.innerHTML = model.current.markup;
        }
      }}
    />
  );
}

export function TextBoxContentSurface({
  structured,
  ...props
}: TextBoxContentSurfaceProps): React.ReactElement {
  if (structured) {
    const { value: _value, onTextCommit: _onTextCommit, registerPendingDraft: _registerPendingDraft, resetRevision: _resetRevision, ...attributes } = props;
    return <div {...attributes} contentEditable={false} />;
  }
  return <EditableSurface {...props} />;
}
