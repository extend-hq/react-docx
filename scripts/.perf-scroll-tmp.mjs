import { chromium } from "playwright";

const docPath = process.argv[2] ?? "/tmp/perf-doc.docx";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
await context.addInitScript(() => {
  Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", {
    get: () => false,
    configurable: true,
  });
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

await page.goto("http://localhost:5177/", { waitUntil: "networkidle" });
await page.locator("input[type=file]").first().setInputFiles(docPath);
await page.waitForFunction(
  () => document.body.textContent?.includes("Loaded "),
  undefined,
  { timeout: 180_000 }
);
await page.waitForTimeout(4000);

await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");

const metrics = await page.evaluate(async () => {
  const scroller = Array.from(document.querySelectorAll("div")).find(
    (el) => el.scrollHeight > el.clientHeight + 1000 && /auto|scroll/.test(getComputedStyle(el).overflowY)
  );
  if (!scroller) return { error: "no scroller" };

  const gaps = [];
  let last = performance.now();
  let raf;
  const tick = (now) => {
    gaps.push(now - last);
    last = now;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  let longTaskTotal = 0;
  let longTaskMax = 0;
  let longTaskCount = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTaskTotal += entry.duration;
      longTaskMax = Math.max(longTaskMax, entry.duration);
      longTaskCount += 1;
    }
  });
  observer.observe({ entryTypes: ["longtask"] });

  const durationMs = 8000;
  const start = performance.now();
  await new Promise((resolve) => {
    const interval = setInterval(() => {
      const elapsed = performance.now() - start;
      if (elapsed >= durationMs) {
        clearInterval(interval);
        resolve();
        return;
      }
      // Down for 6s, back up for 2s.
      scroller.scrollTop += elapsed < 6000 ? 220 : -660;
    }, 16);
  });

  cancelAnimationFrame(raf);
  observer.disconnect();
  gaps.shift();
  const sorted = [...gaps].sort((a, b) => a - b);
  const sum = gaps.reduce((total, gap) => total + gap, 0);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    frames: gaps.length,
    meanGapMs: Math.round((sum / gaps.length) * 10) / 10,
    p50: Math.round(pct(0.5) * 10) / 10,
    p95: Math.round(pct(0.95) * 10) / 10,
    maxGapMs: Math.round(Math.max(...gaps) * 10) / 10,
    droppedPct: Math.round((gaps.filter((gap) => gap > 33).length / gaps.length) * 1000) / 10,
    longTaskCount,
    longTaskTotalMs: Math.round(longTaskTotal),
    longTaskMaxMs: Math.round(longTaskMax),
    scrolledTo: scroller.scrollTop,
  };
});

const { profile } = await cdp.send("Profiler.stop");
// Aggregate self time per function.
const selfByFn = new Map();
const totalByNode = new Map();
const hitCount = new Map();
profile.nodes.forEach((node) => hitCount.set(node.id, node.hitCount ?? 0));
const sampleInterval = 200 / 1000; // ms per sample
profile.nodes.forEach((node) => {
  const name = node.callFrame.functionName || "(anonymous)";
  const url = (node.callFrame.url || "").split("/").pop()?.split("?")[0] ?? "";
  const key = `${name} [${url}]`;
  selfByFn.set(key, (selfByFn.get(key) ?? 0) + (node.hitCount ?? 0) * sampleInterval);
});
const top = [...selfByFn.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 22)
  .map(([key, ms]) => `${Math.round(ms)}ms  ${key}`);

console.log(JSON.stringify(metrics, null, 1));
console.log("TOP SELF-TIME:");
console.log(top.join("\n"));
await browser.close();
