package main

import "core:fmt"
import "core:os"
import "core:strings"
import "core:testing"

// Writes a tiny fixture post.
write_fixture_post :: proc(dir: string, stem, title, date: string, tags := "odin") {
	path := fmt.tprintf("%s/%s.md", dir, stem)
	body := fmt.tprintf(
		"---\ntitle: %s\ndate: %s\ntags: %s\nsummary: Summary of %s\n---\n\nSome words for %s.\n",
		title,
		date,
		tags,
		stem,
		stem,
	)
	_ = os.write_entire_file_from_string(path, body)
}

// Order-independent check that at least one error carries the given kind.
has_kind :: proc(errs: [dynamic]Site_Error, want: Site_Error_Kind) -> bool {
	for e in errs do if e.kind == want do return true
	return false
}

// Unique per test: the suite may run tests in parallel threads, and a
// PID-only name would make sibling tests delete each other's fixtures.
make_fixture_dir :: proc(t: ^testing.T, tag: string) -> string {
	tmp_root, tmp_err := os.temp_directory(context.temp_allocator)
	testing.expect_value(t, tmp_err, nil)
	dir := fmt.tprintf("%s/my-blog-site-test-%s-%d", tmp_root, tag, os.get_pid())
	os.remove_all(dir)
	os.make_directory_all(dir)
	return dir
}

@(test)
test_load_site_sorting_and_indexes :: proc(t: ^testing.T) {
	defer free_all(context.temp_allocator)

	dir := make_fixture_dir(t, "sorting")
	defer os.remove_all(dir)

	write_fixture_post(dir, "alpha", "Alpha", "2026-01-02")
	write_fixture_post(dir, "beta", "Beta", "2026-03-04")
	write_fixture_post(dir, "gamma", "Gamma", "2026-03-04") // same date as beta
	// A draft must be excluded from the site entirely.
	_ = os.write_entire_file_from_string(
		fmt.tprintf("%s/draft-post.md", dir),
		"---\ntitle: Hidden\ndate: 2026-05-06\nsummary: s\ndraft: true\n---\n\nx\n",
	)

	site, errs := load_site(dir, context.temp_allocator)
	testing.expect_value(t, len(errs), 0)

	testing.expect_value(t, len(site.posts), 3)
	// Newest first; equal dates break by ascending slug (DESIGN.md §2),
	// so beta sorts ahead of gamma on their shared date.
	testing.expect_value(t, site.posts[0].slug, "beta")
	testing.expect_value(t, site.posts[1].slug, "gamma")
	testing.expect_value(t, site.posts[2].slug, "alpha")

	testing.expect_value(t, site.posts[0].next_index, -1) // nothing newer than first
	testing.expect_value(t, site.posts[0].prev_index, 1)
	testing.expect_value(t, site.posts[2].prev_index, -1) // nothing older than last
	testing.expect_value(t, site.posts[2].next_index, 1)

	testing.expect_value(t, site.posts[0].url, "/posts/beta/")
	testing.expect(t, site.posts[0].reading_min >= 1)

	tag_count, found := site.tag_index["odin"]
	testing.expect_value(t, found, true)
	testing.expect_value(t, len(tag_count), 3)

	testing.expect_value(t, len(site.groups), 1) // every fixture post is dated 2026
}

@(test)
test_load_site_reports_all_errors :: proc(t: ^testing.T) {
	defer free_all(context.temp_allocator)

	dir := make_fixture_dir(t, "errs")
	defer os.remove_all(dir)

	// Bad slug filename + missing summary in a valid-named file.
	bad_name := fmt.tprintf("%s/Bad Slug.md", dir)
	_ = os.write_entire_file_from_string(bad_name, "---\ntitle: X\ndate: 2026-01-01\nsummary: s\n---\n\nx\n")
	bad_fields := fmt.tprintf("%s/ok-name.md", dir)
	_ = os.write_entire_file_from_string(bad_fields, "---\ntitle: Y\n---\n\nx\n")

	_, errs := load_site(dir, context.temp_allocator)
	testing.expect_value(t, len(errs), 3) // bad slug + missing date + missing summary
	testing.expect(t, has_kind(errs, .Bad_Slug))
	testing.expect(t, has_kind(errs, .Missing_Date))
	testing.expect(t, has_kind(errs, .Missing_Summary))
}

@(test)
test_build_end_to_end :: proc(t: ^testing.T) {
	defer free_all(context.temp_allocator)

	site, errs := load_site(CONTENT_PATH, context.temp_allocator)
	testing.expect_value(t, len(errs), 0)
	testing.expect(t, len(site.posts) >= 1)

	tmp_root, tmp_err := os.temp_directory(context.temp_allocator)
	testing.expect_value(t, tmp_err, nil)
	out := fmt.tprintf("%s/my-blog-e2e-%d", tmp_root, os.get_pid())
	os.remove_all(out)
	defer os.remove_all(out)

	render_errs := render_site(&site, out, context.temp_allocator)
	testing.expect_value(t, len(render_errs), 0)

	slug := site.posts[0].slug
	post_path := fmt.tprintf("%s/posts/%s/index.html", out, slug)
	_, stat_err := os.stat(post_path, context.temp_allocator)
	testing.expect_value(t, stat_err, nil)

	index_bytes, index_err := os.read_entire_file_from_path(fmt.tprintf("%s/index.html", out), context.temp_allocator)
	testing.expect_value(t, index_err, nil)
	testing.expect(t, strings.contains(string(index_bytes), slug))
	testing.expect(t, !strings.contains(string(index_bytes), "<h2>")) // rows escaped via {{ }}

	artifacts := []string{"archive.html", "rss.xml", "404.html"}
	for artifact in artifacts {
		_, read_err := os.read_entire_file_from_path(fmt.tprintf("%s/%s", out, artifact), context.temp_allocator)
		testing.expect_value(t, read_err, nil)
	}

	rss_bytes, _ := os.read_entire_file_from_path(fmt.tprintf("%s/rss.xml", out), context.temp_allocator)
	rss := string(rss_bytes)
	testing.expect(t, strings.contains(rss, "<rss version=\"2.0\">"))
	testing.expect(t, strings.contains(rss, fmt.tprintf("/posts/%s/", slug)))

	archive_bytes, _ := os.read_entire_file_from_path(fmt.tprintf("%s/archive.html", out), context.temp_allocator)
	testing.expect(t, strings.contains(string(archive_bytes), "post-list"))

	post_bytes, _ := os.read_entire_file_from_path(post_path, context.temp_allocator)
	post_html := string(post_bytes)
	testing.expect(t, strings.contains(post_html, "<article"))
	testing.expect(t, strings.contains(post_html, "min</p>")) // reading time rendered
}
