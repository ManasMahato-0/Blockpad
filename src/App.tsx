import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, type RevealRequest } from "./editor/Editor";
import { QuickSearch } from "./editor/QuickSearch";
import { Sidebar } from "./editor/Sidebar";
import { useTheme } from "./theme";
import { deletePageData, loadWorkspace, requestFlush, saveWorkspace } from "./editor/storage";
import type { SearchResult } from "./model/search";
import {
  addPage,
  newPageMeta,
  removePage,
  renamePage,
  selectPage,
  type Workspace,
} from "./model/workspace";

const NARROW_SCREEN = "(max-width: 767px)";

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace());
  // phones start collapsed so the sidebar doesn't cover the page on arrival
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia(NARROW_SCREEN).matches);
  const { theme, toggleTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [reveal, setReveal] = useState<(RevealRequest & { pageId: string }) | null>(null);

  // A removed page's stored content is erased only after its editor has
  // unmounted — that editor's unmount save would otherwise write it back.
  const removedPageIds = useRef<string[]>([]);
  useEffect(() => {
    saveWorkspace(workspace);
    for (const id of removedPageIds.current) deletePageData(id);
    removedPageIds.current = [];
  }, [workspace]);

  const activeTitle = workspace.pages.find((p) => p.id === workspace.activePageId)?.title.trim();
  useEffect(() => {
    document.title = activeTitle ? `${activeTitle} · Blockpad` : "Blockpad";
  }, [activeTitle]);

  const handleTitleChange = useCallback(
    (title: string) => setWorkspace((current) => renamePage(current, current.activePageId, title)),
    []
  );

  const closeSidebarOnPhones = () => {
    if (window.matchMedia(NARROW_SCREEN).matches) setSidebarOpen(false);
  };

  const createPage = () => {
    const page = newPageMeta();
    setWorkspace((current) => addPage(current, page));
  };

  const openPage = (id: string) => {
    setWorkspace((current) => selectPage(current, id));
    closeSidebarOnPhones();
  };

  const deletePage = (id: string) => {
    const replacement = newPageMeta();
    removedPageIds.current.push(id);
    setWorkspace((current) => removePage(current, id, replacement));
  };

  // Search reads pages from storage, so the open page first saves anything
  // still waiting on its typing debounce.
  const openSearch = useCallback(() => {
    requestFlush();
    setSearchOpen(true);
  }, []);

  // Ctrl+P / Cmd+P, the shortcut Notion and code editors use for this, taken
  // over from the browser's print dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  const chooseResult = (result: SearchResult) => {
    setSearchOpen(false);
    setWorkspace((current) => selectPage(current, result.pageId));
    setReveal({ pageId: result.pageId, blockId: result.blockId, offset: result.offset });
    closeSidebarOnPhones();
  };

  // the editor reports back once it has shown the match, so coming back to
  // the page later doesn't jump to it again
  const clearReveal = useCallback(() => setReveal(null), []);

  return (
    <div className="flex min-h-full">
      {sidebarOpen ? (
        <>
          {/* phones only: a dimmed backdrop behind the floating sidebar; tapping it closes */}
          <div
            aria-hidden="true"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/30 md:hidden"
          />
          {/* floats over the page on phones, sits beside it on wider screens */}
          <div className="fixed inset-y-0 left-0 z-40 shadow-xl md:sticky md:top-0 md:h-screen md:shadow-none">
            <Sidebar
              pages={workspace.pages}
              activePageId={workspace.activePageId}
              onSelect={openPage}
              onCreate={createPage}
              onDelete={deletePage}
              onCollapse={() => setSidebarOpen(false)}
              onSearch={openSearch}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sidebar"
          title="Open sidebar"
          className="fixed left-3 top-3 z-40 flex h-11 w-11 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      <main className="min-w-0 flex-1">
        <Editor
          key={workspace.activePageId}
          pageId={workspace.activePageId}
          onTitleChange={handleTitleChange}
          reveal={reveal?.pageId === workspace.activePageId ? reveal : undefined}
          onRevealed={clearReveal}
        />
      </main>

      {searchOpen && (
        <QuickSearch pages={workspace.pages} onChoose={chooseResult} onClose={() => setSearchOpen(false)} />
      )}
    </div>
  );
}
