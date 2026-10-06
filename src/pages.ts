// Page templates. Every interpolation goes through `html`, which escapes by
// default; only renderer output (post bodies, inline tagline) is passed `raw`.

import type { Post } from "./content.ts";
import { type Html, html, raw } from "./html.ts";
import { escapeHtml, renderMarkdownInline } from "./markdown/mod.ts";
import type { Site } from "./site.ts";

export interface RenderContext {
  site: Site;
  /** Cache-busting token appended to asset URLs. */
  assetVersion: string;
  /** Adds the live-reload client. */
  dev: boolean;
  year: number;
}

type Section = "posts" | "archive" | "tags" | null;

interface PageMeta {
  title: string;
  description: string;
  path: string;
  section: Section;
  type?: "website" | "article";
  /** Enables post-only behaviour such as the reading progress bar. */
  article?: boolean;
}

/** Render every output file, keyed by path relative to the output directory. */
export function renderSite(posts: Post[], ctx: RenderContext): Map<string, string> {
  const files = new Map<string, string>();
  files.set("index.html", homePage(posts, ctx));
  files.set("archive/index.html", archivePage(posts, ctx));
  files.set("tags/index.html", tagsPage(posts, ctx));
  for (const [tag, tagged] of groupByTag(posts)) {
    files.set(`tags/${tag}/index.html`, tagPage(tag, tagged, ctx));
  }
  posts.forEach((post, k) => {
    files.set(`posts/${post.slug}/index.html`, postPage(post, posts[k - 1], posts[k + 1], ctx));
  });
  files.set("404.html", notFoundPage(ctx));
  files.set("rss.xml", rssFeed(posts, ctx));
  files.set("sitemap.xml", sitemap(posts, ctx));
  files.set("favicon.svg", favicon());
  return files;
}

// ── Pages ────────────────────────────────────────────────────────────────

function homePage(posts: Post[], ctx: RenderContext): string {
  const { site } = ctx;
  const latest = posts.slice(0, site.postsOnHome);
  const body = html`
    <section class="hero">
      <div class="hero-mark">${pixelMark("hero")}</div>
      <h1 class="hero-title">${raw(renderMarkdownInline(site.tagline))}</h1>
      <p class="hero-lede">${site.description}</p>
      <div class="hero-actions">
        <a class="btn" href="${link(ctx, "/archive/")}">Archive</a>
        <a class="btn" href="${link(ctx, "/rss.xml")}">RSS feed</a>
      </div>
    </section>
    <section class="feed" aria-labelledby="latest-heading">
      <header class="section-head">
        <h2 class="label" id="latest-heading">Latest writing</h2>
        <span class="label">${plural(posts.length, "post")}</span>
      </header>
      ${latest.length > 0
        ? html`<ol class="timeline">${latest.map((post) => postCard(post, ctx))}</ol>`
        : html`<p class="empty">Nothing published yet. Run <code>deno task new "Title"</code> to start.</p>`}
      ${posts.length > latest.length
        ? html`<p class="feed-more"><a class="btn" href="${
          link(ctx, "/archive/")
        }">All ${posts.length} posts</a></p>`
        : null}
    </section>
  `;
  return layout(ctx, { title: site.title, description: site.description, path: "/", section: "posts" }, body);
}

function postPage(post: Post, newer: Post | undefined, older: Post | undefined, ctx: RenderContext): string {
  const hasToc = post.toc.length >= 2;
  const body = html`
    <article class="post">
      <header class="post-header">
        <a class="back-link" href="${link(ctx, "/")}">← All posts</a>
        <div class="meta-row">${postMeta(post, ctx)}</div>
        <h1 class="post-title">${post.title}</h1>
        ${post.summary ? html`<p class="post-lede">${post.summary}</p>` : null}
      </header>
      <div class="post-layout${hasToc ? " has-toc" : ""}">
        <div class="prose">${raw(rebaseLinks(post.html, ctx.site.basePath))}</div>
        ${hasToc ? toc(post) : null}
      </div>
      <footer class="post-footer">
        ${post.tags.length > 0
          ? html`<p class="filed"><span class="label">Filed under</span> ${
            post.tags.map((t) => tagBadge(t, ctx))
          }</p>`
          : null}
        ${newer || older
          ? html`<nav class="post-nav" aria-label="More posts">
          ${newer ? navCard(newer, "newer", ctx) : null}
          ${older ? navCard(older, "older", ctx) : null}
        </nav>`
          : null}
      </footer>
    </article>
  `;
  return layout(ctx, {
    title: `${post.title} — ${ctx.site.title}`,
    description: post.summary || ctx.site.description,
    path: `/posts/${post.slug}/`,
    section: "posts",
    type: "article",
    article: true,
  }, body);
}

function archivePage(posts: Post[], ctx: RenderContext): string {
  const years = new Map<string, Post[]>();
  for (const post of posts) {
    const year = post.date.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), post]);
  }
  const body = html`
    ${pageHeader("Archive", `Everything, newest first — ${plural(posts.length, "post")}.`)}
    ${[...years].map(([year, list]) =>
      html`<section class="year-group" aria-labelledby="y${year}">
        <h2 class="year" id="y${year}">${year}</h2>
        ${postList(list, ctx)}
      </section>`
    )}
  `;
  return layout(ctx, {
    title: `Archive — ${ctx.site.title}`,
    description: `All posts on ${ctx.site.title}.`,
    path: "/archive/",
    section: "archive",
  }, body);
}

function tagsPage(posts: Post[], ctx: RenderContext): string {
  const tags = [...groupByTag(posts)].sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b));
  const body = html`
    ${pageHeader("Tags", "Posts grouped by topic.")}
    <ul class="tag-cloud">
      ${tags.map(([tag, list]) =>
        html`<li><a class="tag-chip" href="${
          link(ctx, `/tags/${tag}/`)
        }"><span>${tag}</span><span class="count">${list.length}</span></a></li>`
      )}
    </ul>
  `;
  return layout(ctx, {
    title: `Tags — ${ctx.site.title}`,
    description: `Topics on ${ctx.site.title}.`,
    path: "/tags/",
    section: "tags",
  }, body);
}

function tagPage(tag: string, posts: Post[], ctx: RenderContext): string {
  const body = html`
    ${pageHeader(
      `#${tag}`,
      `${plural(posts.length, "post")} tagged ${tag}.`,
      html`<a class="back-link" href="${link(ctx, "/tags/")}">← All tags</a>`,
    )}
    <section class="year-group single">${postList(posts, ctx)}</section>
  `;
  return layout(ctx, {
    title: `#${tag} — ${ctx.site.title}`,
    description: `Posts tagged ${tag} on ${ctx.site.title}.`,
    path: `/tags/${tag}/`,
    section: "tags",
  }, body);
}

