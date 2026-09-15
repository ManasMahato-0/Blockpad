import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Caret } from "../model/document";
import {
  createBlock,
  findIndex,
  getBlock,
  indentBlock,
  insertBlockAfter,
  insertLines,
  moveBlock,
  outdentBlock,
  pressBackspaceAtStart,
  pressDeleteAtEnd,
  pressEnter,
  setBlockContent,
  setBlockType,
  toggleChecked,
} from "../model/document";
import type { Doc, RichText } from "../model/types";
import { VOID_BLOCKS } from "../model/types";
import {
  concat,
  equals,
  linkInRange,
  rangeHasMark,
  setLink,
  slice,
  textLength,
  toggleMark,
  type MarkName,
} from "../model/richText";
import { BlockView } from "./BlockView";
import { SlashMenu, type CaretAnchor } from "./SlashMenu";
import { FormatToolbar, type ActiveMarks, type SelectionAnchor } from "./FormatToolbar";
import { clipboardToLines, domToRichText, safeHref } from "./serialize";
import {
  getCaretOffset,
  getSelectionOffsets,
  isAtEnd,
  isAtStart,
  isOnFirstLine,
  isOnLastLine,
  offsetForVerticalMove,
  selectionInBlock,
  setCaretOffset,
  setSelectionOffsets,
  textLengthOf,
} from "./caret";
import { filterCommands, matchMarkdownShortcut, type BlockCommand } from "./commands";
import { useDocumentState } from "./useDocumentState";

interface SlashState {
  blockId: string;
  /** Index of the "/" character within the block. */
  startOffset: number;
  query: string;
  anchor: CaretAnchor;
}

interface DragState {
  blockId: string;
  fromIndex: number;
}

interface ToolbarState {
  blockId: string;
  start: number;
  end: number;
  anchor: SelectionAnchor;
  active: ActiveMarks;
  linkMode: boolean;
}

/** Bullet shape changes with depth, the way nested lists conventionally do. */
const BULLET_GLYPHS = ["•", "◦", "▪"];

function caretAnchor(el: HTMLElement): CaretAnchor {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.top !== 0 || rect.left !== 0) {
      return { top: rect.top, bottom: rect.bottom, left: rect.left };
    }
  }
  const fallback = el.getBoundingClientRect();
  return { top: fallback.top, bottom: fallback.bottom, left: fallback.left };
}

function activeMarksIn(content: RichText, start: number, end: number): ActiveMarks {
  return {
    bold: rangeHasMark(content, start, end, "bold"),
    italic: rangeHasMark(content, start, end, "italic"),
    code: rangeHasMark(content, start, end, "code"),
    link: linkInRange(content, start, end),
  };
}

interface EditorProps {
  pageId: string;
  onTitleChange: (title: string) => void;
}

