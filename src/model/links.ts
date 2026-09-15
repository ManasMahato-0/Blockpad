import { normalize, slice, textLength, toPlain } from "./richText";
import type { SearchablePage } from "./search";
import type { Doc, InlineSpan, RichText } from "./types";
import type { PageMeta } from "./workspace";

export const linkLabel = (title: string) => title.trim() || "Untitled";

/**
 * Replaces the typed "[[query" — `typedLength` characters from `start` — with
 * a link to the page, followed by a space so typing carries on after it.
 */
export function insertPageLink(
  rich: RichText,
  start: number,
  typedLength: number,
  page: PageMeta
): { content: RichText; caret: number } {
  const label = linkLabel(page.title);
  const content = normalize([
    ...slice(rich, 0, start),
    { text: label, pageLink: page.id },
    { text: " " },
    ...slice(rich, start + typedLength, textLength(rich)),
  ]);
  return { content, caret: start + label.length + 1 };
}

/**
 * Brings every link's text up to date with its page's current title, and
 * turns links to deleted pages back into plain text. Returns the same
 * document when nothing changed.
 */
export function syncLinkTitles(doc: Doc, pages: PageMeta[]): Doc {
  const titles = new Map(pages.map((page) => [page.id, linkLabel(page.title)]));
  let changed = false;

  const blocks = doc.blocks.map((block) => {
    if (!block.content.some((span) => span.pageLink)) return block;
    let blockChanged = false;
    const content = block.content.map((span): InlineSpan => {
      if (!span.pageLink) return span;
      const title = titles.get(span.pageLink);
      if (title === undefined) {
        blockChanged = true;
        const { pageLink: _removed, ...plain } = span;
        return plain;
      }
      if (title === span.text) return span;
      blockChanged = true;
      return { ...span, text: title };
    });
    if (!blockChanged) return block;
    changed = true;
    return { ...block, content: normalize(content) };
  });

  return changed ? { ...doc, blocks } : doc;
}

export interface Backlink {
  pageId: string;
  pageTitle: string;
  blockId: string;
  /** Where the link starts in the block, for putting the caret on it. */
  offset: number;
  text: string;
}

/** Every block on another page that links to `targetId`, in page order. */
export function findBacklinks(pages: SearchablePage[], targetId: string): Backlink[] {
  const found: Backlink[] = [];
  for (const page of pages) {
    if (page.id === targetId) continue;
    for (const block of page.doc.blocks) {
      let offset = 0;
      for (const span of block.content) {
        if (span.pageLink === targetId) {
          found.push({
            pageId: page.id,
            pageTitle: page.title,
            blockId: block.id,
            offset,
            text: toPlain(block.content),
          });
          break;
        }
        offset += span.text.length;
      }
    }
  }
  return found;
}

/** The page link touching the caret on either side, if there is one. */
export function pageLinkAt(rich: RichText, offset: number): string | undefined {
  let pos = 0;
  for (const span of rich) {
    const end = pos + span.text.length;
    if (span.pageLink && offset >= pos && offset <= end) return span.pageLink;
    pos = end;
  }
  return undefined;
}
