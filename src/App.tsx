import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, type RevealRequest } from "./editor/Editor";
import { QuickSearch } from "./editor/QuickSearch";
import { Sidebar } from "./editor/Sidebar";
import { useTheme } from "./theme";
import { deletePageData, loadWorkspace, requestFlush, savePage, saveWorkspace } from "./editor/storage";
import { MARKDOWN_FILE, MAX_IMPORT_BYTES } from "./editor/files";
import { createBlock } from "./model/document";
import { markdownToDoc } from "./model/markdown";
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

  /** Opens a page from a search result, a link or a backlink; `reveal` places the caret. */
  const openPageAt = (pageId: string, at?: RevealRequest) => {
    setWorkspace((current) => selectPage(current, pageId));
    if (at) setReveal({ pageId, ...at });
    closeSidebarOnPhones();
  };

  const chooseResult = (result: SearchResult) => {
    setSearchOpen(false);
    openPageAt(result.pageId, { blockId: result.blockId, offset: result.offset });
  };

  // "[[New idea" → a page titled "New idea", saved straight away so the
  // title is there when it's opened, while the writer stays where they are.
  const createLinkedPage = (title: string) => {
    const page = { ...newPageMeta(), title };
    savePage(page.id, { title, blocks: [createBlock()] });
    setWorkspace((current) => addPage(current, page, false));
    return page;
  };

  // the editor reports back once it has shown the match, so coming back to
  // the page later doesn't jump to it again
  const clearReveal = useCallback(() => setReveal(null), []);

  // a short message at the bottom of the screen, read out by screen readers
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * Each Markdown file becomes a page; the last one opens. Titles are worked
   * out before contents, so [[links]] between files imported together find
   * each other.
   */
  const importFiles = useCallback(
    async (files: File[]) => {
      const accepted = files.filter((file) => MARKDOWN_FILE.test(file.name) && file.size <= MAX_IMPORT_BYTES);
      if (accepted.length === 0) {
        setNotice("Only Markdown files (.md) under 5 MB can be imported");
        return;
      }
      const texts = await Promise.all(accepted.map((file) => file.text()));
      const imported = texts.map((text, i) => ({
        ...newPageMeta(),
        title: markdownToDoc(text).title || accepted[i].name.replace(MARKDOWN_FILE, ""),
      }));
      const known = [...workspace.pages, ...imported];
      imported.forEach((page, i) => savePage(page.id, { ...markdownToDoc(texts[i], known), title: page.title }));
      setWorkspace((current) => imported.reduce((next, page, i) => addPage(next, page, i === imported.length - 1), current));

      const skipped = files.length - accepted.length;
      setNotice(
        `Imported ${imported.length} ${imported.length === 1 ? "page" : "pages"}` +
          (skipped > 0 ? `, skipped ${skipped} other ${skipped === 1 ? "file" : "files"}` : "")
      );
    },
    [workspace.pages]
  );

  // Dropping files anywhere imports them. dragenter and dragleave fire for
  // every element crossed on the way, so they're counted rather than trusted
  // one at a time — otherwise the overlay flickers.
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    let depth = 0;
    const carriesFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth++;
      setDropping(true);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // without this the browser opens the file instead of letting it drop
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropping(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDropping(false);
      void importFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", onEnter, true);
    window.addEventListener("dragover", onOver, true);
    window.addEventListener("dragleave", onLeave, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onEnter, true);
      window.removeEventListener("dragover", onOver, true);
      window.removeEventListener("dragleave", onLeave, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [importFiles]);

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
              onImport={(files) => {
                closeSidebarOnPhones();
                void importFiles(files);
              }}
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
          pages={workspace.pages}
          onOpenPage={openPageAt}
          onCreatePage={createLinkedPage}
        />
      </main>

      {searchOpen && (
        <QuickSearch pages={workspace.pages} onChoose={chooseResult} onClose={() => setSearchOpen(false)} />
      )}

      {dropping && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-3 z-[60] flex items-center justify-center rounded-2xl border-2 border-dashed border-neutral-400 bg-white/85 text-lg font-medium text-neutral-700 backdrop-blur-sm dark:border-neutral-500 dark:bg-neutral-900/85 dark:text-neutral-200"
        >
          Drop Markdown files to import
        </div>
      )}

      {/* always mounted: a live region added at the same moment as its text
          is often not announced */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
        {notice && (
          <p className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
