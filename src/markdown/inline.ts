// Inline Markdown renderer: code spans, links, images, autolinks, raw HTML,
// entities, and emphasis via the CommonMark delimiter-run algorithm.

import { type LinkRef, normalizeLabel, type RefMap, unescapeMarkdown } from "./block.ts";
import { decodeEntities, escapeHtml, htmlToText } from "./escape.ts";

type Delimiter = {
  t: "delim";
  ch: "*" | "_" | "~";
  /** Remaining unmatched characters in the run. */
  n: number;
  /** Original run length, needed for the "rule of 3". */
  orig: number;
  open: boolean;
  close: boolean;
};
type Node = { t: "text"; v: string } | { t: "html"; v: string } | Delimiter;

interface Bracket {
  node: number;
  image: boolean;
  active: boolean;
  /** Source offset just after the opening bracket, used to recover the raw label. */
  labelStart: number;
}

interface LinkTarget extends LinkRef {
  end: number;
}

const ESCAPABLE = /[!-/:-@[-`{-~]/;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;
const ENTITY = /^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/;
const AUTOLINK = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/;
const EMAIL_AUTOLINK =
  /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
const RAW_HTML = new RegExp(
  "^(?:<!--[\\s\\S]*?-->" +
    "|<[A-Za-z][A-Za-z0-9-]*(?:\\s+[A-Za-z_:][\\w.:-]*(?:\\s*=\\s*(?:[^\\s\"'=<>`]+|'[^']*'|\"[^\"]*\"))?)*\\s*/?>" +
    "|</[A-Za-z][A-Za-z0-9-]*\\s*>)",
);
const BARE_URL = /^https?:\/\/[^\s<]+/;

