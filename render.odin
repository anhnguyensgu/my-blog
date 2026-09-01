package main

import "core:fmt"
import "core:mem"
import "core:os"
import "core:strings"
import mustache "vendor/odin-mustache"

LAYOUT_TEMPLATE :: "templates/layout.html"
RSS_MAX_ITEMS :: 20

MONTH_ABBREV := [12]string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"} // variable: indexed with a runtime month

// Compile-time constant: every field is a string literal, so the whole record
// lives in rodata and no constructor proc is needed.
SITE_DATA :: Site_Data{
	site_name     = "Anh Nguyen",
	site_title    = "Notes from Odin and systems work",
	site_role     = "systems notes",
	site_note     = "Short notes from building tools, servers, runtimes, and experiments in Odin.",
	brand_mark    = "AN",

	home_url      = "/",
	archive_url   = "/archive.html",
	tags_url      = "#",
	rss_url       = "/rss.xml",

	asset_path    = "/",
	asset_version = "4",

	site_url      = "http://127.0.0.1:8080",
}

Site_Data :: struct {
	site_name:     string,
	site_title:    string,
	site_role:     string,
	site_note:     string,
	brand_mark:    string,
	home_url:      string,
	archive_url:   string,
	tags_url:      string,
	rss_url:       string,
	asset_path:    string,
	asset_version: string,
	// Absolute origin used only where relative URLs are not allowed (RSS
	// channel/item links). Update when the blog gets its real domain.
	site_url: string,
}

Index_Page_Data :: struct {
	site:                Site_Data,
	page_title:          string,
	latest_current_attr: string,
	home_heading:        string,
	home_intro:          string,
	post_rows:           string,
}

Post_Row_Data :: struct {
	post_url:   string,
	date:       string,
	title:      string,
	summary:    string,
	tag_badges: string,
}

Tag_Data :: struct {
	tag: string,
}

Post_Page_Data :: struct {
	site:                Site_Data,
	page_title:          string,
	latest_current_attr: string,
	title:               string,
	date:                string,
	tags:                string,
	tag_path:            string,
	reading_time:        string,
	content_html:        string,
	previous_link:       string,
	next_link:           string,
}

Archive_Page_Data :: struct {
	site:                Site_Data,
	page_title:          string,
	latest_current_attr: string,
	archive_rows:        string,
}

// Row-shaped view of a post for the index/archive partials. Tags alias the
// header-owned strings; nothing is copied.
Post_Summary :: struct {
	post_url: string,
	date:     string,
	title:    string,
	summary:  string,
	tags:     []string,
}

Error_Page_Data :: struct {
	site:                Site_Data,
	page_title:          string,
	latest_current_attr: string,
	heading:             string,
	message:             string,
	detail:              string,
}

// Renders authored text for embedding inside HTML we generate ourselves
// (prev/next links, archive year headings). Front-matter values that go
// through templates stay escaped by the {{ }} stashes instead.
escape_html :: proc(s: string, allocator := context.temp_allocator) -> string {
	out := strings.clone(s, allocator)
	out, _ = strings.replace_all(out, "&", "&amp;", allocator)
	out, _ = strings.replace_all(out, "<", "&lt;", allocator)
	out, _ = strings.replace_all(out, ">", "&gt;", allocator)
	out, _ = strings.replace_all(out, "\"", "&quot;", allocator)
	return out
}

// XML-entity escaping for rss.xml; mustache would apply HTML entities, which
// are the wrong set for XML documents.
escape_xml :: proc(s: string, allocator := context.temp_allocator) -> string {
	out := strings.clone(s, allocator)
	out, _ = strings.replace_all(out, "&", "&amp;", allocator)
	out, _ = strings.replace_all(out, "<", "&lt;", allocator)
	out, _ = strings.replace_all(out, ">", "&gt;", allocator)
	out, _ = strings.replace_all(out, "\"", "&quot;", allocator)
	out, _ = strings.replace_all(out, "'", "&apos;", allocator)
	return out
}

