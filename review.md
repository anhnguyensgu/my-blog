Correctness

- RSS feed links point at localhost. DEFAULT_SITE.site_url in src/render.ts:24 is the local preview address, and nothing can override it. The committed public/rss.xml already has <link> and <guid> values of http://127.0.0.1:8080/..., so any deployed feed is broken. Read the site URL from an env var or CLI flag, and add --allow-env=SITE_URL to the build task.
- Locale-sensitive sort keys. src/content.ts:173 uses localeCompare on ISO dates and slugs. Both are machine-readable ASCII, so plain </> comparison is deterministic across machines and cheaper. The result is currently the same, so this is low priority.
- Raw OS errors reach the user. src/main.ts:6 prints the bare message and drops the stack. Running new on an existing slug prints "File exists (os error 17)", and a missing content/ dir prints "No such file or directory". Catch Deno.errors.AlreadyExists and NotFound in cli.ts with friendlier text, and print the full error for anything unexpected.
- Front-matter fences are stricter than keys. src/content.ts:58 and :62 require exactly ---, while key lines are trimmed. A UTF-8 BOM or a trailing space on the fence produces the misleading "expected opening '---'". Strip \uFEFF and trim fence lines.
- Slugs lose non-ASCII letters. slugFromTitle in src/cli.ts:19 turns "Xin chào Odin" into xin-ch-o-odin. Normalize with NFKD and strip combining marks before the regex.
- Markdown HTML is unsanitized. marked passes raw HTML through into content_html. Fine for owner-authored posts, but worth a comment in templates/README.md so nobody later feeds it untrusted input.

Wrote 6 lines to ../../.claude/jobs/ccc0b4d9/tmp/probe-directive.ts
// @deno-types="npm:@types/mustache@^4.2.6"
import Mustache from "mustache";

// Should FAIL type-check when the directive resolves the declaration file.
const rendered = Mustache.render(42, {});
console.log(rendered);


Review complete. The code is in good shape overall: type-check, lint, and all 11 tests pass, the committed public/ output is byte-identical to a fresh build, and the narrow task permissions work. I found one medium-impact correctness issue, one hygiene failure, and a set of smaller improvements.

┌──────────────────────────────────┬─────────────────────┐
│              Check               │       Result        │
├──────────────────────────────────┼─────────────────────┤
│ deno check                       │ pass                │
├──────────────────────────────────┼─────────────────────┤
│ deno lint                        │ pass                │
├──────────────────────────────────┼─────────────────────┤
│ deno test                        │ 11 passed, 0 failed │
├──────────────────────────────────┼─────────────────────┤
│ deno fmt --check                 │ fails on 5 files    │
├──────────────────────────────────┼─────────────────────┤
│ fresh build vs committed public/ │ identical           │
└──────────────────────────────────┴─────────────────────┘

Correctness

- RSS feed links point at localhost. DEFAULT_SITE.site_url in src/render.ts:24 ss, and nothing can override it. The committed public/rss.xml already has <link>and <guid> values of http://127.0.0.1:8080/..., so any deployed feed is broken. Read the site URL from an env var or CLI flag, and add --allow-env=SITE_URL to the build task.
- Locale-sensitive sort keys. src/content.ts:173 uses localeCompare on ISO dates and slugs. Both are machine-readable ASCII, so plain </> comparison is deterministic across machines and
  cheaper. The result is currently the same, so this is low priority.
- Raw OS errors reach the user. src/main.ts:6 prints the bare message and drops the stack. Running new on an existing slug prints "File exists (os error 17)", and a missing content/ dir prints "No such file or directory". Catch Deno.errors.AlreadyExists and NotFound in cli.ts with friendlier text, and print the full error for anything unexpected.
- Front-matter fences are stricter than keys. src/content.ts:58 and :62 require exactly ---, while key lines are trimmed. A UTF-8 BOM or a trailing space on the fence produces the misleading "expected opening '---'". Strip \uFEFF and trim fence lines.
- Slugs lose non-ASCII letters. slugFromTitle in src/cli.ts:19 turns "Xin chào Odin" into xin-ch-o-odin. Normalize with NFKD and strip combining marks before the regex.
- Markdown HTML is unsanitized. marked passes raw HTML through into content_htm posts, but worth a comment in templates/README.md so nobody later feeds it
ta are not tied together. renderWithLayout in src/render.ts:112 accepts any PageView for any page, so passing an index view to the post template compiles. A PageViews lookup interface plus <K extends keyof PageViews>(page: K, data: PageViews[K]) makes the mismatch a compile error.
- Unnecessary conditional spread. src/render.ts:159 spreads { navigation } or {}. Since the property already allows undefined, navigation: older || newer ? {...} : undefined is equivalent and simpler.
- RSS date construction. src/render.ts:196 destructures into string | undefined values that are interpolated silently, and monthNames is re-allocated per item. new Date(${date}T00:00:00Z).toUTCString() yields a valid RFC 822 date and removes the table. The exact-string RSS test would need its expected pubDate updated to include the weekday.
- Performance is not a concern at blog scale, but two cheap wins exist. loadPosts reads files one at a time in src/content.ts:148 and buildSite writes post pages one at a time in src/render.ts:258; both can be Promise.all. Also, validate runs marked on every body it never uses. Splitting parsing from HTML rendering fixes that. Mustache already caches parsed templates, so per-page rendering is fine.

Deno

- Run deno fmt. Five files are unformatted: blog.ts, cli.ts, content.ts, render.ts, and test/main.test.ts. The diff is only line wrapping and import ordering. Consider a ci task chaining fmt --check, lint, check, and test.
- The @deno-types directive is correct; keep it. I verified that listing @types/mustache in deno.json imports is not picked up by deno check in 2.9.6, so Mustache silently becomes any without the directive. With it, a bad call fails type-check as expected.
- Task permissions are well scoped for build, validate, and new. Deno.cwd() works under --allow-read=content. The check task can be just deno check, which discovers all five files in this Deno version. test uses blanket read/write, which is acceptable given temp directories.
- Good idioms already in place: Deno.exitCode instead of Deno.exit, createNew: rs.NotFound narrowing, strict compiler flags including noUncheckedIndexedAccessand exactOptionalPropertyTypes, discriminated-union results, and render-before-delete ordering in buildSite.

Test gaps worth filling: HTML escaping of a title containing <script>, escapeXml with & in a summary, CRLF content, new on an existing slug, non-.md files being ignored, and exit codes of the validate command.

Next step if you want the quick wins applied: run deno fmt, then make site_url odified any repository files.
