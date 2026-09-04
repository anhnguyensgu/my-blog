import { join } from "@std/path";
import { loadPosts, SLUG_PATTERN, type ValidationIssue } from "./content.ts";
import { buildSite, DEFAULT_SITE, resolveSiteConfig } from "./render.ts";

export interface BuildOptions {
  contentDir: string;
  templateDir: string;
  outputDir: string;
}

function reportIssues(issues: ValidationIssue[]): void {
  for (const problem of issues) {
    const location = problem.line === undefined ? problem.path : `${problem.path}:${problem.line}`;
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

export function todayString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function createPost(contentDir: string, title: string): Promise<string> {
  const slug = slugFromTitle(title);
  if (!SLUG_PATTERN.test(slug)) throw new Error(`could not derive a valid slug from '${title}'`);

  await Deno.mkdir(contentDir, { recursive: true });
  const filename = join(contentDir, `${slug}.md`);
  const body =
    `---\ntitle: ${title}\ndate: ${todayString()}\ntags:\nsummary:\ndraft: true\n---\n\nStart writing.\n`;
  await Deno.writeTextFile(filename, body, { createNew: true });
  return filename;
}

const COMMANDS = {
  build: {
    usage: "",
    description: "validate content and regenerate public/",
    run: async (commandArgs: string[], options: BuildOptions): Promise<number> => {
      if (commandArgs.length > 0) return 2;
      let site = DEFAULT_SITE;
      try {
        site = resolveSiteConfig(Deno.env.get("SITE_URL"));
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
      }
      const result = await buildSite(options, site);
      if (!result.ok) {
        reportIssues(result.issues);
        return 1;
      }
      console.log(`built ${result.postCount} post(s) into ${options.outputDir}`);
      return 0;
    },
  },
  validate: {
    usage: "",
    description: "validate content without writing files",
    run: async (commandArgs: string[], options: BuildOptions): Promise<number> => {
      if (commandArgs.length > 0) return 2;
      const result = await loadPosts(options.contentDir);
      if (result.issues.length > 0) {
        reportIssues(result.issues);
        return 1;
      }
      console.log(`content OK (${result.posts.length} published post(s))`);
      return 0;
    },
  },
  new: {
    usage: "<title>",
    description: "create a draft in content/",
    run: async (commandArgs: string[], options: BuildOptions): Promise<number> => {
      const title = commandArgs.join(" ").trim();
      if (!title) return 2;
      const filename = await createPost(options.contentDir, title);
      console.log(`created ${filename}`);
      return 0;
    },
  },
} as const;

function printUsage(): void {
  console.error("usage: my-blog <command>\n\ncommands:");
  for (const [name, definition] of Object.entries(COMMANDS)) {
    const invocation = [name, definition.usage].join(" ").trimEnd();
    console.error(`  ${invocation.padEnd(20)} ${definition.description}`);
  }
}

export function defaultOptions(): BuildOptions {
  const root = Deno.cwd();
  return {
    contentDir: join(root, "content"),
    templateDir: join(root, "templates"),
    outputDir: join(root, "public"),
  };
}

export async function runCli(args: string[], options: BuildOptions = defaultOptions()): Promise<number> {
  const [command, ...commandArgs] = args;
  const definition = command !== undefined && Object.hasOwn(COMMANDS, command)
    ? COMMANDS[command as keyof typeof COMMANDS]
    : undefined;
  if (!definition) {
    printUsage();
    return 2;
  }
  const exitCode = await definition.run(commandArgs, options);
  if (exitCode === 2) printUsage();
  return exitCode;
}
