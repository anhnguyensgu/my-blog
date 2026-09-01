import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import Mustache from "mustache";
import { loadPosts, type Post, type ValidationIssue } from "./content.js";
import type { BuildOptions } from "./cli.js";

export interface SiteConfig {
  site_name: string;
  site_title: string;
  site_note: string;
  home_url: string;
  asset_path: string;
  asset_version: string;
  site_url: string;
}

export const DEFAULT_SITE: SiteConfig = {
  site_name: "Anh Nguyen",
  site_title: "Notes from Odin and systems work",
  site_note: "Short notes from building tools, servers, runtimes, and experiments in Odin.",
  home_url: "/",
  asset_path: "/",
  asset_version: "4",
  site_url: "http://127.0.0.1:8080",
};

const RSS_MAX_ITEMS = 20;

interface BaseView {
  site: SiteConfig;
  page_title: string;
}

interface PostRowView {
  url: string;
  date: string;
  title: string;
  summary: string;
  tags: string[];
}

interface IndexView extends BaseView {
  home_heading: string;
  home_intro: string;
  posts: PostRowView[];
}

interface PostPageView extends BaseView {
  title: string;
  date: string;
  tags: string;
  tag_path: string;
  reading_time: string;
  content_html: string;
  has_navigation: boolean;
  older?: PostRowView | undefined;
  newer?: PostRowView | undefined;
}

interface ArchiveGroupView {
  year: string;
  posts: PostRowView[];
}

interface ArchiveView extends BaseView {
  groups: ArchiveGroupView[];
}

interface ErrorView extends BaseView {
  heading: string;
  message: string;
  detail?: string | undefined;
}

type PageView = IndexView | PostPageView | ArchiveView | ErrorView;

interface PageTemplates {
  index: string;
  post: string;
  archive: string;
  error: string;
}

interface Fragments {
  layout: string;
  postRow: string;
  tagBadge: string;
}

interface Templates {
  pages: PageTemplates;
  fragments: Fragments;
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
  return {
    pages: { index, post, archive, error },
    fragments: { layout, postRow, tagBadge },
  };
}

function renderWithLayout(templates: Templates, page: keyof PageTemplates, data: PageView): string {
  const partials = {
    "post-row": templates.fragments.postRow,
    "tag-badge": templates.fragments.tagBadge,
  };
  const content = Mustache.render(templates.pages[page], data, partials);
  return Mustache.render(templates.fragments.layout, { ...data, content });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function baseData(site: SiteConfig, pageTitle: string): BaseView {
  return { site, page_title: pageTitle };
}

function postView(post: Post): PostRowView {
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
  site: SiteConfig,
): string {
  return renderWithLayout(templates, "post", {
    ...baseData(site, `${post.header.title} - ${site.site_name}`),
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

function renderIndex(templates: Templates, posts: Post[], site: SiteConfig): string {
  return renderWithLayout(templates, "index", {
    ...baseData(site, `${site.site_name} - ${site.site_title}`),
    home_heading: "Notes from the low-level web.",
    home_intro:
      "A running notebook about building a small blog engine in Odin, learning the web from raw TCP upward, and keeping the design readable enough for real study.",
    posts: posts.map(postView),
  });
}

function renderArchive(templates: Templates, posts: Post[], site: SiteConfig): string {
  const grouped = new Map<string, Post[]>();
  for (const post of posts) {
    const year = post.header.date.slice(0, 4);
    const group = grouped.get(year) ?? [];
    group.push(post);
    grouped.set(year, group);
  }

  const groups = [...grouped].map(([year, yearPosts]) => ({ year, posts: yearPosts.map(postView) }));
  return renderWithLayout(templates, "archive", {
    ...baseData(site, `Archive - ${site.site_name}`),
    groups,
  });
}

function renderRss(posts: Post[], site: SiteConfig): string {
  const items = posts.slice(0, RSS_MAX_ITEMS).map((post) => {
    const url = `${site.site_url}${post.url}`;
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
    `<title>${escapeXml(site.site_title)}</title>`,
    `<link>${escapeXml(`${site.site_url}/`)}</link>`,
    `<description>${escapeXml(site.site_note)}</description>`,
    ...items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}

function renderNotFound(templates: Templates, site: SiteConfig): string {
  return renderWithLayout(templates, "error", {
    ...baseData(site, `Page Not Found - ${site.site_name}`),
    heading: "Page Not Found",
    message: "The page you requested does not exist.",
  });
}

export async function buildSite(
  options: BuildOptions,
  site: SiteConfig = DEFAULT_SITE,
): Promise<{ postCount: number; issues: ValidationIssue[] }> {
  const { posts, issues } = await loadPosts(options.contentDir);
  if (issues.length > 0) return { postCount: 0, issues };

  const templates = await loadTemplates(options.templateDir);
  const postPages = posts.map((post, index) => ({
    post,
    html: renderPostPage(templates, post, posts[index + 1], posts[index - 1], site),
  }));
  const indexHtml = renderIndex(templates, posts, site);
  const archiveHtml = renderArchive(templates, posts, site);
  const notFoundHtml = renderNotFound(templates, site);

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
    writeFile(path.join(options.outputDir, "rss.xml"), renderRss(posts, site)),
    writeFile(path.join(options.outputDir, "404.html"), notFoundHtml),
  ]);

  return { postCount: posts.length, issues: [] };
}
