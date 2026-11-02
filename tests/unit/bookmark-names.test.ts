import { describe, expect, it } from "vitest";

import { bookmarkNamesFromXml, bookmarkTargetForName } from "../../packages/react-viewer/src/bookmark-names";

describe("bookmark name decoding", () => {
  it.each([
    ["plain_é", "plain_é"],
    ["named_&amp;_&lt;_&gt;_&quot;_&apos;", `named_&_<_>_"_'`],
    ["numeric_&#38;_&#x1F600;", "numeric_&_😀"],
    ["literal_&amp;amp;_&#38;lt;_&amp;#38;", "literal_&amp;_&lt;_&#38;"],
    ["&#32;A&#32;", " A "],
  ])("matches the decoded hyperlink anchor for %s", (encoded, expected) => {
    expect(bookmarkNamesFromXml(`<w:p><w:bookmarkStart w:id="0" w:name="${encoded}"/></w:p>`)).toEqual([expected]);
  });

  it("preserves undecodable values without throwing", () => {
    const value = "invalid_&#0;_&#xD800;_&#x110000;_&#99999999999999999999999;_&unknown;";
    expect(bookmarkNamesFromXml(`<w:bookmarkStart w:name="${value}"/>`)).toEqual([value]);
  });

  it("deduplicates decoded names and keeps hidden targets excluded", () => {
    expect(bookmarkNamesFromXml(
      '<w:p><w:bookmarkStart w:name="  A&amp;B  "/><w:bookmarkStart w:name="A&#38;B"/><w:bookmarkStart w:name="_GoBack"/><w:bookmarkStart w:name="&#95;GoBack"/><w:bookmarkStart w:name="   "/></w:p>'
    )).toEqual(["A&B"]);
    expect(bookmarkNamesFromXml("")).toEqual([]);
  });

  it("prefers an exact decoded target before the trimmed fallback", () => {
    const names = bookmarkNamesFromXml('<w:p><w:bookmarkStart w:name=" A "/><w:bookmarkStart w:name="&#32;A&#32;"/></w:p>');
    const targets = new Map(names.map((name, index) => [name, index]));
    expect(names).toEqual(["A", " A "]);
    expect(bookmarkTargetForName(targets, " A ")).toBe(1);
    expect(bookmarkTargetForName(targets, "A")).toBe(0);
    expect(bookmarkTargetForName(targets, "  A  ")).toBe(0);
    expect(bookmarkTargetForName(targets, "missing")).toBeUndefined();
  });
});
