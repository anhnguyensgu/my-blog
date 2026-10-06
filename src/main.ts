import config from "../site.config.ts";
import { run } from "./cli.ts";

Deno.exit(await run(Deno.args, config));
