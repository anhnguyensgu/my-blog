# AGENTS.md

## Scope

These instructions apply to the entire repository. If scoped `AGENTS.md` files are added later, follow the closest applicable instructions for files in that subtree.

## Project overview

This repository is a small static blog generator written in strict TypeScript for Deno. Markdown posts in `content/` are validated, rendered through Mustache templates, and written to `public/`.

## Commands and verification

Run commands from the repository root:

```sh
deno task check       # Type-check source and tests
deno task test        # Run the complete test suite
deno task lint        # Run the linter
deno task fmt --check # Check formatting
deno task validate    # Validate content without writing output
deno task build       # Validate and regenerate public/
deno task new -- "Post title" # Create a draft post
```

During development, run the narrowest relevant test when practical:

```sh
deno task test --filter "<test name>"
```

Before finishing a code change, run at least:

```sh
deno task check
deno task test
deno task lint
deno task fmt --check
```

Run `deno task build` as well when changing content, templates, rendering, site configuration, or generated output. Use `SITE_URL=https://example.com deno task build` when RSS links must target a deployed site; without it, the build uses the localhost preview URL.

## Project map

| Area | Primary locations | Responsibility | Verification |
|---|---|---|---|
| CLI | `src/main.ts`, `src/cli.ts` | Commands, arguments, permissions, and exit codes | CLI tests |
| Content | `src/content.ts`, `content/` | Front matter, validation, Markdown, and ordering | `deno task validate`, tests |
| Rendering | `src/render.ts` | View models, pages, RSS, and output writes | Tests and `deno task build` |
| Templates | `templates/` | Mustache layouts and fragments | Build and inspect `public/` |
| Public API | `src/blog.ts` | Exports used by tests and consumers | `deno task check` |
| Styling | `public/style.css`, `design/` | Maintained CSS and visual references | Build and visual inspection |
| Tests | `test/main.test.ts` | Behavioral and regression coverage | `deno task test` |
| Generated output | `public/*.html`, `public/posts/`, `public/rss.xml` | Deployable build artifacts | `deno task build` |

See `templates/README.md` for the detailed template contract.

## Critical content and rendering invariants

- Post filenames must be lowercase slugs containing letters, digits, and single dashes.
- Front matter only supports `title`, `date`, `tags`, `summary`, and `draft`.
- Dates use `YYYY-MM-DD`. Published posts require a nonempty summary; drafts may omit it.
- Published posts sort by date descending, then slug ascending. Preserve this tiebreak behavior.
- Drafts must not appear in generated pages or RSS.
- Keep Markdown files limited to metadata and article content. Shared layout and navigation belong in `templates/`.
- Render trusted Markdown HTML with triple Mustache braces only where the template contract requires it; escape metadata and RSS values.
- Do not edit generated HTML or RSS manually. Change `content/`, `templates/`, or `src/`, then rebuild. `public/style.css` is maintained directly and must be preserved by the build.

## Development conventions

- Preserve the strict compiler settings in `deno.json`, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Use explicit types at module boundaries and model expected failures with discriminated unions where appropriate.
- Keep Deno permissions scoped in tasks; do not introduce broader permissions without a concrete need.
- Add or update tests for behavior changes. Prefer temporary directories in filesystem tests and always clean them in `finally` blocks.
- Route functionality intended for external use or tests through `src/blog.ts`.
- Prefer Deno APIs over Node-specific filesystem or process APIs.
- Use stable language and standard-library features supported by the configured toolchain. Do not adopt a feature solely because it is newer.
- Format with `deno fmt`; do not hand-format against the configured 110-column line width.

## Review priorities

Review changes in this order:

1. **Correctness:** Re-read the changed code and verify assumptions, edge cases, error paths, and compatibility with existing behavior. Do not accept a simplification that changes required behavior.
2. **Clarity and simplicity:** Prefer the smallest coherent solution with straightforward control flow. Remove unnecessary abstraction and duplication, but avoid unrelated refactoring.
3. **Idiomatic implementation:** Follow established repository patterns and use stable features supported by the configured Deno toolchain.
4. **Performance:** Avoid unnecessary allocations, repeated work, and needlessly expensive algorithms. Make non-obvious optimizations only when requirements, profiling, or benchmarks justify them.
5. **Conciseness:** Reduce concepts and complexity rather than raw line count. Do not sacrifice readability, maintainability, typing, tests, or error handling merely to use fewer lines.

## Completion checklist

- Check `git status` before editing and do not overwrite unrelated work in progress.
- Add or update tests for behavior changes.
- Run the required type-check, tests, lint, and formatting checks.
- Rebuild when content, templates, rendering, site configuration, or generated output changes.
- Inspect generated diffs and confirm that only expected pages changed.
- Do not commit dependency caches, `node_modules/`, `dist/`, or `.DS_Store`.
