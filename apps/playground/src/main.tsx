import * as React from "react";
import { Analytics } from "@vercel/analytics/react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./components/theme-provider";
import "./index.css";

// StrictMode double-invokes render work in dev, which skews editor perf
// profiling; opt back in with ?strict=1 or VITE_STRICT_MODE=1.
const useStrictMode =
  new URLSearchParams(window.location.search).get("strict") === "1" ||
  import.meta.env.VITE_STRICT_MODE === "1";

const app = (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <App />
    <Analytics />
  </ThemeProvider>
);

createRoot(document.getElementById("root")!).render(
  useStrictMode ? <React.StrictMode>{app}</React.StrictMode> : app
);
