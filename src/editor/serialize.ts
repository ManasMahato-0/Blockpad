import type { InlineSpan, RichText } from "../model/types";
import { normalize, textLength } from "../model/richText";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Only absolute http(s) and mailto links survive. Pasted HTML can carry
 * javascript: URLs, and relative links mean nothing outside their own site.
 */
export function safeHref(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function richTextToHtml(rich: RichText): string {
  return rich
    .map((span) => {
      let html = escapeHtml(span.text);
      if (span.code) html = `<code>${html}</code>`;
      if (span.bold) html = `<strong>${html}</strong>`;
      if (span.italic) html = `<em>${html}</em>`;
      const href = safeHref(span.link);
      if (href) html = `<a href="${escapeHtml(href)}">${html}</a>`;
      return html;
    })
    .join("");
}

type Marks = Omit<InlineSpan, "text">;

/**
 * Formatting carried by one element. Reads tags, plus the inline styles that
 * Google Docs uses instead of them — Docs also wraps every copy in
 * <b style="font-weight:normal">, which would otherwise make a paste all bold.
 */
function marksFor(el: Element, inherited: Marks): Marks {
  const next = { ...inherited };
  const tag = el.tagName.toLowerCase();
  const style = el.getAttribute("style") ?? "";
  const explicitlyNormal = /font-weight:\s*(normal|[1-5]00)\b/i.test(style);

  if ((tag === "strong" || tag === "b") && !explicitlyNormal) next.bold = true;
  if (/font-weight:\s*(bold|[6-9]00)\b/i.test(style)) next.bold = true;
  if (tag === "em" || tag === "i" || /font-style:\s*italic/i.test(style)) next.italic = true;
  if (tag === "code") next.code = true;
  if (tag === "a") {
    const href = safeHref(el.getAttribute("href"));
    if (href) next.link = href;
  }
  return next;
}

export function domToRichText(element: HTMLElement): RichText {
  const spans: RichText = [];

  const walk = (node: Node, marks: Marks) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) spans.push({ ...marks, text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const next = marksFor(el, marks);
    el.childNodes.forEach((child) => walk(child, next));
  };

  element.childNodes.forEach((child) => walk(child, {}));
  return normalize(spans);
}

const BLOCK_TAGS = new Set([
  "address", "article", "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
  "ol", "p", "pre", "section", "table", "tr", "ul",
]);

const IGNORED_TAGS = new Set([
  "head", "link", "meta", "noscript", "script", "style", "template", "title",
]);

/** Collapsed source whitespace leaves stray spaces at the ends of lines. */
function trimLine(line: RichText): RichText {
  if (line.length === 0) return line;
  const out = line.map((span) => ({ ...span }));
  out[0].text = out[0].text.trimStart();
  out[out.length - 1].text = out[out.length - 1].text.trimEnd();
  return normalize(out);
}

function dropTrailingEmpty(lines: RichText[]): RichText[] {
  let end = lines.length;
  while (end > 1 && textLength(lines[end - 1]) === 0) end--;
  return lines.slice(0, end);
}

/**
 * Clipboard contents as lines of formatted text, one per block. HTML is
 * parsed with DOMParser into an inert document — nothing in it runs and it is
 * never attached to the page — and only bold, italic, code and safe links are
 * kept. Colours, sizes and fonts from the source are dropped.
 */
export function clipboardToLines(html: string, plain: string): RichText[] {
  if (!html.trim()) {
    const lines = plain
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line): RichText => (line ? [{ text: line }] : []));
    return dropTrailingEmpty(lines);
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const lines: RichText[] = [];
  let current: RichText = [];

  const breakLine = () => {
    lines.push(trimLine(normalize(current)));
    current = [];
  };

  const walk = (node: Node, marks: Marks, preformatted: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? "";
      if (preformatted) {
        raw.split("\n").forEach((part, i) => {
          if (i > 0) breakLine();
          if (part) current.push({ ...marks, text: part });
        });
        return;
      }
      // whitespace that only separates block elements in the source markup
      if (!raw.trim() && raw.includes("\n")) return;
      const text = raw.replace(/\s+/g, " ");
      if (text) current.push({ ...marks, text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (IGNORED_TAGS.has(tag)) return;
    if (tag === "br") return breakLine();

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && textLength(current) > 0) breakLine();
    const next = marksFor(el, marks);
    el.childNodes.forEach((child) => walk(child, next, preformatted || tag === "pre"));
    if (isBlock && textLength(current) > 0) breakLine();
  };

  walk(parsed.body, {}, false);
  if (textLength(current) > 0) breakLine();
  return dropTrailingEmpty(lines);
}
