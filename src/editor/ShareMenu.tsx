import { useEffect, useId, useRef, useState } from "react";

interface Props {
  /** The page's share link, or null while it is private. */
  link: string | null;
  onShare: () => void;
  onStopSharing: () => void;
  /** Opens straight away, as it does right after a page is shared. */
  defaultOpen?: boolean;
  onClose?: () => void;
}

/** The Share button and its panel: share a private page, or copy a shared page's link. */
export function ShareMenu({ link, onShare, onStopSharing, defaultOpen = false, onClose }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setCopied(false);
    onClose?.();
    if (returnFocus) buttonRef.current?.focus();
  };

  // Escape or a press anywhere outside closes the panel
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  });

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // clipboard refused: leave the link selected for Ctrl+C instead
      inputRef.current?.select();
    }
  };

  const button =
    "rounded-md px-2.5 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
          <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
        </svg>
        {link ? "Shared" : "Share"}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label={link ? "Share link" : "Share this page"}
          className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-700 shadow-xl dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          {link ? (
            <>
              <p className="mb-2">Anyone with this link can view and edit the page.</p>
              <div className="flex gap-1.5">
                <input
                  ref={inputRef}
                  readOnly
                  value={link}
                  aria-label="Share link"
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
                />
                <button
                  type="button"
                  onClick={copy}
                  className={`${button} bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300`}
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <p className="sr-only" aria-live="polite">
                {copied ? "Link copied" : ""}
              </p>
              <button
                type="button"
                onClick={() => {
                  close(true);
                  onStopSharing();
                }}
                className={`${button} mt-2 -ml-2.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100`}
              >
                Stop sharing on this device
              </button>
            </>
          ) : (
            <>
              <p className="mb-1 font-medium text-neutral-900 dark:text-neutral-100">Edit this page together</p>
              <p className="mb-3 text-neutral-600 dark:text-neutral-300">
                The page moves to a shared room, and anyone with the link can view and edit it live.
              </p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onShare();
                }}
                className={`${button} bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300`}
              >
                Share page
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
