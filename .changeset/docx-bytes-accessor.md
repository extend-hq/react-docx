---
"@extend-ai/react-docx": minor
---

Add `getDocxBytes()` to the editor controller. It resolves to the current document as DOCX bytes, the same bytes `exportDocx()` downloads, so an app can save the edited document without a browser download.
