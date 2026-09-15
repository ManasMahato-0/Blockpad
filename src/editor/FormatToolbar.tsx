import { useLayoutEffect, useRef, useState } from "react";
import type { MarkName } from "../model/richText";

export interface SelectionAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ActiveMarks {
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: string | undefined;
}

interface Props {
  anchor: SelectionAnchor;
  active: ActiveMarks;
  /** Open straight into the link field, as Ctrl+K does. */
  initialLinkMode?: boolean;
  onToggle: (mark: MarkName) => void;
  onSetLink: (href: string | undefined) => void;
  onCloseLinkMode: () => void;
}

const GAP = 8;
const MARGIN = 8;

const MARK_BUTTONS: { mark: MarkName; label: string; shortcut: string; glyph: React.ReactNode }[] = [
  { mark: "bold", label: "Bold", shortcut: "Ctrl+B", glyph: <span className="font-bold">B</span> },
  { mark: "italic", label: "Italic", shortcut: "Ctrl+I", glyph: <span className="font-serif italic">I</span> },
  { mark: "code", label: "Inline code", shortcut: "Ctrl+E", glyph: <span className="font-mono text-[13px]">{"<>"}</span> },
];

const buttonClass = (pressed: boolean) =>
  `flex h-8 min-w-8 items-center justify-center rounded px-2 text-[15px] transition-colors ${
    pressed
      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
  }`;

export function FormatToolbar({
  anchor,
  active,
  initialLinkMode = false,
  onToggle,
  onSetLink,
  onCloseLinkMode,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ top: anchor.top - 48, left: anchor.left });
  const [editingLink, setEditingLink] = useState(initialLinkMode);
  const [draft, setDraft] = useState(active.link ?? "");

  // Above the selection by default, below it when there is no room; clamped
  // horizontally. Measured before paint, so the toolbar never visibly jumps.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const fitsAbove = anchor.top - GAP - height >= MARGIN;
    const top = fitsAbove ? anchor.top - GAP - height : anchor.bottom + GAP;
    const centre = (anchor.left + anchor.right) / 2;
    const left = Math.max(MARGIN, Math.min(centre - width / 2, window.innerWidth - width - MARGIN));
    setPlacement({ top, left });
  }, [anchor, editingLink]);

  // mousedown, not click: a click would blur the text and destroy the selection
  const keepSelection = (event: React.MouseEvent) => event.preventDefault();

  const closeLinkField = () => {
    setEditingLink(false);
    onCloseLinkMode();
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Text formatting"
      data-format-toolbar=""
      className="fixed z-50 rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
      style={{ top: placement.top, left: placement.left }}
    >
      {editingLink ? (
        <form
          className="flex items-center gap-1 p-1"
          onSubmit={(event) => {
            event.preventDefault();
            onSetLink(draft.trim() || undefined);
            closeLinkField();
          }}
        >
          <input
            autoFocus
            type="text"
            inputMode="url"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeLinkField();
              }
            }}
            placeholder="Paste a link…"
            aria-label="Link address"
            className="w-60 rounded border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-500 focus:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-400"
          />
          <button
            type="submit"
            className="rounded px-2 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Apply
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-0.5 p-1">
          {MARK_BUTTONS.map(({ mark, label, shortcut, glyph }) => (
            <button
              key={mark}
              type="button"
              aria-label={label}
              aria-pressed={active[mark]}
              title={`${label} (${shortcut})`}
              onMouseDown={keepSelection}
              onClick={() => onToggle(mark)}
              className={buttonClass(active[mark])}
            >
              {glyph}
            </button>
          ))}

          <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-600" aria-hidden="true" />

          <button
            type="button"
            aria-label={active.link ? "Edit link" : "Add link"}
            aria-pressed={!!active.link}
            title="Link (Ctrl+K)"
            onMouseDown={keepSelection}
            onClick={() => {
              setDraft(active.link ?? "");
              setEditingLink(true);
            }}
            className={buttonClass(!!active.link)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>

          {active.link && (
            <button
              type="button"
              aria-label="Remove link"
              title="Remove link"
              onMouseDown={keepSelection}
              onClick={() => onSetLink(undefined)}
              className={buttonClass(false)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
