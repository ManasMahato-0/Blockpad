import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { createBlock } from "../model/document";
import type { Doc } from "../model/types";
import { loadPage, savePage } from "../editor/storage";
import type { ChangeKind, DocumentState, RemoteChange, TextDelta } from "../editor/useDocumentState";
import { getIdentity } from "./identity";
import { joinRoom, type Session } from "./session";
import { LOCAL_ORIGIN, applyDocToY, sharedTypes, yToDoc } from "./yjsModel";

const TYPING_GROUP_MS = 500;
const SNAPSHOT_DEBOUNCE_MS = 800;
/** Writes that seed an empty room aren't the sharer's to undo. */
const SEED_ORIGIN = "blockpad-seed";

export type ConnectionStatus = "initial" | "connecting" | "connected" | "reconnecting" | "disconnected";

export interface SharedDocumentState extends DocumentState {
  /** False until the first sync: editing before it could overwrite the shared page. */
  ready: boolean;
  status: ConnectionStatus;
  session: Session | null;
}

/**
 * A shared page: the Yjs document in a Liveblocks room is the source of
 * truth, and the editor gets the same plain Doc values it gets for a local
 * page. `seed` fills the room the first time a page is shared.
 */
export function useSharedDocument(pageId: string, roomId: string, seed?: Doc, onSeeded?: () => void): SharedDocumentState {
  // the cached copy shows under the loading state until the room has synced
  const [doc, setDoc] = useState<Doc>(() => loadPage(pageId));
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("initial");
  const [saved, setSaved] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  const docRef = useRef(doc);
  const readyRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const undoManager = useRef<Y.UndoManager | null>(null);
  const listeners = useRef(new Set<(change: RemoteChange) => void>());
  // used while the room is empty, so the placeholder line keeps one id
  const placeholderBlock = useRef(createBlock());
  const seedRef = useRef({ seed, onSeeded });
  seedRef.current = { seed, onSeeded };

  useEffect(() => {
    const current = joinRoom(roomId, getIdentity());
    const { ydoc, provider, room } = current;
    const { title, blocks } = sharedTypes(ydoc);
    const manager = new Y.UndoManager([title, blocks], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: TYPING_GROUP_MS,
    });
    sessionRef.current = current;
    undoManager.current = manager;
    setSession(current);

    const withLine = (next: Doc): Doc =>
      next.blocks.length > 0 ? next : { ...next, blocks: [placeholderBlock.current] };

    // Several observers can fire for one remote update; their line changes
    // are collected and the page re-renders once.
    let pending: Map<string, TextDelta[]> | null = null;
    const publish = () => {
      if (!pending) return;
      const change: RemoteChange = { doc: withLine(yToDoc(ydoc)), textDeltas: pending };
      pending = null;
      docRef.current = change.doc;
      for (const listener of listeners.current) listener(change);
      setDoc(change.doc);
    };
    const collect = (key: string | null, delta: TextDelta | null) => {
      if (!readyRef.current) return;
      if (!pending) {
        pending = new Map();
        queueMicrotask(publish);
      }
      // keep every change: dropping all but the last put carets one keystroke short
      if (key && delta) pending.set(key, [...(pending.get(key) ?? []), delta]);
    };

    const onBlocks = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      for (const event of events) {
        const target = event.target;
        const parent = target.parent;
        // deltas must be read inside the observer; Yjs refuses afterwards
        if (target instanceof Y.Text && parent instanceof Y.Map) collect(String(parent.get("id")), event.delta as TextDelta);
        else collect(null, null);
      }
    };
    const onTitle = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      collect("title", event.delta as TextDelta);
    };
    blocks.observeDeep(onBlocks);
    title.observe(onTitle);

    const onSync = (isSynced: boolean) => {
      setSaved(isSynced);
      if (!isSynced || readyRef.current) return;
      const { seed: initial, onSeeded: seeded } = seedRef.current;
      if (blocks.length === 0 && initial) {
        applyDocToY(ydoc, initial, undefined, SEED_ORIGIN);
        seeded?.();
      }
      readyRef.current = true;
      docRef.current = withLine(yToDoc(ydoc));
      setDoc(docRef.current);
      setReady(true);
    };
    provider.on("sync", onSync);
    if (provider.synced) onSync(true);

    setStatus(room.getStatus());
    const unsubscribeStatus = room.subscribe("status", setStatus);

    return () => {
      unsubscribeStatus();
      provider.off("sync", onSync);
      blocks.unobserveDeep(onBlocks);
      title.unobserve(onTitle);
      manager.destroy();
      current.leave();
      readyRef.current = false;
      sessionRef.current = null;
      undoManager.current = null;
    };
  }, [roomId]);

  // A copy on this device keeps search, backlinks, export and the page list
  // working for shared pages too.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => savePage(pageId, doc), SNAPSHOT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [doc, pageId, ready]);

  const applyChange = useCallback((next: Doc, kind: ChangeKind = "structural") => {
    const previous = docRef.current;
    if (next === previous) return;
    docRef.current = next;
    setDoc(next);
    const current = sessionRef.current;
    if (!current || !readyRef.current) return;
    // a structural edit is its own undo step, never merged with typing around it
    if (kind === "structural") undoManager.current?.stopCapturing();
    applyDocToY(current.ydoc, next, previous);
    if (kind === "structural") undoManager.current?.stopCapturing();
  }, []);

  const undo = useCallback(() => {
    undoManager.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoManager.current?.redo();
  }, []);

  const saveNow = useCallback(
    (latest: Doc) => {
      const current = sessionRef.current;
      if (current && readyRef.current && latest !== docRef.current) {
        applyDocToY(current.ydoc, latest, docRef.current);
      }
      docRef.current = latest;
      if (readyRef.current) savePage(pageId, latest);
    },
    [pageId]
  );

  const onRemoteChange = useCallback((listener: (change: RemoteChange) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { doc, applyChange, undo, redo, saved, saveNow, live: true, onRemoteChange, ready, status, session };
}
