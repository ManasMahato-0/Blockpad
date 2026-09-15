import type { Doc } from "../model/types";
import { emptyDoc } from "../model/document";
import { newPageMeta, type Workspace } from "../model/workspace";

const WORKSPACE_KEY = "blockpad:workspace";
const PAGE_PREFIX = "blockpad:page:";
/** Where the single document lived before pages existed. */
const LEGACY_DOC_KEY = "block-editor:doc";

// Every storage call is guarded: private browsing or a full quota should mean
// "not saved", never an editor that fails to load.
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing useful to do if storage is unavailable
  }
}

/**
 * Asks the open editor to save text it is still holding back for its typing
 * debounce, so something that reads storage straight after sees it.
 */
export const FLUSH_EVENT = "blockpad:flush";

export function requestFlush(): void {
  window.dispatchEvent(new Event(FLUSH_EVENT));
}

export function loadPage(id: string): Doc {
  const doc = read<Doc>(PAGE_PREFIX + id);
  return doc?.blocks?.length ? doc : emptyDoc();
}

export function savePage(id: string, doc: Doc): boolean {
  return write(PAGE_PREFIX + id, doc);
}

export function deletePageData(id: string): void {
  remove(PAGE_PREFIX + id);
}

export function saveWorkspace(workspace: Workspace): boolean {
  return write(WORKSPACE_KEY, workspace);
}

/**
 * Loads the page list. The first time it runs after pages were introduced,
 * the single document from the earlier version becomes the first page — so
 * nobody's existing notes disappear on upgrade.
 */
export function loadWorkspace(): Workspace {
  const saved = read<Workspace>(WORKSPACE_KEY);
  if (saved?.pages?.length) {
    // an index pointing at a page that no longer exists opens the first page
    // instead of a blank screen
    return saved.pages.some((p) => p.id === saved.activePageId)
      ? saved
      : { ...saved, activePageId: saved.pages[0].id };
  }

  const first = newPageMeta();
  const legacy = read<Doc>(LEGACY_DOC_KEY);
  if (legacy?.blocks?.length) {
    first.title = legacy.title ?? "";
    // only drop the old copy once the new one is safely written
    if (savePage(first.id, legacy)) remove(LEGACY_DOC_KEY);
  }

  const workspace: Workspace = { pages: [first], activePageId: first.id };
  saveWorkspace(workspace);
  return workspace;
}
