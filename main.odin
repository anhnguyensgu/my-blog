package main

import "core:log"
import "core:os"

main :: proc() {
	context.logger = log.create_console_logger(lowest = .Debug)
	code := run_cli(os.args)
	log.destroy_console_logger(context.logger)
	os.exit(code)
}
