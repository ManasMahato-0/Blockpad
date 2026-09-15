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

export type MarkName = "bold" | "italic" | "code";

function mapRange(
  rich: RichText,
  start: number,
  end: number,
  change: (span: InlineSpan) => InlineSpan
): RichText {
  const length = textLength(rich);
  const middle = slice(rich, start, end).map(change);
  return concat(concat(slice(rich, 0, start), middle), slice(rich, end, length));
}

/** True only when every character in [start, end) carries the mark. */
export function rangeHasMark(rich: RichText, start: number, end: number, mark: MarkName): boolean {
  if (end <= start) return false;
  const middle = slice(rich, start, end);
  return middle.length > 0 && middle.every((span) => !!span[mark]);
}

/**
 * The usual toggle rule: remove the mark if the whole range already has it,
 * otherwise apply it everywhere — so Bold on a half-bold selection makes all
 * of it bold instead of flipping each piece.
 */
export function toggleMark(rich: RichText, start: number, end: number, mark: MarkName): RichText {
  if (end <= start) return rich;
  const apply = !rangeHasMark(rich, start, end, mark);
  return mapRange(rich, start, end, (span) => {
    const next = { ...span };
    if (apply) next[mark] = true;
    else delete next[mark];
    return next;
  });
}

/** Sets the link on [start, end); an undefined href removes it. */
export function setLink(rich: RichText, start: number, end: number, href: string | undefined): RichText {
  if (end <= start) return rich;
  return mapRange(rich, start, end, (span) => {
    const next = { ...span };
    if (href) next.link = href;
    else delete next.link;
    return next;
  });
}

/** The link shared by the whole range, if the range is covered by exactly one. */
export function linkInRange(rich: RichText, start: number, end: number): string | undefined {
  const middle = slice(rich, start, end);
  const first = middle[0]?.link;
  return first && middle.every((span) => span.link === first) ? first : undefined;
}
