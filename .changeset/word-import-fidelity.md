---
"@extend-ai/react-docx": patch
---

Improve legacy Word parsing for compound streams, fields, phonetic text, comments, symbols, lists, tables, and images. Accept DOC, DOT, DOCX, DOTX, DOCM, and DOTM consistently in file import and drag-and-drop, with download names matching the retained OOXML package family.

Preserve inline and grouped VML artwork, editable text-box stories, cropped bitmap fills, and heading levels 1–9 across parsing and export. Retain the current editor state and pending image edits when obtaining document bytes.
