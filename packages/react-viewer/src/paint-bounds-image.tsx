import * as React from "react";
import { resolveImagePaintBounds, type ImageRunNode } from "@extend-ai/react-docx-doc-model";

interface PaintBoundsImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  image: Pick<ImageRunNode, "paintBounds" | "widthPx" | "heightPx">;
  widthPx?: number;
  heightPx?: number;
  frameRef?: React.Ref<HTMLElement>;
  "data-docx-source-id"?: string;
  "data-docx-header-footer-overlay"?: boolean;
}

export function PaintBoundsImage({
  image,
  widthPx = image.widthPx,
  heightPx = image.heightPx,
  frameRef,
  style,
  "data-docx-source-id": sourceId,
  "data-docx-header-footer-overlay": headerFooterOverlay,
  ...props
}: PaintBoundsImageProps): React.JSX.Element {
  const paint = resolveImagePaintBounds(image, widthPx, heightPx);
  const frameElementRef = React.useRef<HTMLSpanElement | null>(null);
  const imageElementRef = React.useRef<HTMLImageElement>(null);
  const reference = paint ? image.paintBounds : undefined;
  React.useLayoutEffect(() => {
    const frame = frameElementRef.current, element = imageElementRef.current;
    if (!frame || !element || !reference) return;
    const applySize = (width: number, height: number): void => {
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        element.style.transform = `scale(${width / reference.layoutWidthPx}, ${height / reference.layoutHeightPx})`;
      }
    };
    const style = window.getComputedStyle(frame);
    applySize(Number.parseFloat(style.width), Number.parseFloat(style.height));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) applySize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [reference, widthPx, heightPx]);
  const registerFrame = React.useCallback((element: HTMLSpanElement | null): void => {
    frameElementRef.current = element;
    if (typeof frameRef === "function") frameRef(element);
    else if (frameRef) (frameRef as React.MutableRefObject<HTMLElement | null>).current = element;
  }, [frameRef]);
  if (!paint || !reference || !widthPx || !heightPx) return (
    <img {...props} ref={frameRef as React.Ref<HTMLImageElement>} style={style}
      data-docx-source-id={sourceId} data-docx-header-footer-overlay={headerFooterOverlay} />
  );
  return (
    <span
      ref={registerFrame}
      data-docx-image-paint-frame="true"
      data-docx-source-id={sourceId}
      data-docx-header-footer-overlay={headerFooterOverlay}
      style={{
        ...style,
        display: style?.display ?? "inline-block",
        width: style?.width ?? widthPx,
        height: style?.height === "100%" ? "100%" : "auto",
        aspectRatio: `${widthPx} / ${heightPx}`,
        position: style?.position === "absolute" || style?.position === "fixed" ? style.position : "relative",
        overflow: "visible",
      }}
    >
      <img {...props} ref={imageElementRef} style={{
        display: "block",
        position: "absolute",
        left: `${100 * paint.xPx / widthPx}%`,
        top: `${100 * paint.yPx / heightPx}%`,
        width: reference.widthPx,
        height: reference.heightPx,
        transform: `scale(${widthPx / reference.layoutWidthPx}, ${heightPx / reference.layoutHeightPx})`,
        transformOrigin: "top left",
        maxWidth: "none",
        userSelect: style?.userSelect,
      }} />
    </span>
  );
}
