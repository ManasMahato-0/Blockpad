import { useLayoutEffect, useRef, useState } from "react";
import type { BlockCommand } from "./commands";

export interface CaretAnchor {
  /** Top and bottom of the caret itself, so the menu can open up or down. */
  top: number;
  bottom: number;
  left: number;
}

interface Props {
  commands: BlockCommand[];
  activeIndex: number;
  anchor: CaretAnchor;
  onChoose: (command: BlockCommand) => void;
}

/** Referenced by the text line's aria-controls while the menu is open. */
export const SLASH_MENU_ID = "slash-menu";
export const slashOptionId = (commandId: string) => `slash-option-${commandId}`;

const GAP = 6;
const MARGIN = 8;

export function SlashMenu({ commands, activeIndex, anchor, onChoose }: Props) {
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
  }, [anchor, commands.length]);

  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (commands.length === 0) return null;

  return (
    <ul
      ref={listRef}
      id={SLASH_MENU_ID}
      role="listbox"
      aria-label="Insert block"
      // In the Tab order so a scrolling list counts as keyboard-reachable, yet it
      // never actually takes focus from the text being typed: while the menu is
      // open Tab and Shift+Tab choose a command, and mouse presses are cancelled.
      tabIndex={0}
      onMouseDown={(event) => event.preventDefault()}
      className="fixed z-50 max-h-72 w-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
      style={{ top: placement.top, left: placement.left }}
    >
      {commands.map((command, index) => (
        <li
          key={command.id}
          id={slashOptionId(command.id)}
          ref={index === activeIndex ? activeRef : undefined}
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => {
            // mousedown, not click: click would blur the block first and lose the caret
            event.preventDefault();
            onChoose(command);
          }}
          className={`cursor-pointer rounded-md px-3 py-2 ${
            index === activeIndex
              ? "bg-neutral-100 dark:bg-neutral-700"
              : "hover:bg-neutral-50 dark:hover:bg-neutral-700/60"
          }`}
        >
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{command.label}</div>
          <div className="text-xs text-neutral-600 dark:text-neutral-300">{command.description}</div>
        </li>
      ))}
    </ul>
  );
}
