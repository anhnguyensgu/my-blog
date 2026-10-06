import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderMarkdown, renderMarkdownInline } from "../src/markdown/mod.ts";

const md = (source: string) => renderMarkdown(source).html;
const inline = (source: string) => renderMarkdownInline(source);

Deno.test("headings get unique ids, anchors, and toc entries", () => {
  const { html, toc } = renderMarkdown("## Hello *World*\n\n### Hello World\n\n## Hello World ##\n\n# Top");
  assertStringIncludes(
    html,
    `<h2 id="hello-world">Hello <em>World</em><a class="anchor" href="#hello-world"`,
  );
  assertStringIncludes(html, `<h3 id="hello-world-1">`);
  assertStringIncludes(html, `<h2 id="hello-world-2">Hello World<a`);
  assertStringIncludes(html, `<h1 id="top">`);
  assertEquals(toc, [
    { level: 2, id: "hello-world", text: "Hello World" },
    { level: 3, id: "hello-world-1", text: "Hello World" },
    { level: 2, id: "hello-world-2", text: "Hello World" },
  ]);
});

Deno.test("heading ids fold Vietnamese diacritics", () => {
  assertStringIncludes(md("## Xin chào Đà Nẵng"), `id="xin-chao-da-nang"`);
});

Deno.test("setext headings and thematic breaks", () => {
  assertStringIncludes(md("Title\n====="), `<h1 id="title">Title`);
  assertStringIncludes(md("Sub\n---"), `<h2 id="sub">Sub`);
  assertEquals(md("***"), "<hr>");
  assertEquals(md("- - -"), "<hr>");
  assertEquals(md("para\n\n---"), "<p>para</p>\n<hr>");
});

Deno.test("paragraphs, soft breaks, and hard breaks", () => {
  assertEquals(md("one\ntwo\n\nthree"), "<p>one\ntwo</p>\n<p>three</p>");
  assertEquals(md("one  \ntwo"), "<p>one<br>\ntwo</p>");
  assertEquals(md("one\\\ntwo"), "<p>one<br>\ntwo</p>");
});

Deno.test("emphasis follows delimiter-run rules", () => {
  assertEquals(
    inline("*a* **b** ***c*** _d_ __e__"),
    "<em>a</em> <strong>b</strong> <em><strong>c</strong></em> <em>d</em> <strong>e</strong>",
  );
  assertEquals(inline("snake_case_name"), "snake_case_name");
  assertEquals(inline("2 * 3 * 4"), "2 * 3 * 4");
  assertEquals(inline("**foo*"), "*<em>foo</em>");
  assertEquals(inline("*foo**bar*"), "<em>foo**bar</em>");
  assertEquals(inline("*foo **bar** baz*"), "<em>foo <strong>bar</strong> baz</em>");
  assertEquals(inline("~~gone~~ ~one~"), "<del>gone</del> ~one~");
});

Deno.test("code spans are literal and escaped", () => {
  assertEquals(inline("`a < b`"), "<code>a &lt; b</code>");
  assertEquals(inline("`` a ` b ``"), "<code>a ` b</code>");
  assertEquals(inline("`*not em*`"), "<code>*not em*</code>");
  assertEquals(inline("`unclosed"), "`unclosed");
});

Deno.test("escapes, entities, and raw HTML", () => {
  assertEquals(inline("\\*not\\* & <b>bold</b> &copy; 1 < 2"), "*not* &amp; <b>bold</b> &copy; 1 &lt; 2");
  assertEquals(inline("<!-- note -->"), "<!-- note -->");
});

Deno.test("inline links, images, and titles", () => {
  assertEquals(inline(`[a](https://x.y "T")`), `<a href="https://x.y" title="T">a</a>`);
  assertEquals(inline("[a *b*](</p q>)"), `<a href="/p%20q">a <em>b</em></a>`);
  assertEquals(inline("[x](https://w.org/a_(b))"), `<a href="https://w.org/a_(b)">x</a>`);
  assertEquals(
    inline(`![alt *t*](/i.png 'cap')`),
    `<img src="/i.png" alt="alt t" title="cap" loading="lazy" decoding="async">`,
  );
  assertEquals(inline("[not a link] (x)"), "[not a link] (x)");
});

Deno.test("links cannot nest and unsafe schemes are neutralized", () => {
  assertEquals(inline("[a [b](c) d](e)"), `[a <a href="c">b</a> d](e)`);
  assertEquals(inline("[x](javascript:alert(1))"), `<a href="#">x</a>`);
  assertEquals(inline("<javascript:alert(1)>"), `<a href="#">javascript:alert(1)</a>`);
});

Deno.test("reference links: full, collapsed, and shortcut", () => {
  const html = md(`[full][Ref] [Ref][] [ref]\n\n[ref]: https://r.example "Ref title"`);
  const a = `<a href="https://r.example" title="Ref title">`;
  assertEquals(html, `<p>${a}full</a> ${a}Ref</a> ${a}ref</a></p>`);
  assertEquals(md("[missing][nope]"), "<p>[missing][nope]</p>");
});

Deno.test("autolinks", () => {
  assertEquals(inline("<https://a.b/c>"), `<a href="https://a.b/c">https://a.b/c</a>`);
  assertEquals(inline("<me@x.org>"), `<a href="mailto:me@x.org">me@x.org</a>`);
  assertEquals(inline("see https://a.b/c."), `see <a href="https://a.b/c">https://a.b/c</a>.`);
  assertEquals(inline("(https://a.b/c)"), `(<a href="https://a.b/c">https://a.b/c</a>)`);
});

