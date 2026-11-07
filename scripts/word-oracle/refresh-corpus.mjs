import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/word-oracle/refresh-corpus.mjs --output PATH [--watch] [--interval-seconds 60]"
  );
  process.exit(0);
}
const outputOption = option("--output", null);
if (!outputOption) throw new Error("--output is required");
const output = path.resolve(outputOption);
const intervalSeconds = Math.max(5, Number(option("--interval-seconds", "60")));
const run = async (script, parameters) => {
  const begin = performance.now();
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(scripts, script), "--output", output, ...parameters],
      { stdio: ["ignore", "ignore", "inherit"] }
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))
    );
  });
  console.log(
    JSON.stringify({
      stage: script,
      arguments: parameters,
      elapsedMs: Math.round(performance.now() - begin),
    })
  );
};
const modes = [
  {
    variants: "baseline,migrated",
    suffix: "",
    changes: "renderer-changes.json",
    priority: "word-priority-migration.json",
  },
  {
    variants: "baseline,refined",
    suffix: "-refined",
    changes: "renderer-changes-refined.json",
    priority: "word-priority-refined.json",
  },
  {
    variants: "migrated,refined",
    suffix: "-refinement-only",
    changes: "renderer-refinement-only-changes.json",
    priority: "word-priority-refinement-only.json",
  },
  {
    variants: "baseline,final",
    suffix: "-final",
    changes: "renderer-changes-final.json",
    priority: "word-priority-final.json",
  },
  {
    variants: "refined,final",
    suffix: "-final-refinements",
    changes: "renderer-final-refinements-changes.json",
    priority: "word-priority-final-refinements.json",
  },
  {
    variants: "baseline,final-corrected",
    suffix: "-final-corrected",
    changes: "renderer-changes-final-corrected.json",
    priority: "word-priority-final-corrected.json",
  },
  {
    variants: "refined,final-corrected",
    suffix: "-corrected-refinements",
    changes: "renderer-corrected-refinements-changes.json",
    priority: "word-priority-corrected-refinements.json",
  },
  {
    variants: "final,final-corrected",
    suffix: "-corrections",
    changes: "renderer-corrections-changes.json",
    priority: "word-priority-corrections.json",
  },
];
do {
  const identities = JSON.parse(
    await fs.readFile(path.join(output, "build-identities.json"), "utf8")
  );
  const active = modes.filter((mode) =>
    mode.variants.split(",").every((variant) => identities.builds[variant])
  );
  for (const mode of active) {
    const [before, after] = mode.variants.split(",");
    await run("renderer-changes.mjs", [
      "--before",
      before,
      "--after",
      after,
      "--result",
      mode.changes,
      "--priority",
      mode.priority,
    ]);
  }
  const priority = new Map();
  for (const mode of active) {
    const data = JSON.parse(
      await fs.readFile(path.join(output, mode.priority), "utf8")
    );
    for (const document of data.documents) {
      const existing = priority.get(document.id);
      if (!existing || existing.score < document.score)
        priority.set(document.id, { ...document, comparison: mode.variants });
    }
  }
  const ordered = [...priority.values()].sort((a, b) => b.score - a.score);
  const priorityResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ids: ordered.map((document) => document.id),
    documents: ordered,
  };
  await fs.writeFile(
    path.join(output, "word-priority.json.tmp"),
    JSON.stringify(priorityResult, null, 2)
  );
  await fs.rename(
    path.join(output, "word-priority.json.tmp"),
    path.join(output, "word-priority.json")
  );
  const fieldAudit = path.join(output, "audit_page_number_fields.py");
  try {
    await fs.access(fieldAudit);
    await new Promise((resolve, reject) => {
      const child = spawn("python3", [fieldAudit], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Printed-field audit exited${code}`))
      );
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const mode of active) {
    await run("compare-corpus.mjs", [
      "--variants",
      mode.variants,
      "--result",
      `comparison${mode.suffix}.json`,
    ]);
    await run("report-corpus.mjs", [
      "--comparison",
      `comparison${mode.suffix}.json`,
      "--report",
      `report${mode.suffix}.html`,
      "--changes",
      mode.changes,
    ]);
  }
  console.log(
    JSON.stringify({
      refreshedAt: new Date().toISOString(),
      priorityDocuments: ordered.length,
    })
  );
  if (!args.includes("--watch")) break;
  await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
} while (true);
