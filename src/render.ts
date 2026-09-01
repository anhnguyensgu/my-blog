import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import Mustache from "mustache";
import { loadPosts, type Post, type ValidationIssue } from "./content.js";
import type { BuildOptions } from "./cli.js";

export const SITE = {
  site_name: "Anh Nguyen",
  site_title: "Notes from Odin and systems work",
  site_note: "Short notes from building tools, servers, runtimes, and experiments in Odin.",
  home_url: "/",
  asset_path: "/",
  asset_version: "4",
  site_url: "http://127.0.0.1:8080",
} as const;

const RSS_MAX_ITEMS = 20;

interface TemplateData {
  [key: string]: unknown;
  site: typeof SITE;
  page_title: string;
}

interface Templates {
  layout: string;
  index: string;
  post: string;
  archive: string;
  error: string;
  postRow: string;
  tagBadge: string;
}

async function loadTemplates(templateDir: string): Promise<Templates> {
  const load = (filename: string) => readFile(path.join(templateDir, filename), "utf8");
  const [layout, index, post, archive, error, postRow, tagBadge] = await Promise.all([
    load("layout.html"),
    load("index.html"),
    load("post.html"),
    load("archive.html"),
    load("error.html"),
    load("post-row.html"),
    load("tag-badge.html"),
  ]);
  return { layout, index, post, archive, error, postRow, tagBadge };
}

function renderWithLayout(
  templates: Templates,
  page: "index" | "post" | "archive" | "error",
  data: TemplateData,
): string {
  const partials = {
    "post-row": templates.postRow,
    "tag-badge": templates.tagBadge,
  };
  const content = Mustache.render(templates[page], data, partials);
  return Mustache.render(templates.layout, { ...data, content });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function baseData(pageTitle: string): TemplateData {
  return { site: SITE, page_title: pageTitle };
}

function postView(post: Post): object {
  return {
    url: post.url,
    date: post.header.date,
    title: post.header.title,
    summary: post.header.summary,
    tags: post.header.tags,
  };
}

function renderPostPage(
  templates: Templates,
  post: Post,
  older: Post | undefined,
  newer: Post | undefined,
): string {
  return renderWithLayout(templates, "post", {
    ...baseData(`${post.header.title} - ${SITE.site_name}`),
    title: post.header.title,
    date: post.header.date,
    tags: post.header.tags.join(", "),
    tag_path: post.header.tags.join(" / "),
    reading_time: `${post.readingMinutes} min`,
    content_html: post.bodyHtml,
    has_navigation: Boolean(older || newer),
    older: older ? postView(older) : undefined,
    newer: newer ? postView(newer) : undefined,
  });
}

function renderIndex(templates: Templates, posts: Post[]): string {
  return renderWithLayout(templates, "index", {
    ...baseData(`${SITE.site_name} - ${SITE.site_title}`),
    home_heading: "Notes from the low-level web.",
    home_intro:
      "A running notebook about building a small blog engine in Odin, learning the web from raw TCP upward, and keeping the design readable enough for real study.",
    posts: posts.map(postView),
  });
}

function renderArchive(templates: Templates, posts: Post[]): string {
  const grouped = new Map<string, Post[]>();
  for (const post of posts) {
    const year = post.header.date.slice(0, 4);
    const group = grouped.get(year) ?? [];
    group.push(post);
    grouped.set(year, group);
  }

  const groups = [...grouped].map(([year, yearPosts]) => ({ year, posts: yearPosts.map(postView) }));
  return renderWithLayout(templates, "archive", {
    ...baseData(`Archive - ${SITE.site_name}`),
    groups,
  });
}

function renderRss(posts: Post[]): string {
  const items = posts.slice(0, RSS_MAX_ITEMS).map((post) => {
    const url = `${SITE.site_url}${post.url}`;
    const [year, month, day] = post.header.date.split("-");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const date = `${day} ${monthNames[Number(month) - 1]} ${year} 00:00:00 GMT`;
    return [
      "<item>",
      `<title>${escapeXml(post.header.title)}</title>`,
      `<link>${escapeXml(url)}</link>`,
      `<guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `<pubDate>${date}</pubDate>`,
      `<description>${escapeXml(post.header.summary)}</description>`,
      "</item>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    `<title>${escapeXml(SITE.site_title)}</title>`,
    `<link>${escapeXml(`${SITE.site_url}/`)}</link>`,
    `<description>${escapeXml(SITE.site_note)}</description>`,
    ...items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}

function renderNotFound(templates: Templates): string {
  return renderWithLayout(templates, "error", {
    ...baseData(`Page Not Found - ${SITE.site_name}`),
    heading: "Page Not Found",
    message: "The page you requested does not exist.",
  });
}

export async function buildSite(options: BuildOptions): Promise<{ postCount: number; issues: ValidationIssue[] }> {
  const { posts, issues } = await loadPosts(options.contentDir);
  if (issues.length > 0) return { postCount: 0, issues };

  const templates = await loadTemplates(options.templateDir);
  const postPages = posts.map((post, index) => ({
    post,
    html: renderPostPage(templates, post, posts[index + 1], posts[index - 1]),
  }));
  const indexHtml = renderIndex(templates, posts);
  const archiveHtml = renderArchive(templates, posts);
  const notFoundHtml = renderNotFound(templates);

  await mkdir(options.outputDir, { recursive: true });
  await rm(path.join(options.outputDir, "posts"), { recursive: true, force: true });
  await mkdir(path.join(options.outputDir, "posts"), { recursive: true });

  for (const page of postPages) {
    const postDir = path.join(options.outputDir, "posts", page.post.slug);
    await mkdir(postDir, { recursive: true });
    await writeFile(path.join(postDir, "index.html"), page.html);
  }

  await Promise.all([
    writeFile(path.join(options.outputDir, "index.html"), indexHtml),
    writeFile(path.join(options.outputDir, "archive.html"), archiveHtml),
    writeFile(path.join(options.outputDir, "rss.xml"), renderRss(posts)),
    writeFile(path.join(options.outputDir, "404.html"), notFoundHtml),
  ]);

  return { postCount: posts.length, issues: [] };
}
