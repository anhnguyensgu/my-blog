// Block-level Markdown parser: turns source lines into a tree of blocks whose
// text is still raw inline Markdown. Container blocks (quotes, list items) are
// parsed by stripping their prefix and recursing on the inner lines.

export type Align = "left" | "center" | "right" | null;
export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "quote"; children: Block[] }
  | { type: "callout"; kind: CalloutKind; children: Block[] }
  | { type: "list"; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { type: "table"; align: Align[]; head: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "html"; html: string };

export interface ListItem {
  /** `null` for ordinary items, a boolean for task-list items. */
  checked: boolean | null;
  children: Block[];
}

export interface LinkRef {
  href: string;
  title: string | null;
}

/** Link reference definitions keyed by normalized label. */
export type RefMap = Map<string, LinkRef>;

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const LIST_ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])(?=[ \t]|$)/;
const TASK = /^\[([ xX])\](?:[ \t]+|$)/;
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const CALLOUT = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;
const HTML_BLOCK = new RegExp(
  "^ {0,3}(?:<!--|<\\/?(?:address|article|aside|blockquote|details|dialog|div|dl|dt|dd|fieldset|" +
    "figcaption|figure|footer|form|h[1-6]|header|hr|iframe|li|main|nav|ol|p|picture|pre|script|" +
    "section|style|summary|svg|table|tbody|td|tfoot|th|thead|tr|ul|video|audio)(?:[\\s/>]|$))",
  "i",
);
const REF_DEF =
  /^ {0,3}\[((?:[^\\[\]]|\\.){1,999})\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\(((?:[^()\\]|\\.)*)\)))?[ \t]*$/;

/** Parse a Markdown document into blocks, collecting link reference definitions into `refs`. */
export function parseBlocks(source: string, refs: RefMap): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n").map(expandIndentTabs);
  return parseLines(lines, refs).blocks;
}

/** Normalize a link label for reference lookup (case- and whitespace-insensitive). */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Remove Markdown backslash escapes. */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

interface Parsed {
  blocks: Block[];
  /** True when a blank line separates two sibling blocks; makes a containing list item loose. */
  blankBetween: boolean;
}

function parseLines(lines: string[], refs: RefMap): Parsed {
  const blocks: Block[] = [];
  let sawBlank = false;
  let blankBetween = false;
  const push = (block: Block) => {
    if (sawBlank && blocks.length > 0) blankBetween = true;
    sawBlank = false;
    blocks.push(block);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (isBlank(line)) {
      sawBlank = true;
      i++;
      continue;
    }

    if (indentOf(line) >= 4) {
      const body: string[] = [];
      while (i < lines.length && (isBlank(lines[i]!) || indentOf(lines[i]!) >= 4)) {
        body.push(stripIndent(lines[i]!, 4));
        i++;
      }
      while (body.length > 0 && isBlank(body[body.length - 1]!)) {
        body.pop();
        i--;
      }
      push({ type: "code", lang: "", code: body.join("\n") });
      continue;
    }

    const fence = openFence(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = FENCE_CLOSE.exec(lines[i]!);
        if (close && close[1]![0] === fence.marker[0] && close[1]!.length >= fence.marker.length) {
          i++;
          break;
        }
        body.push(stripIndent(lines[i]!, fence.indent));
        i++;
      }
      push({ type: "code", lang: fence.lang, code: body.join("\n") });
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      const text = atx[2]!.replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
      push({ type: "heading", level: atx[1]!.length, text });
      i++;
      continue;
    }

    if (HR.test(line)) {
      push({ type: "hr" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        if (QUOTE.test(current)) {
          inner.push(current.replace(QUOTE, ""));
        } else if (isLazyContinuation(current, inner)) {
          inner.push(current);
        } else {
          break;
        }
        i++;
      }
      push(quoteBlock(parseLines(inner, refs).blocks));
      continue;
    }

    if (HTML_BLOCK.test(line)) {
      const end = /^ {0,3}<!--/.test(line)
        ? /-->/
        : /^ {0,3}<(?:script|pre|style)[\s>]/i.test(line)
        ? /<\/(?:script|pre|style)>/i
        : null;
      const body: string[] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        if (!end && isBlank(current)) break;
        body.push(current);
        i++;
        if (end?.test(current)) break;
      }
      push({ type: "html", html: body.join("\n") });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = parseList(lines, i, refs);
      push(list.block);
      i = list.next;
      continue;
    }

    const table = parseTable(lines, i);
    if (table) {
      push(table.block);
      i = table.next;
      continue;
    }

    // Paragraph, possibly turned into a setext heading by an underline.
    const para: string[] = [line];
    let setextLevel = 0;
    i++;
    while (i < lines.length) {
      const current = lines[i]!;
      if (isBlank(current)) break;
      const underline = SETEXT.exec(current);
      if (underline && extractRefs(para, new Map()).length > 0) {
        setextLevel = underline[1]![0] === "=" ? 1 : 2;
        i++;
        break;
      }
      if (interruptsParagraph(current)) break;
      para.push(current);
      i++;
    }
    const content = extractRefs(para, refs);
    if (content.length === 0) continue;
    const text = content.map((l) => l.trimStart()).join("\n").trimEnd();
    push(setextLevel ? { type: "heading", level: setextLevel, text } : { type: "paragraph", text });
  }

  return { blocks, blankBetween };
}

