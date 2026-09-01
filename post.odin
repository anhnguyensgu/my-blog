package main

import "core:fmt"
import "core:os"
import "core:strconv"
import "core:strings"
import "core:testing"
import cm "vendor:commonmark"

// A calendar date without timezone or locale. Comparison is three integer
// fields; see parse_date for the accepted "YYYY-MM-DD" form.
Date :: struct {
	year:  i32,
	month: u32,
	day:   u32,
}

Post_Header :: struct {
	title:   string,
	date:    Date,
	date_raw: string, // original "YYYY-MM-DD" text, kept for template display
	tags:    [dynamic]string,
	summary: string,
	draft:   bool, // optional front-matter flag; drafts are excluded from every output
}

Markdown_Post :: struct {
	header: Post_Header,
	body:   string, // raw markdown; converted to HTML during render, not at parse time
}

// Well-defined front-matter failure modes (None == success). Callers branch
// on these programmatically; human-readable text is composed once at the
// reporting boundary via front_matter_error_message.
Front_Matter_Error :: enum {
	None,
	Unclosed,
	Missing_Separator,
	Bad_Date,
	Bad_Draft_Value,
	Unknown_Key,
}

// A front-matter failure plus where and what: line points into the header
// block, detail echoes the offending token when there is one. Both are plain
// data so diagnostics can be formatted, sorted, or tested without parsing
// prose back.
Parse_Error :: struct {
	kind:   Front_Matter_Error,
	line:   int,   // 1-based front-matter line; 0 = not applicable
	detail: string, // offending key/value text; "" when not applicable
}

// Splits a post into front matter and raw markdown body. All returned strings
// (and the header's tags) are cloned into `allocator`; nothing aliases the
// input buffer, which callers are free to release afterwards.
// pe.kind == .None signals success.
parse_markdown_post :: proc(
	markdown: string,
	allocator := context.temp_allocator,
) -> (
	post: Markdown_Post,
	pe:   Parse_Error,
) {
	if !strings.has_prefix(markdown, "---\n") {
		post.body = strings.clone(markdown, allocator)
		return post, Parse_Error{}
	}

	rest := markdown[len("---\n"):]

	end := strings.index(rest, "\n---\n")
	if end < 0 {
		return post, Parse_Error{kind = .Unclosed}
	}

	header_text := rest[:end]
	body := rest[end+len("\n---\n"):]

	post.body = strings.clone(body, allocator)
	if header_pe := parse_header(header_text, &post.header, allocator); header_pe.kind != .None {
		return {}, header_pe
	}
	return post, Parse_Error{}
}

// Strict front-matter parser: unknown keys, malformed dates, and malformed
// lines are errors (typos such as "tag:" must not silently drop data).
// Required keys (title/date/summary) are checked separately by
// validate_post_header so all diagnostics can be reported together.
parse_header :: proc(
	header_text: string,
	header: ^Post_Header,
	allocator := context.temp_allocator,
) -> (
	pe: Parse_Error,
) {
	line_no := 0
	lines := header_text
	for line in strings.split_lines_iterator(&lines) {
		line_no += 1
		trimmed := strings.trim_space(line)
		if trimmed == "" {
			continue
		}

		index := strings.index(trimmed, ":")
		if index < 0 {
			return Parse_Error{kind = .Missing_Separator, line = line_no}
		}

		key := strings.trim_space(trimmed[:index])
		value := strings.trim_space(trimmed[index+1:])

		switch key {
		case "title":
			header.title = strings.clone(value, allocator)
		case "date":
			d, ok := parse_date(value)
			if !ok {
				return Parse_Error{kind = .Bad_Date, line = line_no, detail = strings.clone(value, allocator)}
			}
			header.date = d
			header.date_raw = strings.clone(value, allocator)
		case "summary":
			header.summary = strings.clone(value, allocator)
		case "tags":
			for part in strings.split(value, ",", allocator = allocator) {
				tag := strings.trim_space(part)
				if tag != "" {
					append(&header.tags, strings.clone(tag, allocator))
				}
			}
		case "draft":
			switch value {
			case "true":
				header.draft = true
			case "false":
				header.draft = false
			case:
				return Parse_Error{kind = .Bad_Draft_Value, line = line_no, detail = strings.clone(value, allocator)}
			}
		case:
			return Parse_Error{kind = .Unknown_Key, line = line_no, detail = strings.clone(key, allocator)}
		}
	}
	return Parse_Error{}
}

