import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { buildSite, COMMANDS, parseMarkdownPost, runCli } from "../src/blog.js";

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

test("defines the complete command list", () => {
  assert.deepEqual(
    COMMANDS.map(({ name, arguments: commandArguments }) => [name, commandArguments]),
    [
      ["build", ""],
      ["validate", ""],
      ["new", "<title>"],
    ],
  );
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

test("new creates a valid draft", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "my-blog-new-"));
  const previousDirectory = process.cwd();

  try {
    process.chdir(root);
    assert.equal(await runCli(["new", "New Post"]), 0);
    const markdown = await readFile(path.join(root, "content", "new-post.md"), "utf8");
    const parsed = parseMarkdownPost(markdown, "content/new-post.md");
    assert.ok(parsed.ok);
    assert.equal(parsed.post.header.draft, true);
  } finally {
    process.chdir(previousDirectory);
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
    assert.deepEqual(result, { postCount: 1, issues: [] });

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
    assert.equal(result.issues.length, 2);
    assert.match(result.issues[0]?.message ?? "", /filename/);
    assert.match(result.issues[1]?.message ?? "", /summary/);
    await assert.rejects(readFile(path.join(outputDir, "index.html")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
