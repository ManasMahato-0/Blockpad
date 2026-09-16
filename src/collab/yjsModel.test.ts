import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Block, Doc } from "../model/types";
import { applyDocToY, keyForText, sharedTypes, textForKey, transformOffset, yToDoc } from "./yjsModel";

const block = (id: string, text: string, extra: Partial<Block> = {}): Block => ({
  id,
  type: "paragraph",
  content: text ? [{ text }] : [],
  ...extra,
});

const page: Doc = {
  title: "Plan",
  blocks: [
    block("b1", "hello"),
    {
      id: "b2",
      type: "todo",
      checked: true,
      indent: 1,
      content: [{ text: "see " }, { text: "Weekly", pageLink: "w" }, { text: " and " }, { text: "docs", link: "https://example.com/", bold: true }],
    },
    { id: "b3", type: "image", content: [], src: "https://example.com/a.png", alt: "A" },
  ],
};

/** Two replicas that start from the same shared page. */
function replicas(doc: Doc = page) {
  const a = new Y.Doc();
  applyDocToY(a, doc);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b };
}

/** Exchanges everything each side has that the other doesn't. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

const withText = (doc: Doc, id: string, content: Block["content"]): Doc => ({
  ...doc,
  blocks: doc.blocks.map((b) => (b.id === id ? { ...b, content } : b)),
});

describe("page ↔ Yjs", () => {
  it("round-trips every field, mark and link", () => {
    const { b } = replicas();
    expect(yToDoc(b)).toEqual(page);
  });

  it("changes only the typed characters, leaving other blocks alone", () => {
    const ydoc = new Y.Doc();
    applyDocToY(ydoc, page);
    const untouchedBlock = sharedTypes(ydoc).blocks.get(1);
    const updates: Uint8Array[] = [];
    ydoc.on("update", (update: Uint8Array) => updates.push(update));

    const typed = withText(page, "b1", [{ text: "hello world" }]);
    applyDocToY(ydoc, typed, page);

    expect(yToDoc(ydoc)).toEqual(typed);
    expect(sharedTypes(ydoc).blocks.get(1)).toBe(untouchedBlock);
    // one small update, not a rewrite of the page
    expect(updates).toHaveLength(1);
    expect(updates[0].byteLength).toBeLessThan(40);
  });

  it("keeps both people's typing in the same line", () => {
    const { a, b } = replicas();
    applyDocToY(a, withText(page, "b1", [{ text: "hello world" }]));
    applyDocToY(b, withText(page, "b1", [{ text: "oh hello" }]));
    sync(a, b);
    expect(yToDoc(a)).toEqual(yToDoc(b));
    expect(yToDoc(a).blocks[0].content).toEqual([{ text: "oh hello world" }]);
  });

  it("keeps typing inside a range someone else is making bold", () => {
    const { a, b } = replicas();
    applyDocToY(a, withText(page, "b1", [{ text: "hello", bold: true }]));
    applyDocToY(b, withText(page, "b1", [{ text: "helXlo" }]));
    sync(a, b);
    expect(yToDoc(a)).toEqual(yToDoc(b));
    // the bold survives and so does the X, rather than one wiping the other
    expect(yToDoc(a).blocks[0].content).toEqual([{ text: "helXlo", bold: true }]);
  });

  it("merges a deleted block with an edit elsewhere", () => {
    const { a, b } = replicas();
    applyDocToY(a, { ...page, blocks: page.blocks.filter((x) => x.id !== "b3") });
    applyDocToY(b, withText(page, "b1", [{ text: "hello there" }]));
    sync(a, b);
    const merged = yToDoc(a);
    expect(merged).toEqual(yToDoc(b));
    expect(merged.blocks.map((x) => x.id)).toEqual(["b1", "b2"]);
    expect(merged.blocks[0].content).toEqual([{ text: "hello there" }]);
  });

  it("moves a block with its content, fields and marks", () => {
    const ydoc = new Y.Doc();
    applyDocToY(ydoc, page);
    const moved: Doc = { ...page, blocks: [page.blocks[1], page.blocks[0], page.blocks[2]] };
    applyDocToY(ydoc, moved, page);
    expect(yToDoc(ydoc)).toEqual(moved);
  });

  it("updates the title with a minimal change", () => {
    const { a, b } = replicas();
    applyDocToY(a, { ...page, title: "Plan A" });
    applyDocToY(b, { ...page, title: "The Plan" });
    sync(a, b);
    expect(yToDoc(a).title).toBe("The Plan A");
  });
});

describe("shared cursors", () => {
  it("find a line's text and back", () => {
    const ydoc = new Y.Doc();
    applyDocToY(ydoc, page);
    const text = textForKey(ydoc, "b1")!;
    expect(text.toString()).toBe("hello");
    expect(keyForText(ydoc, text)).toBe("b1");
    expect(keyForText(ydoc, textForKey(ydoc, "title")!)).toBe("title");
    expect(textForKey(ydoc, "missing")).toBeNull();
  });

  it("stay on the same character while someone types before it", () => {
    const { a, b } = replicas();
    // B's caret sits between "hel" and "lo"
    const position = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(textForKey(b, "b1")!, 3));
    applyDocToY(a, withText(page, "b1", [{ text: "oh hello" }]));
    sync(a, b);
    const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(position), a);
    expect(absolute?.index).toBe(6);
    expect(keyForText(a, absolute!.type as Y.Text)).toBe("b1");
  });
});

describe("transformOffset", () => {
  it("moves the caret by text inserted before it", () => {
    expect(transformOffset(5, [{ retain: 2 }, { insert: "abc" }])).toBe(8);
  });

  it("leaves it alone for changes after it, or text inserted right at it", () => {
    expect(transformOffset(5, [{ retain: 7 }, { insert: "abc" }])).toBe(5);
    expect(transformOffset(5, [{ retain: 5 }, { insert: "abc" }])).toBe(5);
  });

  it("pulls it back by deleted text, stopping at the deletion's start", () => {
    expect(transformOffset(5, [{ delete: 2 }])).toBe(3);
    expect(transformOffset(5, [{ retain: 3 }, { delete: 10 }])).toBe(3);
  });
});