function notFoundPage(ctx: RenderContext): string {
  const body = html`
    <section class="hero hero-404">
      <p class="label">Error 404</p>
      <h1 class="hero-title">This page is <em>off the grid</em></h1>
      <p class="hero-lede">The link may be old, or the post moved.</p>
      <div
        class="hero-actions"><a class="btn" href="${link(ctx, "/")}">Back home</a><a class="btn" href="${link(
          ctx,
          "/archive/",
        )}">Archive</a></div>
    </section>
  `;
  return layout(ctx, {
    title: `Not found — ${ctx.site.title}`,
    description: "Page not found.",
    path: "/404.html",
    section: null,
  }, body);
}

// ── Layout ───────────────────────────────────────────────────────────────

function layout(ctx: RenderContext, meta: PageMeta, main: Html): string {
  const { site } = ctx;
  const asset = (name: string) => link(ctx, `/assets/${name}?v=${ctx.assetVersion}`);
  const current = (section: Section) => meta.section === section ? raw(` aria-current="page"`) : null;
  const doc = html`
    <!doctype html>
    <html lang="${site.language}">
      <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${meta.title}</title>
    <meta name="description" content="${meta.description}">
    <meta name="author" content="${site.author}">
    <link rel="canonical" href="${absolute(ctx, meta.path)}">
    <meta property="og:type" content="${meta.type ?? "website"}">
    <meta property="og:site_name" content="${site.title}">
    <meta property="og:title" content="${meta.title}">
    <meta property="og:description" content="${meta.description}">
    <meta property="og:url" content="${absolute(ctx, meta.path)}">
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="#ebe7e4" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#161d27" media="(prefers-color-scheme: dark)">
    <link rel="icon" type="image/svg+xml" href="${link(ctx, "/favicon.svg")}">
    <link rel="alternate" type="application/rss+xml" title="${site.title}" href="${link(ctx, "/rss.xml")}">
    <link rel="preload" href="${link(
      ctx,
      "/assets/fonts/newsreader-opsz-normal.woff2",
    )}" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="${link(
      ctx,
      "/assets/fonts/newsreader-opsz-italic.woff2",
    )}" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="${link(
      ctx,
      "/assets/fonts/departure-mono.woff2",
    )}" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="${asset("style.css")}">
    <script>try{const t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch{}</script>
    <script src="${asset("site.js")}" defer></script>
    ${ctx.dev
      ? raw(`<script>new EventSource("/__livereload").onmessage=()=>location.reload()</script>`)
      : null}
      </head>
      <body${meta.article ? raw(` class="is-article"`) : null}>
        <a class="skip-link" href="#main">Skip to content</a>
        <header class="site-header">
          <nav class="nav" aria-label="Primary">
            <a class="nav-brand" href="${link(ctx, "/")}"
              aria-label="${site.title}, home">${pixelMark("nav")}<span>${site.title}</span></a>
            <div class="nav-links">
              <a href="${link(ctx, "/")}" ${current("posts")}>Posts</a>
              <a href="${link(ctx, "/archive/")}" ${current("archive")}>Archive</a>
              <a href="${link(ctx, "/tags/")}" ${current("tags")}>Tags</a>
              <a class="nav-rss" href="${link(ctx, "/rss.xml")}">RSS</a>
            </div>
            <button class="theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
                <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />
              </svg>
            </button>
            <span class="nav-progress" aria-hidden="true"></span>
          </nav>
        </header>
        <main id="main" class="main">
    ${main}
        </main>
        <footer class="site-footer">
          <div class="footer-inner">
            <span>© ${ctx.year} ${site.author}</span>
            <span>Written in Markdown · rendered by hand</span>
            <a href="#main">Back to top ↑</a>
          </div>
        </footer>
        </body>
        </html>
  `;
  return doc.value;
}

