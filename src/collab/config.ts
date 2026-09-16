/**
 * Collaboration is configured from the environment. With no public key the
 * Share button never appears and Blockpad stays a local, single-person app.
 */
export const COLLAB_CONFIG = {
  publicApiKey: import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY as string | undefined,
  /** Only set when developing against the local Liveblocks dev server. */
  baseUrl: import.meta.env.VITE_LIVEBLOCKS_BASE_URL as string | undefined,
};

export const collabEnabled = Boolean(COLLAB_CONFIG.publicApiKey);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A link that opens the shared page. The room id travels in the hash, so no server routing is needed. */
export function shareUrl(roomId: string, location: { origin: string; pathname: string } = window.location): string {
  return `${location.origin}${location.pathname}#join=${roomId}`;
}

/** The room id in a "#join=…" hash, or null. Anything but a well-formed id is ignored. */
export function roomIdFromHash(hash: string): string | null {
  const match = hash.match(/^#join=(.+)$/);
  return match && UUID.test(match[1]) ? match[1].toLowerCase() : null;
}