/** Render inline Markdown to HTML. */
export function renderInline(src: string, refs: RefMap): string {
  const nodes: Node[] = [];
  const brackets: Bracket[] = [];
  let text = "";
  const flush = () => {
    if (text) nodes.push({ t: "text", v: text });
    text = "";
  };
  const pushHtml = (v: string) => {
    flush();
    nodes.push({ t: "html", v });
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i]!;

    if (c === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        pushHtml("<br>\n");
        i += 2;
      } else if (next !== undefined && ESCAPABLE.test(next)) {
        text += next;
        i += 2;
      } else {
        text += c;
        i++;
      }
      continue;
    }

    if (c === "`") {
      const run = /^`+/.exec(src.slice(i))![0];
      const close = findBacktickRun(src, i + run.length, run.length);
      if (close < 0) {
        text += run;
        i += run.length;
        continue;
      }
      let code = src.slice(i + run.length, close).replace(/\n/g, " ");
      if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
      pushHtml(`<code>${escapeHtml(code)}</code>`);
      i = close + run.length;
      continue;
    }

    if (c === "<") {
      const rest = src.slice(i);
      const auto = AUTOLINK.exec(rest);
      const email = auto ? null : EMAIL_AUTOLINK.exec(rest);
      const tag = auto || email ? null : RAW_HTML.exec(rest);
      if (auto) {
        pushHtml(`<a href="${attr(safeUrl(auto[1]!, false))}">${escapeHtml(auto[1]!)}</a>`);
        i += auto[0].length;
      } else if (email) {
        pushHtml(`<a href="${attr(`mailto:${email[1]!}`)}">${escapeHtml(email[1]!)}</a>`);
        i += email[0].length;
      } else if (tag) {
        pushHtml(tag[0]);
        i += tag[0].length;
      } else {
        text += c;
        i++;
      }
      continue;
    }

    if (c === "&") {
      const entity = ENTITY.exec(src.slice(i));
      if (entity) {
        pushHtml(entity[0]);
        i += entity[0].length;
      } else {
        text += c;
        i++;
      }
      continue;
    }

    if (c === "[" || (c === "!" && src[i + 1] === "[")) {
      const image = c === "!";
      flush();
      brackets.push({ node: nodes.length, image, active: true, labelStart: i + (image ? 2 : 1) });
      nodes.push({ t: "text", v: image ? "![" : "[" });
      i += image ? 2 : 1;
      continue;
    }

    if (c === "]") {
      const opener = brackets.pop();
      const target = opener?.active
        ? parseLinkTarget(src, i + 1, src.slice(opener.labelStart, i), refs)
        : null;
      if (!opener || !target) {
        text += c;
        i++;
        continue;
      }
      flush();
      const inner = nodes.splice(opener.node + 1);
      nodes.pop();
      processEmphasis(inner);
      const content = renderNodes(inner);
      const title = target.title === null ? "" : ` title="${attr(target.title)}"`;
      if (opener.image) {
        const alt = attr(htmlToText(content));
        const src = attr(safeUrl(target.href, true));
        nodes.push({
          t: "html",
          v: `<img src="${src}" alt="${alt}"${title} loading="lazy" decoding="async">`,
        });
      } else {
        nodes.push({ t: "html", v: `<a href="${attr(safeUrl(target.href, false))}"${title}>${content}</a>` });
        // Links may not contain other links.
        for (const b of brackets) if (!b.image) b.active = false;
      }
      i = target.end;
      continue;
    }

    if (c === "*" || c === "_" || c === "~") {
      let end = i;
      while (src[end] === c) end++;
      const n = end - i;
      if (c === "~" && n !== 2) {
        text += src.slice(i, end);
        i = end;
        continue;
      }
      const before = i === 0 ? " " : src[i - 1]!;
      const after = end >= src.length ? " " : src[end]!;
      const beforeSpace = WHITESPACE.test(before);
      const afterSpace = WHITESPACE.test(after);
      const beforePunct = PUNCTUATION.test(before);
      const afterPunct = PUNCTUATION.test(after);
      const leftFlanking = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
      const rightFlanking = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
      const open = c === "_" ? leftFlanking && (!rightFlanking || beforePunct) : leftFlanking;
      const close = c === "_" ? rightFlanking && (!leftFlanking || afterPunct) : rightFlanking;
      flush();
      nodes.push({ t: "delim", ch: c, n, orig: n, open, close });
      i = end;
      continue;
    }

    if (c === "\n") {
      const hard = / {2,}$/.test(text);
      text = text.replace(/ +$/, "");
      if (hard) pushHtml("<br>\n");
      else text += "\n";
      i++;
      while (src[i] === " ") i++;
      continue;
    }

    if (
      c === "h" && (i === 0 || /[\s(*_~]/.test(src[i - 1]!)) && !brackets.some((b) => b.active && !b.image)
    ) {
      const url = bareUrl(src.slice(i));
      if (url) {
        pushHtml(`<a href="${attr(safeUrl(url, false))}">${escapeHtml(url)}</a>`);
        i += url.length;
        continue;
      }
    }

    text += c;
    i++;
  }

  flush();
  processEmphasis(nodes);
  return renderNodes(nodes);
}

/** Match emphasis delimiters, replacing each matched span with an HTML node. */
function processEmphasis(nodes: Node[]): void {
  let i = 0;
  while (i < nodes.length) {
    const closer = nodes[i]!;
    if (closer.t !== "delim" || !closer.close || closer.n === 0) {
      i++;
      continue;
    }
    let j = i - 1;
    for (; j >= 0; j--) {
      const candidate = nodes[j]!;
      if (candidate.t === "delim" && candidate.open && candidate.n > 0 && canPair(candidate, closer)) break;
    }
    if (j < 0) {
      i++;
      continue;
    }
    const opener = nodes[j] as Delimiter;
    const use = closer.ch === "~" ? 2 : opener.n >= 2 && closer.n >= 2 ? 2 : 1;
    const tag = closer.ch === "~" ? "del" : use === 2 ? "strong" : "em";
    const inner = renderNodes(nodes.slice(j + 1, i));
    opener.n -= use;
    closer.n -= use;
    nodes.splice(j + 1, i - j - 1, { t: "html", v: `<${tag}>${inner}</${tag}>` });
    i = j + 2;
    if (opener.n === 0) {
      nodes.splice(j, 1);
      i--;
    }
    if (closer.n === 0) nodes.splice(i, 1);
  }
}

function canPair(opener: Delimiter, closer: Delimiter): boolean {
  if (opener.ch !== closer.ch) return false;
  if (opener.ch === "~") return true;
  const bothCanBeEither = opener.close || closer.open;
  const sum = opener.orig + closer.orig;
  return !(bothCanBeEither && sum % 3 === 0 && !(opener.orig % 3 === 0 && closer.orig % 3 === 0));
}

function renderNodes(nodes: Node[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.t === "text") out += escapeHtml(node.v);
    else if (node.t === "html") out += node.v;
    else out += node.ch.repeat(node.n);
  }
  return out;
}

function findBacktickRun(src: string, from: number, length: number): number {
  let i = from;
  while (i < src.length) {
    if (src[i] !== "`") {
      i++;
      continue;
    }
    let end = i;
    while (src[end] === "`") end++;
    if (end - i === length) return i;
    i = end;
  }
  return -1;
}

