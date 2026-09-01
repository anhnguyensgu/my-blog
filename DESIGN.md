All details verified against the working tree. Here is the design document.

---

# Blog System Design — Post Management & Rendering

**Scope:** `/Users/anhnguyen/project/my-blog` · Odin, package main, vendored deps only (`commonmark`, `odin-mustache`) · target: personal blog, <200 posts · **pure static-site generator: markdown + templates → HTML, no bundled server**

## Baseline contract (inherited, preserved)

Static-first remains the architecture: **a build step produces `public/`; there is no runtime server — deployment is any static host**. Template set, layout system, and `public/style.css` visuals are untouched. No config files, no database, no external services. This design confirms the existing trajectory (the TODO comments in `cli.odin:add_post()` describe exactly this plan); the only revision is that `content/*.html` pre-rendered twins become obsolete — markdown is the single source of truth.

## 1. Post model & lifecycle

```odin
Date :: struct { year: i32, month: u32, day: u32 }

Post_Header :: struct {
	title:   string,          // required
	date:    Date,            // required, parsed from "YYYY-MM-DD"
	tags:    [dynamic]string, // optional, comma-separated
	summary: string,          // required (drives index rows + RSS)
	draft:   bool,            // optional front-matter flag, default false
}
```

Decisions:

- **Filename is the slug.** `content/simple-http-server.md` → slug `simple-http-server` → URL `/posts/simple-http-server/`. No slugification logic, no ambiguity between two posts with the same title. Validation enforces `^[a-z0-9]+(-[a-z0-9]+)*$` on the filename stem; violations are build errors, not silent rewrites.
- **URL scheme:** `/posts/<slug>/` served from `public/posts/<slug>/index.html`. Pretty URLs that work on any static host with zero rewrite rules.
- **Typed dates.** Parse `"YYYY-MM-DD"` manually (`strconv.parse_uint` on 3 split fields) into `Date`. No timezone, no locale, comparison is 3 integer fields. Store the raw string too for template display (`{{date}}` stays `2026-05-02`, matching the current visual design).
- **Required vs optional:** `title`, `date`, `summary` required; `tags`, `draft` optional.
- **Drafts:** front-matter `draft: true` excludes the post from index, archive, RSS, and its page is simply not emitted. No separate drafts folder.
- **Validation & error reporting:** errors are well-defined enums, not strings. Parsing yields `Parse_Error{kind: Front_Matter_Error, line, detail}` (`Unclosed`, `Missing_Separator`, `Bad_Date`, `Bad_Draft_Value`, `Unknown_Key`); site/build diagnostics accumulate as `Site_Error{kind: Site_Error_Kind, path, parse, detail}` (`Bad_Slug`, `Read_Failure`, `Front_Matter`, `Missing_Title/Date/Summary`, `Template_Error`, `Write_Failure`, `Directory_Failure`). Prose is composed exactly once, at the reporting boundary (`front_matter_error_message`, `site_error_message`). A build reports *all* broken posts at once and exits nonzero if any.

## 2. Discovery & indexing

Built once per invocation into a single `Site` value:

```odin
Post :: struct {
	header:      Post_Header,
	slug:        string,
	url:         string,     // "/posts/<slug>/"
	source_path: string,
	body_md:     string,
	body_html:   string,     // filled during render step
	reading_min: int,
	prev_index:  int,        // older post, -1 = none
	next_index:  int,        // newer post, -1 = none
}

Archive_Group :: struct { year: i32, post_indices: [dynamic]int }

Site :: struct {
	posts:     [dynamic]Post,
	tag_index: map[string][dynamic]int,  // indices into posts — no duplicated strings
	groups:    [dynamic]Archive_Group,   // year-descending
}
```

