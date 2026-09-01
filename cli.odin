package main

import "core:fmt"
import "core:log"
import "core:os"
import "core:strings"
import "core:time"

CONTENT_PATH :: "content"
PUBLIC_PATH :: "public"

// All handlers share one signature so they can sit behind a single dispatch
// table. Odin proc groups resolve per call site and cannot be stored in a
// struct field, so "overloading" is not an option here — commands that take
// no arguments simply ignore theirs.
Command_Handler :: proc(args: []string) -> int

Command :: struct {
	name:        string,
	args_hint:   string,
	description: string,
	run:         Command_Handler,
}

// Adding a command = adding one row; dispatch and usage follow automatically.
commands := [?]Command{
	{name = "new",      args_hint = "<title-or-slug>", description = "create a draft markdown file in content/",       run = cmd_new},
	{name = "build",    args_hint = "",                description = "parse content/ and regenerate public/",          run = cmd_build},
	{name = "validate", args_hint = "",                description = "parse and check content/ without writing output", run = cmd_validate},
}

// Subcommand dispatch. Returns the process exit code:
// 0 success, 1 build/validation failure, 2 usage error.
run_cli :: proc(args: []string) -> int {
	if len(args) < 2 {
		print_usage()
		return 2
	}

	for cmd in commands {
		if cmd.name == args[1] {
			return cmd.run(args[2:])
		}
	}

	fmt.eprintf("unknown command '%s'\n", args[1])
	print_usage()
	return 2
}

print_usage :: proc() {
	fmt.eprint("usage: my-blog <command>\n\ncommands:\n")
	for cmd in commands {
		hint := cmd.name
		if cmd.args_hint != "" {
			hint = fmt.tprintf("%s %s", cmd.name, cmd.args_hint)
		}
		fmt.eprintf("  %-20s %s\n", hint, cmd.description)
	}
}

cmd_build :: proc(args: []string) -> int {
	site, errs := load_site(CONTENT_PATH, context.allocator)
	if len(errs) > 0 {
		report_site_errors(errs)
		return 1
	}
	if render_errs := render_site(&site, PUBLIC_PATH, context.allocator); len(render_errs) > 0 {
		report_site_errors(render_errs)
		return 1
	}
	log.infof("built %d posts into %s", len(site.posts), PUBLIC_PATH)
	return 0
}

cmd_validate :: proc(args: []string) -> int {
	_, errs := load_site(CONTENT_PATH, context.allocator)
	if len(errs) > 0 {
		report_site_errors(errs)
		return 1
	}
	log.infof("content OK")
	return 0
}

report_site_errors :: proc(errs: [dynamic]Site_Error) {
	for e in errs {
		fmt.eprintf("%s: %s\n", e.path, site_error_message(e))
	}
	fmt.eprintf("%d error(s)\n", len(errs))
}

// Creates content/<slug>.md from a title or slug. The skeleton starts as a
// draft so an unfinished post never breaks `build`.
cmd_new :: proc(args: []string) -> int {
	if len(args) < 1 || args[0] == "" {
		fmt.eprint("usage: my-blog new <title-or-slug>\n")
		return 2
	}
	name := args[0]

	slug := slug_from_title(name)
	if !valid_slug(slug) {
		fmt.eprintf("could not derive a valid slug from '%s'\n", name)
		return 2
	}

	path := fmt.tprintf("%s/%s.md", CONTENT_PATH, slug)
	if _, stat_err := os.stat(path, context.temp_allocator); stat_err == nil {
		fmt.eprintf("%s already exists\n", path)
		return 1
	}

	skeleton := fmt.tprintf(
		"---\ntitle: %s\ndate: %s\ndraft: true\ntags:\nsummary:\n---\n\nStart writing.\n",
		name,
		today_string(),
	)
	if err := os.write_entire_file_from_string(path, skeleton); err != nil {
		fmt.eprintf("could not write %s: %v\n", path, err)
		return 1
	}
	log.infof("created %s", path)
	return 0
}

// Lowercase ASCII alphanumerics kept; every other rune becomes a single dash.
// Leading/trailing/repeated dashes are trimmed.
slug_from_title :: proc(title: string, allocator := context.temp_allocator) -> string {
	sb := strings.builder_make(allocator)
	last_was_dash := true // suppresses leading dashes
	for r in title {
		switch {
		case 'A' <= r && r <= 'Z':
			fmt.sbprintf(&sb, "%c", r + ('a' - 'A'))
			last_was_dash = false
		case ('a' <= r && r <= 'z') || ('0' <= r && r <= '9'):
			fmt.sbprintf(&sb, "%c", r)
			last_was_dash = false
		case:
			if !last_was_dash {
				fmt.sbprintf(&sb, "%c", '-')
				last_was_dash = true
			}
		}
	}
	return strings.trim(strings.to_string(sb), "-")
}

today_string :: proc() -> string {
	now_dt, _ := time.time_to_datetime(time.now())
	return fmt.tprintf(
		"%04d-%02d-%02d",
		now_dt.date.year,
		now_dt.date.month,
		now_dt.date.day,
	)
}
