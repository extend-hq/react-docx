import { describe, expect, it } from "vitest";

describe("image wrap state", () => {
  it("keeps checkbox widget width stable across checked states", async () => {
    const { resolveCheckboxFieldWidthPx } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const uncheckedWidth = resolveCheckboxFieldWidthPx({
      type: "form-field",
      fieldType: "checkbox",
      checked: false,
      checkedSymbol: "☒",
      uncheckedSymbol: "☐"
    });
    const checkedWidth = resolveCheckboxFieldWidthPx({
      type: "form-field",
      fieldType: "checkbox",
      checked: true,
      checkedSymbol: "☒",
      uncheckedSymbol: "☐"
    });

    expect(checkedWidth).toBe(uncheckedWidth);
  });

  it("treats missing floating metadata as inline with text", async () => {
    const { resolveDocxImageWrapState } = await import(
      "../../packages/react-viewer/src/editor"
    );

    expect(resolveDocxImageWrapState(undefined)).toEqual({
      mode: "inline",
      moveWithText: true,
      fixedPositionOnPage: false
    });
  });

  it("preserves wrapped paragraph-anchored images as move-with-text", async () => {
    const { resolveDocxImageWrapState } = await import(
      "../../packages/react-viewer/src/editor"
    );

    expect(
      resolveDocxImageWrapState({
        wrapType: "topAndBottom",
        horizontalAlign: "center",
        horizontalRelativeTo: "page",
        verticalRelativeTo: "paragraph",
        behindDocument: false
      })
    ).toEqual({
      mode: "topAndBottom",
      moveWithText: true,
      fixedPositionOnPage: false
    });
  });

  it("marks absolute overlays as fixed-position image wraps", async () => {
    const { resolveDocxImageWrapState } = await import(
      "../../packages/react-viewer/src/editor"
    );

    expect(
      resolveDocxImageWrapState({
        wrapType: "none",
        verticalRelativeTo: "margin",
        horizontalRelativeTo: "page",
        behindDocument: false
      })
    ).toEqual({
      mode: "inFrontOfText",
      moveWithText: false,
      fixedPositionOnPage: true
    });
  });

  it("drops absolute floating images in page coordinates instead of paragraph coordinates", async () => {
    const { resolveAbsoluteFloatingImageDropPatch } = await import(
      "../../packages/react-viewer/src/editor"
    );

    expect(
      resolveAbsoluteFloatingImageDropPatch(
        {
          wrapType: "none",
          behindDocument: true,
          horizontalRelativeTo: "column",
          verticalRelativeTo: "paragraph"
        },
        {
          marginsPx: { top: 72, right: 72, bottom: 72, left: 72 },
          pageWidthPx: 612,
          pageHeightPx: 792
        },
        {
          wrapperRect: { left: 240, top: 310, width: 26, height: 26 },
          pageSurfaceRect: { left: 100, top: 120, width: 612, height: 792 },
          deltaX: 90,
          deltaY: -40
        }
      )
    ).toEqual({
      xPx: 158,
      yPx: 78,
      horizontalAlign: undefined,
      verticalAlign: undefined,
      horizontalRelativeTo: "margin",
      verticalRelativeTo: "margin"
    });
  });

  it("converts fixed-position wrapped images to move-with-text on drag drop", async () => {
    const { resolveWrappedFloatingImageDropPatch } = await import(
      "../../packages/react-viewer/src/editor"
    );

    expect(
      resolveWrappedFloatingImageDropPatch(
        {
          type: "image",
          widthPx: 80,
          heightPx: 60,
          floating: {
            wrapType: "square",
            wrapText: "bothSides",
            horizontalRelativeTo: "margin",
            verticalRelativeTo: "margin",
            xPx: 140,
            yPx: 90,
            distLPx: 8,
            distRPx: 8,
            distTPx: 0,
            distBPx: 0,
            behindDocument: false
          }
        },
        420,
        120,
        44,
        {
          widthPx: 80,
          heightPx: 60
        }
      )
    ).toMatchObject({
      xPx: 120,
      yPx: 44,
      horizontalRelativeTo: "column",
      verticalRelativeTo: "paragraph",
      behindDocument: false
    });
  });

  it("renders behind-text absolute images below the text layer", async () => {
    const { absoluteFloatingImageStyle } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const style = absoluteFloatingImageStyle({
      type: "image",
      widthPx: 26,
      heightPx: 26,
      floating: {
        wrapType: "none",
        behindDocument: true,
        horizontalRelativeTo: "margin",
        verticalRelativeTo: "margin",
        xPx: 24,
        yPx: 18,
        zIndex: 0
      }
    });

    expect(style.zIndex).toBeLessThan(0);
  });

  it("can resolve page coordinates for fixed-position wrapped images", async () => {
    const { absoluteFloatingImageStyle } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const style = absoluteFloatingImageStyle({
      type: "image",
      widthPx: 102,
      heightPx: 102,
      floating: {
        wrapType: "square",
        wrapText: "bothSides",
        behindDocument: false,
        horizontalRelativeTo: "margin",
        verticalRelativeTo: "margin",
        xPx: 139,
        yPx: 381
      }
    }, {
      pageOriginLeft: 72,
      pageOriginTop: 72
    });

    expect(style.position).toBe("absolute");
    expect(style.left).toBe(211);
    expect(style.top).toBe(453);
  });

  it("distinguishes page-relative and margin-relative anchor origins", async () => {
    const { absoluteFloatingImageStyle } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const pageRelativeStyle = absoluteFloatingImageStyle(
      {
        type: "image",
        widthPx: 240,
        heightPx: 120,
        floating: {
          wrapType: "none",
          behindDocument: false,
          horizontalRelativeTo: "page",
          verticalRelativeTo: "page",
          xPx: -12,
          yPx: -24
        }
      },
      {
        pageOriginLeft: 0,
        pageOriginTop: 0,
        marginOriginLeft: 96,
        marginOriginTop: 96
      }
    );
    const marginRelativeStyle = absoluteFloatingImageStyle(
      {
        type: "image",
        widthPx: 240,
        heightPx: 120,
        floating: {
          wrapType: "none",
          behindDocument: false,
          horizontalRelativeTo: "margin",
          verticalRelativeTo: "margin",
          xPx: -12,
          yPx: -24
        }
      },
      {
        pageOriginLeft: 0,
        pageOriginTop: 0,
        marginOriginLeft: 96,
        marginOriginTop: 96
      }
    );

    expect(pageRelativeStyle.left).toBe(-12);
    expect(pageRelativeStyle.top).toBe(-24);
    expect(marginRelativeStyle.left).toBe(84);
    expect(marginRelativeStyle.top).toBe(72);
  });
});
