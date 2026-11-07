import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import crypto from "node:crypto";

export const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

export async function fileSha256(filename) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function readEvidenceJson(filename) {
  try {
    const bytes = await fs.readFile(filename);
    const value = JSON.parse(bytes);
    Object.defineProperty(value, "artifactSha256", {
      value: sha256(bytes),
      enumerable: false,
    });
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function referenceQualificationErrors(
  receipt,
  sourceSha256,
  environment
) {
  const errors = [];
  if (receipt?.status !== "ok") errors.push("Reference did not complete");
  if (receipt?.sourceSha256 !== sourceSha256)
    errors.push("Source identity mismatch");
  if (
    receipt?.sourceUnchanged !== true ||
    receipt?.stagedSourceUnchanged !== true
  )
    errors.push("Source preservation was not verified");
  if (!environment || receipt?.environmentSha256 !== environment.artifactSha256)
    errors.push("Environment identity mismatch");
  if (
    receipt?.profileId !== "word-pdf-final-original-v1" ||
    receipt?.profileId !== environment?.profileId
  )
    errors.push("Reference profile mismatch");
  if (receipt?.native?.markupPolicy !== "final_no_markup")
    errors.push("Final-view policy missing");
  if (receipt?.native?.readOnly !== "true")
    errors.push("Read-only qualification missing");
  if (
    receipt?.native?.automationSecurity !== "msoAutomationSecurityForceDisable"
  )
    errors.push("Macro policy mismatch");
  if (
    receipt?.native?.wordVersion !== environment?.wordVersion ||
    receipt?.wordBuild !== environment?.wordBuild
  )
    errors.push("Word version mismatch");
  if (!receipt?.pdfSha256 || !receipt?.geometrySha256)
    errors.push("Reference artifact identity missing");
  return errors;
}
