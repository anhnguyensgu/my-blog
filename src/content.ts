import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import { marked } from "marked";

export const ALLOWED_KEYS = new Set(["title", "date", "tags", "summary", "draft"]);
export const REQUIRED_KEYS = ["title", "date", "summary"] as const;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function issue(sourcePath: string, line: number, message: string): ValidationIssue {
  return { path: sourcePath, line, message };
}

export function validCalendarDate(value: string): boolean {
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
