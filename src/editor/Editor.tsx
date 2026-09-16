import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { transformOffsetThrough } from "../model/textDelta";
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
import { insertPageLink, linkLabel, pageLinkAt } from "../model/links";
import type { PageMeta } from "../model/workspace";
import { Backlinks } from "./Backlinks";
import { BlockView, KEYBOARD_HINT_ID } from "./BlockView";
import { SLASH_MENU_ID, SlashMenu, slashOptionId, type CaretAnchor, type MenuItem } from "./SlashMenu";
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
import { useDocumentState, type DocumentState } from "./useDocumentState";
import { FLUSH_EVENT } from "./storage";
import { downloadText, markdownFileName } from "./files";
import { ShareMenu } from "./ShareMenu";
import { collabEnabled, shareUrl } from "../collab/config";
import { docToMarkdown } from "../model/markdown";

interface SlashState {
  /** "/" inserts a block type, "[[" links a page. */
  trigger: "/" | "[[";
  blockId: string;
  /** Index of the trigger's first character within the block. */
  startOffset: number;
  query: string;
  anchor: CaretAnchor;
}

type MenuChoice = MenuItem &
  (
    | { kind: "command"; command: BlockCommand }
    | { kind: "page"; page: PageMeta }
    | { kind: "create"; title: string }
  );

const PAGE_MENU_LIMIT = 8;

/** Pages matching what was typed after "[[", plus a way to create one. */
function pageChoices(pages: PageMeta[], currentPageId: string, query: string): MenuChoice[] {
  const q = query.trim().toLowerCase();
  const choices: MenuChoice[] = pages
    .filter((page) => page.id !== currentPageId && linkLabel(page.title).toLowerCase().includes(q))
    .slice(0, PAGE_MENU_LIMIT)
    .map((page) => ({
      id: `page-${page.id}`,
      label: linkLabel(page.title),
      description: "Link to page",
      kind: "page",
      page,
    }));
  if (q && !pages.some((page) => page.title.trim().toLowerCase() === q)) {
    choices.push({
      id: "create-page",
      label: `Create “${query.trim()}”`,
      description: "New page, linked here",
      kind: "create",
      title: query.trim(),
    });
  }
  return choices;
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

/** Where to put the caret when the page is opened from a search result. */
export interface RevealRequest {
  /** null for the page title */
  blockId: string | null;
  offset: number;
}

export interface EditorProps {
  pageId: string;
  onTitleChange: (title: string) => void;
  reveal?: RevealRequest;
  onRevealed?: () => void;
  pages: PageMeta[];
  onOpenPage: (pageId: string, reveal?: RevealRequest) => void;
  /** Adds a page without opening it, and returns it. */
  onCreatePage: (title: string) => PageMeta;
  /** A shared page's collaboration room. */
  roomId?: string;
  /** True the first time a page is shared: its local content fills the empty room. */
  seed?: boolean;
  onSeeded?: () => void;
  onShare?: () => void;
  onStopSharing?: () => void;
  /** Opens the share panel on arrival, right after the page was shared. */
  shareOpen?: boolean;
  onShareClosed?: () => void;
}

// Collaboration code loads only when a shared page is opened, so people who
// never share don't download it.
const SharedEditor = lazy(() => import("../collab/SharedEditor"));

/** Picks where a page's content comes from: this device, or a shared room. */
export function Editor(props: EditorProps) {
  if (!props.roomId) return <LocalEditor {...props} />;
  return (
    <Suspense fallback={<EditorNotice>Loading shared page…</EditorNotice>}>
      <SharedEditor {...props} roomId={props.roomId} />
    </Suspense>
  );
}

function LocalEditor(props: EditorProps) {
  const state = useDocumentState(props.pageId, props.pages);
  return <EditorView {...props} state={state} />;
}

/** A calm placeholder where the page will be. */
export function EditorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="mx-auto w-full max-w-[720px] px-5 pt-24 text-center text-sm text-neutral-600 md:px-14 dark:text-neutral-400">
      {children}
    </div>
  );
}

