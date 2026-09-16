import * as Y from "yjs";
import { equals, normalize, slice, toPlain } from "../model/richText";
import type { Block, BlockType, Doc, InlineSpan, RichText } from "../model/types";

/**
 * A shared page as Yjs data:
 *
 *   title  — Y.Text
 *   blocks — Y.Array of Y.Map { id, type, indent?, checked?, src?, alt?, content: Y.Text }
 *
 * Formatting lives on the text as attributes named after the marks. The
 * editor never sees any of this: it keeps working with plain Doc values, and
 * this file translates in both directions.
 */

/** Transaction origin for edits made on this device, so observers can tell them from remote ones. */
export const LOCAL_ORIGIN = "blockpad-local";

const MARKS = ["bold", "italic", "code", "link", "pageLink"] as const;
const SCALAR_FIELDS = ["type", "indent", "checked", "src", "alt"] as const;

type YBlock = Y.Map<unknown>;

export function sharedTypes(ydoc: Y.Doc) {
  return { title: ydoc.getText("title"), blocks: ydoc.getArray<YBlock>("blocks") };
}

/** Formatting attributes for a span. `clearing` sets absent marks to null, which removes them. */
function attributesOf(span: InlineSpan, clearing = false): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const mark of MARKS) {
    const value = span[mark];
    if (value) attributes[mark] = value;
    else if (clearing) attributes[mark] = null;
  }
  return attributes;
}

// ----------------------------------------------------------- Yjs → page --

export function yTextToRichText(ytext: Y.Text): RichText {
  const spans: RichText = [];
  for (const op of ytext.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof op.insert !== "string") continue;
    const span: InlineSpan = { text: op.insert };
    const attributes = op.attributes ?? {};
    if (attributes.bold) span.bold = true;
    if (attributes.italic) span.italic = true;
    if (attributes.code) span.code = true;
    if (typeof attributes.link === "string") span.link = attributes.link;
    if (typeof attributes.pageLink === "string") span.pageLink = attributes.pageLink;
    spans.push(span);
  }
  return normalize(spans);
}

function yBlockToBlock(map: YBlock): Block {
  const content = map.get("content");
  const block: Block = {
    id: String(map.get("id")),
    type: (map.get("type") as BlockType) ?? "paragraph",
    content: content instanceof Y.Text ? yTextToRichText(content) : [],
  };
  const indent = map.get("indent");
  if (typeof indent === "number" && indent > 0) block.indent = indent;
  const checked = map.get("checked");
  if (typeof checked === "boolean") block.checked = checked;
  const src = map.get("src");
  if (typeof src === "string") block.src = src;
  const alt = map.get("alt");
  if (typeof alt === "string") block.alt = alt;
  return block;
}

export function yToDoc(ydoc: Y.Doc): Doc {
  const { title, blocks } = sharedTypes(ydoc);
  return { title: title.toString(), blocks: blocks.toArray().map(yBlockToBlock) };
}

// ----------------------------------------------------------- page → Yjs --

const scalarOf = (block: Block, field: (typeof SCALAR_FIELDS)[number]) =>
  field === "indent" ? (block.indent ?? 0) || undefined : block[field];

function insertBlock(yblocks: Y.Array<YBlock>, index: number, block: Block, content?: RichText): void {
  const map: YBlock = new Y.Map();
  yblocks.insert(index, [map]);
  map.set("id", block.id);
  for (const field of SCALAR_FIELDS) {
    const value = scalarOf(block, field);
    if (value !== undefined) map.set(field, value);
  }
  const text = new Y.Text();
  map.set("content", text);
  let pos = 0;
  for (const span of content ?? block.content) {
    // passing attributes, even {}, stops the text inheriting its neighbour's formatting
    text.insert(pos, span.text, attributesOf(span));
    pos += span.text.length;
  }
}

/** Character-by-character formatting keys, for finding the unchanged start and end. */
function charKeys(rich: RichText): string[] {
  const keys: string[] = [];
  for (const span of rich) {
    const key = JSON.stringify(attributesOf(span));
    for (const ch of span.text.split("")) keys.push(ch + key);
  }
  return keys;
}

