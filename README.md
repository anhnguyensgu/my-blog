# my-blog

A static blog generator in strict TypeScript for Deno, with a hand-written Markdown parser and no runtime
dependencies. Posts in `content/` become a static site in `dist/`. The visual design is inspired by
[pi.dev](https://pi.dev): graph-paper backdrop, italic serif headlines, pixel-mono labels, and a light/dark
theme.

## Commands

```sh
deno task dev                 # build with drafts, serve http://127.0.0.1:8000, reload on change
deno task new "Post title"    # create content/post-title.md as a draft
deno task validate            # check every post, write nothing
deno task build               # build dist/ (drafts excluded)
SITE_URL=https://example.com deno task build   # absolute URLs for RSS, canonical links, sitemap

deno task check && deno task test && deno task lint && deno fmt --check
```

`dist/` is regenerated from scratch on every build and is not committed. Deploy it to any static host. The
URLs are `/posts/<slug>/`, so no rewrite rules are needed, and `404.html` is picked up automatically.
`SITE_URL` may include a path prefix (`https://user.github.io/blog`); all internal links follow it.

## Writing posts

```markdown
---
title: Simple HTTP Server in Odin
date: 2026-05-02
tags: odin, http
summary: One sentence shown on the home page, in the RSS feed, and under the title.
draft: false
---

Body in Markdown. Start sections at `##`; the post title is the page's `h1`.
```

- The file name is the slug: lowercase letters, digits, and single dashes.
- `title` and `date` (`YYYY-MM-DD`) are required. `summary` is required unless `draft: true`.
- Tags are comma-separated (or `[a, b]`) slugs. Unknown keys are errors. All problems are reported at once and
  a failing build writes nothing.
- Drafts appear in `deno task dev` (with a DRAFT badge) and never in `deno task build`.
- Site-wide images and files go in `assets/` and are served from `/assets/...`.

## Markdown support

Implemented in `src/markdown/` (block parser, inline parser, renderer, highlighter):

- ATX and setext headings with stable ids, hover anchors, and a table of contents (h2/h3)
- Paragraphs, hard breaks, `*em*`, `**strong**`, `~~strike~~`, `` `code` ``, backslash escapes, entities
- Links: inline, `[reference][]`, shortcut, `<autolinks>`, and bare `https://` URLs; `javascript:` is blocked
- Images; an image alone in a paragraph becomes a `<figure>` captioned by its title
- Fenced (`` ``` `` / `~~~`) and indented code, with highlighting for TS/JS, Odin, Zig, Go, Rust, C/C++,
  Java/Kotlin, Python, shell, SQL, JSON, YAML/TOML, and CSS
- Block quotes, GitHub callouts (`> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`)
- Ordered, unordered, nested, tight and loose lists, plus `- [ ]` task lists
- GFM tables with column alignment, and raw HTML blocks and inline tags

Not supported: footnotes, multi-line link reference titles, and some rare CommonMark edge cases.

## Layout

| Path             | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `site.config.ts` | Site title, tagline (inline Markdown), description, author   |
| `src/markdown/`  | Markdown → HTML                                              |
| `src/content.ts` | Front matter parsing, validation, ordering                   |
| `src/pages.ts`   | Page templates, RSS, sitemap (escaped by default via `html`) |
| `src/build.ts`   | Build pipeline into `dist/`                                  |
| `src/serve.ts`   | Local preview server with live reload                        |
| `assets/`        | `style.css`, `site.js`, fonts; copied to `dist/assets/`      |
| `test/`          | Markdown, content, and end-to-end build tests                |

Fonts are [Newsreader](https://github.com/productiontype/Newsreader) and
[Departure Mono](https://departuremono.com), both under the SIL Open Font License (see `assets/fonts/`).