render_with_layout :: proc(template_path: string, data: any) -> (string, mustache.Render_Error) {
	return mustache.render_from_filename_in_layout_file(
		template_path,
		data,
		LAYOUT_TEMPLATE,
		allocator = context.temp_allocator,
	)
}

write_output_file :: proc(path: string, body: string) -> (err: Site_Error, failed: bool) {
	if werr := os.write_entire_file_from_string(path, body); werr != nil {
		return Site_Error{kind = .Write_Failure, path = path, detail = fmt.tprintf("%v", werr)}, true
	}
	return {}, false
}

post_summary_of :: proc(site: ^Site, i: int) -> Post_Summary {
	post := &site.posts[i]
	return Post_Summary{
		post_url = post.url,
		date     = format_date(post.header.date),
		title    = post.header.title,
		summary  = post.header.summary,
		tags     = post.header.tags[:],
	}
}

// Full static build: one HTML page per post, the index, the year-grouped
// archive, rss.xml, and the regenerated 404 page. Errors accumulate across
// all artifacts; a partial build is possible but always reported.
render_site :: proc(
	site: ^Site,
	out_dir: string,
	allocator: mem.Allocator,
) -> (
	errs: [dynamic]Site_Error,
) {
	errs = make([dynamic]Site_Error, 0, 8, allocator)

	os.make_directory(out_dir)
	os.make_directory(fmt.tprintf("%s/posts", out_dir))

	// Markdown -> HTML once per post; results live as long as the site.
	for i := 0; i < len(site.posts); i += 1 {
		site.posts[i].body_html = convert_mark(site.posts[i].body_md, allocator)
	}

	for i := 0; i < len(site.posts); i += 1 {
		if err, failed := render_post_page(site, i, out_dir); failed {
			append(&errs, err)
		}
	}

	summaries := make([dynamic]Post_Summary, 0, len(site.posts), context.temp_allocator)
	for i := 0; i < len(site.posts); i += 1 {
		append(&summaries, post_summary_of(site, i))
	}

	if err, failed := render_index_page(summaries[:], out_dir); failed {
		append(&errs, err)
	}
	if err, failed := render_archive_page(site, out_dir); failed {
		append(&errs, err)
	}
	if err, failed := write_rss_feed(site, out_dir); failed {
		append(&errs, err)
	}

	not_found_body := render_error_document(
		"Page Not Found",
		"Page Not Found",
		"The page you requested does not exist.",
		"",
	)
	if err, failed := write_output_file(fmt.tprintf("%s/404.html", out_dir), not_found_body); failed {
		append(&errs, err)
	}

	return errs
}

render_index_page :: proc(posts: []Post_Summary, out_dir: string) -> (err: Site_Error, failed: bool) {
	site_info := SITE_DATA

	post_rows, render_err := render_post_rows(posts)
	if render_err != nil {
		return Site_Error{kind = .Template_Error, path = "templates/post-row.html", detail = fmt.tprintf("%v", render_err)}, true
	}

	data := Index_Page_Data{
		site                = site_info,
		page_title          = fmt.tprintf("%s - %s", site_info.site_name, site_info.site_title),
		latest_current_attr = ` aria-current="page"`,
		home_heading        = "Notes from the low-level web.",
		home_intro          = "A running notebook about building a small blog engine in Odin, learning the web from raw TCP upward, and keeping the design readable enough for real study.",
		post_rows           = post_rows,
	}

	body, layout_err := render_with_layout("templates/index.html", data)
	if layout_err != nil {
		return Site_Error{kind = .Template_Error, path = "templates/index.html", detail = fmt.tprintf("%v", layout_err)}, true
	}
	return write_output_file(fmt.tprintf("%s/index.html", out_dir), body)
}

render_post_rows :: proc(posts: []Post_Summary) -> (s: string, err: mustache.Render_Error) {
	sb := strings.builder_make(context.temp_allocator)
	for post in posts {
		row, render_err := render_post_row(post)
		if render_err != nil {
			return "", render_err
		}
		fmt.sbprintf(&sb, "%s\n", row)
	}
	s = strings.to_string(sb)
	return s, nil
}

