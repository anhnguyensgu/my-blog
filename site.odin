package main

import "core:fmt"
import "core:mem"
import "core:os"
import "core:strings"

// Well-defined site/build failure modes. Message text is derived from these
// at the reporting boundary (site_error_message), never stored ad hoc.
Site_Error_Kind :: enum {
	Bad_Slug,
	Read_Failure,
	Front_Matter, // see the embedded Parse_Error for kind/line/detail
	Missing_Title,
	Missing_Date,
	Missing_Summary,
	Template_Error,
	Write_Failure,
	Directory_Failure,
}

// One diagnostic per problem, accumulated across the whole site so a build
// reports every broken post at once instead of stopping at the first.
Site_Error :: struct {
	kind:   Site_Error_Kind,
	path:   string,
	parse:  Parse_Error, // meaningful only when kind == .Front_Matter
	detail: string,      // wrapped OS/template error text for the other kinds
}

// Human-readable text for one site error — the single place site errors
// become prose. Every other layer handles typed values only.
site_error_message :: proc(e: Site_Error, allocator := context.temp_allocator) -> string {
	switch e.kind {
	case .Bad_Slug:
		return "filename is not a valid slug (use lowercase letters, digits, single dashes)"
	case .Read_Failure:
		return "could not read file"
	case .Front_Matter:
		return front_matter_error_message(e.parse, allocator)
	case .Missing_Title:
		return "missing required front-matter key: title"
	case .Missing_Date:
		return "missing required front-matter key: date"
	case .Missing_Summary:
		return "missing required front-matter key: summary"
	case .Template_Error:
		return fmt.aprintf("template render failed: %s", e.detail, allocator = allocator)
	case .Write_Failure:
		return fmt.aprintf("could not write file: %s", e.detail, allocator = allocator)
	case .Directory_Failure:
		return fmt.aprintf("could not create directory: %s", e.detail, allocator = allocator)
	}
	return ""
}

// A published post, fully indexed. Posts are stored newest-first.
Post :: struct {
	header:      Post_Header,
	slug:        string, // filename stem; also the URL segment
	url:         string, // "/posts/<slug>/"
	source_path: string,
	body_md:     string,
	body_html:   string, // filled during render_site
	reading_min: int,
	prev_index:  int, // older post, -1 = none
	next_index:  int, // newer post, -1 = none
}

Archive_Group :: struct {
	year:         i32,
	post_indices: [dynamic]int, // indices into Site.posts, newest-first
}

Site :: struct {
	posts:     [dynamic]Post,
	tag_index: map[string][dynamic]int, // tag -> post indices (tags alias header-owned strings)
	groups:    [dynamic]Archive_Group,  // year-descending
}

