import { printUsage, runCli } from "./blog.ts";

try {
  const exitCode = await runCli(Deno.args);
  if (exitCode === 2) printUsage();
  Deno.exitCode = exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  Deno.exitCode = 1;
}
