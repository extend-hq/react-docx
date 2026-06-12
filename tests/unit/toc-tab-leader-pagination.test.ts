import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  defaultStarterModel,
  DocxEditorViewer,
  paragraphLineCountWithinWidth,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";

function TocViewer({ model }: { model: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only"
  });
}

describe("toc tab leader pagination", () => {
  it("reserves the trailing page-number zone before wrapping long TOC entries", () => {
    const paragraph: DocModel["nodes"][number] = {
      type: "paragraph",
      style: {
        styleId: "TOC3"
      },
      children: [
        {
          type: "text",
          text: "i.\tAllegation relating to evidence relied on to identify the Applicant\t15",
          style: {
            fontFamily: "Arial",
            fontSizePt: 11
          }
        }
      ]
    };

    expect(paragraphLineCountWithinWidth(paragraph, 320)).toBe(3);
  });

  it("accounts for a leading TOC marker tab before wrapping the title text", () => {
    const paragraph: DocModel["nodes"][number] = {
      type: "paragraph",
      style: {
        styleId: "TOC3"
      },
      children: [
        {
          type: "text",
          text: "i.\tObjection relating to non-exhaustion of local remedies\t11",
          style: {
            fontFamily: "Arial",
            fontSizePt: 11,
            characterSpacingTwips: 20
          }
        }
      ]
    };

    // Tabs without explicit stops advance to the next default-stop multiple
    // (Word behavior) rather than a fixed 48px gap, so the marker tab ends at
    // x=48 instead of x≈58 and the title wraps one line earlier.
    expect(paragraphLineCountWithinWidth(paragraph, 260)).toBe(3);
  });

  it("renders TOC entry tabs as measured spacers before the page-number zone", () => {
    const model: DocModel = {
      ...defaultStarterModel,
      nodes: [
        {
          type: "paragraph",
          style: {
            styleId: "TOC8",
            styleName: "toc 8",
            indent: {
              leftTwips: 1418,
              rightTwips: 1134,
              hangingTwips: 851
            },
            tabStops: [
              {
                alignment: "left",
                leader: "none",
                positionTwips: 1418
              },
              {
                alignment: "right",
                leader: "dot",
                positionTwips: 6804
              }
            ]
          },
          children: [
            {
              type: "text",
              text: "1.\tCitation\t1",
              style: {
                fontFamily: "Times New Roman",
                fontSizePt: 12
              }
            }
          ]
        }
      ]
    };

    const html = renderToStaticMarkup(React.createElement(TocViewer, { model }));

    expect(html).toContain('data-docx-tab-layout="leader"');
    expect(html).toContain('data-docx-tab-zone="left"');
    expect(html).toContain('data-docx-tab-zone="right"');
    expect(html).toContain("display:block;flex:0 1 auto");
    expect(html).toContain("display:inline-block;white-space:pre;width:");
    expect(html).toContain("flex:0 0 max-content");
    expect(html).toContain("white-space:nowrap;text-indent:0");
  });
});
