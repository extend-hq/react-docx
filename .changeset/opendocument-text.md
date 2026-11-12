---
"@extend-ai/react-docx": minor
---

Open OpenDocument text (`.odt`, `.ott`, `.odm`, `.otm`, `.oth` and flat `.fodt`) for viewing, using the OpenDocument reader in Rust DOCX/WASM 0.3.0. The file is read straight into the document model, so images are drawn from their own bytes, text frames are drawn from their nested paragraphs, tables and images, page number fields show the live number, footnotes sit on the page that references them and LibreOffice formulas are drawn from their MathML. Such a document is view-only: `editor.viewOnlyReason` is set, `DocxEditorViewer` renders it read-only in any `mode`, editing commands leave the model unchanged, `exportDocx()` reports the reason in `status` and `getDocxBytes()` rejects with it. `isOpenDocumentModel` and the `commentRanges` paragraph field are exported with the model types. The runtime update also brings the parser changes of 0.2.21 and 0.2.22.
