// Markdown → HTML. A hand-written CommonMark subset with the GitHub extensions
// a blog needs: tables, task lists, strikethrough, autolinks, and callouts.

import { type Block, parseBlocks, type RefMap } from "./block.ts";
import { escapeHtml, htmlToText, slugify } from "./escape.ts";
import { highlight } from "./highlight.ts";
import { renderInline } from "./inline.ts";

export { escapeHtml, slugify } from "./escape.ts";

export interface TocEntry {
  level: number;
  id: string;
  text: string;
}

export interface RenderedMarkdown {
  html: string;
  /** Level 2 and 3 headings, in document order. */
  toc: TocEntry[];
}

interface Context {
  refs: RefMap;
  toc: TocEntry[];
  ids: Set<string>;
}

const CALLOUT_TITLES = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

/** Render a Markdown document to HTML and collect its table of contents. */
export function renderMarkdown(source: string): RenderedMarkdown {
  const ctx: Context = { refs: new Map(), toc: [], ids: new Set() };
  const blocks = parseBlocks(source, ctx.refs);
  return { html: renderBlocks(blocks, ctx, false), toc: ctx.toc };
}

/** Render a single line of inline Markdown, e.g. a tagline. */
export function renderMarkdownInline(source: string): string {
  return renderInline(source, new Map());
}

function renderBlocks(blocks: Block[], ctx: Context, tight: boolean): string {
  return blocks.map((block) => renderBlock(block, ctx, tight)).join("\n");
}

function renderBlock(block: Block, ctx: Context, tight: boolean): string {
  switch (block.type) {
    case "heading": {
      const inner = renderInline(block.text, ctx.refs);
      const text = htmlToText(inner).trim();
      const id = uniqueId(slugify(text) || "section", ctx.ids);
      if (block.level === 2 || block.level === 3) ctx.toc.push({ level: block.level, id, text });
      const anchor = `<a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>`;
      return `<h${block.level} id="${id}">${inner}${anchor}</h${block.level}>`;
    }
    case "paragraph": {
      const inner = renderInline(block.text, ctx.refs);
      // A paragraph holding only an image becomes a figure; its title is the caption.
      if (!tight && /^<img [^>]*>$/.test(inner)) {
        const title = / title="([^"]*)"/.exec(inner)?.[1];
        const caption = title ? `<figcaption>${title}</figcaption>` : "";
        return `<figure>${inner}${caption}</figure>`;
      }
      return tight ? inner : `<p>${inner}</p>`;
    }
    case "code": {
      const lang = block.lang || "text";
      const cls = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : "";
      const code = highlight(block.code, block.lang);
      return `<div class="codeblock" data-lang="${
        escapeHtml(lang)
      }"><pre><code${cls}>${code}</code></pre></div>`;
    }
    case "quote":
      return `<blockquote>\n${renderBlocks(block.children, ctx, false)}\n</blockquote>`;
    case "callout": {
      const title = `<p class="callout-title">${CALLOUT_TITLES[block.kind]}</p>`;
      const body = renderBlocks(block.children, ctx, false);
      return `<aside class="callout callout-${block.kind}">\n${title}\n${body}\n</aside>`;
    }
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
      const items = block.items.map((item) => {
        const body = renderBlocks(item.children, ctx, block.tight);
        if (item.checked === null) return `<li>${body}</li>`;
        const box = `<input type="checkbox" disabled${item.checked ? " checked" : ""}>`;
        return `<li class="task">${box} ${body}</li>`;
      });
      return `<${tag}${start}>\n${items.join("\n")}\n</${tag}>`;
    }
    case "table": {
      const align = (k: number) => {
        const a = block.align[k];
        return a ? ` style="text-align:${a}"` : "";
      };
      const cells = (row: string[], tag: string) =>
        row.map((cell, k) => `<${tag}${align(k)}>${renderInline(cell, ctx.refs)}</${tag}>`).join("");
      const head = `<thead><tr>${cells(block.head, "th")}</tr></thead>`;
      const rows = block.rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("\n");
      const body = rows ? `\n<tbody>\n${rows}\n</tbody>` : "";
      return `<div class="table-wrap"><table>\n${head}${body}\n</table></div>`;
    }
    case "hr":
      return "<hr>";
    case "html":
      return block.html;
  }
}

function uniqueId(base: string, ids: Set<string>): string {
  let id = base;
  for (let n = 1; ids.has(id); n++) id = `${base}-${n}`;
  ids.add(id);
  return id;
}