Deno.test("fenced code keeps content, escapes it, and highlights", () => {
  const html = md('```ts\nconst a = "<b>"; // hi\n```');
  assertStringIncludes(html, `<div class="codeblock" data-lang="ts"><pre><code class="language-ts">`);
  assertStringIncludes(html, `<span class="tok-k">const</span>`);
  assertStringIncludes(html, `<span class="tok-s">&quot;&lt;b&gt;&quot;</span>`);
  assertStringIncludes(html, `<span class="tok-c">// hi</span>`);

  assertEquals(
    md("~~~\n*x*\n\n<y>\n~~~"),
    `<div class="codeblock" data-lang="text"><pre><code>*x*\n\n&lt;y&gt;</code></pre></div>`,
  );
  assertEquals(
    md("````\n```\n````"),
    `<div class="codeblock" data-lang="text"><pre><code>\`\`\`</code></pre></div>`,
  );
  assertStringIncludes(md("```\nunclosed"), "<code>unclosed</code>");
});

Deno.test("indented code blocks", () => {
  assertEquals(
    md("    a\n\n      b\n\npara"),
    `<div class="codeblock" data-lang="text"><pre><code>a\n\n  b</code></pre></div>\n<p>para</p>`,
  );
  assertEquals(md("para\n    continued"), "<p>para\ncontinued</p>");
});

Deno.test("block quotes nest and allow lazy continuation", () => {
  assertEquals(
    md("> a\nlazy\n> > b"),
    "<blockquote>\n<p>a\nlazy</p>\n<blockquote>\n<p>b</p>\n</blockquote>\n</blockquote>",
  );
});

Deno.test("callouts", () => {
  assertEquals(
    md("> [!TIP]\n> Use *tests*."),
    `<aside class="callout callout-tip">\n<p class="callout-title">Tip</p>\n<p>Use <em>tests</em>.</p>\n</aside>`,
  );
});

Deno.test("tight and loose lists", () => {
  assertEquals(md("- a\n- b"), "<ul>\n<li>a</li>\n<li>b</li>\n</ul>");
  assertEquals(md("- a\n\n- b"), "<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>");
  assertEquals(md("- a\n\n  more"), "<ul>\n<li><p>a</p>\n<p>more</p></li>\n</ul>");
});

Deno.test("nested and ordered lists", () => {
  assertEquals(
    md("3. a\n4. b\n   - c\n   - d"),
    `<ol start="3">\n<li>a</li>\n<li>b\n<ul>\n<li>c</li>\n<li>d</li>\n</ul></li>\n</ol>`,
  );
  // A change of bullet character starts a new list.
  assertEquals(md("- a\n* b"), "<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>");
  // Only lists starting at 1 may interrupt a paragraph.
  assertEquals(md("year\n2026. was good"), "<p>year\n2026. was good</p>");
});

Deno.test("list items hold code blocks", () => {
  const html = md("1. step\n\n   ```sh\n   deno task build\n   ```");
  assertStringIncludes(html, `<li><p>step</p>\n<div class="codeblock" data-lang="sh">`);
});

Deno.test("task lists", () => {
  assertEquals(
    md("- [ ] todo\n- [x] done"),
    `<ul>\n<li class="task"><input type="checkbox" disabled> todo</li>\n<li class="task"><input type="checkbox" disabled checked> done</li>\n</ul>`,
  );
});

Deno.test("tables with alignment and escaped pipes", () => {
  assertEquals(
    md("| a | b |\n|:-:|--:|\n| `x\\|y` | **2** |\n| only |"),
    `<div class="table-wrap"><table>\n` +
      `<thead><tr><th style="text-align:center">a</th><th style="text-align:right">b</th></tr></thead>\n` +
      `<tbody>\n<tr><td style="text-align:center"><code>x|y</code></td><td style="text-align:right"><strong>2</strong></td></tr>\n` +
      `<tr><td style="text-align:center">only</td><td style="text-align:right"></td></tr>\n</tbody>\n</table></div>`,
  );
  // Without a matching delimiter row it is just a paragraph.
  assertEquals(md("a | b\n--- | --- | ---"), "<p>a | b\n--- | --- | ---</p>");
});

Deno.test("html blocks pass through", () => {
  assertEquals(
    md('<div class="x">\n*raw*\n</div>\n\n*md*'),
    `<div class="x">\n*raw*\n</div>\n<p><em>md</em></p>`,
  );
  assertEquals(md("<!--\nhidden\n-->"), "<!--\nhidden\n-->");
});

Deno.test("an image alone in a paragraph becomes a figure", () => {
  assertEquals(
    md(`![Diagram](/d.svg "How it fits")`),
    `<figure><img src="/d.svg" alt="Diagram" title="How it fits" loading="lazy" decoding="async"><figcaption>How it fits</figcaption></figure>`,
  );
});

Deno.test("CRLF input and leading tabs", () => {
  assertEquals(
    md("a\r\nb\r\n\r\n- x\r\n\t- y"),
    "<p>a\nb</p>\n<ul>\n<li>x\n<ul>\n<li>y</li>\n</ul></li>\n</ul>",
  );
});
