---
"@extend-ai/react-docx": patch
---

Editing performance: single-node editor operations (typing, run-style toggles, paragraph insert/remove/duplicate, paste, and single-cell table edits) now use copy-on-write structural sharing instead of deep-cloning the entire document on every edit. Per-keystroke cost is now proportional to the edited paragraph rather than the whole document (~50–700× faster on large documents in microbenchmarks), and unchanged nodes keep their object identity. Rendered output and behavior are unchanged; document-wide operations such as find/replace still clone fully.