function parseList(lines: string[], start: number, refs: RefMap): { block: Block; next: number } {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const kind = markerKind(first[2]!);
  const ordered = kind === "." || kind === ")";
  const items: ListItem[] = [];
  let tight = true;
  let i = start;

  while (true) {
    const line = lines[i]!;
    const marker = LIST_ITEM.exec(line)!;
    const afterMarker = line.slice(marker[0].length);
    const spaces = /^[ \t]*/.exec(afterMarker)![0].length;
    let contentIndent = marker[0].length + spaces;
    let firstLine = afterMarker.slice(spaces);
    if (isBlank(afterMarker)) {
      contentIndent = marker[0].length + 1;
      firstLine = "";
    } else if (spaces > 4) {
      // Content starts with indented code: the item's own indent is one space past the marker.
      contentIndent = marker[0].length + 1;
      firstLine = afterMarker.slice(1);
    }

    const body = [firstLine];
    i++;
    while (i < lines.length) {
      const current = lines[i]!;
      if (isBlank(current)) {
        body.push("");
      } else if (indentOf(current) >= contentIndent) {
        body.push(current.slice(contentIndent));
      } else if (isLazyContinuation(current, body)) {
        body.push(current.trimStart());
      } else {
        break;
      }
      i++;
    }
    // Trailing blank lines belong to whatever follows the item, not the item itself.
    while (body.length > 1 && isBlank(body[body.length - 1]!)) {
      body.pop();
      i--;
    }

    let checked: boolean | null = null;
    const task = TASK.exec(body[0]!);
    if (task) {
      checked = task[1] !== " ";
      body[0] = body[0]!.slice(task[0].length);
    }
    const parsed = parseLines(body, refs);
    if (parsed.blankBetween) tight = false;
    items.push({ checked, children: parsed.blocks });

    let next = i;
    while (next < lines.length && isBlank(lines[next]!)) next++;
    const sibling = next < lines.length ? LIST_ITEM.exec(lines[next]!) : null;
    if (!sibling || markerKind(sibling[2]!) !== kind || HR.test(lines[next]!)) break;
    if (next > i) tight = false;
    i = next;
  }

  const startNumber = ordered ? parseInt(first[2]!, 10) : 1;
  return { block: { type: "list", ordered, start: startNumber, tight, items }, next: i };
}

