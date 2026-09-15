import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { searchPages, type Range, type SearchResult } from "../model/search";
import type { BlockType } from "../model/types";
import type { PageMeta } from "../model/workspace";
import { loadPage } from "./storage";

interface Props {
  pages: PageMeta[];
  onChoose: (result: SearchResult) => void;
  onClose: () => void;
}

const BLOCK_LABELS: Partial<Record<BlockType, string>> = {
  heading1: "Heading",
  heading2: "Heading",
  heading3: "Heading",
  bulleted: "List",
  numbered: "List",
  todo: "To-do",
  quote: "Quote",
};

function Highlighted({ text, highlights }: { text: string; highlights: Range[] }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  highlights.forEach(([start, end], index) => {
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(
      <mark key={index} className="rounded-sm bg-yellow-200/80 text-inherit dark:bg-yellow-500/30">
        {text.slice(start, end)}
      </mark>
    );
    pos = end;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

export function QuickSearch({ pages, onChoose, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // Read from storage once per opening. The dialog is modal, so nothing can
  // change underneath it while it is open.
  const searchable = useMemo(
    () => pages.map((page) => ({ id: page.id, title: page.title, doc: loadPage(page.id) })),
    [pages]
  );
  const results = useMemo(() => searchPages(searchable, query), [searchable, query]);
  const active = Math.min(activeIndex, results.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  // showModal() brings the browser's own focus trap, Escape handling and an
  // inert page behind the dialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // focus() alone would drop the caret at the start of a text block
    const selection = window.getSelection();
    const returnRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    if (!dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      // Closing puts focus and the caret back where they were. Choosing a
      // result moves them on again straight after, to the match.
      if (!returnFocus?.isConnected) return;
      returnFocus.focus({ preventScroll: true });
      if (returnRange?.startContainer.isConnected && returnFocus.contains(returnRange.startContainer)) {
        selection?.removeAllRanges();
        selection?.addRange(returnRange);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (active >= 0) document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + step + results.length) % results.length);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && results[active]) {
      event.preventDefault();
      onChoose(results[active]);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="Search pages"
      onCancel={(event) => {
        // Escape: let React unmount the dialog rather than the browser hide it
        event.preventDefault();
        onClose();
      }}
      // a click on the dimmed backdrop lands on the dialog element itself
      onClick={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={onKeyDown}
      className="mx-auto mb-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-xl border border-neutral-200 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
    >
      <div className="flex items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-700">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-neutral-500 dark:text-neutral-400">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search pages"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          placeholder="Search pages and text…"
          className="h-13 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
        />
        <kbd className="hidden rounded border border-neutral-200 px-1.5 py-0.5 font-sans text-xs text-neutral-600 md:block dark:border-neutral-600 dark:text-neutral-300">
          Esc
        </kbd>
      </div>

      <p className="sr-only" aria-live="polite">
        {results.length === 1 ? "1 result" : `${results.length} results`}
      </p>

      {results.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={query.trim() ? "Results" : "Pages"}
          // reachable by keyboard, as a scrolling region must be; arrows and
          // Enter still work from here
          tabIndex={0}
          className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5 outline-none"
        >
          {results.map((result, index) => {
            const isTitle = result.blockId === null;
            const label = result.blockType ? BLOCK_LABELS[result.blockType] : undefined;
            return (
              <li
                key={`${result.pageId}:${result.blockId ?? "title"}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseMove={() => index !== active && setActiveIndex(index)}
                onClick={() => onChoose(result)}
                className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 ${
                  index === active ? "bg-neutral-100 dark:bg-neutral-700/70" : ""
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-neutral-500 dark:text-neutral-400">
                  {isTitle ? (
                    <>
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                      <path d="M14 3v5h5" />
                    </>
                  ) : (
                    <path d="M4 6h16M4 12h16M4 18h10" />
                  )}
                </svg>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${isTitle ? "truncate font-medium" : "line-clamp-2"}`}>
                    {result.text ? (
                      <Highlighted text={result.text} highlights={result.highlights} />
                    ) : (
                      <span className="italic text-neutral-600 dark:text-neutral-300">Untitled</span>
                    )}
                  </span>
                  {!isTitle && (
                    <span className="mt-0.5 block truncate text-xs text-neutral-600 dark:text-neutral-400">
                      {result.pageTitle.trim() || "Untitled"}
                      {label && ` · ${label}`}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-10 text-center text-sm text-neutral-600 dark:text-neutral-400">
          No matches for “{query.trim()}”
        </p>
      )}

      <div className="hidden gap-4 border-t border-neutral-200 px-4 py-2 text-xs text-neutral-600 md:flex dark:border-neutral-700 dark:text-neutral-400">
        <span>↑↓ to move</span>
        <span>Enter to open</span>
        <span>Esc to close</span>
      </div>
    </dialog>
  );
}
