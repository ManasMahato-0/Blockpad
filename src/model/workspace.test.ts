import { describe, expect, it } from "vitest";
import { addPage, joinSharedPage, removePage, renamePage, selectPage, setPageRoom, type Workspace } from "./workspace";

describe("sharing", () => {
  it("gives a page a room and takes it away again", () => {
    const shared = setPageRoom(workspaceOf(["a", "b"], "a"), "a", "room-1");
    expect(shared.pages[0]).toEqual({ id: "a", title: "", roomId: "room-1" });
    expect(shared.pages[1]).toEqual({ id: "b", title: "" });
    expect(setPageRoom(shared, "a", undefined).pages[0]).toEqual({ id: "a", title: "" });
  });

  it("adds a joined page and opens it", () => {
    const next = joinSharedPage(workspaceOf(["a"], "a"), { id: "j", title: "Shared page", roomId: "room-1" });
    expect(next.pages.map((p) => p.id)).toEqual(["a", "j"]);
    expect(next.activePageId).toBe("j");
  });

  it("reopens a room this device already has instead of adding it twice", () => {
    const workspace = joinSharedPage(workspaceOf(["a"], "a"), { id: "j", title: "", roomId: "room-1" });
    const again = joinSharedPage(selectPage(workspace, "a"), { id: "other", title: "", roomId: "room-1" });
    expect(again.pages.map((p) => p.id)).toEqual(["a", "j"]);
    expect(again.activePageId).toBe("j");
  });
});

function workspaceOf(ids: string[], activePageId: string): Workspace {
  return { pages: ids.map((id) => ({ id, title: "" })), activePageId };
}

describe("addPage", () => {
  it("appends the page and opens it", () => {
    const next = addPage(workspaceOf(["a"], "a"), { id: "b", title: "" });
    expect(next.pages.map((p) => p.id)).toEqual(["a", "b"]);
    expect(next.activePageId).toBe("b");
  });

  it("can append without opening, for a page created from a link", () => {
    const next = addPage(workspaceOf(["a"], "a"), { id: "b", title: "" }, false);
    expect(next.pages.map((p) => p.id)).toEqual(["a", "b"]);
    expect(next.activePageId).toBe("a");
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
