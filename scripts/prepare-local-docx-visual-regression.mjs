import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultDocxTestingRoot = "/Users/andrewluo/Documents/DOCX testing";
const localRegressionRoot = path.join(
  repoRoot,
  "tests/fixtures/docx-regression-local"
);
const localCasesDir = path.join(localRegressionRoot, "cases");
const localManifestPath = path.join(localRegressionRoot, "visual-cases.json");
const localSnapshotDir = path.join(
  repoRoot,
  "tests/visual/docx-regression-local.spec.ts-snapshots"
);

function parseArgs(argv) {
  const result = {
    folder: "",
    docxTestingRoot: defaultDocxTestingRoot,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--folder") {
      result.folder = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--docx-testing-root") {
      result.docxTestingRoot = argv[index + 1] ?? defaultDocxTestingRoot;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!result.folder.trim()) {
    throw new Error("Missing required --folder argument");
  }

  return result;
}

function printUsage() {
  console.log(`Usage:
  node scripts/prepare-local-docx-visual-regression.mjs --folder <folder-name-or-absolute-path> [--docx-testing-root <path>]

Options:
  --folder              Required. Folder name under the DOCX testing root, or an absolute path.
  --docx-testing-root   Optional. Defaults to ${defaultDocxTestingRoot}`);
}

function resolveSourceDir(folder, docxTestingRoot) {
  if (path.isAbsolute(folder)) {
    return path.resolve(folder);
  }
  return path.resolve(docxTestingRoot, folder);
}

async function removeAndRecreateDirectory(directoryPath) {
  await fs.rm(directoryPath, { recursive: true, force: true });
  await fs.mkdir(directoryPath, { recursive: true });
}

async function fileHash(absolutePath) {
  const content = await fs.readFile(absolutePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function listDocxFiles(sourceDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".docx") &&
        !entry.name.startsWith("~$") &&
        !entry.name.startsWith(".")
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = resolveSourceDir(args.folder, args.docxTestingRoot);
  const sourceStat = await fs.stat(sourceDir).catch(() => null);
  if (!sourceStat || !sourceStat.isDirectory()) {
    throw new Error(`Source folder does not exist or is not a directory: ${sourceDir}`);
  }

  const fileNames = await listDocxFiles(sourceDir);
  if (fileNames.length === 0) {
    throw new Error(`No .docx files found in source folder: ${sourceDir}`);
  }

  await removeAndRecreateDirectory(localCasesDir);
  await fs.rm(localSnapshotDir, { recursive: true, force: true });

  const manifest = [];
  const copiedFiles = [];

  for (const fileName of fileNames) {
    const sourcePath = path.join(sourceDir, fileName);
    const destinationPath = path.join(localCasesDir, fileName);
    await fs.copyFile(sourcePath, destinationPath);

    const sourceHash = await fileHash(sourcePath);
    manifest.push({
      relativePath: fileName,
      sourceHash,
    });
    copiedFiles.push(destinationPath);
  }

  await fs.mkdir(localRegressionRoot, { recursive: true });
  await fs.writeFile(localManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const summary = {
    sourceDir,
    caseCount: copiedFiles.length,
    fixtureRoot: localRegressionRoot,
    casesDir: localCasesDir,
    manifestPath: localManifestPath,
    snapshotDir: localSnapshotDir,
    copiedFiles,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Failed to prepare local visual regression cases"
  );
  process.exit(1);
});
