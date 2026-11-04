import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  DocxEditorViewer,
  defaultStarterModel,
  resolveDocxCommentLinks,
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
    expect(markup).toContain(">Reopen</button>");
    // The commented run gets the inline highlight.
    expect(markup).toContain('data-docx-comment-ids="7"');
    expect(markup).toContain("rgba(143, 106, 200");
  });

  it("renders no comment artifacts when comments are hidden", () => {
    let hiddenComments: DocxComment[] = [];
    const markup = renderToStaticMarkup(
      React.createElement(function HiddenComments(): React.JSX.Element {
        const editor = useDocxEditor({ starterModel: commentedModel() });
        hiddenComments = useDocxComments(editor).comments;
        return React.createElement(DocxEditorViewer, {
          editor,
          mode: "read-only",
        });
      })
    );

    expect(markup).not.toContain("Please tighten this sentence.");
    expect(markup).not.toContain('data-docx-gutter-annotation="comment"');
    expect(markup).not.toContain("data-docx-comment-ids");
    expect(markup).not.toContain("rgba(143, 106, 200");
    expect(hiddenComments).toHaveLength(1);
  });
});

it("links a range across paragraphs to text offsets and the selected image", () => {
  const model: DocModel = {
    ...defaultStarterModel,
    metadata: {
      ...defaultStarterModel.metadata,
      comments: [{ id: 0, text: "Review", nodes: [{ type: "paragraph", blockId: "note", children: [] }] }],
    },
    nodes: [
      { type: "paragraph", blockId: "first", children: [{ type: "text", text: "A" }, { type: "text", text: "B" }],
        sourceXml: '<w:p><w:r><w:t>A</w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>B</w:t></w:r></w:p>' },
      { type: "paragraph", blockId: "middle", children: [{ type: "text", text: "😀" }] },
      { type: "paragraph", blockId: "last", children: [{ type: "image", blockId: "selected" }, { type: "image", blockId: "outside" }],
        sourceXml: '<w:p><w:r><w:drawing/></w:r><w:commentRangeEnd w:id="0"/><w:r><w:drawing/></w:r><w:r><w:commentReference w:id="0"/></w:r></w:p>' },
    ],
  };
  expect(resolveDocxCommentLinks(model)).toEqual([{
    id: 0, blockIds: ["note"], targets: [
      { blockId: "first", start: 1, end: 2 }, { blockId: "middle", start: 0, end: 2 }, { blockId: "selected" },
    ],
  }]);
});
