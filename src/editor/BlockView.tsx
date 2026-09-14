import { useLayoutEffect, useRef } from "react";
import type { Block } from "../model/types";
import { richTextToHtml } from "./serialize";
import { isEmpty } from "../model/richText";

const TYPE_CLASSES: Record<string, string> = {
  paragraph: "text-[16px] leading-7",
  heading1: "text-[30px] leading-10 font-bold",
  heading2: "text-[24px] leading-9 font-bold",
  heading3: "text-[20px] leading-8 font-semibold",
  bulleted: "text-[16px] leading-7",
  numbered: "text-[16px] leading-7",
  todo: "text-[16px] leading-7",
  quote: "text-[16px] leading-7 italic text-neutral-600",
};

const WRAPPER_SPACING: Record<string, string> = {
  heading1: "mt-6",
  heading2: "mt-5",
  heading3: "mt-4",
};

const PLACEHOLDERS: Record<string, string> = {
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  bulleted: "List",
  numbered: "List",
  todo: "To-do",
  quote: "Quote",
};

interface Props {
  block: Block;
  listMarker?: string;
  isOnlyBlock: boolean;
  isDragging: boolean;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  registerWrapper: (id: string, el: HTMLDivElement | null) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, blockId: string) => void;
  onInput: (blockId: string, el: HTMLDivElement) => void;
  onToggleCheck: (blockId: string) => void;
  onDragHandleDown: (event: React.PointerEvent, blockId: string) => void;
}

export function BlockView({
  block,
  listMarker,
  isOnlyBlock,
  isDragging,
  registerRef,
  registerWrapper,
  onKeyDown,
  onInput,
  onToggleCheck,
  onDragHandleDown,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Only write to the DOM when the model genuinely differs from what's on
  // screen. Writing on every render would reset the cursor mid-keystroke.
  // Must be a layout effect: it has to run before the editor positions the
  // caret, or the HTML write wipes the caret that was just placed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = richTextToHtml(block.content);
    if (el.innerHTML !== html) el.innerHTML = html;
    el.dataset.empty = String((el.textContent?.length ?? 0) === 0);
  }, [block.content]);

  const editable = (
    <div
      ref={(el) => {
        ref.current = el;
        registerRef(block.id, el);
      }}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-label={`${block.type} block`}
      data-block-id={block.id}
      data-empty={isEmpty(block.content)}
      data-only={isOnlyBlock}
      data-placeholder={PLACEHOLDERS[block.type] ?? "Type '/' for commands…"}
      // the browser's own text drag moves text between blocks and corrupts
      // the DOM behind the model's back — block reordering is ours to handle
      onDragStart={(event) => event.preventDefault()}
      onInput={(event) => {
        const el = event.currentTarget;
        el.dataset.empty = String((el.textContent?.length ?? 0) === 0);
        onInput(block.id, el);
      }}
      onKeyDown={(event) => onKeyDown(event, block.id)}
      className={`relative w-full ${TYPE_CLASSES[block.type] ?? TYPE_CLASSES.paragraph}`}
    />
  );

  // Keyed by type: converting a paragraph into a list would otherwise let
  // React reuse the editable <div> as the new layout container, and the text
  // we wrote into it with innerHTML — which React doesn't track — would
  // survive inside it. A changed key unmounts the old subtree instead.
  let inner: React.ReactNode;
  if (block.type === "divider") {
    inner = (
      <div key="divider" className="w-full py-2" data-block-id={block.id}>
        <hr className="border-neutral-200" />
      </div>
    );
  } else if (block.type === "image") {
    inner = (
      <div key="image" className="w-full" data-block-id={block.id}>
        <img
          src={block.src}
          alt={block.alt ?? ""}
          className="max-w-full rounded-md border border-neutral-200"
        />
      </div>
    );
  } else if (block.type === "bulleted" || block.type === "numbered") {
    inner = (
      <div key="list" className="flex w-full gap-2">
        <span className="min-w-[1.2rem] select-none pt-[3px] text-right text-neutral-500">
          {listMarker}
        </span>
        {editable}
      </div>
    );
  } else if (block.type === "todo") {
    inner = (
      <div key="todo" className="flex w-full gap-2">
        <input
          type="checkbox"
          checked={!!block.checked}
          onChange={() => onToggleCheck(block.id)}
          className="mt-[7px] h-4 w-4 accent-neutral-800"
          aria-label="Toggle task"
        />
        <div className={block.checked ? "flex-1 text-neutral-400 line-through" : "flex-1"}>
          {editable}
        </div>
      </div>
    );
  } else if (block.type === "quote") {
    inner = (
      <div key="quote" className="w-full border-l-[3px] border-neutral-300 pl-3">{editable}</div>
    );
  } else {
    inner = <div key="plain" className="w-full">{editable}</div>;
  }

  return (
    <div
      ref={(el) => registerWrapper(block.id, el)}
      data-block-wrapper={block.id}
      style={{ paddingLeft: (block.indent ?? 0) * 26 }}
      className={`group relative flex items-start py-[3px] ${
        WRAPPER_SPACING[block.type] ?? ""
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        onPointerDown={(event) => onDragHandleDown(event, block.id)}
        className="absolute -left-7 top-1 cursor-grab select-none rounded p-1 text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-500 focus:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
      >
        <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true" fill="currentColor">
          <circle cx="4" cy="4" r="1.4" />
          <circle cx="8" cy="4" r="1.4" />
          <circle cx="4" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="4" cy="12" r="1.4" />
          <circle cx="8" cy="12" r="1.4" />
        </svg>
      </button>
      {inner}
    </div>
  );
}
