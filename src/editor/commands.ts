import type { BlockType } from "../model/types";

export interface BlockCommand {
  id: string;
  label: string;
  description: string;
  type: BlockType;
  keywords: string[];
}

export const BLOCK_COMMANDS: BlockCommand[] = [
  {
    id: "paragraph",
    label: "Text",
    description: "Plain paragraph",
    type: "paragraph",
    keywords: ["text", "paragraph", "plain", "body"],
  },
  {
    id: "heading1",
    label: "Heading 1",
    description: "Big section heading",
    type: "heading1",
    keywords: ["h1", "heading", "title", "big"],
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium section heading",
    type: "heading2",
    keywords: ["h2", "heading", "subtitle"],
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading",
    type: "heading3",
    keywords: ["h3", "heading", "small"],
  },
  {
    id: "bulleted",
    label: "Bulleted list",
    description: "Simple bulleted list",
    type: "bulleted",
    keywords: ["bullet", "list", "unordered", "ul"],
  },
  {
    id: "numbered",
    label: "Numbered list",
    description: "List with numbers",
    type: "numbered",
    keywords: ["number", "list", "ordered", "ol"],
  },
  {
    id: "todo",
    label: "To-do list",
    description: "Track tasks with checkboxes",
    type: "todo",
    keywords: ["todo", "task", "checkbox", "check"],
  },
  {
    id: "quote",
    label: "Quote",
    description: "Capture a quotation",
    type: "quote",
    keywords: ["quote", "blockquote", "citation"],
  },
  {
    id: "divider",
    label: "Divider",
    description: "Visually divide blocks",
    type: "divider",
    keywords: ["divider", "line", "separator", "hr", "rule"],
  },
];

export function filterCommands(query: string): BlockCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_COMMANDS;
  return BLOCK_COMMANDS.filter(
    (command) =>
      command.label.toLowerCase().includes(q) ||
      command.keywords.some((keyword) => keyword.startsWith(q))
  );
}

const MARKDOWN_TRIGGERS: { trigger: string; type: BlockType }[] = [
  { trigger: "###", type: "heading3" },
  { trigger: "##", type: "heading2" },
  { trigger: "#", type: "heading1" },
  { trigger: "-", type: "bulleted" },
  { trigger: "*", type: "bulleted" },
  { trigger: "1.", type: "numbered" },
  { trigger: ">", type: "quote" },
  { trigger: "[]", type: "todo" },
  { trigger: "[ ]", type: "todo" },
];

/**
 * Called when space is pressed: if everything before the caret is a trigger,
 * the block converts and the trigger text is removed. Leading spaces are
 * allowed and become indentation — two spaces per level — so typing
 * "  - " gives a bullet one level in.
 */
export function matchMarkdownShortcut(
  textBeforeCaret: string
): { type: BlockType; triggerLength: number; indent: number } | null {
  const leading = textBeforeCaret.length - textBeforeCaret.trimStart().length;
  const rest = textBeforeCaret.slice(leading);

  for (const { trigger, type } of MARKDOWN_TRIGGERS) {
    if (rest === trigger) {
      return {
        type,
        triggerLength: leading + trigger.length,
        indent: Math.floor(leading / 2),
      };
    }
  }
  return null;
}
