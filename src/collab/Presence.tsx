import { useEffect, useLayoutEffect, useState } from "react";
import type { JsonObject } from "@liveblocks/client";
import * as Y from "yjs";
import type { Doc } from "../model/types";
import { caretRectAt, getCaretOffset } from "../editor/caret";
import type { Identity } from "./identity";
import type { Presence, Session } from "./session";
import { keyForText, textForKey } from "./yjsModel";

export interface Other {
  connectionId: number;
  presence: Presence;
}

/** Everyone else in the room, kept current. Empty until connected. */
export function useOthers(session: Session | null): Other[] {
  const [others, setOthers] = useState<Other[]>([]);
  useEffect(() => {
    if (!session) return;
    setOthers([...session.room.getOthers()]);
    const unsubscribe = session.room.subscribe("others", (list) => setOthers([...list]));
    return () => {
      unsubscribe();
      setOthers([]);
    };
  }, [session]);
  return others;
}

/**
 * Shares where your caret is. It goes out as a Yjs relative position, which
 * points at a character rather than a number, so it stays right while other
 * people edit the text before it.
 */
export function useShareCaret(session: Session | null): void {
  useEffect(() => {
    if (!session) return;
    const { room, ydoc } = session;
    const publish = () => {
      const active = document.activeElement;
      let cursor: JsonObject | null = null;
      if (active instanceof HTMLElement && active.isContentEditable) {
        const key = active.classList.contains("title-field") ? "title" : active.getAttribute("data-block-id");
        const text = key ? textForKey(ydoc, key) : null;
        if (text) {
          const index = Math.min(getCaretOffset(active), text.length);
          cursor = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index)) as JsonObject;
        }
      }
      room.updatePresence({ cursor });
    };
    document.addEventListener("selectionchange", publish);
    return () => {
      document.removeEventListener("selectionchange", publish);
      room.updatePresence({ cursor: null });
    };
  }, [session]);
}

interface PlacedCursor {
  id: number;
  name: string;
  color: string;
  top: number;
  left: number;
  height: number;
}

/** Other people's carets, drawn over the page with their names. */
export function RemoteCursors({ session, others, doc }: { session: Session; others: Other[]; doc: Doc }) {
  const [placed, setPlaced] = useState<PlacedCursor[]>([]);
  const [frame, setFrame] = useState(0);

  // screen positions change with scrolling and resizing, not only with edits
  useEffect(() => {
    let request = 0;
    const remeasure = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(() => setFrame((n) => n + 1));
    };
    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    return () => {
      cancelAnimationFrame(request);
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
    };
  }, []);

  // measured after the page has rendered the latest content
  useLayoutEffect(() => {
    const next: PlacedCursor[] = [];
    for (const { connectionId, presence } of others) {
      if (!presence?.cursor) continue;
      const absolute = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(presence.cursor),
        session.ydoc
      );
      if (!absolute || !(absolute.type instanceof Y.Text)) continue;
      const key = keyForText(session.ydoc, absolute.type);
      const el =
        key === "title"
          ? document.querySelector<HTMLElement>(".title-field")
          : key && document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(key)}"]`);
      const rect = el ? caretRectAt(el, absolute.index) : null;
      if (!rect) continue;
      next.push({ id: connectionId, name: presence.name, color: presence.color, top: rect.top, left: rect.left, height: rect.height });
    }
    setPlaced(next);
  }, [others, doc, frame, session]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {placed.map((cursor) => (
        <div
          key={cursor.id}
          data-remote-cursor={cursor.name}
          className="absolute"
          style={{ top: cursor.top, left: cursor.left, height: cursor.height }}
        >
          <div className="h-full w-0.5 rounded-full" style={{ background: cursor.color }} />
          <div
            className="absolute bottom-full left-0 mb-0.5 whitespace-nowrap rounded px-1 py-px text-[11px] font-medium leading-tight text-white"
            style={{ background: cursor.color }}
          >
            {cursor.name}
          </div>
        </div>
      ))}
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const VISIBLE_PEOPLE = 4;

/** Coloured initials for everyone on the page, you first. */
export function PeopleHere({ self, others }: { self: Identity; others: Other[] }) {
  const people = [
    { key: "self", name: `${self.name} (you)`, color: self.color },
    ...others.map((other) => ({ key: String(other.connectionId), name: other.presence.name, color: other.presence.color })),
  ];
  const shown = people.slice(0, VISIBLE_PEOPLE);
  const hidden = people.length - shown.length;
  const avatar =
    "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white dark:ring-[#191919]";

  return (
    <ul aria-label={`${people.length} ${people.length === 1 ? "person" : "people"} on this page`} className="mr-1 flex -space-x-1.5">
      {shown.map((person) => (
        <li key={person.key} title={person.name} className={avatar} style={{ background: person.color }}>
          <span aria-hidden="true">{initials(person.name)}</span>
          <span className="sr-only">{person.name}</span>
        </li>
      ))}
      {hidden > 0 && (
        <li title={people.slice(VISIBLE_PEOPLE).map((p) => p.name).join(", ")} className={`${avatar} bg-neutral-600`}>
          +{hidden}
        </li>
      )}
    </ul>
  );
}
