import { assert, assertEquals, assertMatch, assertNotMatch, assertRejects } from "@std/assert";
import { join, resolve } from "@std/path";
import { buildSite, parseMarkdownPost, runCli } from "../src/blog.ts";
import { todayString } from "../src/cli.ts";

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

Deno.test("usage errors exit with code 2", async () => {
  const options = { contentDir: "", templateDir: "", outputDir: "" };
  assertEquals(await runCli([], options), 2);
  assertEquals(await runCli(["bogus"], options), 2);
  assertEquals(await runCli(["build", "extra"], options), 2);
});

Deno.test("strictly validates front matter", () => {
  const valid = parseMarkdownPost(VALID_POST, "content/test-post.md");
  assert(valid.ok);
  assertEquals(valid.post.header.title, "Test Post");
  assertEquals(valid.post.header.tags, ["typescript", "node"]);

  const invalid = parseMarkdownPost(
    `---\ntitle: Bad\ndate: 2026-02-30\ntag: typo\ndraft: yes\n---\n\nBody\n`,
    "content/bad.md",
  );
  assert(!invalid.ok);
  assertEquals(
    invalid.issues.map((problem) => problem.message),
    [
      "unknown front-matter key 'tag'",
      "missing required front-matter key 'summary'",
      "invalid date '2026-02-30', expected YYYY-MM-DD",
      "draft must be 'true' or 'false'",
    ],
  );
});

Deno.test("drafts may omit summary, published posts may not", () => {
  const draftOmitted = parseMarkdownPost("---\ntitle: Draft\ndate: 2026-05-02\ndraft: true\n---\n\nBody\n", "content/draft.md");
  assert(draftOmitted.ok);
  assertEquals(draftOmitted.post.header.draft, true);

  const draftEmpty = parseMarkdownPost("---\ntitle: Draft\ndate: 2026-05-02\nsummary:\ndraft: true\n---\n\nBody\n", "content/draft.md");
  assert(draftEmpty.ok);
  assertEquals(draftEmpty.post.header.summary, "");

  const published = parseMarkdownPost("---\ntitle: Published\ndate: 2026-05-02\ndraft: false\n---\n\nBody\n", "content/published.md");
  assert(!published.ok);
  assertEquals(published.issues.map((problem) => problem.message), ["missing required front-matter key 'summary'"]);
});

