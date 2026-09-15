import { useMemo } from "react";
import { findBacklinks, linkLabel, type Backlink } from "../model/links";
import type { PageMeta } from "../model/workspace";
import { loadPage } from "./storage";

interface Props {
  pageId: string;
  pages: PageMeta[];
  onOpen: (link: Backlink) => void;
}

/** "Linked from": every block on another page that links to this one. */
export function Backlinks({ pageId, pages, onOpen }: Props) {
  // Other pages aren't open, so storage already holds their latest text.
  // Re-read only when pages come or go — not on every keystroke of a title,
  // which also changes `pages`. Titles below come live from `pages` instead.
  const pageIds = pages.map((page) => page.id).join(",");
  const links = useMemo(
    () =>
      findBacklinks(
        pageIds.split(",").map((id) => ({ id, title: "", doc: loadPage(id) })),
        pageId
      ),
    [pageId, pageIds]
  );

  if (links.length === 0) return null;
  const titles = new Map(pages.map((page) => [page.id, page.title]));

  return (
    <section aria-labelledby="backlinks-heading" className="mt-16 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <h2
        id="backlinks-heading"
        className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400"
      >
        Linked from {links.length} {links.length === 1 ? "place" : "places"}
      </h2>
      <ul className="space-y-0.5">
        {links.map((link) => (
          <li key={`${link.pageId}:${link.blockId}`}>
            <button
              type="button"
              onClick={() => onOpen(link)}
              className="w-full rounded-md px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-neutral-500 dark:text-neutral-400">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5" />
                </svg>
                <span className="truncate">{linkLabel(titles.get(link.pageId) ?? "")}</span>
              </span>
              <span className="mt-0.5 block truncate pl-[22px] text-sm text-neutral-600 dark:text-neutral-400">
                {link.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
