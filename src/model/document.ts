import { CONTINUING_BLOCKS, VOID_BLOCKS } from "./types";
import type { Block, BlockType, Doc, RichText } from "./types";
import { concat, isEmpty, slice, textLength } from "./richText";

export interface Caret {
  blockId: string;
  offset: number;
}

export function createBlock(type: BlockType = "paragraph", content: RichText = []): Block {
  return { id: crypto.randomUUID(), type, content };
}

export function emptyDoc(): Doc {
  return { title: "", blocks: [createBlock()] };
}

export function findIndex(doc: Doc, blockId: string): number {
  return doc.blocks.findIndex((b) => b.id === blockId);
}

export function getBlock(doc: Doc, blockId: string): Block | undefined {
  return doc.blocks.find((b) => b.id === blockId);
}

export function setBlockContent(doc: Doc, blockId: string, content: RichText): Doc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.id === blockId ? { ...b, content } : b)),
  };
}

export function setBlockType(doc: Doc, blockId: string, type: BlockType): Doc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.id === blockId ? { ...b, type } : b)),
  };
}

export function toggleChecked(doc: Doc, blockId: string): Doc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.id === blockId ? { ...b, checked: !b.checked } : b)),
  };
}

export function insertBlockAfter(doc: Doc, afterId: string, block: Block): Doc {
  const i = findIndex(doc, afterId);
  if (i === -1) return doc;
  const blocks = [...doc.blocks];
  blocks.splice(i + 1, 0, block);
  return { ...doc, blocks };
}

export function deleteBlock(doc: Doc, blockId: string): Doc {
  const blocks = doc.blocks.filter((b) => b.id !== blockId);
  return { ...doc, blocks: blocks.length > 0 ? blocks : [createBlock()] };
}

export function moveBlock(doc: Doc, fromIndex: number, toIndex: number): Doc {
  if (fromIndex === toIndex) return doc;
  const blocks = [...doc.blocks];
  const [moved] = blocks.splice(fromIndex, 1);
  if (!moved) return doc;
  blocks.splice(toIndex, 0, moved);
  return { ...doc, blocks };
}

export const MAX_INDENT = 6;

/**
 * A block may sit at most one level deeper than the one above it — otherwise
 * you can strand a block four levels in under a top-level line, which no list
 * structure can express.
 */
export function indentBlock(doc: Doc, blockId: string): Doc {
  const index = findIndex(doc, blockId);
  const block = doc.blocks[index];
  if (!block) return doc;

  const previous = doc.blocks[index - 1];
  const ceiling = previous ? Math.min((previous.indent ?? 0) + 1, MAX_INDENT) : 0;
  const next = Math.min((block.indent ?? 0) + 1, ceiling);
  if (next === (block.indent ?? 0)) return doc;

  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.id === blockId ? { ...b, indent: next } : b)),
  };
}

export function outdentBlock(doc: Doc, blockId: string): Doc {
  const block = getBlock(doc, blockId);
  if (!block || (block.indent ?? 0) === 0) return doc;
  return {
    ...doc,
    blocks: doc.blocks.map((b) =>
      b.id === blockId ? { ...b, indent: (b.indent ?? 0) - 1 } : b
    ),
  };
}

export function splitBlock(doc: Doc, blockId: string, offset: number): { doc: Doc; caret: Caret } {
  const block = getBlock(doc, blockId);
  if (!block) return { doc, caret: { blockId, offset } };

  const before = slice(block.content, 0, offset);
  const after = slice(block.content, offset, textLength(block.content));
  const newType = CONTINUING_BLOCKS.has(block.type) ? block.type : "paragraph";
  const newBlock = createBlock(newType, after);
  newBlock.indent = block.indent ?? 0;

  const withTrimmed = setBlockContent(doc, blockId, before);
  return {
    doc: insertBlockAfter(withTrimmed, blockId, newBlock),
    caret: { blockId: newBlock.id, offset: 0 },
  };
}

