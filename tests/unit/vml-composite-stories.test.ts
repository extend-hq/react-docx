import { describe, expect, it } from "vitest";
import type { ImageRunNode, ParagraphNode } from "@extend-ai/react-docx-doc-model";
import { editVmlCompositeStory, mapVmlCompositeStories, type VmlStoryRenderer } from "../../packages/react-viewer/src/vml-composite-stories";

const encode = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const decode = (src: string) => decodeURIComponent(src.slice(src.indexOf(",") + 1));
const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const artwork = '<image x="10" y="18" width="45" height="45" href="data:image/png;base64,aGVsbG8="/><path d="M0 120L360 120" fill="none" stroke="#123456"/>';
const paragraph = (text: string): ParagraphNode => ({ type: "paragraph", children: [{ type: "text", text, style: { fontSizePt: 12, fontFamily: "Arial", bold: true } }] });
function fixture(values: string[][] = [["First"], ["Second"]]): ImageRunNode {
  const shapes = values.map((lines, index) => `<v:shape id="story-${index}" type="#_x0000_t202" style="left:${index ? 145 : 65};top:${index ? 67 : 12};width:190;height:40"><v:textbox><w:txbxContent>${lines.map((text) => `<w:p><w:r><w:rPr><w:b/><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr><w:t>${xml(text)}</w:t></w:r></w:p>`).join("")}</w:txbxContent></v:textbox></v:shape>`).join("");
  const texts = values.flatMap((lines, index) => lines.filter(Boolean).map((text, line) => `<text x="${index ? 145 : 65}" y="${(index ? 77 : 22) + line * 10}">${xml(text)}</text>`)).join("");
  return { type: "image", syntheticTextBox: true, widthPx: 360, heightPx: 140, sourceXml: `<w:pict><v:group style="width:270pt;height:105pt" coordorigin="0,0" coordsize="360,140"><v:shape><v:imagedata r:id="rId1"/></v:shape>${shapes}</v:group></w:pict>`, contentNodes: values.flatMap((lines) => lines.map(paragraph)), src: encode(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="140" viewBox="0 0 360 140">${artwork}${texts}</svg>`), data: new Uint8Array([1, 2]), partName: "word/media/image.svg", contentType: "image/svg+xml" };
}
const render: VmlStoryRenderer = (image) => {
  const text = (image.contentNodes as ParagraphNode[]).map((p) => p.children.map((r) => r.type === "text" ? r.text : "").join(""));
  return encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${image.widthPx}" height="${image.heightPx}" viewBox="0 0 ${image.widthPx} ${image.heightPx}">${text.map((t, i) => `<text y="${Math.min(10 + i * 5, image.heightPx!)}"><tspan x="0">${xml(t)}</tspan></text>`).join("")}</svg>`);
};

describe("VML composite story editing", () => {
  it("maps independent stories and exposes an exact artwork-only layer", () => {
    const image = fixture();
    const mapping = mapVmlCompositeStories(image)!;
    expect(mapping.stories.map((s) => s.text)).toEqual(["First", "Second"]);
    expect(mapping.stories.map((s) => s.editable)).toEqual([true, true]);
    expect(mapping.overlaySafe).toBe(true);
    expect(mapping.stories[1].framePx).toEqual({ x: 145, y: 67, width: 190, height: 40 });
    expect(decode(mapping.artworkSrc)).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="140" viewBox="0 0 360 140">${artwork}</svg>`);
  });
  it("changes one story with duplicate labels and keeps other source/artwork bytes", () => {
    const image = fixture([["Same"], ["Same"]]);
    const second = mapVmlCompositeStories(image)!.stories[1].sourceXml;
    const edited = editVmlCompositeStory(image, "Changed & <escaped>", render, 0)!;
    expect(edited).toBeDefined();
    expect(edited.sourceXml).toContain(second);
    expect(decode(edited.src!)).toContain(artwork);
    expect(edited.sourceXml).toContain("Changed &amp; &lt;escaped&gt;");
    expect(mapVmlCompositeStories(edited)!.stories.map((s) => s.text)).toEqual(["Changed & <escaped>", "Same"]);
    expect(edited.data).toBeUndefined();
    expect(edited.partName).toBeUndefined();
    expect(image.textBoxText).toBeUndefined();
  });
  it("preserves multiline blank paragraphs and can reedit a cleared story", () => {
    const first = editVmlCompositeStory(fixture(), "One\r\n\r\nThree\n", render)!;
    expect(first).toBeDefined();
    expect(first.textBoxText).toBe("One\n\nThree\n");
    expect(first.contentNodes).toHaveLength(5);
    expect(mapVmlCompositeStories(first)!.stories.map((s) => s.text)).toEqual(["One\n\nThree\n", ""]);
    const second = editVmlCompositeStory(first, "Restored", render, 1)!;
    expect(second.textBoxText).toBe("One\n\nThree\n\nRestored");
    expect(decode(second.src!)).toContain(artwork);
    expect(mapVmlCompositeStories(second)!.stories[1].text).toBe("Restored");
    const blank = editVmlCompositeStory(second, "\n", render)!;
    expect(blank.textBoxText).toBe("\n");
    expect(blank.contentNodes).toHaveLength(3);
  });
  it("supports UTF-8 base64 input and numeric entities", () => {
    const image = fixture([["café 😀"]]);
    image.sourceXml = image.sourceXml!.replace("café 😀", "caf&#233; &#x1F600;");
    image.src = `data:image/svg+xml;base64,${Buffer.from(decode(image.src!)).toString("base64")}`;
    expect(mapVmlCompositeStories(image)!.stories[0].text).toBe("café 😀");
    expect(editVmlCompositeStory(image, "é & +", render)!.textBoxText).toBe("é & +");
  });
  it("accounts for SVG viewport origins and ancestor transforms", () => {
    const image = fixture([["First"]]);
    image.src = encode(decode(image.src!).replace('viewBox="0 0 360 140"', 'viewBox="-10 -20 360 140"').replace('<text x="65" y="22">First</text>', '<g transform="translate(5 2) scale(2 2)"><path d="M0 0L1 1"/><text x="30" y="10">First</text></g>'));
    expect(mapVmlCompositeStories(image)!.stories[0].framePx).toEqual({ x: 75, y: 32, width: 190, height: 40 });
    const edited = editVmlCompositeStory(image, "Changed", render)!;
    expect(edited).toBeDefined();
    expect(decode(edited.src!)).toContain('x="30" y="5" width="95" height="20"');
    expect(decode(edited.src!)).toContain('<path d="M0 0L1 1"/>');
  });
  it("replaces nested text-only viewports at their original paint location", () => {
    const image = fixture([["", "", "First", "Last"]]);
    image.src = encode(decode(image.src!).replace(/<text[\s\S]*<\/text>/, '<svg x="65" y="12" width="190" height="40" viewBox="0 0 95 20" preserveAspectRatio="none"><svg width="95" height="20" viewBox="0 0 95 20"><text x="0" y="10">First</text><text x="0" y="18">Last</text></svg></svg>') .replace("</svg>", '</svg>'));
    const edited = editVmlCompositeStory(image, "New\nLine", render)!;
    expect(edited).toBeDefined();
    expect(decode(edited.src!)).toContain(artwork);
    expect(decode(edited.src!)).toContain('x="65" y="12" width="190" height="40"');
  });
  it("keeps bookmark boundaries and chooses the painted run style", () => {
    const image = fixture([["First"]]);
    image.sourceXml = image.sourceXml!.replace("<w:r>", '<w:bookmarkStart w:id="1" w:name="range"/><w:r><w:rPr><w:i/></w:rPr><w:t></w:t></w:r><w:r>').replace("</w:p>", '<w:bookmarkEnd w:id="1"/></w:p>');
    const p = image.contentNodes![0] as ParagraphNode;
    p.children.unshift({ type: "text", text: "", style: { italic: true } });
    const edited = editVmlCompositeStory(image, "Updated", render)!;
    expect(edited).toBeDefined();
    expect(edited.sourceXml).toMatch(/bookmarkStart[^>]*\/>[\s\S]*<w:t xml:space="preserve">Updated<\/w:t>[\s\S]*bookmarkEnd/);
    expect((edited.contentNodes![0] as ParagraphNode).children[0]).toMatchObject({ style: { bold: true, fontFamily: "Arial" } });
  });
  it("maps equal text paint across language metadata boundaries", () => {
    const image = fixture([["AlphaBeta"]]);
    const node = image.contentNodes![0] as ParagraphNode;
    const original = node.children[0];
    if (original.type !== "text") throw new Error("Expected text");
    node.children = [
      { ...original, text: "Alpha", style: { ...original.style, language: "en-US", languageEastAsia: "ja-JP", languageBidi: "ar-SA" } },
      { ...original, text: "Beta", style: { ...original.style, language: "fr-FR", languageEastAsia: "ko-KR", languageBidi: "he-IL" } },
    ];
    expect(mapVmlCompositeStories(image)!.stories[0].text).toBe("AlphaBeta");
    expect(editVmlCompositeStory(image, "Updated", render, 0)!.textBoxText).toBe("Updated");
    const second = node.children[1];
    if (second.type !== "text") throw new Error("Expected text");
    second.style = { ...second.style, italic: true };
    expect(mapVmlCompositeStories(image)).toBeUndefined();
    expect(editVmlCompositeStory(image, "Updated", render, 0)).toBeUndefined();
  });
  it("rejects inconsistent, reordered, rich, transformed, or truncated text mappings", () => {
    const changed = (mutate: (image: ImageRunNode) => void) => { const image = fixture(); mutate(image); return image; };
    const invalid = [
      changed((i) => { i.sourceXml = i.sourceXml!.replace("First", "Different"); }),
      changed((i) => { i.sourceXml = i.sourceXml!.replace('left:65;', 'z-index:2;left:65;'); }),
      changed((i) => { i.src = encode(decode(i.src!).replace('xmlns="http://www.w3.org/2000/svg"', 'xmlns="http://www.w3.org/2000/svg" transform="translate(1)"')); }),
      changed((i) => { (i.contentNodes![0] as ParagraphNode).children = [{ type: "text", text: "First", style: { allCaps: true } }]; }),
      changed((i) => { i.sourceXml = i.sourceXml!.replace("<w:t>First", '<w:fldChar w:fldCharType="begin"/><w:t>First'); }),
      changed((i) => { i.sourceXml = `<wrap>${i.sourceXml}${i.sourceXml}</wrap>`; }),
    ];
    for (const image of invalid) expect(mapVmlCompositeStories(image)).toBeUndefined();
    expect(editVmlCompositeStory(fixture(), "New\nLine", (image) => render({ ...image, contentNodes: image.contentNodes!.slice(0, 1) }))).toBeUndefined();
    expect(editVmlCompositeStory(fixture(), "New", render, 8)).toBeUndefined();
  });
  it("does not invent a paint position for initially empty stories", () => {
    const image = fixture([[""], ["Second"]]);
    expect(mapVmlCompositeStories(image)!.stories.map((s) => s.editable)).toEqual([false, true]);
    expect(editVmlCompositeStory(image, "New", render, 0)).toBeUndefined();
    expect(editVmlCompositeStory(image, "Changed", render, 1)).toBeDefined();
  });
  it("distinguishes exact SVG editing from safe HTML overlay paint ordering", () => {
    const image = fixture();
    image.src = encode(decode(image.src!).replace('<text x="145"', '<rect x="0" y="0" width="360" height="140" fill="red"/><text x="145"'));
    const mapping = mapVmlCompositeStories(image)!;
    expect(mapping).toBeDefined();
    expect(mapping.overlaySafe).toBe(false);
    const edited = editVmlCompositeStory(image, "Changed", render, 0)!;
    expect(edited).toBeDefined();
    expect(decode(edited.src!).indexOf('data-docx-vml-story="0"')).toBeLessThan(decode(edited.src!).indexOf('fill="red"'));
    expect(mapVmlCompositeStories(edited)!.overlaySafe).toBe(false);
  });
  it("rejects root letterboxing that does not share the mapped display coordinates", () => {
    const image = fixture();
    image.widthPx = 500;
    expect(mapVmlCompositeStories(image)).toBeUndefined();
    image.src = encode(decode(image.src!).replace('<svg xmlns=', '<svg preserveAspectRatio="none" xmlns='));
    expect(mapVmlCompositeStories(image)!.stories[0].framePx.width).toBeCloseTo(190 * 500 / 360);
  });
  it.each([
    ['fill="none"', true],
    ['fill="none" stroke="none"', true],
    ['fill="none" stroke="red"', false],
    ['fill="red" stroke="none"', false],
    ['fill="none" style="fill:red"', false],
    ['fill="none" style="stroke:red"', false],
    ['fill="none" stroke="none" style="stroke:inherit"', true],
  ])("keeps overlay paint ordering for rectangle attributes %s", (attributes, expected) => {
    const image = fixture();
    image.src = encode(decode(image.src!).replace('<text x="145"', `<rect x="0" y="0" width="360" height="140" ${attributes}/><text x="145"`));
    expect(mapVmlCompositeStories(image)!.overlaySafe).toBe(expected);
  });
  it("keeps inherited rectangle strokes in the paint ordering", () => {
    const image = fixture();
    const svg = decode(image.src!);
    image.src = encode(svg.replace('<text x="145"', '<g stroke="red"><rect width="360" height="140" fill="none"/></g><text x="145"'));
    expect(mapVmlCompositeStories(image)!.overlaySafe).toBe(false);
    image.src = encode(svg.replace('<text x="145"', '<g stroke="red"><rect width="360" height="140" fill="none" stroke="none"/></g><text x="145"'));
    expect(mapVmlCompositeStories(image)!.overlaySafe).toBe(true);
  });
  it("preserves leading, repeated, and trailing spaces in generated SVG text", () => {
    const text = "  Leading  repeated  trailing  ";
    const edited = editVmlCompositeStory(fixture(), text, render, 0)!;
    expect(edited.textBoxText).toBe(`${text}\nSecond`);
    expect(decode(edited.src!)).toContain('overflow="visible" xml:space="preserve"');
    expect(mapVmlCompositeStories(edited)!.stories[0].text).toBe(text);
    expect(editVmlCompositeStory(edited, text, render, 0)).toBeDefined();
  });
  it.each([
    '<w:bookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/><w:bookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1">text</w:bookmarkStart><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1"><w:r/></w:bookmarkStart><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1"><!--text--></w:bookmarkStart><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1">&#xFEFF;</w:bookmarkStart><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:ID="1"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart id="1"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id=""/><w:bookmarkEnd w:id=""/>',
    '<w:bookmarkStart w:id="1" ext:value="extra" xmlns:ext="urn:extension"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1" xmlns:w="urn:other"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1" __proto__="extra"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="&#X31;"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1">&#xB;</w:bookmarkStart><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1">\u000b</w:bookmarkStart><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="&constructor;"/><w:bookmarkEnd w:id="&constructor;"/>',
    '<w:bookmarkStart w:id="1" xmlns:xml="urn:other"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1" xmlns:q="http://www.w3.org/XML/1998/namespace"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1" xmlns:q="http://www.w3.org/2000/xmlns/"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart\u00a0w:id="1"/><w:bookmarkEnd w:id="1"/>',
    '<w:bookmarkStart w:id="1"><?keep\u00a0value?></w:bookmarkStart><w:bookmarkEnd w:id="1"/>',
    '<w:BookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/>',
    '<q:bookmarkStart q:id="1" xmlns:q="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/><w:bookmarkEnd w:id="1"/>',
  ])("rejects noncanonical or nonempty bookmark markers: %s", (markers) => {
    const image = fixture([["First"]]);
    image.sourceXml = image.sourceXml!.replace("<w:p>", `<w:p>${markers}`);
    expect(mapVmlCompositeStories(image)).toBeUndefined();
    expect(editVmlCompositeStory(image, "Changed", render)).toBeUndefined();
  });
  it("rejects reused bookmark IDs across paragraphs and stories", () => {
    const markers = '<w:bookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/>';
    for (const values of [[["First", "Last"]], [["First"], ["Second"]]]) {
      const image = fixture(values);
      image.sourceXml = image.sourceXml!.replaceAll("<w:p>", `<w:p>${markers}`);
      expect(mapVmlCompositeStories(image)).toBeUndefined();
    }
    const image = fixture([["First"], ["Second"]]);
    image.sourceXml = image.sourceXml!.replaceAll("<w:p>", `<w:p>${markers}`).replace('w:id="1"', 'w:id="&#49;"');
    expect(mapVmlCompositeStories(image)).toBeUndefined();
  });
  it.each(["W:name", "q:id", "name"])("rejects attributes depending on noncanonical story namespace aliases: %s", (attribute) => {
    const image = fixture([["First"]]);
    image.sourceXml = image.sourceXml!.replace("<w:txbxContent>", '<w:txbxContent xmlns:W="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:q="http://schemas.openxmlformats.org/wordprocessingml/2006/main">').replace("<w:p>", `<w:p><w:bookmarkStart w:id="1" ${attribute}="value"/><w:bookmarkEnd w:id="1"/>`);
    expect(mapVmlCompositeStories(image)).toBeUndefined();
  });
  it("rejects invalid inherited bindings and markers nested beneath properties", () => {
    const image = fixture([["First"]]);
    image.sourceXml = image.sourceXml!.replace("<w:p>", '<w:p><w:bookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/>');
    image.sourceXml = image.sourceXml.replace("<w:txbxContent>", '<w:txbxContent xmlns:w="urn:other">');
    expect(mapVmlCompositeStories(image)).toBeUndefined();
    const nested = fixture([["First"]]);
    nested.sourceXml = nested.sourceXml!.replace("<w:rPr>", '<w:rPr><w:bookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/>');
    expect(mapVmlCompositeStories(nested)).toBeUndefined();
  });
  it("requires Word namespace bindings for stories even when descendants rebind or omit bookmarks", () => {
    const image = fixture([["First"]]);
    image.sourceXml = image.sourceXml!.replace("<w:txbxContent>", '<w:txbxContent xmlns:w="urn:other">');
    expect(mapVmlCompositeStories(image)).toBeUndefined();
    image.sourceXml = image.sourceXml.replace("<w:p>", '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:bookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/>');
    expect(mapVmlCompositeStories(image)).toBeUndefined();
    const child = fixture([["First"]]);
    child.sourceXml = child.sourceXml!.replace("<w:rPr>", '<w:rPr xmlns:w="urn:other">');
    expect(mapVmlCompositeStories(child)).toBeUndefined();
  });
  it("preserves canonical marker bytes, Unicode attributes, whitespace and processing instructions", () => {
    const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const start = `<w:bookmarkStart xmlns:w="${namespace}" w:id="1" w:name="é&amp;😀" w:colFirst="0" w:名="value"> \t<!--  --><![CDATA[ \n]]><?保持 value?>&#x85;</w:bookmarkStart>`;
    const end = '<w:bookmarkEnd w:id="1"> \n</w:bookmarkEnd>';
    const image = fixture([["First"]]);
    image.sourceXml = image.sourceXml!.replace("<w:txbxContent>", `<w:txbxContent xmlns:w="${namespace}">`).replace("<w:p>", `<w:p>${start}`).replace("</w:p>", `${end}</w:p>`);
    const edited = editVmlCompositeStory(image, "Changed", render)!;
    expect(edited).toBeDefined();
    expect(edited.sourceXml).toContain(start);
    expect(edited.sourceXml).toContain(end);
    expect(mapVmlCompositeStories(edited)).toBeDefined();
  });
  it("uses normalized XML attribute strings without numeric ID coercion", () => {
    const image = fixture([["First"], ["Second"]]);
    image.sourceXml = image.sourceXml!.replace("<w:p>", '<w:p><w:bookmarkStart w:id="01"/><w:bookmarkEnd w:id="01"/>').replace('<w:p><w:r><w:rPr><w:b/>', '<w:p><w:bookmarkStart w:id="1"/><w:bookmarkEnd w:id="1"/><w:r><w:rPr><w:b/>');
    expect(mapVmlCompositeStories(image)).toBeDefined();
    const normalized = fixture([["First"]]);
    normalized.sourceXml = normalized.sourceXml!.replace("<w:p>", '<w:p><w:bookmarkStart w:id="one\t two"/><w:bookmarkEnd w:id="one  two"/>');
    expect(editVmlCompositeStory(normalized, "Changed", render)).toBeDefined();
  });
  it("preserves crossing bookmark pairs at paragraph boundaries", () => {
    const before = '<w:bookmarkStart w:id="1"/><w:bookmarkStart w:id="2"/>';
    const after = '<w:bookmarkEnd w:id="1"/><w:bookmarkEnd w:id="2"/>';
    const image = fixture([["First"]]);
    image.sourceXml = image.sourceXml!.replace("<w:p>", `<w:p>${before}`).replace("</w:p>", `${after}</w:p>`);
    const edited = editVmlCompositeStory(image, "Changed", render)!;
    expect(edited).toBeDefined();
    expect(edited.sourceXml).toContain(before);
    expect(edited.sourceXml).toContain(after);
    expect(mapVmlCompositeStories(edited)).toBeDefined();
  });
});


describe("VML composite paint allocation", () => {
  function expanded(): ImageRunNode {
    const image = fixture();
    image.paintBounds = { xPx: -0.5, yPx: 0, widthPx: 361, heightPx: 140, layoutWidthPx: 360, layoutHeightPx: 140 };
    image.src = encode(decode(image.src!).replace('width="360" height="140" viewBox="0 0 360 140"', 'width="361" height="140" viewBox="-0.5 0 361 140"'));
    return image;
  }
  it("maps source story coordinates without squeezing expanded paint", () => {
    const image = expanded();
    const mapping = mapVmlCompositeStories(image)!;
    expect(mapping).toBeDefined();
    expect(mapping.paintBounds).toEqual({ xPx: -0.5, yPx: 0, widthPx: 361, heightPx: 140 });
    expect(mapping.stories[0].framePx).toEqual({ x: 65, y: 12, width: 190, height: 40 });
    expect(mapping.stories[1].framePx).toEqual({ x: 145, y: 67, width: 190, height: 40 });
  });
  it("scales the viewport and story frames from the current layout", () => {
    const image = expanded(); image.widthPx = 720; image.heightPx = 280;
    const mapping = mapVmlCompositeStories(image)!;
    expect(mapping.paintBounds).toEqual({ xPx: -1, yPx: 0, widthPx: 722, heightPx: 280 });
    expect(mapping.stories[0].framePx).toEqual({ x: 130, y: 24, width: 380, height: 80 });
  });
  it("clears composite paint metadata only on the story renderer clone", () => {
    const image = expanded();
    const edited = editVmlCompositeStory(image, "Updated", (story) => {
      expect(story.paintBounds).toBeUndefined();
      expect(story.widthPx).toBe(190);
      return render(story);
    }, 0)!;
    expect(edited).toBeDefined();
    expect(edited.paintBounds).toEqual(image.paintBounds);
    expect(mapVmlCompositeStories(edited)?.stories[0].framePx.x).toBe(65);
  });
  it("retains fractional unit coordinates without multiply-divide drift", () => {
    const image = fixture();
    image.widthPx = 719.9;
    image.paintBounds = { xPx: -0.1, yPx: 0, widthPx: 720.1, heightPx: 140, layoutWidthPx: 719.9, layoutHeightPx: 140 };
    image.sourceXml = image.sourceXml!.replace("width:270pt", "width:719.9px").replace('coordsize="360,140"', 'coordsize="719.9,140"');
    image.src = encode(decode(image.src!).replace('width="360" height="140" viewBox="0 0 360 140"', 'width="720.1" height="140" viewBox="-0.1 0 720.1 140" preserveAspectRatio="none"'));
    expect(-0.1 * 719.9 / 719.9).not.toBe(-0.1);
    expect(mapVmlCompositeStories(image)?.paintBounds).toEqual({ xPx: -0.1, yPx: 0, widthPx: 720.1, heightPx: 140 });
  });
  it("keeps nonunit source-coordinate mapping aligned with the parser", () => {
    const image = fixture();
    image.paintBounds = { xPx: -0.25, yPx: 0, widthPx: 360.5, heightPx: 140, layoutWidthPx: 360, layoutHeightPx: 140 };
    image.sourceXml = image.sourceXml!.replace('coordsize="360,140"', 'coordsize="720,140"');
    image.src = encode(decode(image.src!).replace('width="360" height="140" viewBox="0 0 360 140"', 'width="360.5" height="140" viewBox="-0.5 0 721 140" preserveAspectRatio="none"'));
    expect(mapVmlCompositeStories(image)?.stories[0].framePx).toEqual({ x: 32.5, y: 12, width: 95, height: 40 });
  });
  it.each(["xPx", "widthPx", "layoutWidthPx"] as const)("rejects incoherent %s metadata without changing source", (field) => {
    const image = expanded(); image.paintBounds![field] += 1;
    expect(mapVmlCompositeStories(image)).toBeUndefined();
  });
});