// Walks `content_dir` for *.md posts, parses and validates each one, then
// sorts newest-first (slug ascending as tiebreak) and builds tag, archive-year,
// and prev/next indexes. Drafts are skipped silently. All strings inside the
// returned Site (and the errs entries) are owned by `allocator`. This proc never
// calls free_all itself: callers routinely pass the shared temp allocator as
// `allocator`, so freeing "intermediate" state here would release memory the
// returned values still point into. Temp-arena growth is bounded by content
// size and reclaimed by the caller's own free_all scope. Errors accumulate —
// never fail-fast.
load_site :: proc(
	content_dir: string,
	allocator: mem.Allocator,
) -> (
	site: Site,
	errs: [dynamic]Site_Error,
) {
	site.posts = make([dynamic]Post, 0, 16, allocator)
	site.tag_index = make(map[string][dynamic]int, allocator)
	site.groups = make([dynamic]Archive_Group, 0, 4, allocator)
	errs = make([dynamic]Site_Error, 0, 8, allocator)

	w := os.walker_create(content_dir)
	defer os.walker_destroy(&w)
	for info in os.walker_walk(&w) {
		if info.type != .Regular || !strings.has_suffix(info.name, ".md") {
			continue
		}

		// walker yields bare names relative to content_dir; only fullpath is
		// guaranteed to open regardless of the process working directory.
		stem := os.stem(info.fullpath)
		if !valid_slug(stem) {
			append(
				&errs,
				Site_Error{kind = .Bad_Slug, path = strings.clone(info.name, allocator)},
			)
			continue
		}
		slug := strings.clone(stem, allocator)
		source_path := strings.clone(info.name, allocator)

		bytes, read_err := os.read_entire_file_from_path(info.fullpath, context.temp_allocator)
		if read_err != nil {
			append(&errs, Site_Error{kind = .Read_Failure, path = source_path})
			continue
		}

		parsed, pe := parse_markdown_post(string(bytes), allocator)
		if pe.kind != .None {
			append(&errs, Site_Error{kind = .Front_Matter, path = source_path, parse = pe})
			continue
		}
		if parsed.header.draft {
			continue
		}

		if validate_post_header(&parsed.header, source_path, &errs) > 0 {
			continue
		}

		post := Post{
			header      = parsed.header,
			slug        = slug,
			url         = strings.clone(fmt.tprintf("/posts/%s/", slug), allocator),
			source_path = source_path,
			body_md     = parsed.body,
			reading_min = reading_time_minutes(parsed.body),
			prev_index  = -1,
			next_index  = -1,
		}
		append(&site.posts, post)
	}

	sort_posts_newest_first(site.posts[:])

	n := len(site.posts)
	for i := 0; i < n; i += 1 {
		if i+1 < n {
			site.posts[i].prev_index = i + 1 // older
		}
		if i > 0 {
			site.posts[i].next_index = i - 1 // newer
		}
	}

	for i := 0; i < n; i += 1 {
		post := &site.posts[i]
		for tag in post.header.tags {
			entry: [dynamic]int
			if existing, found := site.tag_index[tag]; found {
				entry = existing
			} else {
				entry = make([dynamic]int, 0, 4, allocator)
			}
			append(&entry, i)
			site.tag_index[tag] = entry
		}

		year := post.header.date.year
		if len(site.groups) == 0 || site.groups[len(site.groups)-1].year != year {
			group := Archive_Group{year = year, post_indices = make([dynamic]int, 0, 8, allocator)}
			append(&group.post_indices, i)
			append(&site.groups, group)
		} else {
			append(&site.groups[len(site.groups)-1].post_indices, i)
		}
	}

	return site, errs
}

// Newest first, slug ascending on equal dates — deterministic output so
// rebuilds produce stable diffs of public/.
post_is_newer :: proc(a, b: Post) -> bool {
	if a.header.date.year != b.header.date.year {
		return a.header.date.year > b.header.date.year
	}
	if a.header.date.month != b.header.date.month {
		return a.header.date.month > b.header.date.month
	}
	if a.header.date.day != b.header.date.day {
		return a.header.date.day > b.header.date.day
	}
	return a.slug < b.slug
}

// Slices are the idiomatic parameter shape for element-only algorithms:
// sorting permutes in place and never resizes, so any Post storage works —
// not just this package's [dynamic]array.
sort_posts_newest_first :: proc(posts: []Post) {
	// Insertion sort: personal-blog sizes make it fast, and unlike an
	// unstable quicksort it keeps the equal-date tiebreak order exact.
	for i := 1; i < len(posts); i += 1 {
		key := posts[i]
		j := i - 1
		for j >= 0 && post_is_newer(key, posts[j]) {
			posts[j+1] = posts[j]
			j -= 1
		}
		posts[j+1] = key
	}
}

// words/200 with a floor of 1 minute.
reading_time_minutes :: proc(markdown: string) -> int {
	words := 0
	in_word := false
	for r in markdown {
		is_space := r == ' ' || r == '\t' || r == '\n' || r == '\r'
		if !is_space && !in_word {
			words += 1
		}
		in_word = !is_space
	}
	minutes := words / 200
	return max(minutes, 1)
}
