import type { FormFieldRunNode, ImageRunNode } from "./types";

export function resolveFormFieldSourcePreview(
  field: FormFieldRunNode
): ImageRunNode | undefined {
  const preview = field.sourcePreview;
  if (
    field.fieldType !== "checkbox" ||
    typeof field.sourceXml !== "string" ||
    !field.sourceXml.trim() ||
    !preview ||
    typeof preview.relationshipId !== "string" ||
    !preview.relationshipId.trim() ||
    typeof preview.shapeId !== "string" ||
    !preview.shapeId.trim() ||
    typeof preview.checked !== "boolean" ||
    preview.checked !== Boolean(field.checked ?? field.widget?.checkbox?.defaultChecked)
  ) {
    return undefined;
  }

  const image = preview.image;
  if (!image || image.type !== "image") {
    return undefined;
  }
  const hasSource = typeof image.src === "string" && image.src.trim().length > 0;
  const hasData = (image.data instanceof Uint8Array || Array.isArray(image.data))
    && image.data.length > 0;
  return hasSource || hasData ? image : undefined;
}

export function invalidateFormFieldSource(
  field: FormFieldRunNode
): FormFieldRunNode {
  return { ...field, sourceXml: undefined, sourcePreview: undefined };
}
