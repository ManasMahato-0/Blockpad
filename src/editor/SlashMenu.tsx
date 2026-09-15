import { useLayoutEffect, useRef, useState } from "react";

export interface CaretAnchor {
  /** Top and bottom of the caret itself, so the menu can open up or down. */
  top: number;
  bottom: number;
  left: number;
}

/** Anything the menu can list: block types for "/", pages for "[[". */
export interface MenuItem {
  id: string;
  label: string;
  description: string;
}

interface Props<T extends MenuItem> {
  items: T[];
  activeIndex: number;
  anchor: CaretAnchor;
  label: string;
  onChoose: (item: T) => void;
}

/** Referenced by the text line's aria-controls while the menu is open. */
export const SLASH_MENU_ID = "slash-menu";
export const slashOptionId = (itemId: string) => `slash-option-${itemId}`;

const GAP = 6;
const MARGIN = 8;

export function SlashMenu<T extends MenuItem>({ items, activeIndex, anchor, label, onChoose }: Props<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const [placement, setPlacement] = useState({ top: anchor.bottom + GAP, left: anchor.left });

  // Flip above the caret when there isn't room below, and keep it on screen
  // horizontally. Runs before paint, so the menu never visibly jumps.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();

    const fitsBelow = anchor.bottom + GAP + height <= window.innerHeight - MARGIN;
    const top = fitsBelow
      ? anchor.bottom + GAP
      : Math.max(MARGIN, anchor.top - GAP - height);
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN));

    setPlacement({ top, left });
  }, [anchor, items.length]);

  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (items.length === 0) return null;

  return (
    <ul
      ref={listRef}
      id={SLASH_MENU_ID}
      role="listbox"
      aria-label={label}
      // In the Tab order so a scrolling list counts as keyboard-reachable, yet it
      // never actually takes focus from the text being typed: while the menu is
      // open Tab and Shift+Tab choose an item, and mouse presses are cancelled.
      tabIndex={0}
      onMouseDown={(event) => event.preventDefault()}
      className="fixed z-50 max-h-72 w-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
      style={{ top: placement.top, left: placement.left }}
    >
      {items.map((item, index) => (
        <li
          key={item.id}
          id={slashOptionId(item.id)}
          ref={index === activeIndex ? activeRef : undefined}
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => {
            // mousedown, not click: click would blur the block first and lose the caret
            event.preventDefault();
            onChoose(item);
          }}
          className={`cursor-pointer rounded-md px-3 py-2 ${
            index === activeIndex
              ? "bg-neutral-100 dark:bg-neutral-700"
              : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
          }`}
        >
          <div className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.label}</div>
          <div className="text-xs text-neutral-600 dark:text-neutral-300">{item.description}</div>
        </li>
      ))}
    </ul>
  );
}
