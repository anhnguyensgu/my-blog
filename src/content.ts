import { renderMarkdown, type TocEntry } from "./markdown/mod.ts";

export interface Post {
  slug: string;
  title: string;
  /** `YYYY-MM-DD`. */
  date: string;
  tags: string[];
  summary: string;
  draft: boolean;
  html: string;
  toc: TocEntry[];
  readingMinutes: number;
}

export interface Issue {
  file: string;
  line?: number;
  message: string;
}

export type ParseResult = { ok: true; post: Post } | { ok: false; issues: Issue[] };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const KEYS = new Set(["title", "date", "tags", "summary", "draft"]);
const WORDS_PER_MINUTE = 200;

/** Parse one post. `file` is used for messages; the slug comes from its basename. */
export function parsePost(file: string, source: string): ParseResult {
  const issues: Issue[] = [];
  const issue = (message: string, line?: number) =>
    issues.push(line === undefined ? { file, message } : { file, line, message });

  const slug = (file.split("/").pop() ?? file).replace(/\.md$/, "");
  if (!SLUG.test(slug)) {
    issue(`file name "${slug}" must be a lowercase slug of letters, digits, and single dashes`);
  }

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    issue("missing front matter: the file must start with a --- line", 1);
    return { ok: false, issues };
  }
  const end = lines.findIndex((line, k) => k > 0 && line.trim() === "---");
  if (end < 0) {
    issue("front matter is not closed with a --- line", 1);
    return { ok: false, issues };
  }

  const fields = new Map<string, { value: string; line: number }>();
  for (let k = 1; k < end; k++) {
    const line = lines[k]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z][\w-]*)[ \t]*:(.*)$/.exec(line);
    if (!match) {
      issue(`expected "key: value", got ${JSON.stringify(line)}`, k + 1);
      continue;
    }
    const key = match[1]!;
    if (!KEYS.has(key)) issue(`unknown front matter key "${key}"`, k + 1);
    else if (fields.has(key)) issue(`duplicate front matter key "${key}"`, k + 1);
    else fields.set(key, { value: unquote(match[2]!.trim()), line: k + 1 });
  }

  const title = fields.get("title")?.value ?? "";
  if (!title) issue("missing required field: title");

  const draftField = fields.get("draft");
  let draft = false;
  if (draftField && draftField.value !== "") {
    if (draftField.value === "true") draft = true;
    else if (draftField.value !== "false") issue(`draft must be true or false`, draftField.line);
  }

  const dateField = fields.get("date");
  const date = dateField?.value ?? "";
  if (!dateField || !date) issue("missing required field: date");
  else if (!isValidDate(date)) issue(`invalid date ${JSON.stringify(date)}: use YYYY-MM-DD`, dateField.line);

  const summary = fields.get("summary")?.value ?? "";
  if (!summary && !draft) issue("missing required field: summary (only drafts may omit it)");

  const tagsField = fields.get("tags");
  const tags: string[] = [];
  for (const tag of parseList(tagsField?.value ?? "")) {
    const normalized = tag.toLowerCase();
    if (!SLUG.test(normalized)) {
      issue(`tag ${JSON.stringify(tag)} must use letters, digits, and single dashes`, tagsField?.line);
    } else if (!tags.includes(normalized)) {
      tags.push(normalized);
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const body = lines.slice(end + 1).join("\n");
  const { html, toc } = renderMarkdown(body);
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    ok: true,
    post: {
      slug,
      title,
      date,
      tags,
      summary,
      draft,
      html,
      toc,
      readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    },
  };
}

/** Load every `*.md` post in `dir`, newest first (date descending, then slug ascending). */
export async function loadPosts(dir: string): Promise<{ posts: Post[]; issues: Issue[] }> {
  const posts: Post[] = [];
  const issues: Issue[] = [];
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".md") && !entry.name.startsWith(".")) names.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { posts, issues: [{ file: dir, message: "directory not found" }] };
    }
    throw error;
  }

  for (const name of names.sort()) {
    const file = `${dir}/${name}`;
    const result = parsePost(file, await Deno.readTextFile(file));
    if (result.ok) posts.push(result.post);
    else issues.push(...result.issues);
  }
  return { posts: sortPosts(posts), issues };
}

export function sortPosts(posts: Post[]): Post[] {
  return posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1));
}

export function formatIssue(issue: Issue): string {
  return `${issue.file}${issue.line === undefined ? "" : `:${issue.line}`}: ${issue.message}`;
}

function isValidDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Accepts `a, b` or `[a, b]`. */
function parseList(value: string): string[] {
  const inner = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return inner.split(",").map((item) => unquote(item.trim())).filter(Boolean);
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2]! : value;
}