// ── Components ───────────────────────────────────────────────────────────

function postCard(post: Post, ctx: RenderContext): Html {
  const href = link(ctx, `/posts/${post.slug}/`);
  return html`
    <li class="timeline-item">
      <article class="card">
          <div class="meta-row">${postMeta(post, ctx)}</div>
          <h3 class="card-title"><a href="${href}">${post.title}</a></h3>
          ${post.summary ? html`<p class="card-summary">${post.summary}</p>` : null}
          <a class="read-more" href="${href}" aria-hidden="true" tabindex="-1">Read more</a>
        </article>
    </li>
  `;
}

function postMeta(post: Post, ctx: RenderContext): Html {
  return html`
    ${post.draft ? html`<span class="badge badge-draft">Draft</span>` : null}${post.tags.map((tag) =>
      tagBadge(tag, ctx)
    )}<span
      class="meta stamp"><time datetime="${post.date}">${formatDate(post.date)}</time> · ${post
        .readingMinutes} min read</span>
  `;
}

function postList(posts: Post[], ctx: RenderContext): Html {
  return html`<ol class="post-list">
    ${
    posts.map((post) =>
      html`
        <li class="post-row">
          <time class="meta" datetime="${post.date}">${formatDate(post.date, false)}</time>
          <a class="post-row-title" href="${link(ctx, `/posts/${post.slug}/`)}">${post.title}${post.draft
            ? html`
              <span class="badge badge-draft">Draft</span>
            `
            : null}</a>
          <span class="post-row-tags">${post.tags.map((tag) => tagBadge(tag, ctx))}</span>
        </li>
      `
    )
  }
  </ol>`;
}

function tagBadge(tag: string, ctx: RenderContext): Html {
  return html`<a class="badge" href="${link(ctx, `/tags/${tag}/`)}">${tag}</a>`;
}

function toc(post: Post): Html {
  return html`
    <aside class="toc" aria-label="On this page">
      <p class="label">On this page</p>
      <ol>${post.toc.map((entry) =>
        html`<li class="toc-l${entry.level}"><a href="#${entry.id}">${entry.text}</a></li>`
      )}</ol>
    </aside>
  `;
}

function navCard(post: Post, direction: "newer" | "older", ctx: RenderContext): Html {
  const label = direction === "newer" ? "← Newer" : "Older →";
  return html`
    <a class="post-nav-link ${direction}" href="${link(ctx, `/posts/${post.slug}/`)}">
      <span class="label">${label}</span>
      <span class="post-nav-title">${post.title}</span>
    </a>
  `;
}

