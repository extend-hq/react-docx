import { describe, expect, it } from "vitest";

import { resolveLinkedImageWrapperStyle } from "../../packages/react-viewer/src/editor";

describe("linked image wrapper style", () => {
  it("keeps floating image positioning on the hyperlink wrapper", () => {
    expect(
      resolveLinkedImageWrapperStyle({
        baseStyle: {
          display: "block",
          float: "right",
          marginRight: 12,
          marginTop: 0
        },
        cursor: "pointer"
      })
    ).toMatchObject({
      display: "block",
      float: "right",
      marginRight: 12,
      marginTop: 0,
      lineHeight: 0,
      verticalAlign: "middle",
      cursor: "pointer"
    });
  });

  it("uses inline-block for linked inline images when no floating style exists", () => {
    expect(resolveLinkedImageWrapperStyle({})).toMatchObject({
      display: "inline-block",
      lineHeight: 0,
      verticalAlign: "middle"
    });
  });
});
