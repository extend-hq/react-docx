---
"@extend-ai/react-docx": patch
---

Reduce legacy Word import overhead by moving compound-file streams into the parser, reusing decoded text and formatting data, and appending XML directly into output buffers. Preserve the generated package, parsed model, and structured-block representation.

Use immutable native cache snapshots with thread-local regex readers and a bounded update actor. Skip optional cache admission when its mailbox is full, while preserving complete parsing results.
