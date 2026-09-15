import { describe, expect, it } from "vitest";
import { docToMarkdown, markdownToDoc } from "./markdown";
import type { Block, Doc } from "./types";

const b = (type: Block["type"], content: Block["content"], extra: Partial<Block> = {}): Block => ({
  id: Math.random().toString(36).slice(2),
  type,
  content,
  ...extra,
});

/** Blocks without their random ids, for comparing. */
const shape = (doc: Doc) => doc.blocks.map(({ id: _id, ...rest }) => rest);

const pages = [
  { id: "weekly", title: "Weekly review" },
  { id: "launch", title: "Product launch plan" },
];

const richDoc: Doc = {
  title: "Product launch plan",
  blocks: [
    b("paragraph", [
      { text: "Ship " },
      { text: "v2.0", code: true },
      { text: " on " },
      { text: "Friday", bold: true },
      { text: ", " },
      { text: "maybe", italic: true },
      { text: " — see " },
      { text: "the guide", link: "https://example.com/guide" },
      { text: " and " },
      { text: "Weekly review", pageLink: "weekly" },
    ]),
    b("heading2", [{ text: "Goals" }]),
    b("numbered", [{ text: "First" }]),
    b("bulleted", [{ text: "Nested under a number" }], { indent: 1 }),
    b("numbered", [{ text: "Second" }]),
    b("todo", [{ text: "Done task" }], { checked: true }),
    b("todo", [{ text: "Open task" }], { indent: 1, checked: false }),
    b("quote", [{ text: "Ship small." }]),
    b("divider", []),
    b("paragraph", [{ text: "# not a heading, *not italic*, snake_case_name, 1. not a list" }]),
  ],
};

describe("docToMarkdown", () => {
  it("writes blocks, marks and links as Markdown", () => {
    const md = docToMarkdown(richDoc, pages);
    expect(md).toContain("# Product launch plan\n");
    expect(md).toContain("Ship `v2.0` on **Friday**, *maybe* — see [the guide](https://example.com/guide) and [[Weekly review]]");
    expect(md).toContain("## Goals");
    // the nested bullet is indented to the text of "1. ", which is three spaces
    expect(md).toContain("1. First\n   - Nested under a number\n2. Second\n- [x] Done task\n  - [ ] Open task");
    expect(md).toContain("> Ship small.");
    expect(md).toContain("\n---\n");
    expect(md).toContain("\\# not a heading, \\*not italic\\*, snake\\_case\\_name, 1. not a list");
  });

  it("uses a page's current title for links to it", () => {
    const md = docToMarkdown({ title: "", blocks: [b("paragraph", [{ text: "Old", pageLink: "weekly" }])] }, pages);
    expect(md.trim()).toBe("[[Weekly review]]");
  });

  it("keeps spaces outside the formatting markers", () => {
    const md = docToMarkdown({ title: "", blocks: [b("paragraph", [{ text: "a" }, { text: " bold ", bold: true }, { text: "b" }])] });
    expect(md.trim()).toBe("a **bold** b");
  });
});

describe("markdownToDoc", () => {
  it("reads the first # line as the title", () => {
    const doc = markdownToDoc("# My notes\n\nHello");
    expect(doc.title).toBe("My notes");
    expect(shape(doc)).toEqual([{ type: "paragraph", content: [{ text: "Hello" }] }]);
  });

  it("nests lists by indentation of any width", () => {
    const doc = markdownToDoc("- a\n    - b\n        - c\n    - d\n- e");
    expect(doc.blocks.map((block) => [block.content[0].text, block.indent])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 1],
      ["e", 0],
    ]);
  });

  it("joins wrapped lines into one paragraph or quote", () => {
    const doc = markdownToDoc("one\ntwo\n\n> three\n> four");
    expect(shape(doc)).toEqual([
      { type: "paragraph", content: [{ text: "one two" }] },
      { type: "quote", content: [{ text: "three four" }] },
    ]);
  });

  it("turns code fences into lines of inline code", () => {
    const doc = markdownToDoc("```js\nconst a = 1;\nlet b;\n```");
    expect(shape(doc)).toEqual([
      { type: "paragraph", content: [{ text: "const a = 1;", code: true }] },
      { type: "paragraph", content: [{ text: "let b;", code: true }] },
    ]);
  });

  it("refuses unsafe link and image addresses", () => {
    const doc = markdownToDoc("[click](javascript:alert(1))\n\n![x](javascript:alert(1))");
    expect(doc.blocks[0].content.some((span) => span.link)).toBe(false);
    expect(doc.blocks.some((block) => block.type === "image")).toBe(false);
  });

  it("keeps safe images", () => {
    const [image] = markdownToDoc("![Chart](https://example.com/c.png)").blocks;
    expect(image).toMatchObject({ type: "image", src: "https://example.com/c.png", alt: "Chart" });
  });

  it("links [[Title]] only when that page exists", () => {
    const doc = markdownToDoc("See [[weekly REVIEW]] and [[Nowhere]]", pages);
    expect(doc.blocks[0].content).toEqual([
      { text: "See " },
      { text: "Weekly review", pageLink: "weekly" },
      { text: " and Nowhere" },
    ]);
  });

  it("leaves snake_case and lone asterisks alone", () => {
    const doc = markdownToDoc("my_var_name costs 2 * 3 * 4");
    expect(doc.blocks[0].content).toEqual([{ text: "my_var_name costs 2 * 3 * 4" }]);
  });

  it("gives back an empty paragraph for an empty file", () => {
    expect(markdownToDoc("").blocks).toHaveLength(1);
  });
});

describe("round trip", () => {
  it("exports and imports back to the same page", () => {
    const back = markdownToDoc(docToMarkdown(richDoc, pages), pages);
    expect(back.title).toBe(richDoc.title);
    const expected = richDoc.blocks.map(({ id: _id, checked, ...rest }) =>
      rest.type === "todo" ? { ...rest, checked } : rest
    );
    expect(shape(back).map((block) => ({ ...block, indent: block.indent || undefined }))).toEqual(
      expected.map((block) => ({ ...block, indent: block.indent || undefined }))
    );
  });
});