export function Editor({ pageId, onTitleChange }: EditorProps) {
  const { doc, applyChange, undo, redo, saved, saveNow } = useDocumentState(pageId);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);

  const elements = useRef(new Map<string, HTMLDivElement>());
  const wrappers = useRef(new Map<string, HTMLDivElement>());
  const pendingCaret = useRef<Caret | null>(null);
  const pendingSelection = useRef<{ blockId: string; start: number; end: number } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const matches = slash ? filterCommands(slash.query) : [];

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) elements.current.set(id, el);
    else elements.current.delete(id);
  }, []);

  const registerWrapper = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) wrappers.current.set(id, el);
    else wrappers.current.delete(id);
  }, []);

  // Structural edits say where the cursor belongs; place it once the DOM exists.
  // A pending selection wins: formatting has to leave the same text selected.
  useLayoutEffect(() => {
    const range = pendingSelection.current;
    if (range) {
      pendingSelection.current = null;
      const target = elements.current.get(range.blockId);
      if (target) {
        target.focus();
        setSelectionOffsets(target, range.start, range.end);
      }
      return;
    }
    const caret = pendingCaret.current;
    if (!caret) return;
    pendingCaret.current = null;
    const el = elements.current.get(caret.blockId);
    if (!el) return;
    el.focus();
    setCaretOffset(el, caret.offset);
  });

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el || document.activeElement === el) return;
    if (el.textContent !== doc.title) el.textContent = doc.title;
  }, [doc.title]);

  useEffect(() => {
    onTitleChange(doc.title);
  }, [doc.title, onTitleChange]);

  /**
   * Pull a block's live DOM text back into the model before operating on it.
   * Returns the document untouched when nothing actually changed, so a late
   * debounced commit can't add a duplicate history entry or trigger a render.
   */
  const commit = useCallback((current: Doc, blockId: string): Doc => {
    const el = elements.current.get(blockId);
    if (!el) return current;
    const block = getBlock(current, blockId);
    const next = domToRichText(el);
    if (block && equals(block.content, next)) return current;
    return setBlockContent(current, blockId, next);
  }, []);

  const focusBlock = (blockId: string, offset: number) => {
    pendingCaret.current = { blockId, offset };
    const el = elements.current.get(blockId);
    if (el) {
      el.focus();
      setCaretOffset(el, offset);
      pendingCaret.current = null;
    }
  };

  const closeSlash = () => {
    setSlash(null);
    setActiveIndex(0);
  };

  /**
   * Typing never touches the model (that's what keeps the caret stable), so
   * without this nothing you type would be saved or undoable until the next
   * structural edit. Committing rewrites the block's HTML — the browser emits
   * <b> where we emit <strong> — so the caret is captured and restored through
   * the same path splits and merges use.
   */
  const typingCommit = useRef<number | null>(null);
  const typingBlockId = useRef<string | null>(null);

  const commitTyping = useCallback(
    (blockId: string) => {
      const el = elements.current.get(blockId);
      if (!el) return;
      const next = commit(docRef.current, blockId);
      if (next === docRef.current) return;
      // Only reposition the caret if the user is still in this block — the
      // commit can land after they have moved on, and would otherwise drag
      // them back to where they were typing.
      if (document.activeElement === el) {
        pendingCaret.current = { blockId, offset: getCaretOffset(el) };
      }
      applyChange(next, "typing");
    },
    [applyChange, commit]
  );

  const scheduleTypingCommit = useCallback(
    (blockId: string) => {
      if (typingCommit.current) window.clearTimeout(typingCommit.current);
      // Typing moved to another block before the previous one was committed.
      // Cancelling its timer used to drop that text entirely; commit it now.
      if (typingBlockId.current && typingBlockId.current !== blockId) {
        commitTyping(typingBlockId.current);
      }
      typingBlockId.current = blockId;
      typingCommit.current = window.setTimeout(() => {
        typingBlockId.current = null;
        commitTyping(blockId);
      }, 600);
    },
    [commitTyping]
  );

  // Switching pages unmounts the editor, and typing still waiting on its
  // debounce exists only in the DOM. A layout-effect cleanup runs while the
  // blocks are still attached, so commit every block and save synchronously.
  useLayoutEffect(
    () => () => {
      if (typingCommit.current) window.clearTimeout(typingCommit.current);
      let latest = docRef.current;
      for (const id of elements.current.keys()) latest = commit(latest, id);
      saveNow(latest);
    },
    [commit, saveNow]
  );

  /**
   * Undo/redo live on the document, not on the blocks: an undo can delete the
   * very block that had focus, and once focus is gone a block-level handler
   * never sees the next keystroke. Also suppresses the browser's own
   * contenteditable undo stack, which knows nothing about blocks.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;

      event.preventDefault();
      if (typingCommit.current) window.clearTimeout(typingCommit.current);
      if (key === "y" || event.shiftKey) redo();
      else undo();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  /** Reads the live selection into toolbar state, or hides the toolbar. */
  const readSelection = useCallback(() => {
    const focused = document.activeElement;
    // typing a link address moves focus into the toolbar itself; keep it open
    if (focused instanceof HTMLElement && focused.closest("[data-format-toolbar]")) return;

    const blockId = focused instanceof HTMLElement ? focused.getAttribute("data-block-id") : null;
    const el = blockId ? elements.current.get(blockId) : undefined;
    const selected = el ? selectionInBlock(el) : null;
    if (!blockId || !el || !selected) {
      setToolbar(null);
      return;
    }

    const { start, end, rect } = selected;
    const active = activeMarksIn(domToRichText(el), start, end);
    const anchor = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    setToolbar((current) => ({
      blockId,
      start,
      end,
      anchor,
      active,
      linkMode:
        current !== null && current.blockId === blockId && current.start === start && current.end === end
          ? current.linkMode
          : false,
    }));
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    window.addEventListener("scroll", readSelection, true);
    window.addEventListener("resize", readSelection);
    return () => {
      document.removeEventListener("selectionchange", readSelection);
      window.removeEventListener("scroll", readSelection, true);
      window.removeEventListener("resize", readSelection);
    };
  }, [readSelection]);

  const restoreSelection = (blockId: string, start: number, end: number) => {
    const el = elements.current.get(blockId);
    if (!el) return;
    el.focus();
    setSelectionOffsets(el, start, end);
  };

  /**
   * Formatting goes through the model rather than execCommand, which writes
   * <b> where the renderer writes <strong>. The selection is restored after
   * the re-render so marks can be stacked one after another.
   */
  const applyMark = (blockId: string, start: number, end: number, mark: MarkName) => {
    if (end <= start) return;
    const committed = commit(doc, blockId);
    const block = getBlock(committed, blockId);
    if (!block) return;
    if (typingCommit.current) window.clearTimeout(typingCommit.current);
    pendingSelection.current = { blockId, start, end };
    applyChange(setBlockContent(committed, blockId, toggleMark(block.content, start, end, mark)));
  };

  /** Bare domains get https://; anything that still isn't a safe URL is refused. */
  const normaliseHref = (input: string): string | undefined => {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
    return safeHref(hasScheme ? trimmed : "https://" + trimmed);
  };

  const applyLink = (href: string | undefined) => {
    if (!toolbar) return;
    const { blockId, start, end } = toolbar;
    let target: string | undefined;
    if (href !== undefined) {
      target = normaliseHref(href);
      if (!target) return;
    }
    const committed = commit(doc, blockId);
    const block = getBlock(committed, blockId);
    if (!block || end <= start) return;
    pendingSelection.current = { blockId, start, end };
    applyChange(setBlockContent(committed, blockId, setLink(block.content, start, end, target)));
  };

  /** Removes the "/query" text, then converts the block to the chosen type. */
  const applyCommand = (command: BlockCommand) => {
    if (!slash) return;
    const { blockId, startOffset, query } = slash;
    closeSlash();

    const committed = commit(doc, blockId);
    const block = getBlock(committed, blockId);
    if (!block) return;

    const stripped = concat(
      slice(block.content, 0, startOffset),
      slice(block.content, startOffset + 1 + query.length, textLength(block.content))
    );

    let next = setBlockContent(committed, blockId, stripped);

    if (command.type === "divider") {
      // a divider has no text of its own, so leave a paragraph to keep typing in
      next = setBlockType(next, blockId, "divider");
      const paragraph = createBlock("paragraph");
      next = insertBlockAfter(next, blockId, paragraph);
      pendingCaret.current = { blockId: paragraph.id, offset: 0 };
    } else {
      next = setBlockType(next, blockId, command.type);
      pendingCaret.current = { blockId, offset: startOffset };
    }

    applyChange(next);
  };

  /**
   * Dismissal. selectionchange covers every way the caret can leave the query
   * — arrow keys, clicking elsewhere in the block, focus moving to another
   * block — without a handler per case. It can fire before React has stored
   * the latest query, so this reads the live DOM text instead of comparing
   * against possibly-stale state.
   */
  useEffect(() => {
    if (!slash) return;

    const onSelectionChange = () => {
      const el = elements.current.get(slash.blockId);
      if (!el) return closeSlash();

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      if (!el.contains(selection.anchorNode)) return closeSlash();

      const text = el.textContent ?? "";
      if (text[slash.startOffset] !== "/") return closeSlash();

      const caret = getCaretOffset(el);
      if (caret <= slash.startOffset) return closeSlash();
      if (/\s/.test(text.slice(slash.startOffset + 1, caret))) return closeSlash();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="listbox"]')) return;
      closeSlash();
    };

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [slash]);

  // --- dragging blocks ------------------------------------------------------

  const startDrag = (event: React.PointerEvent, blockId: string) => {
    event.preventDefault();
    const fromIndex = findIndex(doc, blockId);
    if (fromIndex === -1) return;
    setToolbar(null);
    setDrag({ blockId, fromIndex });
    setDropIndex(fromIndex);
  };

  useEffect(() => {
    if (!drag) return;

    const indexForY = (y: number): number => {
      const blocks = docRef.current.blocks;
      for (let i = 0; i < blocks.length; i++) {
        const rect = wrappers.current.get(blocks[i].id)?.getBoundingClientRect();
        if (!rect) continue;
        if (y < rect.top + rect.height / 2) return i;
      }
      return blocks.length;
    };

    const onMove = (event: PointerEvent) => setDropIndex(indexForY(event.clientY));

    const onUp = (event: PointerEvent) => {
      const target = indexForY(event.clientY);
      // dropping below itself: removing the block first shifts everything up one
      const adjusted = target > drag.fromIndex ? target - 1 : target;
      if (adjusted !== drag.fromIndex) {
        applyChange(moveBlock(docRef.current, drag.fromIndex, adjusted));
      }
      setDrag(null);
      setDropIndex(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag]);

  // --- keyboard -------------------------------------------------------------

  /**
   * Paste is always handled here. Left to the browser, it injects the source
   * page's markup — colours, font sizes, headings — straight into the block,
   * and multi-line text lands as one block with newlines inside it.
   */
  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>, blockId: string) => {
    const el = elements.current.get(blockId);
    if (!el) return;
    event.preventDefault();

    const html = event.clipboardData.getData("text/html");
    const plain = event.clipboardData.getData("text/plain");
    let lines = clipboardToLines(html, plain);
    if (lines.length === 0 && plain) lines = clipboardToLines("", plain);
    if (lines.length === 0) return;

    if (typingCommit.current) window.clearTimeout(typingCommit.current);
    closeSlash();

    const { start, end } = getSelectionOffsets(el);
    let next = commit(doc, blockId);
    const block = getBlock(next, blockId);
    if (!block) return;
    if (end > start) {
      next = setBlockContent(
        next,
        blockId,
        concat(slice(block.content, 0, start), slice(block.content, end, textLength(block.content)))
      );
    }

    const result = insertLines(next, blockId, start, lines);
    pendingCaret.current = result.caret;
    applyChange(result.doc);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, blockId: string) => {
    const el = elements.current.get(blockId);
    if (!el) return;

    // The slash menu owns these keys while it is open, otherwise Enter would
    // split the block instead of choosing a command.
    if (slash) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(matches.length, 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % Math.max(matches.length, 1));
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const command = matches[activeIndex];
        if (command) {
          event.preventDefault();
          applyCommand(command);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeSlash();
        return;
      }
    }

    // Only a slash that starts a word opens the menu, so "and/or" and URLs
    // type normally.
    if (event.key === "/") {
      const offset = getCaretOffset(el);
      const charBefore = (el.textContent ?? "")[offset - 1];
      if (offset === 0 || charBefore === undefined || /\s/.test(charBefore)) {
        setSlash({ blockId, startOffset: offset, query: "", anchor: caretAnchor(el) });
        setActiveIndex(0);
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
      const key = event.key.toLowerCase();
      const shortcutMarks: Record<string, MarkName> = { b: "bold", i: "italic", e: "code" };
      if (Object.hasOwn(shortcutMarks, key)) {
        event.preventDefault();
        const { start, end } = getSelectionOffsets(el);
        if (end > start) {
          applyMark(blockId, start, end, shortcutMarks[key]);
        } else if (key !== "e") {
          // With nothing selected, Ctrl+B means "type the next characters in
          // bold" — a typing state rather than a range, which the browser
          // already tracks. The <b> it produces is read back as bold on the
          // next commit. Inline code has no browser equivalent, so Ctrl+E
          // needs a selection.
          document.execCommand(key === "b" ? "bold" : "italic");
        }
        return;
      }
      if (key === "k") {
        event.preventDefault();
        const selected = selectionInBlock(el);
        if (!selected) return;
        const { start, end, rect } = selected;
        setToolbar({
          blockId,
          start,
          end,
          anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
          active: activeMarksIn(domToRichText(el), start, end),
          linkMode: true,
        });
        return;
      }
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const committed = commit(doc, blockId);
      const next = event.shiftKey
        ? outdentBlock(committed, blockId)
        : indentBlock(committed, blockId);
      if (next !== doc) {
        pendingCaret.current = { blockId, offset: getCaretOffset(el) };
        applyChange(next);
      }
      return;
    }

    if (event.key === " ") {
      const offset = getCaretOffset(el);
      const textBefore = (el.textContent ?? "").slice(0, offset);
      const match = matchMarkdownShortcut(textBefore);
      if (match) {
        event.preventDefault();
        const committed = commit(doc, blockId);
        const block = getBlock(committed, blockId);
        if (!block) return;
        const stripped = slice(block.content, match.triggerLength, textLength(block.content));
        let next = setBlockContent(committed, blockId, stripped);
        next = setBlockType(next, blockId, match.type);
        for (let level = 0; level < match.indent; level++) {
          next = indentBlock(next, blockId);
        }
        pendingCaret.current = { blockId, offset: 0 };
        applyChange(next);
        return;
      }
    }

    // These run outside the state updater on purpose: updaters must be pure,
    // and StrictMode invokes them twice — which would mint two different block
    // ids and leave the caret pointing at the one React threw away.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const offset = getCaretOffset(el);
      const { doc: next, caret } = pressEnter(commit(doc, blockId), blockId, offset);
      pendingCaret.current = caret;
      applyChange(next);
      return;
    }

    // Merges read the neighbouring block as well, and its latest typing may
    // still be in the DOM waiting on the debounced commit. Committing only the
    // current block let Delete merge in an empty line and then remove it —
    // silently losing the text below. Commit both first.
    if (event.key === "Backspace" && isAtStart(el)) {
      const previous = doc.blocks[findIndex(doc, blockId) - 1];
      let committed = commit(doc, blockId);
      if (previous) committed = commit(committed, previous.id);
      const result = pressBackspaceAtStart(committed, blockId);
      if (result) {
        event.preventDefault();
        pendingCaret.current = result.caret;
        applyChange(result.doc);
      }
      return;
    }

    if (event.key === "Delete" && isAtEnd(el)) {
      const below = doc.blocks[findIndex(doc, blockId) + 1];
      let committed = commit(doc, blockId);
      if (below) committed = commit(committed, below.id);
      const result = pressDeleteAtEnd(committed, blockId);
      if (result) {
        event.preventDefault();
        pendingCaret.current = result.caret;
        applyChange(result.doc);
      }
      return;
    }

    // Leave from anywhere on the first/last visual line, landing at the same
    // horizontal position. Shift+arrow is left alone so text selection works.
    if (event.key === "ArrowUp" && !event.shiftKey && isOnFirstLine(el)) {
      const index = findIndex(doc, blockId);
      const previous = doc.blocks[index - 1];
      const target = previous && elements.current.get(previous.id);
      if (previous && target && !VOID_BLOCKS.has(previous.type)) {
        event.preventDefault();
        const offset = offsetForVerticalMove(el, target, "up");
        applyChange(commit(doc, blockId));
        focusBlock(previous.id, offset);
      }
      return;
    }

    if (event.key === "ArrowDown" && !event.shiftKey && isOnLastLine(el)) {
      const index = findIndex(doc, blockId);
      const next = doc.blocks[index + 1];
      const target = next && elements.current.get(next.id);
      if (next && target && !VOID_BLOCKS.has(next.type)) {
        event.preventDefault();
        const offset = offsetForVerticalMove(el, target, "down");
        applyChange(commit(doc, blockId));
        focusBlock(next.id, offset);
      }
      return;
    }
  };

  /** Keeps the slash query in step with what has actually been typed. */
  const handleInput = (blockId: string, el: HTMLDivElement) => {
    scheduleTypingCommit(blockId);
    if (!slash || slash.blockId !== blockId) return;
    const text = el.textContent ?? "";
    if (text[slash.startOffset] !== "/") {
      closeSlash();
      return;
    }
    const caret = getCaretOffset(el);
    if (caret <= slash.startOffset) {
      closeSlash();
      return;
    }
    setSlash({ ...slash, query: text.slice(slash.startOffset + 1, caret) });
    setActiveIndex(0);
  };

  const dropLine = <div className="h-0.5 rounded-full bg-blue-500" aria-hidden="true" />;
  // one counter per depth: going deeper restarts at 1, coming back out resumes
  const counters: number[] = [];

  return (
    <div className="mx-auto min-h-full w-full max-w-[720px] px-14 py-16">
      <div
        className="pointer-events-none fixed right-5 top-4 text-xs text-neutral-400"
        aria-live="polite"
      >
        {saved ? "Saved" : "Saving…"}
      </div>
      <h1
        ref={titleRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Document title"
        className="title-field mb-6 text-[40px] font-bold tracking-tight text-neutral-900 outline-none"
        data-empty={doc.title.length === 0}
        data-placeholder="Untitled"
        onInput={(event) => {
          const el = event.currentTarget;
          el.dataset.empty = String((el.textContent?.length ?? 0) === 0);
          applyChange({ ...docRef.current, title: el.textContent ?? "" });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            focusBlock(doc.blocks[0].id, 0);
          }
        }}
        onPaste={(event) => {
          // a title is one line of plain text, whatever was copied
          event.preventDefault();
          const firstLine = event.clipboardData.getData("text/plain").split(/\r?\n/)[0] ?? "";
          if (firstLine) document.execCommand("insertText", false, firstLine);
        }}
      />

      <div
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const last = doc.blocks[doc.blocks.length - 1];
            const el = elements.current.get(last.id);
            if (el) focusBlock(last.id, textLengthOf(el));
          }
        }}
      >
        {doc.blocks.map((block, index) => {
          const depth = block.indent ?? 0;
          if (block.type === "numbered") {
            counters[depth] = (counters[depth] ?? 0) + 1;
            counters.length = depth + 1;
          } else {
            counters.length = 0;
          }

          return (
            <Fragment key={block.id}>
              {drag && dropIndex === index && dropLine}
              <BlockView
                block={block}
                listMarker={
                  block.type === "numbered"
                    ? `${counters[depth]}.`
                    : block.type === "bulleted"
                      ? BULLET_GLYPHS[depth % BULLET_GLYPHS.length]
                      : undefined
                }
                isOnlyBlock={doc.blocks.length === 1}
                isDragging={drag?.blockId === block.id}
                registerRef={registerRef}
                registerWrapper={registerWrapper}
                onKeyDown={handleKeyDown}
                onInput={handleInput}
                onPaste={handlePaste}
                onToggleCheck={(id) => applyChange(toggleChecked(doc, id))}
                onDragHandleDown={startDrag}
              />
            </Fragment>
          );
        })}
        {drag && dropIndex === doc.blocks.length && dropLine}
      </div>

      {slash && matches.length > 0 && (
        <SlashMenu
          commands={matches}
          activeIndex={activeIndex}
          anchor={slash.anchor}
          onChoose={applyCommand}
        />
      )}

      {toolbar && !slash && !drag && (
        <FormatToolbar
          key={toolbar.linkMode ? "link" : "marks"}
          anchor={toolbar.anchor}
          active={toolbar.active}
          initialLinkMode={toolbar.linkMode}
          onToggle={(mark) => applyMark(toolbar.blockId, toolbar.start, toolbar.end, mark)}
          onSetLink={applyLink}
          onCloseLinkMode={() => {
            setToolbar({ ...toolbar, linkMode: false });
            restoreSelection(toolbar.blockId, toolbar.start, toolbar.end);
          }}
        />
      )}
    </div>
  );
}
