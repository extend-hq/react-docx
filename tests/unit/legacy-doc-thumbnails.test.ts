import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModelFromBytes } from "@extend-ai/react-docx-doc-model";
import {
  useDocxEditor,
  useDocxViewerThumbnails,
  type DocxViewerThumbnails,
} from "@extend-ai/react-docx";

const FIXTURES = join(__dirname, "../../crates/docx-core/tests/fixtures-doc");

function fixtureBuffer(name: string): ArrayBuffer {
  const bytes = readFileSync(join(FIXTURES, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function thumbnailsFor(name: string): Promise<{
  thumbnails: DocxViewerThumbnails;
  setupMs: number;
}> {
  const { model } = await buildDocModelFromBytes(fixtureBuffer(name));
  let result: DocxViewerThumbnails | undefined;

  function Probe(): React.JSX.Element {
    const editor = useDocxEditor({ starterModel: model as never });
    result = useDocxViewerThumbnails(editor, { resolution: 200 });
    return React.createElement("div");
  }

  const startedAt = performance.now();
  renderToStaticMarkup(React.createElement(Probe));
  const setupMs = performance.now() - startedAt;
  if (!result) {
    throw new Error("thumbnails hook produced no result");
  }
  return { thumbnails: result, setupMs };
}

describe("legacy .doc thumbnails", () => {
  it("produces per-page thumbnails for a .doc identical in shape to its .docx twin", async () => {
    const doc = await thumbnailsFor("patient_original (3).doc");
    const docx = await thumbnailsFor("patient_original (3).docx");

    expect(doc.thumbnails.thumbnails.length).toBeGreaterThan(0);
    expect(doc.thumbnails.thumbnails.length).toBe(
      docx.thumbnails.thumbnails.length
    );

    for (const thumbnail of doc.thumbnails.thumbnails) {
      expect(thumbnail.widthPx).toBeGreaterThan(0);
      expect(thumbnail.heightPx).toBeGreaterThan(0);
      expect(typeof thumbnail.paint).toBe("function");
      expect(thumbnail.aspectRatio).toBeCloseTo(
        thumbnail.sourceWidthPx / Math.max(1, thumbnail.sourceHeightPx)
      );
    }

    // Same pipeline, comparable cost: .doc setup must stay within 3x of the
    // .docx twin (both are typically a few ms; guard against a format-specific
    // slow path sneaking in).
    expect(doc.setupMs).toBeLessThan(Math.max(250, docx.setupMs * 3));
  });
});
