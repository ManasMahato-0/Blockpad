export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulleted"
  | "numbered"
  | "todo"
  | "quote"
  | "divider"
  | "image";

/** Blocks with no editable text — arrow/backspace treat them as a single unit. */
export const VOID_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>(["divider", "image"]);

/** Pressing Enter at the end of these continues the same type instead of starting a paragraph. */
export const CONTINUING_BLOCKS: ReadonlySet<BlockType> = new Set<BlockType>([
  "bulleted",
  "numbered",
  "todo",
]);

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
  /** Id of another page. The text is that page's title, kept in step when the page opens. */
  pageLink?: string;
}

export type RichText = InlineSpan[];

export interface Block {
  id: string;
  type: BlockType;
  content: RichText;
  /** Nesting depth. Flat list plus a level, rather than a tree. */
  indent?: number;
  checked?: boolean;
  src?: string;
  alt?: string;
}

export interface Doc {
  title: string;
  blocks: Block[];
}
