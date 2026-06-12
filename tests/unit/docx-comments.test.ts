import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  DocxEditorViewer,
  defaultStarterModel,
  useDocxComments,
  useDocxEditor,
  type DocxComment,
} from "../../packages/react-viewer/src/editor";

const COMMENTED_PARAGRAPH_XML =
  `<w:p>` +
  `<w:r><w:t xml:space="preserve">Before </w:t></w:r>` +
  `<w:commentRangeStart w:id="7"/>` +
  `<w:r><w:t>annotated text</w:t></w:r>` +
  `<w:commentRangeEnd w:id="7"/>` +
  `<w:r><w:commentReference w:id="7"/></w:r>` +
  `<w:r><w:t xml:space="preserve"> after.</w:t></w:r>` +
  `</w:p>`;

function commentedModel(): DocModel {
  return {
    ...defaultStarterModel,
    nodes: [
      {
        type: "paragraph",
        sourceXml: COMMENTED_PARAGRAPH_XML,
        children: [
          { type: "text", text: "Before " },
          { type: "text", text: "annotated text" },
          { type: "text", text: " after." },
        ],
      },
    ],
    metadata: {
      ...defaultStarterModel.metadata,
      comments: [
        {
          id: 7,
          author: "Ada Lovelace",
          initials: "AL",
          date: "2026-06-01T10:00:00Z",
          text: "Please tighten this sentence.",
          resolved: true,
        },
        {
          id: 99,
          author: "Unanchored",
          text: "No anchor for this one.",
        },
      ],
    },
  };
}

function CommentsProbe({
  model,
  onComments,
}: {
  model: DocModel;
  onComments: (comments: DocxComment[]) => void;
}): React.JSX.Element {
  const editor = useDocxEditor({
    starterModel: model,
    initialShowComments: true,
  });
  const { comments, showComments } = useDocxComments(editor);
  onComments(comments);
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only",
    showComments,
  });
}

describe("docx comments", () => {
  it("collects anchored comments and renders gutter cards with highlights", () => {
    let collected: DocxComment[] = [];
    const markup = renderToStaticMarkup(
      React.createElement(CommentsProbe, {
        model: commentedModel(),
        onComments: (comments) => {
          collected = comments;
        },
      })
    );

    expect(collected).toHaveLength(1);
    const comment = collected[0];
    expect(comment.commentId).toBe(7);
    expect(comment.author).toBe("Ada Lovelace");
    expect(comment.text).toBe("Please tighten this sentence.");
    expect(comment.resolved).toBe(true);
    expect(comment.anchorText).toBe("annotated text");
    expect(comment.location).toEqual({ kind: "paragraph", nodeIndex: 0 });

    // Gutter card with the comment body and author.
    expect(markup).toContain("Please tighten this sentence.");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain('data-docx-gutter-annotation="comment"');
    expect(markup).toContain("Comment · Resolved");
    // The commented run gets the inline highlight.
    expect(markup).toContain("rgba(251, 191, 36");
  });

  it("renders no comment artifacts when comments are hidden", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        function HiddenComments(): React.JSX.Element {
          const editor = useDocxEditor({ starterModel: commentedModel() });
          return React.createElement(DocxEditorViewer, {
            editor,
            mode: "read-only",
          });
        }
      )
    );

    expect(markup).not.toContain("Please tighten this sentence.");
    expect(markup).not.toContain('data-docx-gutter-annotation="comment"');
    expect(markup).not.toContain("rgba(251, 191, 36");
  });
});
