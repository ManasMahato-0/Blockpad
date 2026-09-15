import { useState } from "react";
import type { PageMeta } from "../model/workspace";
import type { Theme } from "../theme";

interface Props {
  pages: PageMeta[];
  activePageId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
  onSearch: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Sidebar({
  pages,
  activePageId,
  onSelect,
  onCreate,
  onDelete,
  onCollapse,
  onSearch,
  theme,
  onToggleTheme,
}: Props) {
  const searchShortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘P" : "Ctrl+P";
  // Deleting takes two clicks: the first arms the button, the second confirms.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <nav
      aria-label="Pages"
      className="flex h-full w-60 shrink-0 flex-col border-r border-neutral-200 bg-[#f7f7f5] dark:border-neutral-800 dark:bg-[#202020]"
    >
      <div className="flex items-center gap-1 px-4 pb-2 pt-4">
        <span className="mr-auto text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-100">Blockpad</span>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-200"
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m11 17-5-5 5-5" />
            <path d="m18 17-5-5 5-5" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        onClick={onSearch}
        aria-keyshortcuts={searchShortcut === "⌘P" ? "Meta+P" : "Control+P"}
        className="mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-100"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        Search
        <kbd className="ml-auto font-sans text-xs text-neutral-600 dark:text-neutral-400" aria-hidden="true">
          {searchShortcut}
        </kbd>
      </button>

      <button
        type="button"
        onClick={onCreate}
        className="mx-2 mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-100"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New page
      </button>

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {pages.map((page) => {
          const active = page.id === activePageId;
          const confirming = confirmingId === page.id;
          const label = page.title.trim() || "Untitled";

          return (
            <li
              key={page.id}
              onMouseLeave={() => confirming && setConfirmingId(null)}
              className={`group flex items-center rounded-md ${
                active ? "bg-neutral-200/70 dark:bg-neutral-700/70" : "hover:bg-neutral-200/50 dark:hover:bg-neutral-700/40"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(page.id)}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm ${
                  active ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-300"
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-neutral-400 dark:text-neutral-500">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5" />
                </svg>
                <span className={`truncate ${page.title.trim() ? "" : "italic text-neutral-600 dark:text-neutral-300"}`}>{label}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (confirming) {
                    setConfirmingId(null);
                    onDelete(page.id);
                  } else {
                    setConfirmingId(page.id);
                  }
                }}
                onBlur={() => confirming && setConfirmingId(null)}
                aria-label={confirming ? `Confirm deleting ${label}` : `Delete ${label}`}
                title={confirming ? "Click again to delete" : "Delete page"}
                className={`mr-1 shrink-0 rounded px-1.5 py-1 text-xs focus:opacity-100 ${
                  confirming
                    ? "bg-red-50 font-medium text-red-700 opacity-100 dark:bg-red-950/60 dark:text-red-300"
                    : "text-neutral-500 opacity-0 hover:bg-neutral-300/60 hover:text-neutral-700 group-hover:opacity-100 [@media(hover:none)]:opacity-100 dark:text-neutral-400 dark:hover:bg-neutral-600/60 dark:hover:text-neutral-200"
                }`}
              >
                {confirming ? (
                  "Delete?"
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