render_post_row :: proc(post: Post_Summary) -> (s: string, err: mustache.Render_Error) {
	tag_badges, render_err := render_tag_badges(post.tags)
	if render_err != nil {
		return "", render_err
	}
	data := Post_Row_Data{
		post_url   = post.post_url,
		date       = post.date,
		title      = post.title,
		summary    = post.summary,
		tag_badges = tag_badges,
	}
	s, err = mustache.render_from_filename(
		"templates/post-row.html",
		data,
		allocator = context.temp_allocator,
	)
	if err != nil {
		return "", err
	}
	return s, nil
}

render_tag_badges :: proc(tags: []string) -> (s: string, err: mustache.Render_Error) {
	sb := strings.builder_make(context.temp_allocator)
	for tag in tags {
		badge, render_err := mustache.render_from_filename(
			"templates/tag-badge.html",
			Tag_Data{tag = tag},
			allocator = context.temp_allocator,
		)
		if render_err != nil {
			return "", render_err
		}
		fmt.sbprintf(&sb, "%s\n", badge)
	}
	s = strings.to_string(sb)
	return s, nil
}

// Prev/next links are HTML we generate, so they ride through triple-stash in
// templates/post.html; authored titles inside them are escaped here.
post_nav_links :: proc(site: ^Site, index: int) -> (previous_link, next_link: string) {
	post := &site.posts[index]
	if post.prev_index >= 0 {
		prev := &site.posts[post.prev_index]
		previous_link = fmt.tprintf(
			`<a href="%s">&#8592; %s</a>`,
			prev.url,
			escape_html(prev.header.title),
		)
	}
	if post.next_index >= 0 {
		next := &site.posts[post.next_index]
		next_link = fmt.tprintf(
			`<a href="%s">%s &#8594;</a>`,
			next.url,
			escape_html(next.header.title),
		)
	}
	return previous_link, next_link
}

render_post_page :: proc(site: ^Site, index: int, out_dir: string) -> (err: Site_Error, failed: bool) {
	post := &site.posts[index]
	site_info := SITE_DATA

	// public/posts/<slug>/ is created on demand; make_directory_all reports
	// "Exist" on rebuilds, which is success for our purposes, so probe with
	// stat instead of treating every mkdir error as fatal.
	post_dir := fmt.tprintf("%s/posts/%s", out_dir, post.slug)
	if _, stat_err := os.stat(post_dir, context.temp_allocator); stat_err != nil {
		if mk_err := os.make_directory_all(post_dir); mk_err != nil {
			return Site_Error{kind = .Directory_Failure, path = post.source_path, detail = fmt.tprintf("%v", mk_err)}, true
		}
	}

	previous_link, next_link := post_nav_links(site, index)
	tag_line := strings.join(post.header.tags[:], ", ", context.temp_allocator)
	tag_path := strings.join(post.header.tags[:], " / ", context.temp_allocator)

	data := Post_Page_Data{
		site                = site_info,
		page_title          = fmt.tprintf("%s - %s", post.header.title, site_info.site_name),
		latest_current_attr = "",
		title               = post.header.title,
		date                = format_date(post.header.date),
		tags                = tag_line,
		tag_path            = tag_path,
		reading_time        = fmt.tprintf("%d min", post.reading_min),
		content_html        = post.body_html,
		previous_link       = previous_link,
		next_link           = next_link,
	}

	body, render_err := render_with_layout("templates/post.html", data)
	if render_err != nil {
		return Site_Error{kind = .Template_Error, path = post.source_path, detail = fmt.tprintf("%v", render_err)}, true
	}
	return write_output_file(
		fmt.tprintf("%s/posts/%s/index.html", out_dir, post.slug),
		body,
	)
}

