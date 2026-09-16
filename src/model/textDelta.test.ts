import { describe, expect, it } from "vitest";
import { transformOffsetThrough } from "./textDelta";

describe("transformOffsetThrough", () => {
  it("applies every change in order, not only the last", () => {
    // someone types "Now: " one character at a time before a caret at 4
    const keystrokes = ["N", "o", "w", ":", " "].map((ch, i) => [{ retain: i }, { insert: ch }]);
    expect(transformOffsetThrough(4, keystrokes)).toBe(9);
  });

  it("combines insertions and deletions", () => {
    expect(transformOffsetThrough(6, [[{ insert: "abc" }], [{ retain: 1 }, { delete: 4 }]])).toBe(5);
  });
});