Deno.test("new creates a valid draft", async () => {
  const root = await Deno.makeTempDir({ prefix: "my-blog-new-" });

  try {
    const options = {
      contentDir: join(root, "content"),
      templateDir: join(root, "templates"),
      outputDir: join(root, "public"),
    };
    assertEquals(await runCli(["new", "New Post"], options), 0);
    const markdown = await Deno.readTextFile(join(root, "content", "new-post.md"));
    const parsed = parseMarkdownPost(markdown, "content/new-post.md");
    assert(parsed.ok);
    assertEquals(parsed.post.header.draft, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("new stamps the draft with the local calendar date", async () => {
  const root = await Deno.makeTempDir({ prefix: "my-blog-date-" });

  try {
    const options = {
      contentDir: join(root, "content"),
      templateDir: join(root, "templates"),
      outputDir: join(root, "public"),
    };
    const before = todayString();
    await runCli(["new", "Dated Post"], options);
    const markdown = await Deno.readTextFile(join(root, "content", "dated-post.md"));
    const stamped = /^date: (\d{4}-\d{2}-\d{2})$/m.exec(markdown)?.[1];
    assert(stamped, "draft must contain a date line in YYYY-MM-DD format");
    const after = todayString();
    assert(
      stamped === before || stamped === after,
      `stamped date ${stamped} must be the local calendar date (${before} or ${after} if midnight crossed)`,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("builds Markdown into the complete static output", async () => {
  const root = await Deno.makeTempDir({ prefix: "my-blog-test-" });
  const contentDir = join(root, "content");
  const outputDir = join(root, "public");
  await Deno.mkdir(contentDir);

  try {
    await Deno.writeTextFile(join(contentDir, "test-post.md"), VALID_POST);
    await Deno.writeTextFile(
      join(contentDir, "hidden-post.md"),
      VALID_POST.replace("title: Test Post", "title: Hidden Post").replace("draft: false", "draft: true"),
    );

    const result = await buildSite({
      contentDir,
      templateDir: resolve("templates"),
      outputDir,
    });
    assertEquals(result, { ok: true, postCount: 1 });

    const postHtml = await Deno.readTextFile(join(outputDir, "posts", "test-post", "index.html"));
    assertMatch(postHtml, /<h2>Hello<\/h2>/);
    assertMatch(postHtml, /<strong>Markdown<\/strong>/);
    assertNotMatch(postHtml, /&lt;article/);

    const indexHtml = await Deno.readTextFile(join(outputDir, "index.html"));
    assertMatch(indexHtml, /\/posts\/test-post\//);
    assertNotMatch(indexHtml, /Hidden Post/);

    const archiveHtml = await Deno.readTextFile(join(outputDir, "archive.html"));
    assertMatch(archiveHtml, />2026</);

    const rss = await Deno.readTextFile(join(outputDir, "rss.xml"));
    assertMatch(rss, /<rss version="2.0">/);

    await Deno.readTextFile(join(outputDir, "404.html"));
  } finally {
    await Deno.remove(root, { recursive: true });
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

Deno.test("renders prev/next navigation between posts", async () => {
  const root = await Deno.makeTempDir({ prefix: "my-blog-nav-" });
  const contentDir = join(root, "content");
  const outputDir = join(root, "public");
  await Deno.mkdir(contentDir);

  try {
    await Deno.writeTextFile(join(contentDir, "older-post.md"), postMarkdown("Older Post", "2026-05-01", "Older summary."));
    await Deno.writeTextFile(join(contentDir, "newer-post.md"), postMarkdown("Newer Post", "2026-06-01", "Newer summary."));

    const result = await buildSite({
      contentDir,
      templateDir: resolve("templates"),
      outputDir,
    });
    assertEquals(result, { ok: true, postCount: 2 });

    const newerHtml = await Deno.readTextFile(join(outputDir, "posts", "newer-post", "index.html"));
    assertMatch(newerHtml, /<a href="\/posts\/older-post\/">&#8592; Older Post<\/a>/);
    assertNotMatch(newerHtml, /\/posts\/newer-post\//);

    const olderHtml = await Deno.readTextFile(join(outputDir, "posts", "older-post", "index.html"));
    assertMatch(olderHtml, /<a href="\/posts\/newer-post\/">Newer Post &#8594;<\/a>/);
    assertNotMatch(olderHtml, /\/posts\/older-post\//);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("groups the archive by year, newest first", async () => {
  const root = await Deno.makeTempDir({ prefix: "my-blog-archive-" });
  const contentDir = join(root, "content");
  const outputDir = join(root, "public");
  await Deno.mkdir(contentDir);

  try {
    await Deno.writeTextFile(join(contentDir, "old-note.md"), postMarkdown("Old Note", "2025-11-20", "From 2025."));
    await Deno.writeTextFile(join(contentDir, "new-note.md"), postMarkdown("New Note", "2026-01-15", "From 2026."));

    const result = await buildSite({
      contentDir,
      templateDir: resolve("templates"),
      outputDir,
    });
    assertEquals(result, { ok: true, postCount: 2 });

    const archiveHtml = await Deno.readTextFile(join(outputDir, "archive.html"));
    assertMatch(archiveHtml, /<h2 class="post-title">2026<\/h2>/);
    assertMatch(archiveHtml, /<h2 class="post-title">2025<\/h2>/);
    const y2026 = archiveHtml.indexOf(">2026<");
    const y2025 = archiveHtml.indexOf(">2025<");
    const newNote = archiveHtml.indexOf("/posts/new-note/");
    const oldNote = archiveHtml.indexOf("/posts/old-note/");
    assert(y2026 >= 0 && y2025 >= 0 && newNote >= 0 && oldNote >= 0, "archive must contain both year headings and both post links");
    assert(y2026 < newNote, "the 2026 post must be rendered under the 2026 heading");
    assert(newNote < y2025, "the 2026 group must be rendered before the 2025 group");
    assert(y2025 < oldNote, "the 2025 post must be rendered under the 2025 heading");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// Design rule (inherited from the original Odin implementation): posts are
// ordered date-DESCENDING, and among posts sharing a date the tiebreak is
// slug-ASCENDING — the smaller slug sorts first (alpha before beta). Do not
// "fix" this backwards: beta must NOT come first on a shared date.
Deno.test("sorts date-descending with slug-ascending tiebreak (smaller slug first)", async () => {
  const root = await Deno.makeTempDir({ prefix: "my-blog-order-" });
  const contentDir = join(root, "content");
  const outputDir = join(root, "public");
  await Deno.mkdir(contentDir);

  try {
    await Deno.writeTextFile(join(contentDir, "gamma.md"), postMarkdown("Gamma", "2026-01-01", "Oldest post."));
    await Deno.writeTextFile(join(contentDir, "alpha.md"), postMarkdown("Alpha", "2026-03-01", "Tied post A."));
    await Deno.writeTextFile(join(contentDir, "beta.md"), postMarkdown("Beta", "2026-03-01", "Tied post B."));

    const result = await buildSite({
      contentDir,
      templateDir: resolve("templates"),
      outputDir,
    });
    assertEquals(result, { ok: true, postCount: 3 });

    const indexHtml = await Deno.readTextFile(join(outputDir, "index.html"));
    const beta = indexHtml.indexOf("/posts/beta/");
    const alpha = indexHtml.indexOf("/posts/alpha/");
    const gamma = indexHtml.indexOf("/posts/gamma/");
    assert(beta >= 0 && alpha >= 0 && gamma >= 0, "all three posts must be listed");
    // slug-ascending tiebreak: smaller slug sorts first among same-date posts.
    assert(alpha < beta, "on a shared date, 'alpha' (smaller slug) must come before 'beta'");
    assert(beta < gamma, "the older post must come last");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("renders complete RSS items", async () => {
  const root = await Deno.makeTempDir({ prefix: "my-blog-rss-" });
  const contentDir = join(root, "content");
  const outputDir = join(root, "public");
  await Deno.mkdir(contentDir);

  try {
    await Deno.writeTextFile(join(contentDir, "rss-one.md"), postMarkdown("RSS One", "2026-05-02", "First summary."));
    await Deno.writeTextFile(join(contentDir, "rss-two.md"), postMarkdown("RSS Two", "2026-04-02", "Second summary."));

    const result = await buildSite({
      contentDir,
      templateDir: resolve("templates"),
      outputDir,
    });
    assertEquals(result, { ok: true, postCount: 2 });

    const rss = await Deno.readTextFile(join(outputDir, "rss.xml"));
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
    assert(rss.includes(itemOne), "rss.xml must contain the complete item for rss-one");
    assert(rss.includes(itemTwo), "rss.xml must contain the complete item for rss-two");
    assert(rss.indexOf(itemOne) < rss.indexOf(itemTwo), "RSS items must be ordered newest first");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("does not build when any content file is invalid", async () => {
  const root = await Deno.makeTempDir({ prefix: "my-blog-invalid-" });
  const contentDir = join(root, "content");
  const outputDir = join(root, "public");
  await Deno.mkdir(contentDir);

  try {
    await Deno.writeTextFile(join(contentDir, "Bad Name.md"), VALID_POST);
    await Deno.writeTextFile(join(contentDir, "missing-summary.md"), "---\ntitle: Missing\ndate: 2026-01-01\n---\nBody\n");

    const result = await buildSite({
      contentDir,
      templateDir: resolve("templates"),
      outputDir,
    });
    assert(!result.ok);
    assertEquals(result.issues.length, 2);
    assertMatch(result.issues[0]?.message ?? "", /filename/);
    assertMatch(result.issues[1]?.message ?? "", /summary/);
    await assertRejects(() => Deno.readTextFile(join(outputDir, "index.html")));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
