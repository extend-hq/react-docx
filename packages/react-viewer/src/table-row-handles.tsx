import * as React from "react";

interface RowGeometry {
  heightsPx: number[];
  bottomsPx: number[];
}

export function TableRowHandles({
  rowCount,
  resolveZoomScale,
  children,
}: {
  rowCount: number;
  resolveZoomScale: (element: HTMLElement) => number;
  children: (geometry: RowGeometry) => React.ReactNode;
}): React.ReactElement {
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [geometry, setGeometry] = React.useState<RowGeometry>();
  const geometryRef = React.useRef<RowGeometry | undefined>(undefined);
  const commitGeometry = React.useCallback((next: RowGeometry | undefined) => {
    const current = geometryRef.current;
    if (
      current === next ||
      (current && next &&
        current.heightsPx.length === next.heightsPx.length &&
        next.heightsPx.every((height, index) =>
          Math.abs(height - current.heightsPx[index]!) < 0.01 &&
          Math.abs(next.bottomsPx[index]! - current.bottomsPx[index]!) < 0.01
        ))
    ) {
      return;
    }
    geometryRef.current = next;
    setGeometry(next);
  }, []);
  const measure = React.useCallback(() => {
    const host = anchorRef.current?.parentElement;
    const table = host?.querySelector<HTMLTableElement>(":scope > table");
    if (!host || !table || table.rows.length !== rowCount) {
      commitGeometry(undefined);
      return;
    }

    const scale = resolveZoomScale(host);
    if (!Number.isFinite(scale) || scale <= 0) {
      commitGeometry(undefined);
      return;
    }
    const originTop = host.getBoundingClientRect().top + host.clientTop * scale;
    const rects = Array.from(table.rows, (row) => row.getBoundingClientRect());
    if (rects.some((rect) => rect.height <= 0)) {
      commitGeometry(undefined);
      return;
    }
    commitGeometry({
      heightsPx: rects.map((rect) => rect.height / scale),
      bottomsPx: rects.map((rect) => (rect.bottom - originTop) / scale),
    });
  }, [commitGeometry, resolveZoomScale, rowCount]);

  // Handle geometry is local to the active table and independent of pagination.
  React.useLayoutEffect(measure);
  React.useLayoutEffect(() => {
    const table =
      anchorRef.current?.parentElement?.querySelector<HTMLTableElement>(
        ":scope > table"
      );
    if (!table || typeof ResizeObserver !== "function") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    for (const row of Array.from(table.rows)) observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <>
      <span
        ref={anchorRef}
        hidden
        aria-hidden="true"
        data-docx-pagination-ignore="true"
      />
      {geometry?.heightsPx.length === rowCount ? children(geometry) : null}
    </>
  );
}
