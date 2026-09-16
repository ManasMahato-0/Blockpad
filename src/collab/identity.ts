export interface Identity {
  name: string;
  color: string;
}

const STORAGE_KEY = "blockpad:identity";

// dark enough for white name labels to pass WCAG AA
export const CURSOR_COLORS = ["#c2255c", "#6741d9", "#1864ab", "#0b7285", "#237032", "#c92a2a"];
const ADJECTIVES = ["Calm", "Bright", "Brave", "Clever", "Kind", "Quick", "Sunny", "Swift"];
const ANIMALS = ["Otter", "Fox", "Heron", "Lynx", "Panda", "Koala", "Falcon", "Badger"];

const pick = <T,>(items: T[]): T => items[crypto.getRandomValues(new Uint32Array(1))[0] % items.length];

/** This browser's name and cursor colour on shared pages, made up once and remembered. */
export function getIdentity(): Identity {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof saved?.name === "string" && CURSOR_COLORS.includes(saved?.color)) return saved;
  } catch {
    // unreadable or unavailable storage: make a new identity below
  }
  const identity = { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(CURSOR_COLORS) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // not remembered, which only means a new name next visit
  }
  return identity;
}
