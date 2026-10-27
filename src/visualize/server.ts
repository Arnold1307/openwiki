import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { buildGraph, type WikiGraph } from "./graph.js";
import { CSP, OFFLINE_CSP, PAGE, renderPage } from "./page.js";
import { loadVisualizerAssets } from "./static-export.js";

const HOST = "127.0.0.1"; // loopback only (never expose the wiki on the network)
const PORT_ATTEMPTS = 20; // ports to try before giving up when the preferred one is busy
const WATCH_DEBOUNCE_MS = 150; // collapse a burst of file-change events into one rebuild

// The client JS is an external module (/client.js), so scripts need only 'self' plus the
// jsdelivr CDN origin for the three browser libraries (whose integrity is pinned by the SRI
// hashes on the <script> tags in page.ts) - no 'unsafe-inline' for scripts. The stylesheet is
// a same-origin asset (/styles.css), which 'self' covers; style-src still keeps 'unsafe-inline'
// because client.ts writes inline style= attributes for legend swatches and sidebar dots.

/**
 * Inputs for a single visualizer server run. Every field is required: the CLI parser
 * fills the defaults, so the server itself never has to guess.
 */
export interface VisualizeServerOptions {
  /**
   * Resolved absolute path to the wiki directory to serve.
   */
  wikiRoot: string;

  /**
   * Preferred TCP port; the server increments from here when it is already in use.
   */
  port: number;

  /**
   * Whether to open the default browser once the server is listening.
   */
  open: boolean;

  /**
   * Whether to serve locally bundled vendor scripts instead of loading from external CDNs.
   */
  noCdn?: boolean;

  /**
   * User interface language code, e.g. "en" or "de".
   */
  lang?: string;
}

/*
 * Coverage: the server-lifecycle code below (boot, listen/retry, fs watch,
 * browser launch, banner) needs a live HTTP server, a real filesystem, and a
 * SIGINT to exercise - none reachable from a unit test. Its one piece of pure
 * request logic is extracted into `createRequestHandler` (fully covered), so we
 * exclude the lifecycle glue rather than count it as permanently uncovered.
 */
/* v8 ignore start */
/**
 * Start the visualizer server. Resolves when the server is stopped (SIGINT);
 * exits the process on an unrecoverable listen error, matching the prototype.
 */
export async function runVisualizeServer(
  options: VisualizeServerOptions,
): Promise<void> {
  const { wikiRoot } = options;
  await assertWikiDir(wikiRoot);

  let graph: WikiGraph = {
    root: "",
    generatedAt: "",
    types: [],
    nodes: [],
    edges: [],
  };
  const sseClients = new Set<ServerResponse>();

  // The compiled client modules and the stylesheet sit beside this file in dist/visualize//.
  // They are static, server-owned build artifacts (no user input, never evaluated), read once
  // at startup and served verbatim at fixed routes.
  const { clientJs, clientLibJs, stylesCss, vendorAssets } =
    await loadVisualizerAssets(Boolean(options.noCdn));

  const pageHtml =
    options.noCdn || options.lang
      ? renderPage({
          staticExport: false,
          noCdn: Boolean(options.noCdn),
          lang: options.lang,
        })
      : PAGE;

  const serverCsp = options.noCdn ? OFFLINE_CSP : CSP;

  const broadcastReload = (): void => {
    for (const res of sseClients) res.write("event: reload\ndata: 1\n\n");
  };
  const rebuild = async (reason: string): Promise<void> => {
    try {
      graph = await buildGraph(wikiRoot);
      process.stdout.write(
        `  \u21bb ${reason}: ${graph.nodes.length} pages, ${graph.edges.length} links\n`,
      );
      broadcastReload();
    } catch (error) {
      process.stderr.write(`  ! rebuild failed: ${(error as Error).message}\n`);
    }
  };

  const server = createServer(
    createRequestHandler({
      // The graph is rebuilt (reassigned) on every file change, so read it live
      // per request rather than capturing a stale snapshot.
      getGraph: () => graph,
      clientJs,
      clientLibJs,
      stylesCss,
      sseClients,
      pageHtml,
      csp: serverCsp,
      vendorAssets,
    }),
  );

  return new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      process.stdout.write("\n  stopped.\n");
      server.close(() => resolve());
    });
    listen(server, options.port, PORT_ATTEMPTS, (boundPort) => {
      const url = `http://${HOST}:${boundPort}`;
      void rebuild("initial scan").then(() => {
        startWatch(wikiRoot, rebuild);
        printBanner(wikiRoot, url);
        if (options.open) openBrowser(url);
      });
    });
  });
}
/* v8 ignore stop */

/**
 * Dependencies for the visualizer HTTP request handler. The handler is a pure
 * router over a fixed set of routes; everything it needs is passed in so it can
 * be exercised without booting a real server.
 */
export interface RequestHandlerDeps {
  /**
   * Read the current wiki graph. A getter (not the graph itself) because the
   * server reassigns the graph on every rebuild, and each request must serve the
   * latest one.
   */
  getGraph: () => WikiGraph;

