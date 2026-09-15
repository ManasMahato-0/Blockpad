import { toPlain } from "./richText";
import type { BlockType, Doc } from "./types";
import { VOID_BLOCKS } from "./types";

export interface SearchablePage {
  id: string;
  title: string;
  doc: Doc;
}

export type Range = [start: number, end: number];

export interface SearchResult {
  pageId: string;
  pageTitle: string;
  /** null when the match is the page title itself */
  blockId: string | null;
  blockType?: BlockType;
  /** Where the first match starts in the full text, as a caret offset. */
  offset: number;
  /** The title, or a snippet of the block around the match. */
  text: string;
  /** Highlighted character ranges within `text`. */
  highlights: Range[];
  score: number;
}

const RESULT_LIMIT = 50;
const SNIPPET_LENGTH = 120;
const SNIPPET_LEAD = 30;
const TITLE_BONUS = 10;

interface Match {
  ranges: Range[];
  first: number;
  score: number;
}

const isWordStart = (text: string, index: number) => index === 0 || /[^\p{L}\p{N}]/u.test(text[index - 1]);

/** Sorts ranges and joins any that touch, so highlights never nest. */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/** Every word must appear somewhere in the text, in any order. */
function matchWords(text: string, terms: string[]): Match | null {
  const lower = text.toLowerCase();
  const ranges: Range[] = [];
  let score = 0;
  let first = Infinity;

  for (const term of terms) {
    let index = lower.indexOf(term);
    if (index === -1) return null;
    first = Math.min(first, index);
    score += isWordStart(lower, index) ? 2 : 1;
    while (index !== -1) {
      ranges.push([index, index + term.length]);
      index = lower.indexOf(term, index + term.length);
    }
  }

  if (terms.length > 1 && lower.includes(terms.join(" "))) score += 3;
  return { ranges: mergeRanges(ranges), first, score };
}

/** Letters of the query in order, gaps allowed: "prlp" finds "Product launch plan". */
function matchFuzzy(text: string, query: string): Match | null {
  const lower = text.toLowerCase();
  const letters = query.replace(/\s+/g, "");
  const ranges: Range[] = [];
  let from = 0;
  for (const letter of letters) {
    const index = lower.indexOf(letter, from);
    if (index === -1) return null;
    ranges.push([index, index + 1]);
    from = index + 1;
  }
  return { ranges: mergeRanges(ranges), first: ranges[0][0], score: 0.5 };
}

/** Cuts long text down to a window around the first match. */
function snippet(text: string, match: Match): { text: string; highlights: Range[] } {
  if (text.length <= SNIPPET_LENGTH) return { text, highlights: match.ranges };

  let start = Math.max(0, match.first - SNIPPET_LEAD);
  // start on a word boundary rather than halfway through a word
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < match.first) start = space + 1;
  }
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const shift = prefix.length - start;

  const highlights = match.ranges
    .filter(([s, e]) => e > start && s < end)
    .map(([s, e]): Range => [Math.max(s, start) + shift, Math.min(e, end) + shift]);

  return { text: prefix + text.slice(start, end) + suffix, highlights };
}

/**
 * Ranks titles and block text against a query. An empty query lists every
 * page, so the same box doubles as a page switcher.
 */
export function searchPages(pages: SearchablePage[], query: string): SearchResult[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return pages.map((page) => ({
      pageId: page.id,
      pageTitle: page.title,
      blockId: null,
      offset: page.title.length,
      text: page.title,
      highlights: [],
      score: 0,
    }));
  }

  const terms = trimmed.split(/\s+/);
  const results: SearchResult[] = [];

  for (const page of pages) {
    const titleMatch = matchWords(page.title, terms) ?? matchFuzzy(page.title, trimmed);
    if (titleMatch) {
      results.push({
        pageId: page.id,
        pageTitle: page.title,
        blockId: null,
        offset: titleMatch.first,
        text: page.title,
        highlights: titleMatch.ranges,
        score: titleMatch.score + TITLE_BONUS + (page.title.toLowerCase() === trimmed ? TITLE_BONUS : 0),
      });
    }

    for (const block of page.doc.blocks) {
      if (VOID_BLOCKS.has(block.type)) continue;
      const text = toPlain(block.content);
      const match = text && matchWords(text, terms);
      if (!match) continue;
      results.push({
        pageId: page.id,
        pageTitle: page.title,
        blockId: block.id,
        blockType: block.type,
        offset: match.first,
        ...snippet(text, match),
        score: match.score,
      });
    }
  }

  // Array.prototype.sort is stable, so equal scores keep page and block order
  return results.sort((a, b) => b.score - a.score).slice(0, RESULT_LIMIT);
}
