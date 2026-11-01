import { PaintBoundsImage } from "./paint-bounds-image";
import * as React from "react";
import {
  resolveFormFieldSourcePreview,
  type FormFieldRunNode,
} from "@extend-ai/react-docx-doc-model";
import { resolveFormFieldPreviewImageSource } from "./image-render";

export function formFieldAccessibleName(field: FormFieldRunNode): string {
  return [field.title, field.widget?.name, field.tag, field.sourcePreview?.image.alt]
    .find((value) => Boolean(value?.trim()))?.trim() ?? "Checkbox";
}

export interface FormFieldPreviewPresentation {
  frameStyle?: React.CSSProperties;
  imageStyle?: React.CSSProperties;
  imageLayoutWidthPx?: number;
  imageLayoutHeightPx?: number;
  clipStyle?: React.CSSProperties;
  frameRef?: React.Ref<HTMLSpanElement>;
  inlineAdvancePx?: number;
}

export function ReadOnlyCheckbox({
  field,
  fallback,
  sourceId,
  childIndex,
  style,
  presentation,
  attributes,
}: {
  field: FormFieldRunNode;
  fallback: React.ReactNode;
  sourceId?: string;
  childIndex?: number;
  style?: React.CSSProperties;
  presentation?: FormFieldPreviewPresentation;
  attributes?: Record<string, string>;
}): React.JSX.Element {
  const preview = resolveFormFieldSourcePreview(field);
  const src = preview ? resolveFormFieldPreviewImageSource(preview) : undefined;
  const [failedSource, setFailedSource] = React.useState<string>();
  const showPreview = Boolean(src && src !== failedSource);
  const image = showPreview ? (
    <PaintBoundsImage
      image={preview ?? {}}
      widthPx={presentation?.imageLayoutWidthPx ?? preview?.widthPx}
      heightPx={presentation?.imageLayoutHeightPx ?? preview?.heightPx}
      key={src}
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-docx-form-field-preview="true"
      onError={() => setFailedSource(src)}
      style={{
        display: "block",
        width: preview?.widthPx,
        height: preview?.heightPx,
        maxWidth: "none",
        ...presentation?.imageStyle,
      }}
    />
  ) : null;

  return (
    <span
      {...attributes}
      ref={preview ? presentation?.frameRef : undefined}
      contentEditable={false}
      data-docx-source-id={sourceId}
      data-docx-form-field="true"
      data-docx-form-field-child-index={childIndex}
      data-docx-form-field-type="checkbox"
      role="checkbox"
      aria-label={formFieldAccessibleName(field)}
      aria-checked={Boolean(field.checked ?? field.widget?.checkbox?.defaultChecked)}
      aria-readonly="true"
      style={{ ...style, ...(preview ? presentation?.frameStyle : undefined) }}
    >
      {showPreview
        ? presentation?.clipStyle
          ? <span aria-hidden="true" style={presentation.clipStyle}>{image}</span>
          : image
        : fallback}
    </span>
  );
}