// The only place front-matter errors become prose. Everything upstream works
// with Parse_Error values; everything downstream prints these strings.
front_matter_error_message :: proc(pe: Parse_Error, allocator := context.temp_allocator) -> string {
	switch pe.kind {
	case .None:
		return ""
	case .Unclosed:
		return "front matter is never closed: expected a closing '---' line"
	case .Missing_Separator:
		return fmt.aprintf("front matter line %d: missing ':' separator", pe.line,
			allocator = allocator)
	case .Bad_Date:
		return fmt.aprintf("front matter line %d: invalid date '%s', expected YYYY-MM-DD", pe.line, pe.detail,
			allocator = allocator)
	case .Bad_Draft_Value:
		return fmt.aprintf("front matter line %d: invalid draft value '%s', expected true or false", pe.line, pe.detail,
			allocator = allocator)
	case .Unknown_Key:
		return fmt.aprintf("front matter line %d: unknown front-matter key '%s'", pe.line, pe.detail,
			allocator = allocator)
	}
	return ""
}

// Collects (never fail-fast) one Site_Error per missing required key and
// returns how many it appended, so callers can branch without re-counting.
validate_post_header :: proc(header: ^Post_Header, path: string, errs: ^[dynamic]Site_Error) -> (missing: int) {
	if header.title == "" {
		append(errs, Site_Error{kind = .Missing_Title, path = path})
		missing += 1
	}
	if header.date_raw == "" {
		append(errs, Site_Error{kind = .Missing_Date, path = path})
		missing += 1
	}
	if header.summary == "" {
		append(errs, Site_Error{kind = .Missing_Summary, path = path})
		missing += 1
	}
	return
}

// Parses "YYYY-MM-DD" strictly: exactly ten characters, digits in the right
// places, month 01-12, day 01-31 (no month-length refinement; dates come from
// the author's own hand).
parse_date :: proc(s: string) -> (d: Date, ok: bool) {
	if len(s) != 10 {
		return {}, false
	}
	for i := 0; i < 10; i += 1 {
		if i == 4 || i == 7 {
			if s[i] != '-' {
				return {}, false
			}
			continue
		}
		c := s[i]
		if c < '0' || c > '9' {
			return {}, false
		}
	}

	year, y_ok := strconv.parse_int(s[:4])
	month, m_ok := strconv.parse_uint(s[5:7])
	day, d_ok := strconv.parse_uint(s[8:])
	if !(y_ok && m_ok && d_ok) {
		return {}, false
	}
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return {}, false
	}
	return Date{year = i32(year), month = u32(month), day = u32(day)}, true
}

format_date :: proc(d: Date) -> string {
	return fmt.tprintf("%04d-%02d-%02d", d.year, d.month, d.day)
}

// Slug rule: ^[a-z0-9]+(-[a-z0-9]+)*$ — lowercase letters and digits joined
// by single dashes, no leading/trailing dash.
valid_slug :: proc(stem: string) -> bool {
	if len(stem) == 0 {
		return false
	}
	for r, i in stem {
		switch {
		case ('a' <= r && r <= 'z') || ('0' <= r && r <= '9'):
			// allowed
		case r == '-':
			if i == 0 || i == len(stem)-1 {
				return false
			}
			if stem[i-1] == '-' {
				return false
			}
		case:
			return false
		}
	}
	return true
}

convert_mark :: proc(markdown: string, allocator := context.temp_allocator) -> string {
	html_c := cm.markdown_to_html(cstring(raw_data(markdown)), len(markdown), cm.DEFAULT_OPTIONS)
	defer cm.free(html_c)

	html := string(html_c)
	return strings.clone(html, allocator)
}

