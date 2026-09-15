import { safeHref } from "../editor/serialize";
import { createBlock, normalizeIndents } from "./document";
import { linkLabel } from "./links";
import { normalize } from "./richText";
import type { Block, BlockType, Doc, InlineSpan, RichText } from "./types";
import type { PageMeta } from "./workspace";

type Marks = Omit<InlineSpan, "text">;

const LIST_TYPES: ReadonlySet<BlockType> = new Set<BlockType>(["bulleted", "numbered", "todo"]);

// ---------------------------------------------------------------- export --

/** Characters that would otherwise start formatting when read back. */
const escapeText = (text: string) => text.replace(/([\\`*_[\]])/g, "\\$1");

/** A paragraph starting with "# ", "- ", "1. " or "> " would come back as something else. */
function escapeLineStart(line: string): string {
  if (/^(#{1,6}\s|>|[-+*]\s|[-*_]{3,}\s*$)/.test(line)) return "\\" + line;
  return line.replace(/^(\d+)([.)]\s)/, "$1\\$2");
}

function codeSpan(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return fence + pad + text + pad + fence;
}

function spanToMarkdown(span: InlineSpan, titles: Map<string, string>): string {
  if (span.pageLink) return `[[${titles.get(span.pageLink) ?? span.text}]]`;
  if (!span.bold && !span.italic && !span.code && !span.link) return escapeText(span.text);

  // "** bold**" isn't bold in Markdown: spaces at the edges go outside the markers
  const lead = span.text.match(/^\s*/)?.[0] ?? "";
  const trail = span.text.slice(lead.length).match(/\s*$/)?.[0] ?? "";
  const inner = span.text.slice(lead.length, span.text.length - trail.length);
  if (!inner) return span.text;

  let core = span.code ? codeSpan(inner) : escapeText(inner);
  if (span.bold) core = `**${core}**`;
  if (span.italic) core = `*${core}*`;
  if (span.link) core = `[${core}](${span.link.replace(/[()\s]/g, encodeURIComponent)})`;
  return lead + core + trail;
}

/** Writes a page as Markdown. Page links become [[Title]] with current titles. */
export function docToMarkdown(doc: Doc, pages: PageMeta[] = []): string {
  const titles = new Map(pages.map((page) => [page.id, linkLabel(page.title)]));
  const lines: string[] = [];
  if (doc.title.trim()) lines.push(`# ${doc.title.trim()}`);

  // numbering restarts per depth, as on screen; indentation per depth is the
  // width of each parent's marker, which is what Markdown nests by
  const counters: number[] = [];
  const markerWidths: number[] = [];
  let previousWasList = false;

  for (const block of doc.blocks) {
    const isList = LIST_TYPES.has(block.type);
    if (block.type === "paragraph" && block.content.length === 0) continue;

    const text = block.content.map((span) => spanToMarkdown(span, titles)).join("");
    const depth = isList ? Math.min(block.indent ?? 0, markerWidths.length) : 0;
    let line: string;

    if (block.type === "numbered") {
      counters[depth] = (counters[depth] ?? 0) + 1;
      counters.length = depth + 1;
    } else {
      // a bullet nested under a numbered item leaves the parent's count alone
      counters.length = isList ? depth : 0;
    }

    if (isList) {
      const marker = block.type === "numbered" ? `${counters[depth]}. ` : "- ";
      const pad = " ".repeat(markerWidths.slice(0, depth).reduce((sum, width) => sum + width, 0));
      markerWidths[depth] = marker.length;
      markerWidths.length = depth + 1;
      const box = block.type === "todo" ? `[${block.checked ? "x" : " "}] ` : "";
      line = pad + marker + box + text;
    } else {
      markerWidths.length = 0;
      switch (block.type) {
        case "heading1":
          line = `# ${text}`;
          break;
        case "heading2":
          line = `## ${text}`;
          break;
        case "heading3":
          line = `### ${text}`;
          break;
        case "quote":
          line = `> ${text}`;
          break;
        case "divider":
          line = "---";
          break;
        case "image":
          line = `![${escapeText(block.alt ?? "")}](${block.src ?? ""})`;
          break;
        default:
          line = escapeLineStart(text);
      }
    }

    // list items sit on consecutive lines; everything else is its own paragraph
    if (lines.length > 0 && !(isList && previousWasList)) lines.push("");
    lines.push(line);
    previousWasList = isList;
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------- import --

/** Finds where an emphasis run opened at `from` closes, or -1. */
function findClosing(text: string, delim: string, from: number): number {
  if (from >= text.length || /\s/.test(text[from])) return -1;
  // snake_case_words aren't italic
  if (delim[0] === "_" && /[\p{L}\p{N}]/u.test(text[from - delim.length - 1] ?? "")) return -1;

  let j = text.indexOf(delim, from + 1);
  while (j !== -1) {
    const spaceBefore = /\s/.test(text[j - 1]);
    const wordAfter = delim[0] === "_" && /[\p{L}\p{N}]/u.test(text[j + delim.length] ?? "");
    // a single * mustn't close on half of a ** pair
    const partOfLonger = delim.length === 1 && (text[j + 1] === delim || text[j - 1] === delim);
    if (!spaceBefore && !wordAfter && !partOfLonger) return j;
    j = text.indexOf(delim, j + 1);
  }
  return -1;
}

function parseInline(text: string, pagesByTitle: Map<string, PageMeta>, marks: Marks = {}): RichText {
  const out: RichText = [];
  let plain = "";
  const pushPlain = () => {
    if (plain) out.push({ ...marks, text: plain });
    plain = "";
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);

    if (ch === "\\" && /[\\`*_[\]#>+\-.!()]/.test(text[i + 1] ?? "")) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const run = rest.match(/^`+/)![0];
      const close = text.indexOf(run, i + run.length);
      if (close !== -1) {
        pushPlain();
        let code = text.slice(i + run.length, close);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
        out.push({ ...marks, code: true, text: code });
        i = close + run.length;
        continue;
      }
      plain += run;
      i += run.length;
      continue;
    }

    if (rest.startsWith("[[")) {
      const close = text.indexOf("]]", i + 2);
      if (close !== -1) {
        const name = text.slice(i + 2, close);
        const page = pagesByTitle.get(name.trim().toLowerCase());
        pushPlain();
        if (page) out.push({ text: linkLabel(page.title), pageLink: page.id });
        else plain += name;
        i = close + 2;
        continue;
      }
    }

    if (ch === "[") {
      const link = rest.match(/^\[([^\]]*)\]\(([^)\s]*)\)/);
      if (link) {
        // an unsafe address keeps its text and loses the link
        const href = safeHref(decodeURI(link[2]));
        pushPlain();
        out.push(...parseInline(link[1], pagesByTitle, href ? { ...marks, link: href } : marks));
        i += link[0].length;
        continue;
      }
    }

    const delim = ["***", "**", "__", "*", "_"].find((d) => rest.startsWith(d));
    if (delim) {
      const close = findClosing(text, delim, i + delim.length);
      if (close !== -1) {
        pushPlain();
        const added: Marks =
          delim === "***" ? { bold: true, italic: true } : delim.length === 2 ? { bold: true } : { italic: true };
        out.push(...parseInline(text.slice(i + delim.length, close), pagesByTitle, { ...marks, ...added }));
        i = close + delim.length;
        continue;
      }
      plain += delim;
      i += delim.length;
      continue;
    }

    plain += ch;
    i++;
  }

  pushPlain();
  return out;
}

/**
 * Reads Markdown into a page. A "# Title" first line becomes the page title.
 * [[Title]] links to a page of that name when one exists.
 */
export function markdownToDoc(markdown: string, pages: PageMeta[] = []): Doc {
  const pagesByTitle = new Map(pages.map((page) => [page.title.trim().toLowerCase(), page]));
  const inline = (text: string) => normalize(parseInline(text.trim(), pagesByTitle));
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");

  const blocks: Block[] = [];
  let title = "";
  // consecutive lines of one paragraph or one quote join into a single block
  let pending: { type: "paragraph" | "quote"; lines: string[] } | null = null;
  // leading-space widths of the open list levels, outermost first
  const listIndents: number[] = [];

  const add = (type: BlockType, text: string, extra: Partial<Block> = {}) => {
    blocks.push({ ...createBlock(type, inline(text)), ...extra });
  };
  const flushParagraph = () => {
    if (pending) add(pending.type, pending.lines.join(" "));
    pending = null;
  };
  const addLine = (type: "paragraph" | "quote", text: string) => {
    if (pending?.type !== type) flushParagraph();
    pending ??= { type, lines: [] };
    pending.lines.push(text);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flushParagraph();
      listIndents.length = 0;
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) {
        if (lines[i]) blocks.push(createBlock("paragraph", [{ text: lines[i], code: true }]));
      }
      continue;
    }

    const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    const isDivider = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line);
    if (list && !isDivider) {
      flushParagraph();
      const spaces = list[1].length;
      while (listIndents.length > 0 && listIndents[listIndents.length - 1] >= spaces) listIndents.pop();
      const indent = listIndents.length;
      listIndents.push(spaces);

      const task = /^[-*+]$/.test(list[2]) ? list[3].match(/^\[([ xX])\]\s+(.*)$/) : null;
      if (task) add("todo", task[2], { indent, checked: task[1] !== " " });
      else add(/\d/.test(list[2]) ? "numbered" : "bulleted", list[3], { indent });
      continue;
    }
    listIndents.length = 0;

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)(\s+#+)?\s*$/);
    if (heading) {
      flushParagraph();
      if (heading[1].length === 1 && !title && blocks.length === 0) {
        title = normalize(parseInline(heading[2], pagesByTitle)).map((span) => span.text).join("");
        continue;
      }
      const level = Math.min(heading[1].length, 3);
      add(level === 1 ? "heading1" : level === 2 ? "heading2" : "heading3", heading[2]);
      continue;
    }

    if (isDivider) {
      flushParagraph();
      blocks.push(createBlock("divider"));
      continue;
    }

    const image = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    const imageSrc = image && safeHref(image[2]);
    if (image && imageSrc && !imageSrc.startsWith("mailto:")) {
      flushParagraph();
      blocks.push({ ...createBlock("image"), src: imageSrc, alt: image[1] });
      continue;
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    addLine(quote ? "quote" : "paragraph", quote ? quote[1] : line);
  }
  flushParagraph();

  return { title, blocks: blocks.length > 0 ? normalizeIndents(blocks) : [createBlock()] };
}
