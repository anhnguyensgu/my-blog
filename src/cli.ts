import { build, type BuildResult } from "./build.ts";
import { formatIssue, loadPosts } from "./content.ts";
import { slugify } from "./markdown/mod.ts";
import { serve } from "./serve.ts";
import { resolveSite, type SiteConfig } from "./site.ts";

const CONTENT_DIR = "content";
const ASSETS_DIR = "assets";
const OUT_DIR = "dist";

const USAGE = `Usage:
  deno task dev [--port 8000]        Build with drafts, serve, and rebuild on change
  deno task build [--drafts]         Build the site into ${OUT_DIR}/ (set SITE_URL for the public URL)
  deno task validate                 Check every post without writing anything
  deno task new "Post title"         Create content/<slug>.md as a draft`;

/** Run a CLI command and return the process exit code. */
export async function run(args: string[], config: SiteConfig): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "build":
      return await buildCommand(rest, config);
    case "dev":
      return await devCommand(rest, config);
    case "validate":
      return await validateCommand();
    case "new":
      return await newCommand(rest);
    default:
      console.error(USAGE);
      return command === undefined || command === "help" || command === "--help" ? 0 : 2;
  }
}

async function buildCommand(args: string[], config: SiteConfig): Promise<number> {
  const unknown = args.filter((arg) => arg !== "--drafts");
  if (unknown.length > 0) return usageError(`unknown argument ${unknown[0]}`);
  const site = resolveSite(config, Deno.env.get("SITE_URL"));
  const result = await build({
    contentDir: CONTENT_DIR,
    assetsDir: ASSETS_DIR,
    outDir: OUT_DIR,
    site,
    drafts: args.includes("--drafts"),
    dev: false,
  });
  return report(result, `for ${site.baseUrl}/`);
}

async function devCommand(args: string[], config: SiteConfig): Promise<number> {
  let port = Number(Deno.env.get("PORT") ?? 8000);
  for (let k = 0; k < args.length; k++) {
    if (args[k] === "--port") port = Number(args[++k]);
    else return usageError(`unknown argument ${args[k]}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return usageError("--port must be 1-65535");

  const site = resolveSite(config, `http://127.0.0.1:${port}`);
  const rebuild = async () =>
    report(
      await build({
        contentDir: CONTENT_DIR,
        assetsDir: ASSETS_DIR,
        outDir: OUT_DIR,
        site,
        drafts: true,
        dev: true,
      }),
      "(drafts included)",
    ) === 0;
  await rebuild();
  await serve({ port, root: OUT_DIR, watch: [CONTENT_DIR, ASSETS_DIR], rebuild });
  return 0;
}

async function validateCommand(): Promise<number> {
  const { posts, issues } = await loadPosts(CONTENT_DIR);
  if (issues.length > 0) {
    for (const issue of issues) console.error(formatIssue(issue));
    console.error(`${issues.length} problem(s) found.`);
    return 1;
  }
  const drafts = posts.filter((post) => post.draft).length;
  console.log(`${posts.length} post(s) OK (${drafts} draft).`);
  return 0;
}

async function newCommand(args: string[]): Promise<number> {
  const title = args.join(" ").trim();
  if (!title) return usageError(`missing post title`);
  const slug = slugify(title).replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return usageError(`cannot derive a file name from ${JSON.stringify(title)}`);

  const path = `${CONTENT_DIR}/${slug}.md`;
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0"))
    .join("-");
  const source =
    `---\ntitle: ${title}\ndate: ${date}\ntags:\nsummary:\ndraft: true\n---\n\nStart writing here.\n`;
  try {
    await Deno.mkdir(CONTENT_DIR, { recursive: true });
    await Deno.writeTextFile(path, source, { createNew: true });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      console.error(`${path} already exists.`);
      return 1;
    }
    throw error;
  }
  console.log(`Created ${path}. Set draft: false and add a summary to publish it.`);
  return 0;
}

function report(result: BuildResult, note: string): number {
  if (!result.ok) {
    for (const issue of result.issues) console.error(formatIssue(issue));
    console.error(`Build failed: ${result.issues.length} problem(s). Nothing was written.`);
    return 1;
  }
  console.log(`Built ${result.posts} post(s), ${result.files} file(s) into ${OUT_DIR}/ ${note}`);
  return 0;
}

function usageError(message: string): number {
  console.error(`error: ${message}\n\n${USAGE}`);
  return 2;
}