@(test)
test_parse_md_post :: proc(t: ^testing.T) {
	bytes, err := os.read_entire_file_from_path(
		"content/simple-http-server.md",
		context.temp_allocator,
	)
	testing.expect_value(t, err, nil)
	defer free_all(context.temp_allocator)

	p, pe := parse_markdown_post(string(bytes))
	testing.expect_value(t, pe.kind, Front_Matter_Error.None)
	testing.expect_value(t, p.header.title, "Simple HTTP Server in Odin")
	testing.expect_value(t, p.header.date_raw, "2026-05-02")
	testing.expect_value(t, p.header.date.year, i32(2026))
	testing.expect_value(t, p.header.draft, false)
	testing.expect(t, len(p.header.tags) == 3)
	testing.expect(t, strings.has_prefix(p.body, "\nThe first useful version"))
	testing.expect(t, !strings.contains(p.body, "<h2>")) // body stays raw markdown
}

@(test)
test_parse_front_matter_roundtrip :: proc(t: ^testing.T) {
	doc := "---\ntitle: Draft Note\ndate: 2026-08-23\ntags: notes, odin\nsummary: A short summary.\ndraft: true\n---\n\nBody **markdown** here.\n"

	post, pe := parse_markdown_post(doc)
	testing.expect_value(t, pe.kind, Front_Matter_Error.None)
	defer free_all(context.temp_allocator)

	testing.expect_value(t, post.header.title, "Draft Note")
	testing.expect_value(t, post.header.draft, true)
	testing.expect_value(t, post.header.summary, "A short summary.")
	testing.expect(t, len(post.header.tags) == 2)
	testing.expect_value(t, post.header.tags[0], "notes")
	testing.expect_value(t, post.header.tags[1], "odin")
	testing.expect(t, strings.contains(post.body, "**markdown**"))
}

@(test)
test_parse_header_errors :: proc(t: ^testing.T) {
	{
		_, pe := parse_markdown_post("---\ntitle: X\n")
		testing.expect_value(t, pe.kind, Front_Matter_Error.Unclosed)
	}
	{
		_, pe := parse_markdown_post("---\ntag: typo\n---\nbody")
		testing.expect_value(t, pe.kind, Front_Matter_Error.Unknown_Key)
		testing.expect_value(t, pe.line, 1)
		testing.expect_value(t, pe.detail, "tag") // detail echoes the offending key
	}
	{
		_, pe := parse_markdown_post("---\ndate: 2026-13-01\n---\nbody")
		testing.expect_value(t, pe.kind, Front_Matter_Error.Bad_Date)
	}
	{
		_, pe := parse_markdown_post("---\ndraft: yes\n---\nbody")
		testing.expect_value(t, pe.kind, Front_Matter_Error.Bad_Draft_Value)
	}
	free_all(context.temp_allocator)
}

@(test)
test_validate_missing_required :: proc(t: ^testing.T) {
	header: Post_Header
	errs: [dynamic]Site_Error
	defer delete(errs)
	defer free_all(context.temp_allocator)

	validate_post_header(&header, "content/x.md", &errs)
	testing.expect_value(t, len(errs), 3)
	want_kinds := [3]Site_Error_Kind{.Missing_Title, .Missing_Date, .Missing_Summary}
	for kind, i in want_kinds {
		testing.expect_value(t, errs[i].kind, kind)
	}
}

@(test)
test_parse_date :: proc(t: ^testing.T) {
	d, ok := parse_date("2026-05-02")
	testing.expect_value(t, ok, true)
	testing.expect_value(t, d.year, i32(2026))
	testing.expect_value(t, d.month, u32(5))
	testing.expect_value(t, d.day, u32(2))

	bad_dates := []string{"", "2026-5-2", "2026/05/02", "2026-13-01", "2026-00-10", "abcd-ef-gh", "2026-05-02x"}
	for bad in bad_dates {
		_, bad_ok := parse_date(bad)
		testing.expect_value(t, bad_ok, false)
	}

	back := format_date(d)
	testing.expect_value(t, back, "2026-05-02")
}

@(test)
test_valid_slug_matrix :: proc(t: ^testing.T) {
	good_slugs := []string{"a", "odin", "simple-http-server", "post-2", "0"}
	for good in good_slugs {
		testing.expect_value(t, valid_slug(good), true)
	}
	bad_slugs := []string{"", "-a", "a-", "a--b", "Hello", "hello_world", "café", "a b"}
	for bad in bad_slugs {
		testing.expect_value(t, valid_slug(bad), false)
	}
}
