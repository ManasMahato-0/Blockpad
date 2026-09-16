import { useCallback, useEffect, useRef, useState } from "react";
import { syncLinkTitles } from "../model/links";
import type { Doc } from "../model/types";
import type { PageMeta } from "../model/workspace";
import { loadPage, savePage } from "./storage";

const SAVE_DEBOUNCE_MS = 400;
/** Typing pauses longer than this start a new undo entry. */
const TYPING_GROUP_MS = 500;
const HISTORY_LIMIT = 200;

export type ChangeKind = "structural" | "typing";

import type { TextDelta } from "../model/textDelta";
export type { TextDelta };

export interface RemoteChange {
  doc: Doc;
  /**
   * Keyed by block id, or "title". Several updates can arrive together, so
   * each line gets every change in the order it happened.
   */
  textDeltas: Map<string, TextDelta[]>;
}

/** What the editor needs from a page, whether it lives on this device or is shared. */
export interface DocumentState {
  doc: Doc;
  /**
   * The page as it is right now. React state lags by a render, and on a
   * shared page a remote edit can land in that gap — building an edit on the
   * rendered value would send everyone back to it.
   */
  getDoc: () => Doc;
  applyChange: (next: Doc, kind?: ChangeKind) => void;
  undo: () => void;
  redo: () => void;
  saved: boolean;
  saveNow: (latest: Doc) => void;
  /** Shared pages commit every keystroke straight away, so remote edits never meet uncommitted text. */
  live: boolean;
  /** Called just before a remote change renders, so the editor can keep the caret in place. */
  onRemoteChange?: (listener: (change: RemoteChange) => void) => () => void;
}

/**
 * One page's document, its undo history and its saving. The editor is
 * remounted for each page, so history never crosses between pages.
 */
export function useDocumentState(pageId: string, pages: PageMeta[]): DocumentState {
  // Links pick up renamed and deleted pages as the page opens. Not an undo
  // step: nobody typed anything.
  const [doc, setDocState] = useState<Doc>(() => syncLinkTitles(loadPage(pageId), pages));
  const [saved, setSaved] = useState(true);

  // History is held in refs and never touched inside a state updater:
  // StrictMode invokes updaters twice, which would push and pop every entry
  // twice and corrupt the stacks.
  const docRef = useRef(doc);
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);
  const lastTypingAt = useRef(0);

  const commitState = (next: Doc) => {
    docRef.current = next;
    setDocState(next);
  };

  const applyChange = useCallback((next: Doc, kind: ChangeKind = "structural") => {
    const current = docRef.current;
    if (next === current) return;

    const now = Date.now();
    // a continuous run of typing collapses into one undo entry
    const groupWithPrevious = kind === "typing" && now - lastTypingAt.current < TYPING_GROUP_MS;
    if (!groupWithPrevious) {
      past.current = [...past.current, current].slice(-HISTORY_LIMIT);
      future.current = [];
    }
    lastTypingAt.current = kind === "typing" ? now : 0;

    commitState(next);
  }, []);

  const undo = useCallback(() => {
    const previous = past.current[past.current.length - 1];
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [docRef.current, ...future.current];
    lastTypingAt.current = 0;
    commitState(previous);
  }, []);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, docRef.current];
    lastTypingAt.current = 0;
    commitState(next);
  }, []);

  useEffect(() => {
    setSaved(false);
    const timer = setTimeout(() => setSaved(savePage(pageId, doc)), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [doc, pageId]);

  /** Synchronous save for when there is no later render to wait for, such as unmounting. */
  const saveNow = useCallback(
    (latest: Doc) => {
      docRef.current = latest;
      savePage(pageId, latest);
    },
    [pageId]
  );

  // Closing the tab, or switching to another page, would otherwise lose
  // whatever the debounced save had not written yet.
  useEffect(() => {
    const flush = () => savePage(pageId, docRef.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [pageId]);

  const getDoc = useCallback(() => docRef.current, []);

  return { doc, getDoc, applyChange, undo, redo, saved, saveNow, live: false };
}
