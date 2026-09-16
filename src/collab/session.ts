import { createClient, type Client, type JsonObject } from "@liveblocks/client";
import { getYjsProviderForRoom } from "@liveblocks/yjs";
import { COLLAB_CONFIG } from "./config";
import type { Identity } from "./identity";

/** What each person in a room shares about themselves. */
export type Presence = {
  name: string;
  color: string;
  /** A Yjs relative position as JSON, so it stays put while text before it changes. */
  cursor: JsonObject | null;
};

let client: Client | null = null;

function getClient(): Client {
  client ??= createClient({
    publicApiKey: COLLAB_CONFIG.publicApiKey ?? "",
    ...(COLLAB_CONFIG.baseUrl ? { baseUrl: COLLAB_CONFIG.baseUrl } : {}),
    // cursor updates are sent at most this often
    throttle: 80,
  });
  return client;
}

/** Room names are namespaced, in case the Liveblocks project is ever shared with another app. */
const roomName = (roomId: string) => `blockpad-${roomId}`;

function enter(roomId: string, identity: Identity) {
  const { room, leave } = getClient().enterRoom<Presence>(roomName(roomId), {
    initialPresence: { name: identity.name, color: identity.color, cursor: null },
  });
  const provider = getYjsProviderForRoom(room);
  return { room, provider, ydoc: provider.getYDoc(), leave };
}

export type Session = ReturnType<typeof enter>;
export type SharedRoom = Session["room"];

export const joinRoom = enter;
