import { runCli } from "./blog.ts";

try {
  Deno.exitCode = await runCli(Deno.args);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  Deno.exitCode = 1;
}