/**
 * Enter on an empty list item exits the list instead of making another one —
 * without this, lists are a trap you can't get out of with the keyboard.
 */
export function pressEnter(doc: Doc, blockId: string, offset: number): { doc: Doc; caret: Caret } {
  const block = getBlock(doc, blockId);
  if (!block) return { doc, caret: { blockId, offset } };

  if (CONTINUING_BLOCKS.has(block.type) && isEmpty(block.content)) {
    return { doc: setBlockType(doc, blockId, "paragraph"), caret: { blockId, offset: 0 } };
  }
  return splitBlock(doc, blockId, offset);
}

/**
 * Backspace at offset 0. Demoting a styled block to a paragraph takes priority
 * over merging, so the first backspace never eats the line above.
 */
export function pressBackspaceAtStart(doc: Doc, blockId: string): { doc: Doc; caret: Caret } | null {
  const index = findIndex(doc, blockId);
  const block = doc.blocks[index];
  if (!block) return null;

  if (block.type !== "paragraph") {
    return { doc: setBlockType(doc, blockId, "paragraph"), caret: { blockId, offset: 0 } };
  }

  const previous = doc.blocks[index - 1];
  if (!previous) return null;

  if (VOID_BLOCKS.has(previous.type)) {
    return { doc: deleteBlock(doc, previous.id), caret: { blockId, offset: 0 } };
  }

  const joinOffset = textLength(previous.content);
  const merged = setBlockContent(doc, previous.id, concat(previous.content, block.content));
  return {
    doc: deleteBlock(merged, blockId),
    caret: { blockId: previous.id, offset: joinOffset },
  };
}

/**
 * Delete at the end of a block — the mirror of Backspace at the start. Pulls
 * the next block's text up onto this line; an image or divider below is
 * removed instead of merged.
 */
export function pressDeleteAtEnd(doc: Doc, blockId: string): { doc: Doc; caret: Caret } | null {
  const index = findIndex(doc, blockId);
  const block = doc.blocks[index];
  const below = doc.blocks[index + 1];
  if (!block || !below) return null;

  const joinOffset = textLength(block.content);
  if (VOID_BLOCKS.has(below.type)) {
    return { doc: deleteBlock(doc, below.id), caret: { blockId, offset: joinOffset } };
  }

  const merged = setBlockContent(doc, blockId, concat(block.content, below.content));
  return { doc: deleteBlock(merged, below.id), caret: { blockId, offset: joinOffset } };
}

/**
 * Pasting several lines. The first joins the text before the caret, the last
 * takes the text that was after it, and each line in between becomes its own
 * block. New blocks follow the Enter rule: pasting into a bullet gives
 * bullets, pasting into a heading gives paragraphs after the first line.
 */
export function insertLines(
  doc: Doc,
  blockId: string,
  offset: number,
  lines: RichText[]
): { doc: Doc; caret: Caret } {
  const block = getBlock(doc, blockId);
  if (!block || lines.length === 0) return { doc, caret: { blockId, offset } };

  const before = slice(block.content, 0, offset);
  const after = slice(block.content, offset, textLength(block.content));

  if (lines.length === 1) {
    return {
      doc: setBlockContent(doc, blockId, concat(concat(before, lines[0]), after)),
      caret: { blockId, offset: offset + textLength(lines[0]) },
    };
  }

  const newType = CONTINUING_BLOCKS.has(block.type) ? block.type : "paragraph";
  let next = setBlockContent(doc, blockId, concat(before, lines[0]));
  let previousId = blockId;

  for (let i = 1; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    const created = createBlock(newType, isLast ? concat(lines[i], after) : lines[i]);
    created.indent = block.indent ?? 0;
    next = insertBlockAfter(next, previousId, created);
    previousId = created.id;
  }

  return {
    doc: next,
    caret: { blockId: previousId, offset: textLength(lines[lines.length - 1]) },
  };
}
