import type { SiteConfig } from "./src/site.ts";

/** Site identity. `tagline` accepts inline Markdown; `*emphasis*` renders in the accent color. */
export default {
  title: "Anh Nguyen",
  tagline: "Notes from Odin and *systems work*",
  description: "Short notes from building tools, servers, runtimes, and experiments in Odin.",
  author: "Anh Nguyen",
  language: "en",
  // Overridden by the SITE_URL environment variable at build time.
  url: "http://127.0.0.1:8000",
  postsOnHome: 10,
} satisfies SiteConfig;
