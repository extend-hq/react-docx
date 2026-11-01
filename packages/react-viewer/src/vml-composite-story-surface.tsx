import { PaintBoundsImage } from "./paint-bounds-image";
import type { ImageRunNode } from "@extend-ai/react-docx-doc-model";
import * as React from "react";
import { TextBoxContentSurface, type TextBoxDraftReader } from "./textbox-content-surface";
import type { VmlCompositeStories, VmlCompositeStory } from "./vml-composite-stories";

interface VmlCompositeStorySurfaceProps {
  mapping: VmlCompositeStories;
  src: string;
  paintBounds?: ImageRunNode["paintBounds"];
  alt: string;
  widthPx: number;
  heightPx: number;
  displayWidthPx: number;
  displayHeightPx: number;
  readOnly: boolean;
  visualStyle: React.CSSProperties;
  renderStory: (story: VmlCompositeStory) => React.ReactNode;
  onSelect: () => void;
  onStoryCommit: (index: number, text: string) => boolean | void;
  resetRevision?: number;
  registerStoryDraft?: (index: number, reader: TextBoxDraftReader) => () => void;
}

export function VmlCompositeStorySurface({
  mapping,
  src,
  paintBounds,
  alt,
  widthPx,
  heightPx,
  displayWidthPx,
  displayHeightPx,
  readOnly,
  visualStyle,
  renderStory,
  onSelect,
  onStoryCommit,
  registerStoryDraft,
  resetRevision,
}: VmlCompositeStorySurfaceProps): React.ReactElement {
  const frameRef = React.useRef<HTMLSpanElement>(null);
  const canvasRef = React.useRef<HTMLSpanElement>(null);
  const [wasEditing, setWasEditing] = React.useState(!readOnly);
  const showEditors = !readOnly || wasEditing;

  React.useLayoutEffect(() => {
    setWasEditing(!readOnly);
  }, [readOnly]);

  React.useLayoutEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const applySize = (width: number, height: number): void => {
      canvas.style.transform = `scale(${width / widthPx}, ${height / heightPx})`;
    };
    const style = window.getComputedStyle(frame);
    applySize(Number.parseFloat(style.width), Number.parseFloat(style.height));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) applySize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [widthPx, heightPx, displayWidthPx, displayHeightPx]);

  return (
    <span
      ref={frameRef}
      data-docx-vml-composite-surface="true"
      style={{
        display: "block",
        position: "relative",
        width: displayWidthPx,
        height: "auto",
        aspectRatio: `${displayWidthPx} / ${displayHeightPx}`,
        maxWidth: "100%",
        overflow: "visible",
        ...(mapping.paintBounds ? visualStyle : undefined),
      }}
    >
      {mapping.paintBounds && <PaintBoundsImage
        image={{ widthPx, heightPx, paintBounds }}
        src={showEditors ? mapping.artworkSrc : src}
        alt={alt}
        draggable={false}
        style={{
          display: "block",
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          userSelect: "none",
        }}
      />}
      <span
        ref={canvasRef}
        style={{
          display: "block",
          position: "absolute",
          left: 0,
          top: 0,
          width: widthPx,
          height: heightPx,
          transform: `scale(${displayWidthPx / widthPx}, ${displayHeightPx / heightPx})`,
          transformOrigin: "top left",
          ...(!mapping.paintBounds ? visualStyle : undefined),
        }}
      >
        {!mapping.paintBounds && <img
          src={showEditors ? mapping.artworkSrc : src}
          alt={alt}
          draggable={false}
          style={{
            display: "block",
            width: widthPx,
            height: heightPx,
            maxWidth: "none",
            pointerEvents: "none",
            userSelect: "none",
          }}
        />}
        {showEditors && mapping.stories.map((story) => (
          <TextBoxContentSurface
            key={story.index}
            value={story.text}
            resetRevision={resetRevision}
            contentEditable={!readOnly && story.editable}
            data-docx-textbox-editor="true"
            data-docx-vml-story-index={story.index}
            suppressContentEditableWarning
            spellCheck={false}
            onTextCommit={(text) => onStoryCommit(story.index, text)}
            registerPendingDraft={registerStoryDraft ? (reader) => registerStoryDraft(story.index, reader) : undefined}
            onInput={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            onPaste={(event) => event.stopPropagation()}
            onCompositionStart={(event) => event.stopPropagation()}
            onCompositionEnd={(event) => event.stopPropagation()}
            onFocus={(event) => {
              event.stopPropagation();
              if (!readOnly) onSelect();
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (!readOnly) onSelect();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (!readOnly) onSelect();
            }}
            style={{
              position: "absolute",
              left: story.framePx.x,
              top: story.framePx.y,
              width: story.framePx.width,
              height: story.framePx.height,
              boxSizing: "border-box",
              overflow: "visible",
              background: "transparent",
              border: "none",
              padding: 0,
              whiteSpace: "pre-wrap",
              textIndent: 0,
              cursor: readOnly || !story.editable ? "default" : "text",
              outline: "none",
            }}
          >
            {renderStory(story)}
          </TextBoxContentSurface>
        ))}
      </span>
    </span>
  );
}