  /**
   * Compiled browser client module, served verbatim at `/client.js`.
   */
  clientJs: string;

  /**
   * Compiled browser client library module, served verbatim at `/client-lib.js`.
   */
  clientLibJs: string;

  /**
   * Visualizer stylesheet, served verbatim at `/styles.css`.
   */
  stylesCss: string;

  /**
   * Live set of open Server-Sent-Events responses; the handler registers new
   * `/events` subscribers here and drops them when the connection closes.
   */
  sseClients: Set<ServerResponse>;

  /**
   * Rendered HTML for the visualizer index page.
   */
  pageHtml?: string;

  /**
   * Content Security Policy header value.
   */
  csp?: string;

  /**
   * Optional map of filename -> content for `/vendor/*` scripts.
   */
  vendorAssets?: Record<string, string>;
}

/**
 * Build the visualizer HTTP request handler. Routing is locked to a fixed set of
 * routes (`/`, `/index.html`, `/client.js`, `/client-lib.js`, `/styles.css`,
 * `/api/graph`, `/events`, `/vendor/*`); no filesystem path is ever derived from `req.url`, and
 * `/` carries the strict Content-Security-Policy. Any other path is a 404.
 */
export function createRequestHandler(
  deps: RequestHandlerDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  const {
    getGraph,
    clientJs,
    clientLibJs,
    stylesCss,
    sseClients,
    pageHtml = PAGE,
    csp = CSP,
    vendorAssets = {},
  } = deps;

  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": csp,
      });
      res.end(pageHtml);
      return;
    }
    if (url === "/client.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(clientJs);
      return;
    }
    if (url === "/client-lib.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(clientLibJs);
      return;
    }
    if (url === "/styles.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end(stylesCss);
      return;
    }
    if (url.startsWith("/vendor/")) {
      const name = url.slice("/vendor/".length);
      const asset = vendorAssets[name];
      if (asset !== undefined) {
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
        });
        res.end(asset);
        return;
      }
    }
    if (url === "/api/graph") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(getGraph()));
      return;
    }
    if (url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    // Only these fixed routes exist; no filesystem path is ever derived from req.url.
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  };
}

/* v8 ignore start */
/**
 * Fail early with a friendly message when the wiki directory is missing.
 */
async function assertWikiDir(wikiRoot: string): Promise<void> {
  try {
    const s = await stat(wikiRoot);
    if (!s.isDirectory()) {
      throw new Error(`expected a directory: ${wikiRoot}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`wiki directory not found: ${wikiRoot}`);
    }
    throw error;
  }
}

/**
 * Watch `wikiRoot` recursively, debouncing bursts of filesystem events so an
 * agent or editor writing three files in a millisecond triggers one rebuild.
 */
function startWatch(
  wikiRoot: string,
  onChange: (reason: string) => Promise<void>,
): void {
  let timer: NodeJS.Timeout | null = null;
  try {
    watch(wikiRoot, { recursive: true }, (_event, filename) => {
      // Ignore hidden files and tmp writes
      if (filename && (filename.startsWith(".") || filename.endsWith("~"))) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void onChange(filename ? `changed: ${filename}` : "file changed");
      }, WATCH_DEBOUNCE_MS);
    });
  } catch {
    // Non-fatal: watching is a convenience; the visualizer still serves the
    // initial scan when fs.watch is unavailable on the platform.
  }
}

/**
 * Print the startup banner pointing to the visualizer URL and wiki path.
 */
function printBanner(wikiRoot: string, url: string): void {
  process.stdout.write(
    `\n  openwiki visualizer\n  serving: ${wikiRoot}\n  url:     ${url}\n\n  press Ctrl+C to stop.\n\n`,
  );
}

/**
 * Try to bind `preferredPort`, incrementing up to `maxAttempts` times if in use.
 */
function listen(
  server: Server,
  preferredPort: number,
  maxAttempts: number,
  onBound: (port: number) => void,
): void {
  let attempt = 0;
  const tryPort = (port: number): void => {
    attempt += 1;
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener("listening", onListening);
      if (error.code === "EADDRINUSE" && attempt < maxAttempts) {
        tryPort(port + 1);
        return;
      }
      process.stderr.write(
        `openwiki visualize: could not bind port ${preferredPort}..${
          preferredPort + maxAttempts - 1
        }: ${error.message}\n`,
      );
      process.exit(1);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      onBound(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  };
  tryPort(preferredPort);
}

/**
 * Launch the default browser on the visualizer URL. Platform-agnostic (macOS,
 * Windows via powershell Start-Process, Linux via xdg-open); fires and forgets
 * and swallows errors so a missing GUI never crashes the server.
 */
function openBrowser(url: string): void {
  const { platform } = process;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "powershell"
        : "xdg-open";
  const args =
    platform === "win32"
      ? ["-NoProfile", "-Command", "Start-Process", url]
      : [url];
  try {
    const child = execFile(cmd, args, () => {});
    child.unref();
  } catch {
    // Swallowed: browser launch is a convenience.
  }
}
/* v8 ignore stop */
