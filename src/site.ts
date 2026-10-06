export interface SiteConfig {
  title: string;
  /** Home page headline; inline Markdown. */
  tagline: string;
  description: string;
  author: string;
  language: string;
  /** Absolute public URL, optionally with a path prefix (e.g. https://user.github.io/blog). */
  url: string;
  postsOnHome: number;
}

/** A config with its URL resolved into the pieces templates need. */
export interface Site extends SiteConfig {
  /** Absolute URL without a trailing slash, e.g. `https://example.com/blog`. */
  baseUrl: string;
  /** Path prefix for internal links: `""` or e.g. `/blog`. */
  basePath: string;
}

/**
 * Resolve the public URL from `override` (usually `SITE_URL`) or the config.
 * @throws {Error} when the URL is not an absolute http(s) URL without query or fragment.
 */
export function resolveSite(config: SiteConfig, override?: string): Site {
  const raw = override?.trim() || config.url;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid site URL ${JSON.stringify(raw)}: expected an absolute http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`invalid site URL ${JSON.stringify(raw)}: expected an http or https URL`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error(
      `invalid site URL ${JSON.stringify(raw)}: must not contain credentials, query, or fragment`,
    );
  }
  const basePath = url.pathname.replace(/\/+$/, "");
  return { ...config, url: raw, baseUrl: url.origin + basePath, basePath };
}