// Archive rows are pre-rendered into a single HTML blob (year heading plus
// that year's post rows), matching how index rows reach their template.
render_archive_page :: proc(site: ^Site, out_dir: string) -> (err: Site_Error, failed: bool) {
	site_info := SITE_DATA

	rows, render_err := render_archive_rows(site)
	if render_err != nil {
		return Site_Error{kind = .Template_Error, path = "templates/post-row.html", detail = fmt.tprintf("%v", render_err)}, true
	}

	data := Archive_Page_Data{
		site                = site_info,
		page_title          = fmt.tprintf("%s - %s", "Archive", site_info.site_name),
		latest_current_attr = "",
		archive_rows        = rows,
	}

	body, layout_err := render_with_layout("templates/archive.html", data)
	if layout_err != nil {
		return Site_Error{kind = .Template_Error, path = "templates/archive.html", detail = fmt.tprintf("%v", layout_err)}, true
	}
	return write_output_file(fmt.tprintf("%s/archive.html", out_dir), body)
}

render_archive_rows :: proc(site: ^Site) -> (s: string, err: mustache.Render_Error) {
	sb := strings.builder_make(context.temp_allocator)
	for group in site.groups {
		fmt.sbprintf(
			&sb,
			"<h2 class=\"post-title\">%d</h2>\n<div class=\"post-list\">\n",
			group.year,
		)
		for i in group.post_indices {
			row, render_err := render_post_row(post_summary_of(site, i))
			if render_err != nil {
				return "", render_err
			}
			fmt.sbprintf(&sb, "%s\n", row)
		}
		fmt.sbprintf(&sb, "</div>\n")
	}
	s = strings.to_string(sb)
	return s, nil
}

// rss.xml is built by hand (no mustache): XML needs XML escaping, items link
// absolutely via site_url, capped at RSS_MAX_ITEMS newest posts.
write_rss_feed :: proc(site: ^Site, out_dir: string) -> (err: Site_Error, failed: bool) {
	site_info := SITE_DATA

	sb := strings.builder_make(context.temp_allocator)
	fmt.sbprintf(
		&sb,
		"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\">\n<channel>\n<title>%s</title>\n<link>%s/</link>\n<description>%s</description>\n",
		escape_xml(site_info.site_title),
		site_info.site_url,
		escape_xml(site_info.site_note),
	)

	count := len(site.posts)
	if count > RSS_MAX_ITEMS {
		count = RSS_MAX_ITEMS
	}
	for i := 0; i < count; i += 1 {
		post := &site.posts[i]
		item_url := fmt.tprintf("%s%s", site_info.site_url, post.url)
		fmt.sbprintf(
			&sb,
			"<item>\n<title>%s</title>\n<link>%s</link>\n<guid isPermaLink=\"true\">%s</guid>\n<pubDate>%02d %s %04d 00:00:00 GMT</pubDate>\n<description>%s</description>\n</item>\n",
			escape_xml(post.header.title),
			item_url,
			item_url,
			post.header.date.day,
			MONTH_ABBREV[post.header.date.month-1],
			post.header.date.year,
			escape_xml(post.header.summary),
		)
	}
	fmt.sbprintf(&sb, "</channel>\n</rss>\n")

	return write_output_file(fmt.tprintf("%s/rss.xml", out_dir), strings.to_string(sb))
}

render_error_document :: proc(
	page_title: string,
	heading: string,
	message: string,
	detail: string,
) -> string {
	site_info := SITE_DATA
	data := Error_Page_Data{
		site                = site_info,
		page_title          = fmt.tprintf("%s - %s", page_title, site_info.site_name),
		latest_current_attr = "",
		heading             = heading,
		message             = message,
		detail              = detail,
	}

	body, render_err := render_with_layout("templates/error.html", data)
	if render_err == nil {
		return body
	}

	return fmt.tprintf(
		"<!doctype html><html><head><title>%s</title></head><body><h1>%s</h1><p>%s</p><pre>%s</pre></body></html>",
		page_title,
		heading,
		message,
		detail,
	)
}