function pageHeader(title: string, lede: string, extra: Html | null = null): Html {
  return html`<header class="page-header">
    ${extra}
    <h1 class="page-title">${title}</h1>
    <p class="page-lede">${lede}</p>
  </header>`;
}

// The "AN" monogram as a pixel grid: A pixels are warm, N pixels are blue, the N's diagonal is gold.
const MARK = [
  ".AA..N..N",
  "A..A.NG.N",
  "AAAA.N.GN",
  "A..A.N..N",
  "A..A.N..N",
];
const MARK_COLORS: Record<string, string> = { A: "#ec8a78", N: "#4a98c4", G: "#efb757" };

function pixelMark(variant: "nav" | "hero" | "favicon"): Html {
  const size = variant === "hero" ? 12 : variant === "nav" ? 3 : 4;
  const rects: string[] = [];
  MARK.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (cell === ".") return;
      const fill = variant === "nav" ? "currentColor" : MARK_COLORS[cell];
      rects.push(`<rect x="${x * size}" y="${y * size}" width="${size}" height="${size}" fill="${fill}"/>`);
    })
  );
  const w = MARK[0]!.length * size;
  const h = MARK.length * size;
  return raw(
    `<svg class="mark mark-${variant}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" aria-hidden="true">${
      rects.join("")
    }</svg>`,
  );
}

function favicon(): string {
  const mark = pixelMark("favicon").value.replace(/<svg[^>]*>|<\/svg>/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -10 40 40" shape-rendering="crispEdges"><rect x="-2" y="-10" width="40" height="40" fill="#161d27"/>${mark}</svg>\n`;
}

// ── Feeds ────────────────────────────────────────────────────────────────

function rssFeed(posts: Post[], ctx: RenderContext): string {
  const { site } = ctx;
  const items = posts.slice(0, 20).map((post) => {
    const url = absolute(ctx, `/posts/${post.slug}/`);
    // Feed readers resolve nothing relative to the site; make root-relative links absolute.
    const content = rebaseLinks(post.html, site.baseUrl);
    return `    <item>
      <title>${escapeHtml(post.title)}</title>
      <link>${escapeHtml(url)}</link>
      <guid isPermaLink="true">${escapeHtml(url)}</guid>
      <pubDate>${rfc822(post.date)}</pubDate>
      <description>${escapeHtml(post.summary)}</description>
${post.tags.map((tag) => `      <category>${escapeHtml(tag)}</category>\n`).join("")}      <content:encoded>${
      escapeHtml(content)
    }</content:encoded>
    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeHtml(site.title)}</title>
    <link>${escapeHtml(absolute(ctx, "/"))}</link>
    <description>${escapeHtml(site.description)}</description>
    <language>${escapeHtml(site.language)}</language>
    <atom:link href="${escapeHtml(absolute(ctx, "/rss.xml"))}" rel="self" type="application/rss+xml"/>
${posts[0] ? `    <lastBuildDate>${rfc822(posts[0].date)}</lastBuildDate>\n` : ""}${items.join("\n")}
  </channel>
</rss>
`;
}

function sitemap(posts: Post[], ctx: RenderContext): string {
  const urls = [
    ["/", posts[0]?.date],
    ["/archive/", posts[0]?.date],
    ["/tags/", undefined],
    ...posts.map((post) => [`/posts/${post.slug}/`, post.date]),
  ].map(([path, date]) =>
    `  <url><loc>${escapeHtml(absolute(ctx, path!))}</loc>${date ? `<lastmod>${date}</lastmod>` : ""}</url>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function link(ctx: RenderContext, path: string): string {
  return ctx.site.basePath + path;
}

function absolute(ctx: RenderContext, path: string): string {
  return ctx.site.baseUrl + path;
}

/** In post bodies `/x` means the site root; prefix such links (not `//host` ones) with `base`. */
function rebaseLinks(html: string, base: string): string {
  return base ? html.replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`) : html;
}

function groupByTag(posts: Post[]): Map<string, Post[]> {
  const tags = new Map<string, Post[]>();
  for (const post of posts) for (const tag of post.tags) tags.set(tag, [...(tags.get(tag) ?? []), post]);
  return tags;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-05-02` → `May 2, 2026` (or `May 02` without the year). */
export function formatDate(date: string, withYear = true): string {
  const [year, month, day] = date.split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  return withYear ? `${name} ${Number(day)}, ${year}` : `${name} ${day}`;
}

function rfc822(date: string): string {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
