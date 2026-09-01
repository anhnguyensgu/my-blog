import { runCli } from "./blog.js";

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
