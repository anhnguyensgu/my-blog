import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { marked } from "marked";
import Mustache from "mustache";

const ALLOWED_KEYS = new Set(["title", "date", "tags", "summary", "draft"]);
const REQUIRED_KEYS = ["title", "date", "summary"] as const;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RSS_MAX_ITEMS = 20;

const SITE = {
  site_name: "Anh Nguyen",
  site_title: "Notes from Odin and systems work",
  site_note: "Short notes from building tools, servers, runtimes, and experiments in Odin.",
  home_url: "/",
  asset_path: "/",
  asset_version: "4",
  site_url: "http://127.0.0.1:8080",
} as const;

export interface PostHeader {
  title: string;
  date: string;
  tags: string[];
  summary: string;
  draft: boolean;
}

export interface Post {
  header: PostHeader;
  slug: string;
  url: string;
  bodyHtml: string;
  readingMinutes: number;
}

export interface ValidationIssue {
  path: string;
  line: number;
  message: string;
}

export interface ParseResult {
  post?: { header: PostHeader; bodyMarkdown: string };
  issues: ValidationIssue[];
}

export interface BuildOptions {
  contentDir: string;
  templateDir: string;
  outputDir: string;
}

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

function issue(sourcePath: string, line: number, message: string): ValidationIssue {
  return { path: sourcePath, line, message };
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

export function parseMarkdownPost(markdown: string, sourcePath: string): ParseResult {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const issues: ValidationIssue[] = [];

  if (lines[0] !== "---") {
    return { issues: [issue(sourcePath, 1, "expected opening '---'")] };
  }

  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex < 0) {
    return { issues: [issue(sourcePath, 1, "front matter is never closed with '---'")] };
  }

  const values = new Map<string, { value: string; line: number }>();
  for (let index = 1; index < closingIndex; index += 1) {
    const rawLine = lines[index]!;
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;

    const separator = trimmed.indexOf(":");
    if (separator < 0) {
      issues.push(issue(sourcePath, index + 1, "missing ':' separator"));
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!ALLOWED_KEYS.has(key)) {
      issues.push(issue(sourcePath, index + 1, `unknown front-matter key '${key}'`));
      continue;
    }
    if (values.has(key)) {
      issues.push(issue(sourcePath, index + 1, `duplicate front-matter key '${key}'`));
      continue;
    }
    values.set(key, { value, line: index + 1 });
  }

  const draftEntry = values.get("draft");
  const isDraft = draftEntry?.value === "true";
  for (const key of REQUIRED_KEYS) {
    const entry = values.get(key);
    const emptyDraftSummary = isDraft && key === "summary";
    if (!entry || (!emptyDraftSummary && entry.value === "")) {
      issues.push(issue(sourcePath, entry?.line ?? 1, `missing required front-matter key '${key}'`));
    }
  }

  const date = values.get("date");
  if (date && date.value !== "" && !validCalendarDate(date.value)) {
    issues.push(issue(sourcePath, date.line, `invalid date '${date.value}', expected YYYY-MM-DD`));
  }

  if (draftEntry && draftEntry.value !== "true" && draftEntry.value !== "false") {
    issues.push(issue(sourcePath, draftEntry.line, "draft must be 'true' or 'false'"));
  }

  if (issues.length > 0) return { issues };

  return {
    post: {
      header: {
        title: values.get("title")!.value,
        date: values.get("date")!.value,
        summary: values.get("summary")!.value,
        tags: (values.get("tags")?.value ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        draft: draftEntry?.value === "true",
      },
      bodyMarkdown: lines.slice(closingIndex + 1).join("\n"),
    },
    issues,
  };
}

function readingTimeMinutes(markdown: string): number {
  const words = markdown.trim() === "" ? 0 : markdown.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export async function loadPosts(contentDir: string): Promise<{ posts: Post[]; issues: ValidationIssue[] }> {
  const entries = await readdir(contentDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  const posts: Post[] = [];
  const issues: ValidationIssue[] = [];

  for (const filename of files) {
    const slug = path.basename(filename, ".md");
    const sourcePath = path.join(contentDir, filename);
    if (!SLUG_PATTERN.test(slug)) {
      issues.push(issue(sourcePath, 0, "filename must use lowercase letters, digits, and single dashes"));
      continue;
    }

    const markdown = await readFile(sourcePath, "utf8");
    const parsed = parseMarkdownPost(markdown, sourcePath);
    issues.push(...parsed.issues);
    if (!parsed.post || parsed.post.header.draft) continue;

    posts.push({
      header: parsed.post.header,
      slug,
      url: `/posts/${slug}/`,
      bodyHtml: marked.parse(parsed.post.bodyMarkdown, { async: false }),
      readingMinutes: readingTimeMinutes(parsed.post.bodyMarkdown),
    });
  }

  posts.sort((left, right) => right.header.date.localeCompare(left.header.date) || left.slug.localeCompare(right.slug));
  return { posts, issues };
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

function reportIssues(issues: ValidationIssue[]): void {
  for (const problem of issues) {
    const location = problem.line > 0 ? `${problem.path}:${problem.line}` : problem.path;
    console.error(`${location}: ${problem.message}`);
  }
  console.error(`${issues.length} error(s)`);
}

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function createPost(contentDir: string, title: string): Promise<void> {
  const slug = slugFromTitle(title);
  if (!SLUG_PATTERN.test(slug)) throw new Error(`could not derive a valid slug from '${title}'`);

  await mkdir(contentDir, { recursive: true });
  const filename = path.join(contentDir, `${slug}.md`);
  const today = new Date().toISOString().slice(0, 10);
  const body = `---\ntitle: ${title}\ndate: ${today}\ntags:\nsummary:\ndraft: true\n---\n\nStart writing.\n`;
  await writeFile(filename, body, { flag: "wx" });
  console.log(`created ${filename}`);
}

export const COMMANDS = [
  { name: "build", arguments: "", description: "validate content and regenerate public/" },
  { name: "validate", arguments: "", description: "validate content without writing files" },
  { name: "new", arguments: "<title>", description: "create a draft in content/" },
] as const;

function printUsage(): void {
  console.error("usage: my-blog <command>\n\ncommands:");
  for (const command of COMMANDS) {
    console.error(`  ${`${command.name} ${command.arguments}`.trimEnd().padEnd(20)} ${command.description}`);
  }
}

export async function runCli(args: string[]): Promise<number> {
  const root = process.cwd();
  const options: BuildOptions = {
    contentDir: path.join(root, "content"),
    templateDir: path.join(root, "templates"),
    outputDir: path.join(root, "public"),
  };
  const [command, ...commandArgs] = args;

  switch (command) {
    case "build": {
      if (commandArgs.length > 0) break;
      const result = await buildSite(options);
      if (result.issues.length > 0) {
        reportIssues(result.issues);
        return 1;
      }
      console.log(`built ${result.postCount} post(s) into ${options.outputDir}`);
      return 0;
    }
    case "validate": {
      if (commandArgs.length > 0) break;
      const result = await loadPosts(options.contentDir);
      if (result.issues.length > 0) {
        reportIssues(result.issues);
        return 1;
      }
      console.log(`content OK (${result.posts.length} published post(s))`);
      return 0;
    }
    case "new": {
      const title = commandArgs.join(" ").trim();
      if (!title) break;
      await createPost(options.contentDir, title);
      return 0;
    }
  }

  printUsage();
  return 2;
}
