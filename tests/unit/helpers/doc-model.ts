import { buildDocModel, type DocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";

export async function parseAndBuildDocModel(input: ArrayBuffer): Promise<DocModel> {
  const pkg = await parseDocx(input);
  return buildDocModel(pkg);
}

export async function parseAndBuildFromZip(zip: ArrayBuffer): Promise<DocModel> {
  return parseAndBuildDocModel(zip);
}
