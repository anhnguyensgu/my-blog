import { assert, assertEquals } from "@std/assert";
import { type Issue, parsePost, type Post, sortPosts } from "../src/content.ts";
import { resolveSite } from "../src/site.ts";

const VALID = `---
title: "Hello: World"
date: 2026-05-02
tags: [Odin, http, odin]
summary: A summary.
---

## Section

Body text.
`;

function issuesOf(file: string, source: string): Issue[] {
  const result = parsePost(file, source);
  assert(!result.ok, "expected the post to be rejected");
  return result.issues;
}

Deno.test("parses front matter and renders the body", () => {
  const result = parsePost("content/hello-world.md", VALID);
  assert(result.ok);
  const { post } = result;
  assertEquals(post.slug, "hello-world");
  assertEquals(post.title, "Hello: World");
  assertEquals(post.date, "2026-05-02");
  assertEquals(post.tags, ["odin", "http"]);
  assertEquals(post.summary, "A summary.");
  assertEquals(post.draft, false);
  assertEquals(post.readingMinutes, 1);
  assertEquals(post.toc, [{ level: 2, id: "section", text: "Section" }]);
  assert(post.html.includes("<p>Body text.</p>"));
});

Deno.test("reports every problem in a post at once", () => {
  const issues = issuesOf(
    "content/Bad_Name.md",
    "---\ndate: 2026-02-30\ndraft: maybe\ncolor: red\ntags: ok, not ok\nnonsense\n---\n",
  );
  assertEquals(issues.map((i) => i.message), [
    `file name "Bad_Name" must be a lowercase slug of letters, digits, and single dashes`,
    `unknown front matter key "color"`,
    `expected "key: value", got "nonsense"`,
    "missing required field: title",
    "draft must be true or false",
    `invalid date "2026-02-30": use YYYY-MM-DD`,
    "missing required field: summary (only drafts may omit it)",
    `tag "not ok" must use letters, digits, and single dashes`,
  ]);
  assertEquals(issues.find((i) => i.message.startsWith("unknown"))?.line, 4);
});

Deno.test("requires a closed front matter block", () => {
  assertEquals(issuesOf("content/a.md", "# no front matter").map((i) => i.message), [
    "missing front matter: the file must start with a --- line",
  ]);
  assertEquals(issuesOf("content/a.md", "---\ntitle: x\n").map((i) => i.message), [
    "front matter is not closed with a --- line",
  ]);
});

Deno.test("drafts may omit the summary and tags", () => {
  const result = parsePost(
    "content/draft.md",
    "---\ntitle: Draft\ndate: 2026-01-01\ntags:\nsummary:\ndraft: true\n---\n",
  );
  assert(result.ok);
  assertEquals(result.post.draft, true);
  assertEquals(result.post.tags, []);
});

Deno.test("sorts by date descending, then slug ascending", () => {
  const post = (slug: string, date: string) => ({ slug, date }) as Post;
  const sorted = sortPosts([post("b", "2026-01-01"), post("c", "2026-03-01"), post("a", "2026-01-01")]);
  assertEquals(sorted.map((p) => p.slug), ["c", "a", "b"]);
});

Deno.test("resolveSite splits the URL into base URL and path prefix", () => {
  const config = {
    title: "T",
    tagline: "t",
    description: "d",
    author: "a",
    language: "en",
    url: "http://127.0.0.1:8000",
    postsOnHome: 10,
  };
  assertEquals(resolveSite(config).basePath, "");
  const site = resolveSite(config, "https://user.github.io/blog/");
  assertEquals(site.baseUrl, "https://user.github.io/blog");
  assertEquals(site.basePath, "/blog");
  let message = "";
  try {
    resolveSite(config, "ftp://x");
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes("expected an http or https URL"));
});
