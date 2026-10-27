/**
 * Copies browser assets that TypeScript does not emit into the visualizer
 * distribution directory. The list is explicit so adding another asset is a
 * one-line change, and every copy is verified before the build can succeed.
 */
const { copyFileSync, existsSync, mkdirSync, statSync } = require("node:fs");
const path = require("node:path");

/** Browser assets required by the compiled visualizer. */
const ASSETS = [
  {
    source: path.resolve(__dirname, "..", "src", "visualize", "styles.css"),
    destination: path.resolve(
      __dirname,
      "..",
      "dist",
      "visualize",
      "styles.css",
    ),
  },
];

/** Vendor browser assets copied for offline visualizer use. */
const VENDOR_ASSETS = [
  {
    name: "force-graph.min.js",
    source: path.resolve(
      __dirname,
      "..",
      "node_modules",
      "force-graph",
      "dist",
      "force-graph.min.js",
    ),
    destination: path.resolve(
      __dirname,
      "..",
      "dist",
      "visualize",
      "vendor",
      "force-graph.min.js",
    ),
  },
  {
    name: "marked.min.js",
    source: path.resolve(
      __dirname,
      "..",
      "node_modules",
      "marked",
      "lib",
      "marked.umd.js",
    ),
    destination: path.resolve(
      __dirname,
      "..",
      "dist",
      "visualize",
      "vendor",
      "marked.min.js",
    ),
  },
  {
    name: "purify.min.js",
    source: path.resolve(
      __dirname,
      "..",
      "node_modules",
      "dompurify",
      "dist",
      "purify.min.js",
    ),
    destination: path.resolve(
      __dirname,
      "..",
      "dist",
      "visualize",
      "vendor",
      "purify.min.js",
    ),
  },
  {
    name: "mermaid.min.js",
    source: path.resolve(
      __dirname,
      "..",
      "node_modules",
      "mermaid",
      "dist",
      "mermaid.min.js",
    ),
    destination: path.resolve(
      __dirname,
      "..",
      "dist",
      "visualize",
      "vendor",
      "mermaid.min.js",
    ),
  },
];

/** Copy one asset and fail if the resulting destination is unusable. */
function copyAsset({ source, destination }) {
  if (!existsSync(source)) {
    throw new Error(`source asset is missing: ${source}`);
  }
  // tsc creates dist/visualize/ on its way to client.js, so a missing directory
  // means this ran without (or before) a build rather than that a copy failed.
  const destinationDir = path.dirname(destination);
  if (!existsSync(destinationDir)) {
    throw new Error(
      `destination directory does not exist (run the build first): ${destinationDir}`,
    );
  }
  copyFileSync(source, destination);
  if (!existsSync(destination) || statSync(destination).size === 0) {
    throw new Error(`destination asset is missing or empty: ${destination}`);
  }
}

function main() {
  for (const asset of ASSETS) copyAsset(asset);
  for (const vendor of VENDOR_ASSETS) {
    if (existsSync(vendor.source)) {
      const destDir = path.dirname(vendor.destination);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }
      copyAsset(vendor);
    }
  }
  const noun = ASSETS.length === 1 ? "asset" : "assets";
  console.log(`copy-visualize-assets: copied ${ASSETS.length} ${noun}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      `copy-visualize-assets failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

module.exports = { ASSETS, VENDOR_ASSETS, copyAsset };
