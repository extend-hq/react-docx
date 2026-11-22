---
"@extend-ai/react-docx": minor
---

Add a `useWorker` option to `useDocxEditor`, `useDocxModel` and the vanilla viewer so imports can fall back to, or always use, main-thread parsing when the import worker cannot start, such as when the worker script is served from another origin. The default still requires the worker.
