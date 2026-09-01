import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { buildSite, parseMarkdownPost, runCli } from "../src/blog.js";
import { todayString } from "../src/cli.js";

const VALID_POST = `---
title: Test Post
date: 2026-05-02
tags: typescript, node
summary: A test post.
draft: false
---

## Hello

This is **Markdown**.
`;

test("usage errors exit with code 2", async () => {
  const options = { contentDir: "", templateDir: "", outputDir: "" };
  assert.equal(await runCli([], options), 2);
  assert.equal(await runCli(["bogus"], options), 2);
  assert.equal(await runCli(["build", "extra"], options), 2);
});

test("strictly validates front matter", () => {
  const valid = parseMarkdownPost(VALID_POST, "content/test-post.md");
  assert.ok(valid.ok);
  assert.equal(valid.post.header.title, "Test Post");
  assert.deepEqual(valid.post.header.tags, ["typescript", "node"]);

  const invalid = parseMarkdownPost(
    `---\ntitle: Bad\ndate: 2026-02-30\ntag: typo\ndraft: yes\n---\n\nBody\n`,
    "content/bad.md",
  );
  assert.ok(!invalid.ok);
  assert.deepEqual(
    invalid.issues.map((problem) => problem.message),
    [
      "unknown front-matter key 'tag'",
      "missing required front-matter key 'summary'",
      "invalid date '2026-02-30', expected YYYY-MM-DD",
      "draft must be 'true' or 'false'",
    ],
  );
});

test("drafts may omit summary, published posts may not", () => {
  const draftOmitted = parseMarkdownPost("---\ntitle: Draft\ndate: 2026-05-02\ndraft: true\n---\n\nBody\n", "content/draft.md");
  assert.ok(draftOmitted.ok);
  assert.equal(draftOmitted.post.header.draft, true);

  const draftEmpty = parseMarkdownPost("---\ntitle: Draft\ndate: 2026-05-02\nsummary:\ndraft: true\n---\n\nBody\n", "content/draft.md");
  assert.ok(draftEmpty.ok);
  assert.equal(draftEmpty.post.header.summary, "");

  const published = parseMarkdownPost("---\ntitle: Published\ndate: 2026-05-02\ndraft: false\n---\n\nBody\n", "content/published.md");
  assert.ok(!published.ok);
  assert.deepEqual(published.issues.map((problem) => problem.message), ["missing required front-matter key 'summary'"]);
});

