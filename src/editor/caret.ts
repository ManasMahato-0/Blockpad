/**
 * Translates between the browser's cursor model (a DOM node plus an offset
 * inside it) and ours (a single character offset within the block). Nothing
 * built in does this, and every split/merge/undo depends on it.
 */

function textNodesOf(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

export function getCaretOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;

  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return 0;

  let offset = 0;
  for (const node of textNodesOf(element)) {
    if (node === range.startContainer) return offset + range.startOffset;
    offset += node.length;
  }
  // caret sat on the element itself (e.g. an empty block) rather than in a text node
  return range.startContainer === element ? offset : 0;
}

export function setCaretOffset(element: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  let remaining = offset;

  const nodes = textNodesOf(element);
  if (nodes.length === 0) {
    range.setStart(element, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  for (const node of nodes) {
    if (remaining <= node.length) {
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= node.length;
  }

  const last = nodes[nodes.length - 1];
  range.setStart(last, last.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function textLengthOf(element: HTMLElement): number {
  return element.textContent?.length ?? 0;
}

export function isAtStart(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed) return false;
  return getCaretOffset(element) === 0;
}

export function isAtEnd(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed) return false;
  return getCaretOffset(element) === textLengthOf(element);
}

function caretRect(element: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return null;
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[0];
  // a collapsed caret in an empty block can report no rects at all
  const box = range.getBoundingClientRect();
  return box.height > 0 ? box : null;
}

function lineHeightOf(element: HTMLElement, fallback: number): number {
  const value = parseFloat(getComputedStyle(element).lineHeight);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Whether the caret is on the block's first visual line. ArrowUp should leave
 * for the block above from anywhere on that line: requiring offset 0 made it
 * take two presses, and in a wrapped paragraph it is simply wrong.
 */
export function isOnFirstLine(element: HTMLElement): boolean {
  const rect = caretRect(element);
  if (!rect) return true;
  const top = element.getBoundingClientRect().top;
  return rect.top - top < lineHeightOf(element, rect.height) * 0.75;
}

export function isOnLastLine(element: HTMLElement): boolean {
  const rect = caretRect(element);
  if (!rect) return true;
  const bottom = element.getBoundingClientRect().bottom;
  return bottom - rect.bottom < lineHeightOf(element, rect.height) * 0.75;
}

function offsetWithin(element: HTMLElement, container: Node, offset: number): number {
  const measure = document.createRange();
  measure.selectNodeContents(element);
  measure.setEnd(container, offset);
  return measure.toString().length;
}

/**
 * Where the caret should land when ArrowUp/ArrowDown crosses into another
 * block: the same horizontal position, on the target's nearest line. Falls
 * back to the end (moving up) or start (moving down) when the point misses —
 * for instance when the target is scrolled out of view.
 */
export function offsetForVerticalMove(
  from: HTMLElement,
  to: HTMLElement,
  direction: "up" | "down"
): number {
  const fallback = direction === "up" ? textLengthOf(to) : 0;
  const x = caretRect(from)?.left;
  if (x === undefined) return fallback;

  const box = to.getBoundingClientRect();
  const halfLine = lineHeightOf(to, 20) / 2;
  const y = direction === "up" ? box.bottom - halfLine : box.top + halfLine;

  // Browsers disagree on the name; both are called on document so `this` holds.
  const doc = document as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }

  if (!node || !to.contains(node)) return fallback;
  return offsetWithin(to, node, offset);
}

/** Start and end of the selection as character offsets within one block. */
export function getSelectionOffsets(element: HTMLElement): { start: number; end: number } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return { start: 0, end: 0 };
  const range = selection.getRangeAt(0);
  const start = element.contains(range.startContainer)
    ? offsetWithin(element, range.startContainer, range.startOffset)
    : 0;
  const end = element.contains(range.endContainer)
    ? offsetWithin(element, range.endContainer, range.endOffset)
    : textLengthOf(element);
  return { start, end: Math.max(start, end) };
}

/**
 * The selection inside one block: character offsets, plus the rectangle a
 * toolbar can anchor to. Null when the selection is collapsed or spills
 * outside this block.
 */
export function selectionInBlock(
  element: HTMLElement
): { start: number; end: number; rect: DOMRect } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const { start, end } = getSelectionOffsets(element);
  if (end <= start) return null;
  return { start, end, rect: range.getBoundingClientRect() };
}

/**
 * Selects characters [start, end) within one block. Applying a format
 * re-renders the block and destroys the selection; this puts it back, which
 * is what lets marks be stacked one after another.
 */
export function setSelectionOffsets(element: HTMLElement, start: number, end: number): void {
  const selection = window.getSelection();
  if (!selection) return;

  const nodes = textNodesOf(element);
  const locate = (target: number): [Node, number] => {
    let remaining = target;
    for (const node of nodes) {
      if (remaining <= node.length) return [node, remaining];
      remaining -= node.length;
    }
    const last = nodes[nodes.length - 1];
    return last ? [last, last.length] : [element, 0];
  };

  const range = document.createRange();
  const [startNode, startOffset] = locate(start);
  const [endNode, endOffset] = locate(end);
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  selection.removeAllRanges();
  selection.addRange(range);
}
