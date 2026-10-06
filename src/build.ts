import { type Issue, loadPosts } from "./content.ts";
import { renderSite } from "./pages.ts";
import type { Site } from "./site.ts";

export interface BuildOptions {
  contentDir: string;
  assetsDir: string;
  outDir: string;
  site: Site;
  /** Include posts marked `draft: true`. */
  drafts: boolean;
  /** Development build: adds the live-reload client. */
  dev: boolean;
  year?: number;
}

export type BuildResult =
  | { ok: true; posts: number; files: number }
  | { ok: false; issues: Issue[] };

/** Validate content and regenerate `outDir` from scratch. Nothing is written when content has issues. */
export async function build(options: BuildOptions): Promise<BuildResult> {
  assertSafeOutDir(options);
  const { posts, issues } = await loadPosts(options.contentDir);
  if (issues.length > 0) return { ok: false, issues };

  const published = options.drafts ? posts : posts.filter((post) => !post.draft);
  const assets = await readTree(options.assetsDir);
  const pages = renderSite(published, {
    site: options.site,
    assetVersion: await fingerprint(assets),
    dev: options.dev,
    year: options.year ?? new Date().getFullYear(),
  });

  await Deno.remove(options.outDir, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  for (const [path, text] of pages) {
    await writeFile(`${options.outDir}/${path}`, new TextEncoder().encode(text));
  }
  for (const [path, bytes] of assets) await writeFile(`${options.outDir}/assets/${path}`, bytes);
  return { ok: true, posts: published.length, files: pages.size + assets.size };
}

/** `outDir` is deleted on every build, so refuse anything that could be the project or a source dir. */
function assertSafeOutDir({ outDir, contentDir, assetsDir }: BuildOptions): void {
  const norm = (p: string) => p.replace(/\/+$/, "").replace(/^\.\//, "");
  const out = norm(outDir);
  if (
    out === "" || out === "." || out.split("/").includes("..") || out === norm(contentDir) ||
    out === norm(assetsDir)
  ) {
    throw new Error(`refusing to use ${JSON.stringify(outDir)} as the output directory`);
  }
}

/** Read every file under `dir`, keyed by `/`-separated relative path. A missing dir is empty. */
async function readTree(dir: string, prefix = ""): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(`${dir}/${prefix}`));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return files;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory) { for (const [k, v] of await readTree(dir, `${path}/`)) files.set(k, v); }
    else if (entry.isFile) files.set(path, await Deno.readFile(`${dir}/${path}`));
  }
  return files;
}

async function fingerprint(files: Map<string, Uint8Array>): Promise<string> {
  const parts: Uint8Array[] = [];
  for (const [path, bytes] of files) parts.push(new TextEncoder().encode(path), bytes);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return [...digest.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeFile(path, bytes);
}