- `load_site(content_dir, allocator)` walks `content/*.md` (reuse the `os.walker_walk` pattern from `load_post_struct`), parses, validates, then sorts: **date descending, slug ascending tiebreak** (deterministic output → stable diffs of `public/`).
- Prev/next and tag index and year groups are computed once here; renderers just read them.
- **Allocator contract:** the whole `Site` lives on `context.allocator` for the lifetime of the process invocation (`free_all` at end of `run_cli`/`main` under a `mem.Tracking_Allocator` wrapper in debug builds to surface leaks). All intermediate work — walker buffers, splits, mustache output, commonmark conversion — uses `context.temp_allocator` with `defer free_all` scopes, exactly matching the existing code style. One owner, no aliasing: strings inside `Site` are cloned with the site allocator; nothing else retains pointers into temp allocations. A short-lived batch tool leaking-until-exit is acceptable and boring; the tracking allocator catches real mistakes.
- **Archive grouping: by year only.** At <200 posts, month grouping is noise. Revisit if a year ever exceeds ~60 posts.

## 3. Rendering pipeline

**Decision: full rebuild per build run; there is no render-on-request path at all.** For <200 small posts, commonmark + mustache completes in milliseconds. mtime/hash caching adds a state file, staleness bugs, and cache-invalidation questions for zero perceivable gain. Delete the idea. There is no preview server either (see §5).

Flow:

```
content/*.md
     │  os.walker_walk (skip *.html, hidden files)
     ▼
[load_site]  parse front matter ─ validate ─ sort desc ─ tag/year/prev-next indexes
     │                                   (errors collected, not fatal-yet)
     ▼
[render_site]                                        out: public/
 ├─ for each post: convert_mark(body_md)             (commonmark, temp alloc)
 │    └─ mustache(post.html + layout.html)  ──────▶  posts/<slug>/index.html
 ├─ render_post_rows loop (existing pattern)  ─────▶ index.html
 ├─ year groups → post-row partials           ─────▶ archive.html
 ├─ strings.builder + escape_xml (no mustache) ─────▶ rss.xml
 └─ render_error_document                     ─────▶ 404.html
     ▼
[deploy]       any static host serves public/ as-is
```

Details:

