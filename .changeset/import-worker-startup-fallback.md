---
"@extend-ai/react-docx": patch
---

Fall back to main-thread parsing when the import worker's script cannot be fetched or evaluated, not only when the worker cannot be constructed. This applies to imports that allow a fallback (`useWorker: true` and the `parseDocxForViewer` default); imports that require the worker still report an error.
