import fs from "node:fs";
import path from "node:path";

export const DOCX_REGRESSION_ROOT_DIR = path.resolve(
  process.cwd(),
  "tests/fixtures/docx-regression"
);
export const DOCX_REGRESSION_CASES_DIR = path.join(
  DOCX_REGRESSION_ROOT_DIR,
  "cases"
);
export const DOCX_VISUAL_REGRESSION_MANIFEST_PATH = path.join(
  DOCX_REGRESSION_ROOT_DIR,
  "visual-cases.json"
);

export interface DocxRegressionCase {
  fileName: string;
  absolutePath: string;
  relativePath: string;
  slug: string;
  snapshotPrefix: string;
}

export interface DocxVisualRegressionCase extends DocxRegressionCase {
  sourceHash?: string;
  wordPageCount?: number;
}

interface DocxVisualRegressionManifestEntry {
  relativePath: string;
  sourceHash?: string;
  wordPageCount?: number;
}

function walkFilesSync(directory: string, output: string[]): void {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFilesSync(absolutePath, output);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    output.push(absolutePath);
  }
}

function slugFromRelativePath(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.docx$/i, "");
  const normalized = withoutExtension
    .replace(/[\\/]+/g, "--")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized.length > 0 ? normalized : "fixture";
}

export function listDocxRegressionCasesSync(): DocxRegressionCase[] {
  if (!fs.existsSync(DOCX_REGRESSION_CASES_DIR)) {
    return [];
  }

  const allFiles: string[] = [];
  walkFilesSync(DOCX_REGRESSION_CASES_DIR, allFiles);

  return allFiles
    .filter((absolutePath) => absolutePath.toLowerCase().endsWith(".docx"))
    .map((absolutePath) => {
      const relativePath = path.relative(DOCX_REGRESSION_CASES_DIR, absolutePath);
      const fileName = path.basename(absolutePath);
      const slug = slugFromRelativePath(relativePath);
      const snapshotPrefix = `docx-regression-${slug}`;
      return {
        fileName,
        absolutePath,
        relativePath,
        slug,
        snapshotPrefix
      };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function listVisualDocxRegressionCasesSync(): DocxVisualRegressionCase[] {
  const allCases = listDocxRegressionCasesSync();
  const caseByRelativePath = new Map(
    allCases.map((fixture) => [fixture.relativePath, fixture] as const)
  );

  if (!fs.existsSync(DOCX_VISUAL_REGRESSION_MANIFEST_PATH)) {
    return [];
  }

  const manifest = JSON.parse(
    fs.readFileSync(DOCX_VISUAL_REGRESSION_MANIFEST_PATH, "utf8")
  ) as DocxVisualRegressionManifestEntry[];

  return manifest.map((entry) => {
    const fixture = caseByRelativePath.get(entry.relativePath);
    if (!fixture) {
      throw new Error(
        `Visual regression fixture "${entry.relativePath}" is missing from ${DOCX_REGRESSION_CASES_DIR}`
      );
    }

    return {
      ...fixture,
      sourceHash: entry.sourceHash,
      wordPageCount: entry.wordPageCount
    };
  });
}
