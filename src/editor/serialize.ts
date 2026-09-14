import type { InlineSpan, RichText } from "../model/types";
import { normalize } from "../model/richText";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function richTextToHtml(rich: RichText): string {
  return rich
    .map((span) => {
      let html = escapeHtml(span.text);
      if (span.code) html = `<code>${html}</code>`;
      if (span.bold) html = `<strong>${html}</strong>`;
      if (span.italic) html = `<em>${html}</em>`;
      if (span.link) html = `<a href="${escapeHtml(span.link)}">${html}</a>`;
      return html;
    })
    .join("");
}

export function domToRichText(element: HTMLElement): RichText {
  const spans: RichText = [];

  const walk = (node: Node, marks: Omit<InlineSpan, "text">) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) spans.push({ ...marks, text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const next = { ...marks };
    const tag = el.tagName.toLowerCase();
    if (tag === "strong" || tag === "b") next.bold = true;
    if (tag === "em" || tag === "i") next.italic = true;
    if (tag === "code") next.code = true;
    if (tag === "a") next.link = el.getAttribute("href") ?? undefined;

    el.childNodes.forEach((child) => walk(child, next));
  };

  element.childNodes.forEach((child) => walk(child, {}));
  return normalize(spans);
}
