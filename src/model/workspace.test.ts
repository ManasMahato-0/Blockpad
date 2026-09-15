import { describe, expect, it } from "vitest";
import { addPage, removePage, renamePage, selectPage, type Workspace } from "./workspace";

function workspaceOf(ids: string[], activePageId: string): Workspace {
  return { pages: ids.map((id) => ({ id, title: "" })), activePageId };
}

describe("addPage", () => {
  it("appends the page and opens it", () => {
    const next = addPage(workspaceOf(["a"], "a"), { id: "b", title: "" });
    expect(next.pages.map((p) => p.id)).toEqual(["a", "b"]);
    expect(next.activePageId).toBe("b");
  });
});

describe("selectPage", () => {
  it("opens an existing page", () => {
    expect(selectPage(workspaceOf(["a", "b"], "a"), "b").activePageId).toBe("b");
  });

  it("ignores an id that isn't in the workspace", () => {
    const workspace = workspaceOf(["a"], "a");
    expect(selectPage(workspace, "missing")).toBe(workspace);
  });
});

describe("renamePage", () => {
  it("updates the title", () => {
    const next = renamePage(workspaceOf(["a"], "a"), "a", "Notes");
    expect(next.pages[0].title).toBe("Notes");
  });

  it("returns the same workspace when nothing changed, so saving can be skipped", () => {
    const workspace = workspaceOf(["a"], "a");
    expect(renamePage(workspace, "a", "")).toBe(workspace);
  });
});

describe("removePage", () => {
  const fresh = { id: "fresh", title: "" };

  it("opens the page below when the open page is removed", () => {
    const next = removePage(workspaceOf(["a", "b", "c"], "b"), "b", fresh);
    expect(next.pages.map((p) => p.id)).toEqual(["a", "c"]);
    expect(next.activePageId).toBe("c");
  });

  it("opens the page above when the removed open page was last", () => {
    expect(removePage(workspaceOf(["a", "b", "c"], "c"), "c", fresh).activePageId).toBe("b");
  });

  it("leaves the open page alone when a different page is removed", () => {
    expect(removePage(workspaceOf(["a", "b", "c"], "a"), "c", fresh).activePageId).toBe("a");
  });

  it("puts a fresh page in place of the only page, so the workspace is never empty", () => {
    const next = removePage(workspaceOf(["a"], "a"), "a", fresh);
    expect(next.pages).toEqual([fresh]);
    expect(next.activePageId).toBe("fresh");
  });
});
