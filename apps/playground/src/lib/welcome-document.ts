import type { DocModel } from "@extend-ai/react-docx";

/** File name shown for the sample document both playgrounds open with. */
export const WELCOME_FILE_NAME = "Welcome.docx";

type SampleRunStyle = {
  fontFamily?: string;
  fontSizePt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
};

function paragraph(text: string, style: SampleRunStyle = {}) {
  return {
    type: "paragraph" as const,
    children: [
      {
        type: "text" as const,
        text,
        style: { fontFamily: "Calibri", fontSizePt: 11, color: "#111827", ...style },
      },
    ],
  };
}

/** The welcome document shared by the React and vanilla playgrounds. */
export function createWelcomeDocumentModel(): DocModel {
  return {
    nodes: [
      paragraph("A place for ideas.", { fontFamily: "Georgia", fontSizePt: 26, bold: true }),
      paragraph("A little room to think, write, and make something.", { fontSizePt: 13 }),
      paragraph(""),
      paragraph("Welcome to the DOCX playground", { fontSizePt: 15, bold: true }),
      paragraph(
        "This document is yours to explore. Click anywhere in the text to make a change, or open a document of your own."
      ),
      paragraph(""),
      paragraph("Try it out", { fontSizePt: 14, bold: true }),
      paragraph(
        "Switch to read-only mode to preview a document, change the zoom, or export your edits as a DOCX."
      ),
      paragraph(""),
      paragraph("Made for the browser, ready for your workflow.", { italic: true }),
    ],
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections: [],
      footerSections: [],
      paragraphStyles: [
        {
          id: "Normal",
          name: "Body",
          isDefault: true,
          runStyle: { fontFamily: "Calibri", fontSizePt: 11 },
        },
      ],
      defaultParagraphStyleId: "Normal",
    },
  };
}
