export interface PageMeta {
  id: string;
  title: string;
  /** Set once the page is shared: the collaboration room its content lives in. */
  roomId?: string;
}

/** The page list shown in the sidebar. Each page's content is stored separately. */
export interface Workspace {
  pages: PageMeta[];
  activePageId: string;
}

export function newPageMeta(): PageMeta {
  return { id: crypto.randomUUID(), title: "" };
}

/** Appends a page and opens it, unless `open` is false (a page created from a link). */
export function addPage(workspace: Workspace, page: PageMeta, open = true): Workspace {
  return { pages: [...workspace.pages, page], activePageId: open ? page.id : workspace.activePageId };
}

export function selectPage(workspace: Workspace, id: string): Workspace {
  if (id === workspace.activePageId || !workspace.pages.some((p) => p.id === id)) return workspace;
  return { ...workspace, activePageId: id };
}

/** Returns the same workspace when the title is unchanged, so callers can skip saving. */
export function renamePage(workspace: Workspace, id: string, title: string): Workspace {
  const page = workspace.pages.find((p) => p.id === id);
  if (!page || page.title === title) return workspace;
  return {
    ...workspace,
    pages: workspace.pages.map((p) => (p.id === id ? { ...p, title } : p)),
  };
}

/** Shares a page by giving it a room, or makes it private again with undefined. */
export function setPageRoom(workspace: Workspace, id: string, roomId: string | undefined): Workspace {
  return {
    ...workspace,
    pages: workspace.pages.map((p) => {
      if (p.id !== id) return p;
      const { roomId: _previous, ...rest } = p;
      return roomId ? { ...rest, roomId } : rest;
    }),
  };
}

/**
 * Opening a share link: reopens the page if this device already has that
 * room, otherwise adds `page` for it. Pure, so running it twice can't add
 * the page twice.
 */
export function joinSharedPage(workspace: Workspace, page: PageMeta): Workspace {
  const existing = workspace.pages.find((p) => p.roomId === page.roomId);
  return existing ? selectPage(workspace, existing.id) : addPage(workspace, page);
}

/**
 * Removes a page. If it was open, the page below it opens — or the one above
 * when it was last. A workspace never has zero pages: removing the only page
 * puts `replacement` in its place, passed in so this stays a pure function.
 */
export function removePage(workspace: Workspace, id: string, replacement: PageMeta): Workspace {
  const index = workspace.pages.findIndex((p) => p.id === id);
  if (index === -1) return workspace;

  const pages = workspace.pages.filter((p) => p.id !== id);
  if (pages.length === 0) return { pages: [replacement], activePageId: replacement.id };

  const activePageId =
    workspace.activePageId === id ? pages[Math.min(index, pages.length - 1)].id : workspace.activePageId;
  return { pages, activePageId };
}
