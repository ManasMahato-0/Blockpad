import { describe, expect, it } from "vitest";
import { findBacklinks, insertPageLink, pageLinkAt, syncLinkTitles } from "./links";
import { normalize, toPlain } from "./richText";
import type { Doc, RichText } from "./types";

const docWith = (content: RichText): Doc => ({ title: "", blocks: [{ id: "b", type: "paragraph", content }] });

describe("insertPageLink", () => {
  it("replaces the typed [[query with the link and a space", () => {
    const { content, caret } = insertPageLink([{ text: "See [[wee now" }], 4, 5, { id: "w", title: "Weekly review" });
    expect(content).toEqual([
      { text: "See " },
      { text: "Weekly review", pageLink: "w" },
      { text: "  now" },
    ]);
    expect(caret).toBe(4 + "Weekly review".length + 1);
  });

  it("labels an untitled page", () => {
    const { content } = insertPageLink([{ text: "[[" }], 0, 2, { id: "u", title: "  " });
    expect(content[0]).toEqual({ text: "Untitled", pageLink: "u" });
  });
});

describe("syncLinkTitles", () => {
  it("renames links to match the page's current title", () => {
    const doc = docWith([{ text: "Old name", pageLink: "p" }]);
    const next = syncLinkTitles(doc, [{ id: "p", title: "New name" }]);
    expect(next.blocks[0].content).toEqual([{ text: "New name", pageLink: "p" }]);
  });

  it("turns a link to a deleted page into plain text", () => {
    const doc = docWith([{ text: "see " }, { text: "Gone", pageLink: "missing" }]);
    expect(syncLinkTitles(doc, []).blocks[0].content).toEqual([{ text: "see Gone" }]);
  });

  it("returns the same document when every title is current", () => {
    const doc = docWith([{ text: "Same", pageLink: "p" }]);
    expect(syncLinkTitles(doc, [{ id: "p", title: "Same" }])).toBe(doc);
  });
});

describe("page link spans", () => {
  it("never merge with a neighbouring link to the same page", () => {
    const rich = normalize([
      { text: "A", pageLink: "p" },
      { text: "A", pageLink: "p" },
    ]);
    expect(rich).toHaveLength(2);
  });

  it("are found from either side of the caret", () => {
    const rich: RichText = [{ text: "go " }, { text: "Plan", pageLink: "p" }, { text: " now" }];
    expect(pageLinkAt(rich, 3)).toBe("p");
    expect(pageLinkAt(rich, 7)).toBe("p");
    expect(pageLinkAt(rich, 2)).toBeUndefined();
    expect(pageLinkAt(rich, 8)).toBeUndefined();
  });
});

describe("findBacklinks", () => {
  it("lists blocks on other pages that link here, with the link's position", () => {
    const pages = [
      { id: "target", title: "Target", doc: docWith([{ text: "Self", pageLink: "target" }]) },
      { id: "a", title: "A", doc: docWith([{ text: "read " }, { text: "Target", pageLink: "target" }]) },
      { id: "b", title: "B", doc: docWith([{ text: "nothing here" }]) },
    ];
    const links = findBacklinks(pages, "target");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ pageId: "a", blockId: "b", offset: 5 });
    expect(toPlain(pages[1].doc.blocks[0].content)).toBe(links[0].text);
  });
});
