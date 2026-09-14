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