export function EditorView({
  pageId,
  onTitleChange,
  reveal,
  onRevealed,
  pages,
  onOpenPage,
  onCreatePage,
  roomId,
  onShare,
  onStopSharing,
  shareOpen,
  onShareClosed,
  state,
  headerExtra,
  overlay,
}: EditorProps & {
  state: DocumentState;
  /** Shown beside the save status, such as who else is on a shared page. */
  headerExtra?: React.ReactNode;
  /** Drawn over the page, such as other people's cursors. */
  overlay?: React.ReactNode;
}) {
  const { doc, applyChange, undo, redo, saved, saveNow, live, onRemoteChange } = state;
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

  const elements = useRef(new Map<string, HTMLDivElement>());
  const wrappers = useRef(new Map<string, HTMLDivElement>());
  const pendingCaret = useRef<Caret | null>(null);
  const pendingSelection = useRef<{ blockId: string; start: number; end: number } | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const matches: MenuChoice[] = !slash
    ? []
    : slash.trigger === "/"
      ? filterCommands(slash.query).map((command) => ({
          id: command.id,
          label: command.label,
          description: command.description,
          kind: "command",
          command,
        }))
      : pageChoices(pages, pageId, slash.query);

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

  // Where the title's caret belongs after a remote edit to the title.
  const pendingTitleCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const caret = pendingTitleCaret.current;
    // while you type in the title it isn't rewritten, unless someone else changed it
    if (document.activeElement === el && caret === null) return;
    if (el.textContent !== doc.title) el.textContent = doc.title;
    if (caret !== null) {
      pendingTitleCaret.current = null;
      setCaretOffset(el, caret);
    }
  }, [doc.title]);

  useEffect(() => {
    onTitleChange(doc.title);
  }, [doc.title, onTitleChange]);

  /**
   * A remote edit is about to re-render: wherever you are, your caret or
   * selection moves by exactly what the other person inserted or deleted
   * before it, instead of jumping when the line's HTML is rewritten.
   */
  useEffect(() => {
    if (!onRemoteChange) return;
    return onRemoteChange(({ textDeltas }) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;

      // A second batch can arrive before the first has rendered, while the
      // caret on screen hasn't moved yet. Carry on from where the caret is
      // about to be, or the first batch's shift is lost.
      if (active === titleRef.current) {
        const deltas = textDeltas.get("title");
        const from = pendingTitleCaret.current ?? getCaretOffset(active);
        if (deltas) pendingTitleCaret.current = transformOffsetThrough(from, deltas);
        return;
      }

      const blockId = active.getAttribute("data-block-id");
      const deltas = blockId ? textDeltas.get(blockId) : undefined;
      if (!blockId || !deltas) return;
      const waitingSelection = pendingSelection.current?.blockId === blockId ? pendingSelection.current : null;
      const waitingCaret = pendingCaret.current?.blockId === blockId ? pendingCaret.current : null;
      const { start, end } = waitingSelection ?? (waitingCaret
        ? { start: waitingCaret.offset, end: waitingCaret.offset }
        : getSelectionOffsets(active));
      if (end > start) {
        pendingSelection.current = {
          blockId,
          start: transformOffsetThrough(start, deltas),
          end: transformOffsetThrough(end, deltas),
        };
      } else {
        pendingCaret.current = { blockId, offset: transformOffsetThrough(start, deltas) };
      }
    });
  }, [onRemoteChange]);

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
  // an input method (Chinese, Japanese…) is mid-composition; rewriting the
  // line now would cancel it
  const composing = useRef(false);

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
      // On a shared page every keystroke goes out at once: text held back for
      // a debounce would meet other people's edits and lose to them.
      if (live) {
        if (!composing.current) commitTyping(blockId);
        return;
      }
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
    [commitTyping, live]
  );

  /**
   * Typing still waiting on its debounce exists only in the DOM, and both
   * switching pages and closing the tab happen before that commit runs.
   * Commits every block and saves synchronously, without a re-render, which
   * would move the cursor when the user comes back to the tab.
   */
  const flushFromDom = useCallback(() => {
    let latest = docRef.current;
    for (const id of elements.current.keys()) latest = commit(latest, id);
    saveNow(latest);
    return latest;
  }, [commit, saveNow]);

  /** Downloads the page as Markdown, typing not yet committed included. */
  const exportMarkdown = () => {
    const latest = flushFromDom();
    downloadText(markdownFileName(latest.title), docToMarkdown(latest, pages), "text/markdown");
  };

  // Unloading the page never unmounts React, so closing the tab needs its own
  // flush. Hidden counts too: mobile browsers often discard a background tab
  // without ever firing pagehide.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushFromDom();
    };
    window.addEventListener("pagehide", flushFromDom);
    window.addEventListener(FLUSH_EVENT, flushFromDom);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushFromDom);
      window.removeEventListener(FLUSH_EVENT, flushFromDom);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushFromDom]);

  // Switching pages unmounts the editor. A layout-effect cleanup runs while
  // the blocks are still attached, so their text can still be read.
  useLayoutEffect(
    () => () => {
      if (typingCommit.current) window.clearTimeout(typingCommit.current);
      flushFromDom();
    },
    [flushFromDom]
  );

  /**
   * Opening a search result: the caret goes onto the match, the block scrolls
   * to the middle of the screen and briefly flashes so the eye lands on it.
   */
  useEffect(() => {
    if (!reveal) return;
    onRevealed?.();
    if (!reveal.blockId) {
      const title = titleRef.current;
      if (title) {
        title.focus();
        setCaretOffset(title, reveal.offset);
      }
      return;
    }
    const el = elements.current.get(reveal.blockId);
    const wrapper = wrappers.current.get(reveal.blockId);
    if (!el || !wrapper) return;
    el.focus({ preventScroll: true });
    setCaretOffset(el, reveal.offset);
    wrapper.scrollIntoView({ block: "center" });
    wrapper.animate(
      [{ backgroundColor: "rgba(250, 204, 21, 0.35)" }, { backgroundColor: "rgba(250, 204, 21, 0)" }],
      { duration: 1600, easing: "ease-out" }
    );
  }, [reveal, onRevealed]);

  /**
   * Undo/redo live on the document, not on the blocks: an undo can delete the
   * very block that had focus, and once focus is gone a block-level handler
   * never sees the next keystroke. Also suppresses the browser's own
   * contenteditable undo stack, which knows nothing about blocks.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      // text boxes such as search and the link field keep their own undo
      if (event.target instanceof HTMLInputElement) return;
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

  /**
   * "/query" is removed and the block converts to the chosen type; "[[query"
   * is replaced by a link to the chosen page, created first if it's new.
   */
  const chooseMenuItem = (item: MenuChoice) => {
    if (!slash) return;
    const { trigger, blockId, startOffset, query } = slash;
    closeSlash();

    const committed = commit(doc, blockId);
    const block = getBlock(committed, blockId);
    if (!block) return;

    if (item.kind !== "command") {
      const page = item.kind === "page" ? item.page : onCreatePage(item.title);
      const { content, caret } = insertPageLink(block.content, startOffset, trigger.length + query.length, page);
      pendingCaret.current = { blockId, offset: caret };
      applyChange(setBlockContent(committed, blockId, content));
      return;
    }
    const { command } = item;

    const stripped = concat(
      slice(block.content, 0, startOffset),
      slice(block.content, startOffset + trigger.length + query.length, textLength(block.content))
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
      if (!text.startsWith(slash.trigger, slash.startOffset)) return closeSlash();

      const caret = getCaretOffset(el);
      const queryStart = slash.startOffset + slash.trigger.length;
      if (caret < queryStart) return closeSlash();
      // a command name is one word; a page title can have spaces but no "]"
      const stop = slash.trigger === "/" ? /\s/ : /[\]\n]/;
      if (stop.test(text.slice(queryStart, caret))) return closeSlash();
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

  // Combobox wiring: the text line keeps focus while the menu is open, so it
  // points assistive technology at the highlighted option.
  useEffect(() => {
    if (!slash) return;
    const el = elements.current.get(slash.blockId);
    if (!el) return;
    const highlighted = matches[activeIndex];
    el.setAttribute("aria-controls", SLASH_MENU_ID);
    if (highlighted) el.setAttribute("aria-activedescendant", slashOptionId(highlighted.id));
    else el.removeAttribute("aria-activedescendant");
    return () => {
      el.removeAttribute("aria-controls");
      el.removeAttribute("aria-activedescendant");
    };
  }, [slash, activeIndex, matches]);

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
        const item = matches[activeIndex];
        if (item) {
          event.preventDefault();
          chooseMenuItem(item);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeSlash();
        return;
      }
    }

    // Tab indents a line, so without a way out a keyboard user is trapped in
    // the editor. Escape lets go of focus; the next Tab moves past the editor.
    if (event.key === "Escape") {
      event.preventDefault();
      el.blur();
      return;
    }

    // The drag handle only works with a pointer, so moving a block needs a
    // keyboard route of its own.
    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      const index = findIndex(doc, blockId);
      const target = event.key === "ArrowUp" ? index - 1 : index + 1;
      if (index === -1 || target < 0 || target >= doc.blocks.length) return;
      pendingCaret.current = { blockId, offset: getCaretOffset(el) };
      applyChange(moveBlock(commit(doc, blockId), index, target));
      return;
    }

    // Only a slash that starts a word opens the menu, so "and/or" and URLs
    // type normally.
    if (event.key === "/") {
      const offset = getCaretOffset(el);
      const charBefore = (el.textContent ?? "")[offset - 1];
      if (offset === 0 || charBefore === undefined || /\s/.test(charBefore)) {
        setSlash({ trigger: "/", blockId, startOffset: offset, query: "", anchor: caretAnchor(el) });
        setActiveIndex(0);
      }
      return;
    }

    // "[[" opens the page picker. Keydown arrives before the second "[" is
    // typed, so only the first one is in the text yet.
    if (event.key === "[") {
      const offset = getCaretOffset(el);
      if ((el.textContent ?? "")[offset - 1] === "[") {
        setSlash({ trigger: "[[", blockId, startOffset: offset - 1, query: "", anchor: caretAnchor(el) });
        setActiveIndex(0);
      }
      return;
    }

    // Links aren't focusable inside editable text, so Ctrl+Enter follows the
    // one beside the caret.
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      const target = pageLinkAt(domToRichText(el), getCaretOffset(el));
      if (target) {
        event.preventDefault();
        onOpenPage(target);
        return;
      }
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
    const caret = getCaretOffset(el);
    const queryStart = slash.startOffset + slash.trigger.length;
    if (!text.startsWith(slash.trigger, slash.startOffset) || caret < queryStart) {
      closeSlash();
      return;
    }
    setSlash({ ...slash, query: text.slice(queryStart, caret) });
    setActiveIndex(0);
  };

  // Roving tab stop: only one block is in the Tab order at a time, so Tab can
  // leave the editor instead of walking through every line.
  const tabbableId = doc.blocks.some((b) => b.id === focusedBlockId)
    ? focusedBlockId
    : (doc.blocks.find((b) => !VOID_BLOCKS.has(b.type))?.id ?? null);

  const dropLine = <div className="h-0.5 rounded-full bg-blue-500" aria-hidden="true" />;
  // one counter per depth: going deeper restarts at 1, coming back out resumes
  const counters: number[] = [];

  return (
    <div
      className="mx-auto min-h-full w-full max-w-[720px] px-5 pb-16 pt-14 md:px-14 md:py-16"
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        const blockId = event.target instanceof HTMLElement ? event.target.getAttribute("data-block-id") : null;
        if (live && blockId) commitTyping(blockId);
      }}
    >
      <div className="fixed right-3 top-2.5 z-20 flex items-center gap-1">
        {headerExtra}
        <span
          className="pointer-events-none px-2 text-xs text-neutral-500 dark:text-neutral-400"
          aria-live="polite"
        >
          {saved ? "Saved" : "Saving…"}
        </span>
        <button
          type="button"
          onClick={exportMarkdown}
          aria-label="Export page as Markdown"
          title="Export as Markdown"
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12m0 0-4-4m4 4 4-4" />
            <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
          </svg>
          <span className="max-md:hidden">Export</span>
        </button>
        {collabEnabled && onShare && onStopSharing && (
          <ShareMenu
            link={roomId ? shareUrl(roomId) : null}
            onShare={onShare}
            onStopSharing={onStopSharing}
            defaultOpen={shareOpen}
            onClose={onShareClosed}
          />
        )}
      </div>
      <p id={KEYBOARD_HINT_ID} className="sr-only">
        Tab indents a line. Press Escape to leave the editor, then Tab to move on.
        Control Shift Arrow Up or Down moves a line. Type two opening square
        brackets to link another page, and Control Enter beside a link opens it.
      </p>
      {/* A real heading, so the page has an h1 that screen readers announce as
          one. The editable field sits inside it: role="textbox" on the h1
          itself would replace its heading role. */}
      <h1 className="mb-6 text-[30px] font-bold leading-tight tracking-tight text-neutral-900 md:text-[40px] dark:text-neutral-100">
        <div
          ref={titleRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Document title"
          className="title-field outline-none"
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
      </h1>

      <div
        onClick={(event) => {
          const link = event.target instanceof Element ? event.target.closest("[data-page-link]") : null;
          if (link) {
            event.preventDefault();
            onOpenPage(link.getAttribute("data-page-link") ?? "");
            return;
          }
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
            // a bullet or to-do nested under a numbered item leaves the
            // parent's count alone, so the next number carries on
            counters.length = block.type === "bulleted" || block.type === "todo" ? depth : 0;
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
                isTabbable={block.id === tabbableId}
                onFocusBlock={setFocusedBlockId}
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

      <Backlinks
        pageId={pageId}
        pages={pages}
        onOpen={(link) => onOpenPage(link.pageId, { blockId: link.blockId, offset: link.offset })}
      />

      {slash && matches.length > 0 && (
        <SlashMenu
          items={matches}
          activeIndex={activeIndex}
          anchor={slash.anchor}
          label={slash.trigger === "/" ? "Insert block" : "Link to page"}
          onChoose={chooseMenuItem}
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

      {overlay}
    </div>
  );
}
