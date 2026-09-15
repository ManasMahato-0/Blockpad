import { describe, expect, it } from "vitest";
import { linkInRange, rangeHasMark, setLink, toggleMark } from "./richText";

describe("toggleMark", () => {
  it("formats just the selected characters", () => {
    expect(toggleMark([{ text: "hello world" }], 6, 11, "bold")).toEqual([
      { text: "hello " },
      { text: "world", bold: true },
    ]);
  });

  it("removes the mark when the whole range already has it", () => {
    const rich = [{ text: "hello " }, { text: "world", bold: true }];
    expect(toggleMark(rich, 6, 11, "bold")).toEqual([{ text: "hello world" }]);
  });

  it("makes a half-bold selection fully bold instead of flipping each piece", () => {
    const rich = [{ text: "ab" }, { text: "cd", bold: true }];
    expect(toggleMark(rich, 0, 4, "bold")).toEqual([{ text: "abcd", bold: true }]);
  });

  it("keeps existing marks when adding another", () => {
    expect(toggleMark([{ text: "word", italic: true }], 0, 4, "bold")).toEqual([
      { text: "word", italic: true, bold: true },
    ]);
  });

  it("leaves the text untouched for an empty range", () => {
    const rich = [{ text: "abc" }];
    expect(toggleMark(rich, 1, 1, "bold")).toBe(rich);
  });
});

describe("rangeHasMark", () => {
  it("is true only when every character has the mark", () => {
    const rich = [{ text: "ab" }, { text: "cd", code: true }];
    expect(rangeHasMark(rich, 2, 4, "code")).toBe(true);
    expect(rangeHasMark(rich, 1, 4, "code")).toBe(false);
  });
});

describe("links", () => {
  it("sets and then clears a link on a range", () => {
    const linked = setLink([{ text: "see docs" }], 4, 8, "https://example.com/");
    expect(linked).toEqual([{ text: "see " }, { text: "docs", link: "https://example.com/" }]);
    expect(setLink(linked, 4, 8, undefined)).toEqual([{ text: "see docs" }]);
  });

  it("reports a link only when the whole range shares it", () => {
    const rich = [{ text: "see " }, { text: "docs", link: "https://example.com/" }];
    expect(linkInRange(rich, 4, 8)).toBe("https://example.com/");
    expect(linkInRange(rich, 0, 8)).toBeUndefined();
  });
});