- **Markdown→HTML:** `convert_mark` unchanged (already clones commonmark output into the caller's allocator). Called fresh every build — see "no caching" above.
- **Escaping rules (hard rule):** everything authored in front matter — title, summary, tags, dates — renders through escaped `{{ }}`. Only internally-generated HTML blobs use triple-stash: `{{{content_html}}}`, `{{{previous_link}}}`, `{{{next_link}}}`. Verified: `templates/post.html` already follows this; keep it that way.
- **Reading time:** `words / 200`, minimum 1, rendered as `"<n> min"`. Count words by whitespace-splitting `body_md` before conversion (code fences count as words — fine).
- **RSS:** generated with a `strings.builder` + dedicated `escape_xml` (mustache would apply *HTML* entity escaping, wrong for XML; and the codebase already proves the builder-loop idiom in `render_post_rows`). Channel = site_data fields; items = top 20 posts.
- **404/error reuse:** `public/404.html` regenerated each build via the existing `render_error_document`; server-side runtime errors keep using it live.
- **Writes:** plain `os.write_entire_file_from_string` per artifact (existing behavior). Atomic-rename is optional hardening, not designed in.

## 4. CLI commands

`main` inspects `os.args()`: subcommand dispatch, no flags beyond the command name.

| Command | Effect |
|---|---|
| `my-blog new <title-or-slug>` | writes `content/<derived-slug>.md` with front-matter skeleton (`title`, today's `date` via `core:time`, empty summary/tags) |
| `my-blog build` | `load_site` + `render_site`; prints collected `Site_Error`s; exit 1 on any |
| `my-blog validate` | `load_site` only — parse/validate/sort, no output written |
| *(none / unknown)* | print usage, exit 2 |

Parsing = `args := os.args(); cmd := args[1]; switch cmd {...}`. Nothing else.

## 5. Serving & deployment (revised post-implementation)

No server ships with the blog — scope decision after the implementation review: the engine is purely **markdown + templates → HTML**. The `build` output in `public/` is served by anything: GitHub Pages, nginx, or locally `python3 -m http.server -d public`. Consequences: no routing, HEAD handling, or cache-header code exists; the pretty-URL scheme (`/posts/<slug>/` → `index.html`) works on every static host without rewrite rules; `404.html` remains generated because static hosts pick it up automatically.

## 6. Module layout

| File | Owns |
|---|---|
| `post.odin` | `Date`, `Post_Header`, `parse_markdown_post`, `parse_header` (strict), `parse_date`, `format_date`, slug validation |
| `site.odin` | `Site`, `Post`, `Archive_Group`, `Site_Error`, `load_site`, sorting, tag/year/prev-next indexes, `reading_time_minutes` |
| `render.odin` | all mustache `render_*` procs moved verbatim from `cli.odin`, plus `render_site`, `render_archive_page`, `rss.xml` builder, `escape_xml` |
| `cli.odin` | `run_cli(args)` dispatch only; `cmd_new`, `cmd_build`, `cmd_validate`, usage printer |
| `main.odin` | entry point; delegates to `run_cli(os.args())` (`server.odin` and `app.odin` deleted — see §5) |

Core signatures:

```odin
load_site            :: proc(content_dir: string, alloc: mem.Allocator) -> (site: Site, errs: [dynamic]Site_Error)
render_site          :: proc(site: ^Site, out_dir: string, alloc: mem.Allocator) -> (errs: [dynamic]Site_Error)
reading_time_minutes :: proc(markdown: string) -> int
parse_date           :: proc(s: string) -> (d: Date, ok: bool)
valid_slug           :: proc(stem: string) -> bool
run_cli              :: proc(args: []string) -> int   // exit code
render_error_document:: proc(page_title, heading, message, detail: string) -> string  // unchanged
```

## 7. Migration plan (each step compiles independently)

1. **Delete dead weight** (zero-risk): `Error :: enum {}` + `proc a` stub at bottom of `post.odin`; stale `content/simple-http-server.html`; hardcoded demo data + TODO comments inside `add_post()`; unused `load_post_struct`'s `[dynamic]string` shape (replaced by `load_site`).
2. **Dates:** add `Date`, `parse_date`, `format_date` + unit tests; switch `Post_Header.date` to `Date` (keep raw string alongside for templates). Update the existing `test_parse_md_post`.
3. **Strict front matter:** `parse_header` returns `(ok, err_msg)`; add `draft`; add `validate_post_header` producing `Site_Error`s; tests for missing-title/date/summary and bad date.
4. **`site.odin`:** implement `load_site`, sorting, tag index, year groups, prev/next; test against a fixture dir created in a temp path.
5. **Extract `render.odin`:** move `render_*` procs out of `cli.odin` unchanged (pure relocation, compiler-checked).
6. **Real post pages:** change `render_post_page` to take `^Post`; feed `body_html` from `convert_mark`, metadata from header; emit `public/posts/<slug>/index.html`. Remove the hardcoded `simple-http-server.html` read.
7. **Full build:** implement `render_site` (index, archive, rss, 404) and wire `cmd_build`; delete `add_post`.
8. **CLI:** subcommand dispatch in `main`. *(Amended after review: the server was removed entirely — see §5.)*

## 8. Testing

Extend the existing `@(test)` style, all pure-function-first:

- `post_test.odin` cases: valid front matter round-trip; missing required key → specific `Site_Error_Kind`; malformed front matter → specific `Front_Matter_Error`; `draft` flag; `parse_date` valid/bad-month/negative; slug validator matrix.
- `site_test.odin`: 3-fixture-dir → order after sort (incl. same-date slug tiebreak), tag index counts, prev/next endpoints (-1 at both ends), year grouping.
- End-to-end: build-test writes fixtures + runs `load_site`/`render_site` into `os.tmpdir()/my-blog-test-<pid>/`, asserts `posts/<slug>/index.html`, `index.html`, `rss.xml`, `404.html` exist and contain expected substrings; `defer os.remove_all`.

---

### Review findings (paths + severity)

- **Medium — ~~`server.odin` `response_for_path`~~ moot:** 404-with-200 bug existed, but the entire server was removed before it mattered.
- **Low — ~~HTTP method ignored~~ / ~~REQUEST_LIMIT~~ moot:** both lived in the deleted server.
- **Info — `post.odin`:** `parse_header` accepts unknown keys silently and stores `date` as string; superseded by steps 2–3.
- **Drift check:** no conflicts with inherited decisions; the design preserves static-first, template set, vendored deps, and visual design. Only obsolete mechanism removed: `content/*.html` twins and hardcoded `add_post()`.