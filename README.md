# Blockpad

A block-based document editor in the browser, in the style of Notion. Every paragraph, heading and list item is an independent block you can type in, convert, indent and drag around.

**[Try it live →](https://blockpad-five.vercel.app)**

Built from scratch with React and TypeScript — no editor framework. Everything below `contenteditable` is hand-written: cursor tracking, splitting and merging blocks, the slash menu, undo history.

## What it does

- **Slash menu** — type `/` to insert or convert a block: text, three heading levels, bulleted, numbered and to-do lists, quote, divider. Filters as you type; arrow keys and Enter to choose.
- **Markdown shortcuts** — `# ` becomes a heading, `- ` a bullet, `1. ` a numbered item, `> ` a quote, `[] ` a to-do.
- **Nested lists** — Tab and Shift+Tab indent and outdent. Numbering restarts per level and resumes when you come back out.
- **Drag to reorder** — grab the handle that appears on hover.
- **Undo and redo** — continuous typing collapses into one step; structural edits are their own.
- **Autosave** — saved to local storage as you type, and flushed when the tab closes.

### Keyboard

| Keys | Action |
| --- | --- |
| `/` | Open the block menu |
| `Enter` | Split the block at the cursor; on an empty list item, leave the list |
| `Backspace` at line start | Turn a styled block back into text, or merge into the line above |
| `Tab` / `Shift+Tab` | Indent / outdent |
| `Ctrl/Cmd + B`, `Ctrl/Cmd + I` | Bold, italic |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z`, `Ctrl + Y` | Redo |

## How it works

**One `contenteditable` per block, not one for the whole document.** A single editable region means fighting the browser over DOM structure on every keystroke. Per-block keeps native cursor behaviour inside a line, and makes cross-block operations explicit.

**A pure document model.** The document is plain data — blocks holding runs of formatted text. Every operation (split, merge, move, indent, change type) is a pure function that returns a new document. That makes the core directly unit-testable, and makes undo history a list of previous versions.

**The DOM is the source of truth while you type.** If React re-rendered a block's content on every keystroke, the cursor would jump to the start. So typing never touches the model; the block's text is committed back at structural moments — Enter, Backspace at a line start, switching blocks — and on a short debounce for autosave.

**Cursor translation.** Browsers report the cursor as a DOM node plus an offset inside it. The model wants a single character offset within a block. `src/editor/caret.ts` converts between the two in both directions, which is what lets a merge land the cursor exactly at the seam.

### Problems worth knowing about

Most bugs in this project were timing and lifecycle problems between React and the DOM, not logic errors — the pure model was correct every time.

- **State updaters must be pure.** React's StrictMode calls `setState` updater functions twice. Generating block IDs inside one minted two different IDs and left the cursor pointing at a block that didn't exist; mutating undo history inside one pushed and popped every entry twice.
- **React only cleans up what React created.** Converting a paragraph into a list reused the same `<div>` as a new layout container, and text written into it with `innerHTML` survived inside it. Keying each block's markup by its type forces a clean remount.
- **Debounced work outlives the moment it was scheduled for.** An autosave commit could fire after you had pressed Enter and moved on, dragging the cursor back to the old line. It now no-ops when nothing changed, and never moves a cursor that has left the block.

## Running it

```bash
npm install
npm run dev      # development server
npm test         # unit tests
npm run build    # production build
```

Unit tests cover the document model: text slicing, the Enter and Backspace rules, indentation limits and the markdown shortcut matcher.

## Stack

React 19, TypeScript, Vite, Tailwind CSS v4, Vitest.

## Scope

Deliberately left out: multi-block selection, image upload, real-time collaboration, and multiple documents. Everything is stored in the browser's local storage.