function parseTable(lines: string[], i: number): { block: Block; next: number } | null {
  const headLine = lines[i]!;
  const delimLine = lines[i + 1];
  if (!headLine.includes("|") || delimLine === undefined) return null;
  if (!delimLine.includes("|") || !TABLE_DELIM.test(delimLine)) return null;
  const head = splitRow(headLine);
  const delims = splitRow(delimLine);
  if (head.length !== delims.length) return null;

  const align = delims.map((d): Align => {
    const left = d.startsWith(":");
    const right = d.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  const rows: string[][] = [];
  let next = i + 2;
  while (next < lines.length && !isBlank(lines[next]!) && !interruptsParagraph(lines[next]!)) {
    const cells = splitRow(lines[next]!);
    rows.push(head.map((_, k) => cells[k] ?? ""));
    next++;
  }
  return { block: { type: "table", align, head, rows }, next };
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let k = 0; k < row.length; k++) {
    const c = row[k]!;
    if (c === "\\" && row[k + 1] === "|") {
      cell += "|";
      k++;
    } else if (c === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function quoteBlock(children: Block[]): Block {
  const first = children[0];
  const callout = first?.type === "paragraph" ? CALLOUT.exec(first.text) : null;
  if (!first || first.type !== "paragraph" || !callout) return { type: "quote", children };
  const rest = first.text.slice(callout[0].length);
  const body = rest.trim() ? [{ ...first, text: rest }, ...children.slice(1)] : children.slice(1);
  return { type: "callout", kind: callout[1]!.toLowerCase() as CalloutKind, children: body };
}

/** Strip leading link reference definitions from paragraph lines, recording them in `refs`. */
function extractRefs(lines: string[], refs: RefMap): string[] {
  let k = 0;
  for (; k < lines.length; k++) {
    const def = REF_DEF.exec(lines[k]!);
    if (!def) break;
    const label = normalizeLabel(def[1]!);
    const title = def[4] ?? def[5] ?? def[6];
    if (!refs.has(label)) {
      refs.set(label, {
        href: unescapeMarkdown(def[2] ?? def[3] ?? ""),
        title: title === undefined ? null : unescapeMarkdown(title),
      });
    }
  }
  return lines.slice(k);
}

function openFence(line: string): { indent: number; marker: string; lang: string } | null {
  const m = FENCE.exec(line);
  if (!m) return null;
  const marker = m[2]!;
  const info = m[3]!.trim();
  if (marker[0] === "`" && info.includes("`")) return null;
  return { indent: m[1]!.length, marker, lang: unescapeMarkdown(info.split(/\s+/)[0] ?? "") };
}

/** Whether `line` starts a block that ends an open paragraph. */
function interruptsParagraph(line: string): boolean {
  if (ATX.test(line) || HR.test(line) || QUOTE.test(line) || HTML_BLOCK.test(line) || openFence(line)) {
    return true;
  }
  const item = LIST_ITEM.exec(line);
  if (!item) return false;
  // Empty items, and ordered lists not starting at 1, cannot interrupt a paragraph.
  if (isBlank(line.slice(item[0].length))) return false;
  return !/^\d/.test(item[2]!) || parseInt(item[2]!, 10) === 1;
}

/** A non-blank line that continues the paragraph at the end of `body` despite missing its container prefix. */
function isLazyContinuation(line: string, body: string[]): boolean {
  if (isBlank(line) || body.length === 0) return false;
  const last = body[body.length - 1]!;
  if (isBlank(last) || ATX.test(last) || HR.test(last) || indentOf(last) >= 4) return false;
  if (LIST_ITEM.test(line) || interruptsParagraph(line)) return false;
  const fences = body.filter((l) => openFence(l) !== null || FENCE_CLOSE.test(l)).length;
  return fences % 2 === 0;
}

function markerKind(marker: string): string {
  return /^\d/.test(marker) ? marker.slice(-1) : marker;
}

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function indentOf(line: string): number {
  return /^ */.exec(line)![0].length;
}

function stripIndent(line: string, count: number): string {
  let k = 0;
  while (k < count && line[k] === " ") k++;
  return line.slice(k);
}

/** Expand tabs in leading whitespace to 4-column tab stops; tabs elsewhere are content. */
function expandIndentTabs(line: string): string {
  const lead = /^[ \t]*/.exec(line)![0];
  if (!lead.includes("\t")) return line;
  let col = 0;
  for (const c of lead) col = c === "\t" ? col + 4 - (col % 4) : col + 1;
  return " ".repeat(col) + line.slice(lead.length);
}
