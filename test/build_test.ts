import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { build } from "../src/build.ts";
import { resolveSite } from "../src/site.ts";

const CONFIG = {
  title: "Test <Blog>",
  tagline: "Hello *there*",
  description: "A test blog.",
  author: "Tester",
  language: "en",
  url: "http://127.0.0.1:8000",
  postsOnHome: 2,
};

const POSTS: Record<string, string> = {
  "first.md":
    "---\ntitle: First & Best\ndate: 2026-01-01\ntags: alpha\nsummary: The first.\n---\n\n## One\n\n## Two\n\n![x](/assets/x.png)\n",
  "second.md":
    "---\ntitle: Second\ndate: 2026-02-01\ntags: alpha, beta\nsummary: The second.\n---\n\nText.\n",
  "third.md": "---\ntitle: Third\ndate: 2026-03-01\nsummary: The third.\n---\n\nText.\n",
  "secret.md": "---\ntitle: Secret\ndate: 2026-04-01\ndraft: true\n---\n\nUnfinished.\n",
};

async function withSite(
  posts: Record<string, string>,
  fn: (dir: string, read: (path: string) => Promise<string>) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "blog-test-" });
  try {
    await Deno.mkdir(`${dir}/content`);
    await Deno.mkdir(`${dir}/assets`);
    await Deno.writeTextFile(`${dir}/assets/style.css`, "body{}");
    for (const [name, source] of Object.entries(posts)) {
      await Deno.writeTextFile(`${dir}/content/${name}`, source);
    }
    await fn(dir, (path) => Deno.readTextFile(`${dir}/out/${path}`));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function options(dir: string, siteUrl?: string) {
  return {
    contentDir: `${dir}/content`,
    assetsDir: `${dir}/assets`,
    outDir: `${dir}/out`,
    site: resolveSite(CONFIG, siteUrl),
    drafts: false,
    dev: false,
    year: 2026,
  };
}

Deno.test("builds every page and leaves drafts out", async () => {
  await withSite(POSTS, async (dir, read) => {
    const result = await build(options(dir));
    assertEquals(result, { ok: true, posts: 3, files: 13 });

    const home = await read("index.html");
    assertStringIncludes(home, "<title>Test &lt;Blog&gt;</title>");
    assertStringIncludes(home, `<h1 class="hero-title">Hello <em>there</em></h1>`);
    // Newest first, limited to postsOnHome, with a link to the rest.
    assert(home.indexOf("Third") < home.indexOf("Second"));
    assert(!home.includes(">First &amp; Best<"));
    assertStringIncludes(home, "All 3 posts");
    assert(!home.includes("Secret"));
    assert(!home.includes("__livereload"));

    const first = await read("posts/first/index.html");
    assertStringIncludes(first, '<h1 class="post-title">First &amp; Best</h1>');
    assertStringIncludes(first, `<aside class="toc"`);
    assertStringIncludes(first, `class="post-nav-link newer" href="/posts/second/"`);
    assert(!first.includes("post-nav-link older"));

    assertStringIncludes(await read("tags/beta/index.html"), "/posts/second/");
    assertStringIncludes(await read("archive/index.html"), `<h2 class="year" id="y2026">2026</h2>`);
    assertStringIncludes(await read("assets/style.css"), "body{}");
    await read("404.html");
    await read("sitemap.xml");
    await assertRejects(() => read("posts/secret/index.html"), Deno.errors.NotFound);

    const rss = await read("rss.xml");
    assertEquals(rss.match(/<item>/g)?.length, 3);
    assertStringIncludes(rss, "<title>First &amp; Best</title>");
    assertStringIncludes(rss, "<pubDate>Sun, 01 Mar 2026 00:00:00 GMT</pubDate>");
    assertStringIncludes(rss, "src=&quot;http://127.0.0.1:8000/assets/x.png&quot;");
  });
});

Deno.test("drafts and live reload are included in dev builds", async () => {
  await withSite(POSTS, async (dir, read) => {
    await build({ ...options(dir), drafts: true, dev: true });
    assertStringIncludes(await read("posts/secret/index.html"), "badge-draft");
    assertStringIncludes(await read("index.html"), "__livereload");
  });
});

Deno.test("a path prefix in SITE_URL prefixes every internal link", async () => {
  await withSite(POSTS, async (dir, read) => {
    await build(options(dir, "https://example.com/blog"));
    const home = await read("index.html");
    assertStringIncludes(home, `href="/blog/posts/third/"`);
    assertStringIncludes(home, `href="/blog/assets/style.css?v=`);
    assertStringIncludes(home, `<link rel="canonical" href="https://example.com/blog/">`);
    // Root-relative links written inside posts follow the prefix too.
    assertStringIncludes(await read("posts/first/index.html"), `src="/blog/assets/x.png"`);
    assertStringIncludes(await read("rss.xml"), "src=&quot;https://example.com/blog/assets/x.png&quot;");
    assert(!/href="\/(?!blog)/.test(home), "every root-relative link should start with /blog");
  });
});

Deno.test("invalid content fails the build without touching the output", async () => {
  await withSite({ ...POSTS, "broken.md": "---\ntitle: Broken\n---\n" }, async (dir) => {
    await Deno.mkdir(`${dir}/out`);
    await Deno.writeTextFile(`${dir}/out/keep.txt`, "previous build");
    const result = await build(options(dir));
    assert(!result.ok);
    assertEquals(result.issues.map((i) => i.message), [
      "missing required field: date",
      "missing required field: summary (only drafts may omit it)",
    ]);
    assertEquals(await Deno.readTextFile(`${dir}/out/keep.txt`), "previous build");
  });
});

Deno.test("refuses dangerous output directories", async () => {
  for (const outDir of [".", "./", "", "../x", "content"]) {
    await assertRejects(
      () => build({ ...options("."), contentDir: "content", outDir }),
      Error,
      "refusing to use",
    );
  }
});