test("new creates a valid draft", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-blog-new-"));

  try {
    const options = {
      contentDir: path.join(root, "content"),
      templateDir: path.join(root, "templates"),
      outputDir: path.join(root, "public"),
    };
    assert.equal(await runCli(["new", "New Post"], options), 0);
    const markdown = await readFile(path.join(root, "content", "new-post.md"), "utf8");
    const parsed = parseMarkdownPost(markdown, "content/new-post.md");
    assert.ok(parsed.ok);
    assert.equal(parsed.post.header.draft, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("new stamps the draft with the local calendar date", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-blog-date-"));

  try {
    const options = {
      contentDir: path.join(root, "content"),
      templateDir: path.join(root, "templates"),
      outputDir: path.join(root, "public"),
    };
    const before = todayString();
    await runCli(["new", "Dated Post"], options);
    const markdown = await readFile(path.join(root, "content", "dated-post.md"), "utf8");
    const stamped = /^date: (\d{4}-\d{2}-\d{2})$/m.exec(markdown)?.[1];
    assert.ok(stamped, "draft must contain a date line in YYYY-MM-DD format");
    const after = todayString();
    assert.ok(
      stamped === before || stamped === after,
      `stamped date ${stamped} must be the local calendar date (${before} or ${after} if midnight crossed)`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("builds Markdown into the complete static output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-blog-test-"));
  const contentDir = path.join(root, "content");
  const outputDir = path.join(root, "public");
  await mkdir(contentDir);

  try {
    await writeFile(path.join(contentDir, "test-post.md"), VALID_POST);
    await writeFile(
      path.join(contentDir, "hidden-post.md"),
      VALID_POST.replace("title: Test Post", "title: Hidden Post").replace("draft: false", "draft: true"),
    );

    const result = await buildSite({
      contentDir,
      templateDir: path.resolve("templates"),
      outputDir,
    });
    assert.deepEqual(result, { ok: true, postCount: 1 });

    const postHtml = await readFile(path.join(outputDir, "posts", "test-post", "index.html"), "utf8");
    assert.match(postHtml, /<h2>Hello<\/h2>/);
    assert.match(postHtml, /<strong>Markdown<\/strong>/);
    assert.doesNotMatch(postHtml, /&lt;article/);

    const indexHtml = await readFile(path.join(outputDir, "index.html"), "utf8");
    assert.match(indexHtml, /\/posts\/test-post\//);
    assert.doesNotMatch(indexHtml, /Hidden Post/);

    const archiveHtml = await readFile(path.join(outputDir, "archive.html"), "utf8");
    assert.match(archiveHtml, />2026</);

    const rss = await readFile(path.join(outputDir, "rss.xml"), "utf8");
    assert.match(rss, /<rss version="2.0">/);

    await readFile(path.join(outputDir, "404.html"), "utf8");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function postMarkdown(title: string, date: string, summary: string): string {
  return `---
title: ${title}
date: ${date}
tags: typescript
summary: ${summary}
draft: false
---

Body
`;
}

test("renders prev/next navigation between posts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-blog-nav-"));
  const contentDir = path.join(root, "content");
  const outputDir = path.join(root, "public");
  await mkdir(contentDir);

  try {
    await writeFile(path.join(contentDir, "older-post.md"), postMarkdown("Older Post", "2026-05-01", "Older summary."));
    await writeFile(path.join(contentDir, "newer-post.md"), postMarkdown("Newer Post", "2026-06-01", "Newer summary."));

    const result = await buildSite({
      contentDir,
      templateDir: path.resolve("templates"),
      outputDir,
    });
    assert.deepEqual(result, { ok: true, postCount: 2 });

    const newerHtml = await readFile(path.join(outputDir, "posts", "newer-post", "index.html"), "utf8");
    assert.match(newerHtml, /<a href="\/posts\/older-post\/">&#8592; Older Post<\/a>/);
    assert.doesNotMatch(newerHtml, /\/posts\/newer-post\//);

    const olderHtml = await readFile(path.join(outputDir, "posts", "older-post", "index.html"), "utf8");
    assert.match(olderHtml, /<a href="\/posts\/newer-post\/">Newer Post &#8594;<\/a>/);
    assert.doesNotMatch(olderHtml, /\/posts\/older-post\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("groups the archive by year, newest first", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-blog-archive-"));
  const contentDir = path.join(root, "content");
  const outputDir = path.join(root, "public");
  await mkdir(contentDir);

  try {
    await writeFile(path.join(contentDir, "old-note.md"), postMarkdown("Old Note", "2025-11-20", "From 2025."));
    await writeFile(path.join(contentDir, "new-note.md"), postMarkdown("New Note", "2026-01-15", "From 2026."));

    const result = await buildSite({
      contentDir,
      templateDir: path.resolve("templates"),
      outputDir,
    });
    assert.deepEqual(result, { ok: true, postCount: 2 });

    const archiveHtml = await readFile(path.join(outputDir, "archive.html"), "utf8");
    assert.match(archiveHtml, /<h2 class="post-title">2026<\/h2>/);
    assert.match(archiveHtml, /<h2 class="post-title">2025<\/h2>/);
    const y2026 = archiveHtml.indexOf(">2026<");
    const y2025 = archiveHtml.indexOf(">2025<");
    const newNote = archiveHtml.indexOf("/posts/new-note/");
    const oldNote = archiveHtml.indexOf("/posts/old-note/");
    assert.ok(y2026 >= 0 && y2025 >= 0 && newNote >= 0 && oldNote >= 0, "archive must contain both year headings and both post links");
    assert.ok(y2026 < newNote, "the 2026 post must be rendered under the 2026 heading");
    assert.ok(newNote < y2025, "the 2026 group must be rendered before the 2025 group");
    assert.ok(y2025 < oldNote, "the 2025 post must be rendered under the 2025 heading");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Design rule (inherited from the original Odin implementation): posts are
// ordered date-DESCENDING, and among posts sharing a date the tiebreak is
// slug-ASCENDING — the smaller slug sorts first (alpha before beta). Do not
// "fix" this backwards: beta must NOT come first on a shared date.
test("sorts date-descending with slug-ascending tiebreak (smaller slug first)", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-blog-order-"));
  const contentDir = path.join(root, "content");
  const outputDir = path.join(root, "public");
  await mkdir(contentDir);

  try {
    await writeFile(path.join(contentDir, "gamma.md"), postMarkdown("Gamma", "2026-01-01", "Oldest post."));
    await writeFile(path.join(contentDir, "alpha.md"), postMarkdown("Alpha", "2026-03-01", "Tied post A."));
    await writeFile(path.join(contentDir, "beta.md"), postMarkdown("Beta", "2026-03-01", "Tied post B."));

    const result = await buildSite({
      contentDir,
      templateDir: path.resolve("templates"),
      outputDir,
    });
    assert.deepEqual(result, { ok: true, postCount: 3 });

    const indexHtml = await readFile(path.join(outputDir, "index.html"), "utf8");
    const beta = indexHtml.indexOf("/posts/beta/");
    const alpha = indexHtml.indexOf("/posts/alpha/");
    const gamma = indexHtml.indexOf("/posts/gamma/");
    assert.ok(beta >= 0 && alpha >= 0 && gamma >= 0, "all three posts must be listed");
    // slug-ascending tiebreak: smaller slug sorts first among same-date posts.
    assert.ok(alpha < beta, "on a shared date, 'alpha' (smaller slug) must come before 'beta'");
    assert.ok(beta < gamma, "the older post must come last");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renders complete RSS items", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-blog-rss-"));
  const contentDir = path.join(root, "content");
  const outputDir = path.join(root, "public");
  await mkdir(contentDir);

  try {
    await writeFile(path.join(contentDir, "rss-one.md"), postMarkdown("RSS One", "2026-05-02", "First summary."));
    await writeFile(path.join(contentDir, "rss-two.md"), postMarkdown("RSS Two", "2026-04-02", "Second summary."));

    const result = await buildSite({
      contentDir,
      templateDir: path.resolve("templates"),
      outputDir,
    });
    assert.deepEqual(result, { ok: true, postCount: 2 });

    const rss = await readFile(path.join(outputDir, "rss.xml"), "utf8");
    const itemOne = [
      "<item>",
      "<title>RSS One</title>",
      "<link>http://127.0.0.1:8080/posts/rss-one/</link>",
      '<guid isPermaLink="true">http://127.0.0.1:8080/posts/rss-one/</guid>',
      "<pubDate>02 May 2026 00:00:00 GMT</pubDate>",
      "<description>First summary.</description>",
      "</item>",
    ].join("\n");
    const itemTwo = [
      "<item>",
      "<title>RSS Two</title>",
      "<link>http://127.0.0.1:8080/posts/rss-two/</link>",
      '<guid isPermaLink="true">http://127.0.0.1:8080/posts/rss-two/</guid>',
      "<pubDate>02 Apr 2026 00:00:00 GMT</pubDate>",
      "<description>Second summary.</description>",
      "</item>",
    ].join("\n");
    assert.ok(rss.includes(itemOne), "rss.xml must contain the complete item for rss-one");
    assert.ok(rss.includes(itemTwo), "rss.xml must contain the complete item for rss-two");
    assert.ok(rss.indexOf(itemOne) < rss.indexOf(itemTwo), "RSS items must be ordered newest first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not build when any content file is invalid", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-blog-invalid-"));
  const contentDir = path.join(root, "content");
  const outputDir = path.join(root, "public");
  await mkdir(contentDir);

  try {
    await writeFile(path.join(contentDir, "Bad Name.md"), VALID_POST);
    await writeFile(path.join(contentDir, "missing-summary.md"), "---\ntitle: Missing\ndate: 2026-01-01\n---\nBody\n");

    const result = await buildSite({
      contentDir,
      templateDir: path.resolve("templates"),
      outputDir,
    });
    assert.ok(!result.ok);
    assert.equal(result.issues.length, 2);
    assert.match(result.issues[0]?.message ?? "", /filename/);
    assert.match(result.issues[1]?.message ?? "", /summary/);
    await assert.rejects(readFile(path.join(outputDir, "index.html")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
