import type { InlineSpan, RichText } from "./types";

export function textLength(rich: RichText): number {
  let total = 0;
  for (const span of rich) total += span.text.length;
  return total;
}

export function toPlain(rich: RichText): string {
  return rich.map((span) => span.text).join("");
}

export function fromPlain(text: string): RichText {
  return text ? [{ text }] : [];
}

export function isEmpty(rich: RichText): boolean {
  return textLength(rich) === 0;
}

function sameMarks(a: InlineSpan, b: InlineSpan): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.code === !!b.code &&
    a.link === b.link
  );
}

/** Drops empty spans and merges neighbours with identical formatting. */
export function normalize(rich: RichText): RichText {
  const out: RichText = [];
  for (const span of rich) {
    if (!span.text) continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, span)) last.text += span.text;
    else out.push({ ...span });
  }
  return out;
}

/** Characters [start, end), preserving the formatting each character carried. */
export function slice(rich: RichText, start: number, end: number): RichText {
  const out: RichText = [];
  let pos = 0;
  for (const span of rich) {
    const spanStart = pos;
    const spanEnd = pos + span.text.length;
    pos = spanEnd;
    if (spanEnd <= start) continue;
    if (spanStart >= end) break;
    const text = span.text.slice(
      Math.max(0, start - spanStart),
      Math.min(span.text.length, end - spanStart)
    );
    if (text) out.push({ ...span, text });
  }
  return normalize(out);
}

export function concat(a: RichText, b: RichText): RichText {
  return normalize([...a, ...b]);
}

export function equals(a: RichText, b: RichText): boolean {
  if (a.length !== b.length) return false;
  return a.every((span, i) => span.text === b[i].text && sameMarks(span, b[i]));
}
