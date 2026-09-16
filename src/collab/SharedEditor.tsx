import { useState } from "react";
import { EditorNotice, EditorView, type EditorProps } from "../editor/Editor";
import { loadPage } from "../editor/storage";
import { getIdentity } from "./identity";
import { PeopleHere, RemoteCursors, useOthers, useShareCaret } from "./Presence";
import { useSharedDocument } from "./useSharedDocument";

/** A page whose content lives in a collaboration room. Loaded on demand. */
export default function SharedEditor(props: EditorProps & { roomId: string }) {
  // read once: the page's local content, used only if this share creates the room
  const [seed] = useState(() => (props.seed ? loadPage(props.pageId) : undefined));
  const [identity] = useState(getIdentity);
  const state = useSharedDocument(props.pageId, props.roomId, seed, props.onSeeded);
  const session = state.ready ? state.session : null;
  const others = useOthers(session);
  useShareCaret(session);

  if (!state.ready || !session) {
    return (
      <EditorNotice>
        {state.status === "reconnecting" || state.status === "disconnected"
          ? "Can’t reach the shared page. Retrying…"
          : "Connecting to shared page…"}
      </EditorNotice>
    );
  }

  const offline = state.status === "reconnecting" || state.status === "disconnected";
  return (
    <EditorView
      {...props}
      state={state}
      headerExtra={
        <>
          {offline && (
            <span role="status" className="px-1 text-xs font-medium text-amber-800 dark:text-amber-300">
              Reconnecting…
            </span>
          )}
          <PeopleHere self={identity} others={others} />
        </>
      }
      overlay={<RemoteCursors session={session} others={others} doc={state.doc} />}
    />
  );
}
