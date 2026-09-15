import { describe, expect, it } from "vitest";
import { searchPages, type SearchablePage, type SearchResult } from "./search";
import type { Block } from "./types";

const block = (id: string, text: string, type: Block["type"] = "paragraph"): Block => ({
  id,
  type,
  content: text ? [{ text }] : [],
});

const page = (id: string, title: string, blocks: Block[] = []): SearchablePage => ({
  id,
  title,
  doc: { title, blocks },
});

const highlighted = (result: SearchResult) => result.highlights.map(([s, e]) => result.text.slice(s, e));

describe("searchPages", () => {
  const pages = [
    page("launch", "Product launch plan", [
      block("b1", "Ship the new onboarding flow"),
      block("b2", "", "divider"),
      block("b3", "Watch the launch dashboards"),
    ]),
    page("weekly", "Weekly review", [block("w1", "Onboarding numbers look good")]),
  ];

  it("lists every page when the query is empty", () => {
    const results = searchPages(pages, "  ");
    expect(results.map((r) => [r.pageId, r.blockId])).toEqual([
      ["launch", null],
      ["weekly", null],
    ]);
  });

  it("ignores case and ranks a title above body text", () => {
    const results = searchPages(pages, "LAUNCH");
    expect(results[0]).toMatchObject({ pageId: "launch", blockId: null });
    expect(results[1]).toMatchObject({ blockId: "b3" });
  });

  it("needs every word, in any order", () => {
    expect(searchPages(pages, "flow onboarding").map((r) => r.blockId)).toEqual(["b1"]);
    expect(searchPages(pages, "onboarding missing")).toEqual([]);
  });

  it("ranks the exact phrase above the same words scattered", () => {
    const results = searchPages(
      [page("p", "", [block("scattered", "numbers were good, the review went well"), block("phrase", "a good review")])],
      "good review"
    );
    expect(results.map((r) => r.blockId)).toEqual(["phrase", "scattered"]);
  });

  it("highlights every occurrence and points the caret at the first", () => {
    const [result] = searchPages([page("p", "", [block("a", "one two one")])], "one");
    expect(result.highlights).toEqual([
      [0, 3],
      [8, 11],
    ]);
    expect(result.offset).toBe(0);
  });

  it("finds titles by their letters in order", () => {
    const [result] = searchPages(pages, "prlp");
    expect(result).toMatchObject({ pageId: "launch", blockId: null });
    // "P" and "r" are neighbours, so their highlights join into one
    expect(highlighted(result)).toEqual(["Pr", "l", "p"]);
  });

  it("never fuzzy-matches body text, which would match almost anything", () => {
    expect(searchPages(pages, "swf").some((r) => r.blockId)).toBe(false);
  });

  it("trims a long block to a snippet whose highlights still line up", () => {
    const long = "word ".repeat(40) + "needle " + "word ".repeat(40);
    const [result] = searchPages([page("p", "", [block("a", long)])], "needle");
    expect(result.text.length).toBeLessThan(long.length);
    expect(result.text.startsWith("…")).toBe(true);
    expect(result.text.endsWith("…")).toBe(true);
    expect(highlighted(result)).toEqual(["needle"]);
    expect(long.slice(result.offset, result.offset + 6)).toBe("needle");
  });
});
