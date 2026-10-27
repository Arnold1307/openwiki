import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildGraph, type WikiGraph } from "./graph.js";
import { renderPage, STATIC_PAGE } from "./page.js";

/** Browser assets emitted alongside the server and copied into static exports. */
export interface VisualizerAssets {
  clientJs: string;
  clientLibJs: string;
  /** Stylesheet served verbatim and copied into static exports. */
  stylesCss: string;
  /** Optional vendor scripts for offline use. */
  vendorAssets?: Record<string, string>;
}

/** Inputs for writing a self-contained static visualizer directory. */
export interface StaticVisualizerExportOptions {
  /** Absolute path to the generated wiki that supplies graph data. */
  wikiRoot: string;

  /** Absolute path to the directory receiving the static app. */
  outputDir: string;

  /** Test seam; production callers load the compiled browser modules. */
  assets?: VisualizerAssets;

  /** Whether to bundle vendor assets and eliminate external CDN dependencies. */
  noCdn?: boolean;

  /** User interface language code, e.g. "en" or "de". */
  lang?: string;
}

/** Summary of the graph captured by one static export. */
export interface StaticVisualizerExportResult {
  outputDir: string;
  graph: WikiGraph;
}

const VENDOR_FILES = [
  "force-graph.min.js",
  "marked.min.js",
  "purify.min.js",
  "mermaid.min.js",
];

/** Read vendor scripts from the vendor distribution directory if present. */
export async function loadVendorAssets(): Promise<Record<string, string>> {
  const assets: Record<string, string> = {};
  for (const name of VENDOR_FILES) {
    try {
      const content = await readFile(
        new URL(`./vendor/${name}`, import.meta.url),
        "utf8",
      );
      assets[name] = content;
    } catch {
      // Vendor assets may not be copied yet in dev
    }
  }
  return assets;
}

/** Read the browser assets that ship beside this module in dist. */
export async function loadVisualizerAssets(
  includeVendor = false,
): Promise<VisualizerAssets> {
  const [clientJs, clientLibJs, stylesCss] = await Promise.all([
    readFile(new URL("./client.js", import.meta.url), "utf8"),
    readFile(new URL("./client-lib.js", import.meta.url), "utf8"),
    readFile(new URL("./styles.css", import.meta.url), "utf8"),
  ]);
  const vendorAssets = includeVendor ? await loadVendorAssets() : undefined;
  return { clientJs, clientLibJs, stylesCss, vendorAssets };
}

/**
 * Write the visualizer as sibling static files. The client reads ./graph.json and
 * never opens an SSE connection, so the output can be hosted without OpenWiki.
 */
export async function exportStaticVisualizer(
  options: StaticVisualizerExportOptions,
): Promise<StaticVisualizerExportResult> {
  const [graph, assets] = await Promise.all([
    buildGraph(options.wikiRoot),
    options.assets
      ? Promise.resolve(options.assets)
      : loadVisualizerAssets(Boolean(options.noCdn)),
  ]);

  await mkdir(options.outputDir, { recursive: true });

  const pageHtml =
    options.noCdn || options.lang
      ? renderPage({
          staticExport: true,
          noCdn: Boolean(options.noCdn),
          lang: options.lang,
        })
      : STATIC_PAGE;

  const writePromises = [
    writeFile(path.join(options.outputDir, "index.html"), pageHtml, "utf8"),
    writeFile(
      path.join(options.outputDir, "client.js"),
      assets.clientJs,
      "utf8",
    ),
    writeFile(
      path.join(options.outputDir, "client-lib.js"),
      assets.clientLibJs,
      "utf8",
    ),
    writeFile(
      path.join(options.outputDir, "styles.css"),
      assets.stylesCss,
      "utf8",
    ),
    writeFile(
      path.join(options.outputDir, "graph.json"),
      `${JSON.stringify(graph, null, 2)}\n`,
      "utf8",
    ),
  ];

  if (options.noCdn && assets.vendorAssets) {
    const vendorDir = path.join(options.outputDir, "vendor");
    await mkdir(vendorDir, { recursive: true });
    for (const [name, content] of Object.entries(assets.vendorAssets)) {
      writePromises.push(
        writeFile(path.join(vendorDir, name), content, "utf8"),
      );
    }
  }

  await Promise.all(writePromises);

  return { outputDir: options.outputDir, graph };
}
