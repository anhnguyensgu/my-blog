// Local preview server: rebuilds on changes in the watched directories and
// tells open pages to reload over server-sent events. Not for production.

export interface ServeOptions {
  port: number;
  root: string;
  watch: string[];
  /** Rebuild `root`; returns false when the build failed (the old output keeps being served). */
  rebuild: () => Promise<boolean>;
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};

export async function serve(options: ServeOptions): Promise<void> {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();

  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: options.port,
    onListen: ({ port }) => console.log(`Serving ${options.root}/ at http://127.0.0.1:${port}/`),
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/__livereload") {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          clients.add(c);
          c.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          clients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }
    return await serveFile(options.root, url.pathname);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = Deno.watchFs(options.watch);
  for await (const _event of watcher) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const started = performance.now();
      if (!(await options.rebuild())) return;
      console.log(`Rebuilt in ${Math.round(performance.now() - started)} ms`);
      for (const client of clients) {
        try {
          client.enqueue(encoder.encode("data: reload\n\n"));
        } catch {
          clients.delete(client);
        }
      }
    }, 80);
  }
  await server.finished;
}

async function serveFile(root: string, pathname: string): Promise<Response> {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (path.split("/").includes("..")) return new Response("Bad request", { status: 400 });

  const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}/index.html`];
  for (const candidate of candidates) {
    try {
      const body = await Deno.readFile(`${root}${candidate}`);
      return new Response(body, {
        headers: { "content-type": contentType(candidate), "cache-control": "no-store" },
      });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound || error instanceof Deno.errors.IsADirectory)) throw error;
    }
  }
  const notFound = await Deno.readFile(`${root}/404.html`).catch(() => new TextEncoder().encode("Not found"));
  return new Response(notFound, { status: 404, headers: { "content-type": CONTENT_TYPES.html! } });
}

function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
