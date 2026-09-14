import { useCallback, useEffect, useRef, useState } from "react";
import type { Doc } from "../model/types";
import { emptyDoc } from "../model/document";

const STORAGE_KEY = "block-editor:doc";
const SAVE_DEBOUNCE_MS = 400;
/** Typing pauses longer than this start a new undo entry. */
const TYPING_GROUP_MS = 500;
const HISTORY_LIMIT = 200;

export type ChangeKind = "structural" | "typing";

function loadSaved(): Doc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Doc;
    if (!parsed?.blocks?.length) return null;
    return parsed;
  } catch {
    // corrupt or unavailable storage shouldn't stop the editor loading
    return null;
  }
}

function save(doc: Doc): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return true;
  } catch {
    // quota or private mode — editing still works, it just isn't persisted
    return false;
  }
}

export function useDocumentState() {
  const [doc, setDocState] = useState<Doc>(() => loadSaved() ?? emptyDoc());
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
    const timer = setTimeout(() => setSaved(save(doc)), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [doc]);

  // Without this, closing the tab within a second of typing loses the text:
  // it exists only in the DOM until the debounced save fires.
  useEffect(() => {
    const flush = () => save(docRef.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    commitState(emptyDoc());
  }, []);

  return { doc, applyChange, undo, redo, reset, saved };
}
