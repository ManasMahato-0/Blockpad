import { useCallback, useEffect, useRef, useState } from "react";
import { Editor } from "./editor/Editor";
import { Sidebar } from "./editor/Sidebar";
import { deletePageData, loadWorkspace, saveWorkspace } from "./editor/storage";
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

  const createPage = () => {
    const page = newPageMeta();
    setWorkspace((current) => addPage(current, page));
  };

  const openPage = (id: string) => {
    setWorkspace((current) => selectPage(current, id));
    if (window.matchMedia(NARROW_SCREEN).matches) setSidebarOpen(false);
  };

  const deletePage = (id: string) => {
    const replacement = newPageMeta();
    removedPageIds.current.push(id);
    setWorkspace((current) => removePage(current, id, replacement));
  };

  return (
    <div className="flex min-h-full">
      {sidebarOpen ? (
        // floats over the page on phones, sits beside it on wider screens
        <div className="fixed inset-y-0 left-0 z-40 shadow-xl md:sticky md:top-0 md:h-screen md:shadow-none">
          <Sidebar
            pages={workspace.pages}
            activePageId={workspace.activePageId}
            onSelect={openPage}
            onCreate={createPage}
            onDelete={deletePage}
            onCollapse={() => setSidebarOpen(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sidebar"
          title="Open sidebar"
          className="fixed left-3 top-3 z-40 rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
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
        />
      </main>
    </div>
  );
}
