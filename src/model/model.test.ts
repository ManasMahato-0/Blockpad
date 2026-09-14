import { describe, expect, it } from "vitest";
import { concat, equals, normalize, slice, toPlain } from "./richText";
import {
  createBlock,
  indentBlock,
  outdentBlock,
  pressBackspaceAtStart,
  pressEnter,
  getBlock,
} from "./document";
import { matchMarkdownShortcut } from "../editor/commands";
import type { Doc } from "./types";

function docOf(...blocks: ReturnType<typeof createBlock>[]): Doc {
  return { title: "", blocks };
}

describe("richText", () => {
  it("keeps formatting attached to the right characters when slicing", () => {
    const rich = [{ text: "hello " }, { text: "world", bold: true }];
    expect(slice(rich, 0, 6)).toEqual([{ text: "hello " }]);
    expect(slice(rich, 6, 11)).toEqual([{ text: "world", bold: true }]);
  });

  it("slices through the middle of a bold run without losing the bold", () => {
    const rich = [{ text: "hello " }, { text: "world", bold: true }];
    expect(slice(rich, 3, 9)).toEqual([{ text: "lo " }, { text: "wor", bold: true }]);
  });

  it("merges neighbouring spans that have identical formatting", () => {
    expect(concat([{ text: "hel" }], [{ text: "lo" }])).toEqual([{ text: "hello" }]);
  });

  it("keeps differently formatted neighbours apart", () => {
    const joined = concat([{ text: "hi " }], [{ text: "there", bold: true }]);
    expect(joined).toHaveLength(2);
  });

  it("treats identical text as equal, and differing formatting as not", () => {
    expect(equals([{ text: "a" }], [{ text: "a" }])).toBe(true);
    expect(equals([{ text: "a" }], [{ text: "b" }])).toBe(false);
    expect(equals([{ text: "a" }], [{ text: "a", bold: true }])).toBe(false);
    expect(equals([{ text: "a" }], [{ text: "a" }, { text: "b" }])).toBe(false);
  });

  it("drops empty spans", () => {
    expect(normalize([{ text: "" }, { text: "a" }])).toEqual([{ text: "a" }]);
  });
});

describe("pressEnter", () => {
  it("moves text after the cursor into a new block", () => {
    const block = createBlock("paragraph", [{ text: "hello world" }]);
    const { doc, caret } = pressEnter(docOf(block), block.id, 5);

    expect(doc.blocks).toHaveLength(2);
    expect(toPlain(doc.blocks[0].content)).toBe("hello");
    expect(toPlain(doc.blocks[1].content)).toBe(" world");
    expect(caret.blockId).toBe(doc.blocks[1].id);
    expect(caret.offset).toBe(0);
  });

  it("exits the list when pressed on an empty bullet", () => {
    const block = createBlock("bulleted", []);
    const { doc } = pressEnter(docOf(block), block.id, 0);

    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe("paragraph");
  });

  it("continues the list when the bullet has text", () => {
    const block = createBlock("bulleted", [{ text: "milk" }]);
    const { doc } = pressEnter(docOf(block), block.id, 4);

    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[1].type).toBe("bulleted");
  });

  it("starts a paragraph rather than a second heading", () => {
    const block = createBlock("heading1", [{ text: "Title" }]);
    const { doc } = pressEnter(docOf(block), block.id, 5);

    expect(doc.blocks[1].type).toBe("paragraph");
  });
});

describe("pressBackspaceAtStart", () => {
  it("demotes a heading to a paragraph instead of merging upward", () => {
    const first = createBlock("paragraph", [{ text: "above" }]);
    const heading = createBlock("heading1", [{ text: "Title" }]);
    const result = pressBackspaceAtStart(docOf(first, heading), heading.id)!;

    expect(result.doc.blocks).toHaveLength(2);
    expect(getBlock(result.doc, heading.id)!.type).toBe("paragraph");
  });

  it("merges into the block above with the caret at the join", () => {
    const first = createBlock("paragraph", [{ text: "hello" }]);
    const second = createBlock("paragraph", [{ text: " world" }]);
    const result = pressBackspaceAtStart(docOf(first, second), second.id)!;

    expect(result.doc.blocks).toHaveLength(1);
    expect(toPlain(result.doc.blocks[0].content)).toBe("hello world");
    expect(result.caret).toEqual({ blockId: first.id, offset: 5 });
  });

  it("does nothing in the very first block", () => {
    const only = createBlock("paragraph", [{ text: "hi" }]);
    expect(pressBackspaceAtStart(docOf(only), only.id)).toBeNull();
  });

  it("deletes an image above rather than the text being typed", () => {
    const image = createBlock("image", []);
    const text = createBlock("paragraph", [{ text: "caption" }]);
    const result = pressBackspaceAtStart(docOf(image, text), text.id)!;

    expect(result.doc.blocks).toHaveLength(1);
    expect(toPlain(result.doc.blocks[0].content)).toBe("caption");
  });
});

describe("indenting", () => {
  it("indents a block one level under the one above", () => {
    const first = createBlock("bulleted", [{ text: "top" }]);
    const second = createBlock("bulleted", [{ text: "child" }]);
    const doc = indentBlock(docOf(first, second), second.id);

    expect(getBlock(doc, second.id)!.indent).toBe(1);
  });

  it("refuses to indent more than one level past the block above", () => {
    const first = createBlock("bulleted", [{ text: "top" }]);
    const second = createBlock("bulleted", [{ text: "child" }]);
    let doc = docOf(first, second);
    doc = indentBlock(doc, second.id);
    doc = indentBlock(doc, second.id);
    doc = indentBlock(doc, second.id);

    expect(getBlock(doc, second.id)!.indent).toBe(1);
  });

  it("never indents the very first block", () => {
    const only = createBlock("bulleted", [{ text: "top" }]);
    const doc = indentBlock(docOf(only), only.id);

    expect(getBlock(doc, only.id)!.indent ?? 0).toBe(0);
  });

  it("outdents but stops at zero", () => {
    const first = createBlock("bulleted", [{ text: "top" }]);
    const second = createBlock("bulleted", [{ text: "child" }]);
    let doc = indentBlock(docOf(first, second), second.id);
    doc = outdentBlock(doc, second.id);
    doc = outdentBlock(doc, second.id);

    expect(getBlock(doc, second.id)!.indent).toBe(0);
  });
});

describe("markdown shortcuts", () => {
  it("matches a plain trigger with no indent", () => {
    expect(matchMarkdownShortcut("-")).toEqual({ type: "bulleted", triggerLength: 1, indent: 0 });
  });

  it("reads leading spaces as indentation, two spaces per level", () => {
    expect(matchMarkdownShortcut("  -")).toEqual({ type: "bulleted", triggerLength: 3, indent: 1 });
    expect(matchMarkdownShortcut("    1.")).toEqual({ type: "numbered", triggerLength: 6, indent: 2 });
  });

  it("ignores text that merely contains a trigger", () => {
    expect(matchMarkdownShortcut("a -")).toBeNull();
    expect(matchMarkdownShortcut("hello")).toBeNull();
  });
});
