/** Characters retained, inserted or deleted in one line by a remote edit (Yjs delta form). */
export type TextDelta = { retain?: number; insert?: unknown; delete?: number }[];

/**
 * Where a caret at `offset` ends up after a remote change to its text.
 * Text inserted exactly at the caret goes after it, so a remote writer
 * can't push your cursor along while you type.
 *
 * Lives outside the Yjs code so the editor can use it without pulling Yjs
 * into the bundle for people who never share a page.
 */
export function transformOffset(offset: number, delta: TextDelta): number {
  let index = 0;
  let result = offset;
  for (const op of delta) {
    if (op.retain !== undefined) {
      index += op.retain;
    } else if (op.insert !== undefined) {
      const length = typeof op.insert === "string" ? op.insert.length : 1;
      if (index < offset) result += length;
    } else if (op.delete !== undefined) {
      if (index < offset) result -= Math.min(op.delete, offset - index);
      index += op.delete;
    }
    if (index >= offset && op.insert === undefined) break;
  }
  return Math.max(0, result);
}

/** A caret carried through several remote changes, applied in the order they happened. */
export function transformOffsetThrough(offset: number, deltas: TextDelta[]): number {
  return deltas.reduce((position, delta) => transformOffset(position, delta), offset);
}
