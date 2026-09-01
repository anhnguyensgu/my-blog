import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { SLUG_PATTERN, loadPosts, type ValidationIssue } from "./content.js";
import { buildSite } from "./render.js";

export interface BuildOptions {
  contentDir: string;
  templateDir: string;
  outputDir: string;
}

function reportIssues(issues: ValidationIssue[]): void {
  for (const problem of issues) {
    const location = problem.line > 0 ? `${problem.path}:${problem.line}` : problem.path;
    console.error(`${location}: ${problem.message}`);
  }
  console.error(`${issues.length} error(s)`);
}

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function createPost(contentDir: string, title: string): Promise<void> {
  const slug = slugFromTitle(title);
  if (!SLUG_PATTERN.test(slug)) throw new Error(`could not derive a valid slug from '${title}'`);

  await mkdir(contentDir, { recursive: true });
  const filename = path.join(contentDir, `${slug}.md`);
  const today = new Date().toISOString().slice(0, 10);
  const body = `---\ntitle: ${title}\ndate: ${today}\ntags:\nsummary:\ndraft: true\n---\n\nStart writing.\n`;
  await writeFile(filename, body, { flag: "wx" });
  console.log(`created ${filename}`);
}

export const COMMANDS = [
  { name: "build", arguments: "", description: "validate content and regenerate public/" },
  { name: "validate", arguments: "", description: "validate content without writing files" },
  { name: "new", arguments: "<title>", description: "create a draft in content/" },
] as const;

function printUsage(): void {
  console.error("usage: my-blog <command>\n\ncommands:");
  for (const command of COMMANDS) {
    console.error(`  ${`${command.name} ${command.arguments}`.trimEnd().padEnd(20)} ${command.description}`);
  }
}

export async function runCli(args: string[]): Promise<number> {
  const root = process.cwd();
  const options: BuildOptions = {
    contentDir: path.join(root, "content"),
    templateDir: path.join(root, "templates"),
    outputDir: path.join(root, "public"),
  };
  const [command, ...commandArgs] = args;

  switch (command) {
    case "build": {
      if (commandArgs.length > 0) break;
      const result = await buildSite(options);
      if (result.issues.length > 0) {
        reportIssues(result.issues);
        return 1;
      }
      console.log(`built ${result.postCount} post(s) into ${options.outputDir}`);
      return 0;
    }
    case "validate": {
      if (commandArgs.length > 0) break;
      const result = await loadPosts(options.contentDir);
      if (result.issues.length > 0) {
        reportIssues(result.issues);
        return 1;
      }
      console.log(`content OK (${result.posts.length} published post(s))`);
      return 0;
    }
    case "new": {
      const title = commandArgs.join(" ").trim();
      if (!title) break;
      await createPost(options.contentDir, title);
      return 0;
    }
  }

  printUsage();
  return 2;
}