/**
 * Rewrites a Y.Text to match `next` with the smallest change: only the part
 * between the unchanged start and end is replaced. When only formatting
 * changed, the text is reformatted in place instead, so someone typing inside
 * that range at the same moment keeps their characters.
 */
export function updateText(ytext: Y.Text, next: RichText): void {
  const current = yTextToRichText(ytext);
  if (equals(current, next)) return;

  if (toPlain(current) === toPlain(next)) {
    let pos = 0;
    for (const span of next) {
      ytext.format(pos, span.text.length, attributesOf(span, true));
      pos += span.text.length;
    }
    return;
  }

  const before = charKeys(current);
  const after = charKeys(next);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }

  if (endBefore > start) ytext.delete(start, endBefore - start);
  let pos = start;
  for (const span of slice(next, start, endAfter)) {
    ytext.insert(pos, span.text, attributesOf(span));
    pos += span.text.length;
  }
}

function replacePlainText(ytext: Y.Text, next: string): void {
  const current = ytext.toString();
  if (current === next) return;
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start++;
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent--;
    endNext--;
  }
  if (endCurrent > start) ytext.delete(start, endCurrent - start);
  if (endNext > start) ytext.insert(start, next.slice(start, endNext));
}

/**
 * Brings the shared page in line with `next`, touching only what differs
 * from the shared state as it is right now. `previous`, when given, lets
 * blocks this edit didn't touch be skipped without reading their text.
 */
export function applyDocToY(ydoc: Y.Doc, next: Doc, previous?: Doc, origin: unknown = LOCAL_ORIGIN): void {
  const { title, blocks } = sharedTypes(ydoc);
  const untouched = new Set(previous?.blocks ?? []);

  ydoc.transact(() => {
    replacePlainText(title, next.title);

    const wanted = new Set(next.blocks.map((block) => block.id));
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (!wanted.has(String(blocks.get(i).get("id")))) blocks.delete(i, 1);
    }

    next.blocks.forEach((block, index) => {
      const atIndex = index < blocks.length ? blocks.get(index) : undefined;

      if (!atIndex || atIndex.get("id") !== block.id) {
        const from = blocks.toArray().findIndex((map, i) => i > index && map.get("id") === block.id);
        if (from === -1) {
          insertBlock(blocks, index, block);
        } else {
          // Yjs lists have no move: the block is re-created at its new place,
          // carrying the shared text as it is now
          const moved = blocks.get(from);
          const content = moved.get("content");
          const carried = content instanceof Y.Text ? yTextToRichText(content) : block.content;
          blocks.delete(from, 1);
          insertBlock(blocks, index, block, equals(carried, block.content) ? carried : block.content);
        }
        return;
      }

      if (untouched.has(block)) return;
      for (const field of SCALAR_FIELDS) {
        const value = scalarOf(block, field);
        if (atIndex.get(field) === value) continue;
        if (value === undefined) atIndex.delete(field);
        else atIndex.set(field, value);
      }
      const content = atIndex.get("content");
      if (content instanceof Y.Text) updateText(content, block.content);
      else {
        const text = new Y.Text();
        atIndex.set("content", text);
        updateText(text, block.content);
      }
    });
  }, origin);
}

export { transformOffset } from "../model/textDelta";

// ----------------------------------------------------------- cursors --

/** The shared text behind a line — "title" or a block id — if it exists yet. */
export function textForKey(ydoc: Y.Doc, key: string): Y.Text | null {
  const { title, blocks } = sharedTypes(ydoc);
  if (key === "title") return title;
  for (const map of blocks) {
    if (map.get("id") !== key) continue;
    const content = map.get("content");
    return content instanceof Y.Text ? content : null;
  }
  return null;
}

/** Which line a piece of shared text belongs to. */
export function keyForText(ydoc: Y.Doc, ytext: Y.Text): string | null {
  if (ytext === sharedTypes(ydoc).title) return "title";
  const parent = ytext.parent;
  return parent instanceof Y.Map ? String(parent.get("id")) : null;
}