/** Parse what follows `]`: an inline `(dest "title")`, a `[ref]`, `[]`, or a shortcut reference. */
function parseLinkTarget(src: string, pos: number, label: string, refs: RefMap): LinkTarget | null {
  if (src[pos] === "(") {
    const inline = parseInlineTarget(src, pos + 1);
    if (inline) return inline;
  }
  if (src[pos] === "[") {
    const close = src.indexOf("]", pos + 1);
    const ref = close < 0 ? null : src.slice(pos + 1, close);
    if (ref !== null && !/(?:^|[^\\])\[/.test(ref)) {
      const def = refs.get(normalizeLabel(ref === "" ? label : ref));
      if (def) return { ...def, end: close + 1 };
      if (ref !== "") return null;
    }
  }
  const def = refs.get(normalizeLabel(label));
  return def ? { ...def, end: pos } : null;
}

function parseInlineTarget(src: string, pos: number): LinkTarget | null {
  let p = pos;
  const skipSpace = () => {
    while (p < src.length && /[ \t\n]/.test(src[p]!)) p++;
  };
  skipSpace();

  let href: string;
  if (src[p] === "<") {
    const end = src.indexOf(">", p + 1);
    if (end < 0) return null;
    href = src.slice(p + 1, end);
    if (/[\n<]/.test(href)) return null;
    p = end + 1;
  } else {
    const start = p;
    let depth = 0;
    while (p < src.length) {
      const ch = src[p]!;
      if (ch === "\\" && ESCAPABLE.test(src[p + 1] ?? "")) {
        p += 2;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) break;
        depth--;
      } else if (ch.charCodeAt(0) <= 0x20) break; // spaces and control characters end the destination
      p++;
    }
    if (depth !== 0) return null;
    href = src.slice(start, p);
  }

  const beforeTitle = p;
  skipSpace();
  let title: string | null = null;
  const quote = src[p];
  if (p > beforeTitle && (quote === '"' || quote === "'" || quote === "(")) {
    const closeCh = quote === "(" ? ")" : quote;
    let k = p + 1;
    while (k < src.length && src[k] !== closeCh) k += src[k] === "\\" ? 2 : 1;
    if (k >= src.length) return null;
    title = decodeEntities(unescapeMarkdown(src.slice(p + 1, k)));
    p = k + 1;
    skipSpace();
  }
  if (src[p] !== ")") return null;
  return { href: decodeEntities(unescapeMarkdown(href)), title, end: p + 1 };
}

function bareUrl(rest: string): string | null {
  const match = BARE_URL.exec(rest);
  if (!match) return null;
  let url = match[0].replace(/[?!.,:;*_~'"]+$/, "");
  // Drop trailing ")" that close a parenthesis opened before the URL.
  while (url.endsWith(")") && count(url, "(") < count(url, ")")) url = url.slice(0, -1);
  return url.length > "https://".length ? url : null;
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

/** Percent-encode a URL and neutralize script-capable schemes. */
function safeUrl(url: string, image: boolean): string {
  const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme === "javascript" || scheme === "vbscript" || scheme === "file") return "#";
  if (scheme === "data" && !(image && /^data:image\/(?:png|gif|jpe?g|webp|avif);/i.test(url))) return "#";
  return url
    .replace(/%(?![0-9A-Fa-f]{2})/g, "%25")
    .replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/gu, (c) => encodeURIComponent(c));
}

function attr(value: string): string {
  return escapeHtml(value);
}
