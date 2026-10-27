import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  CSP,
  OFFLINE_CSP,
  OFFLINE_PAGE,
  OFFLINE_STATIC_PAGE,
  PAGE,
  STATIC_PAGE,
  renderPage,
} from "../../src/visualize/page.ts";

describe("visualize page generation", () => {
  test("live and static pages produce valid HTML with key landmarks", () => {
    for (const doc of [PAGE, STATIC_PAGE]) {
      expect(doc).toContain("<!doctype html>");
      expect(doc).toContain('<div id="graph">');
      expect(doc).toContain('class="sidebar" id="sidebar"');
      expect(doc).toContain('<div class="detail" id="detail">');
      expect(doc).toContain('<div class="legend" id="legend">');
      expect(doc).toContain('id="hint"');
      expect(doc).toContain('id="search"');
      expect(doc).toContain('id="filter-type"');
    }
  });

  test("static page is self-contained with no live SSE reconnect logic", () => {
    expect(STATIC_PAGE).toContain('data-static-export="true"');
    expect(STATIC_PAGE).toContain('src="./client.js"');
    expect(PAGE).not.toContain('data-static-export="true"');
    expect(PAGE).toContain('src="/client.js"');
  });

  test("pins third-party scripts with subresource integrity hashes in default mode", () => {
    for (const doc of [PAGE, STATIC_PAGE]) {
      const scripts = doc.match(/<script\b[^>]*>/gu) ?? [];
      const cdnScripts = scripts.filter((s) => s.includes("cdn.jsdelivr.net"));
      expect(cdnScripts).toHaveLength(4);
      for (const tag of cdnScripts) {
        expect(tag).toMatch(/integrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/u);
        expect(tag).toContain('crossorigin="anonymous"');
      }
    }
  });

  test("hint and legend are anchored inside the graph panel, not .main", () => {
    for (const doc of [PAGE, STATIC_PAGE]) {
      const mainStart = doc.indexOf('<div class="main" id="main">');
      const detailStart = doc.indexOf('<div class="detail" id="detail">');
      const mainRegion = doc.slice(mainStart, detailStart);

      const graphStart = doc.indexOf('<div id="graph">');
      const overlayStart = doc.indexOf(
        '<div class="graph-overlay" id="graph-overlay">',
      );
      expect(graphStart).toBeGreaterThan(-1);
      expect(overlayStart).toBeGreaterThan(graphStart);

      expect(mainRegion).toContain('id="graph-overlay"');
      expect(mainRegion).toContain('id="legend"');
      expect(mainRegion).toContain('id="hint"');
      expect(doc.indexOf('id="legend"')).toBeGreaterThan(overlayStart);
      expect(doc.indexOf('id="hint"')).toBeGreaterThan(overlayStart);
    }
  });

  test("the CSP allows the Google Fonts origins the page itself requests", () => {
    const directives = Object.fromEntries(
      CSP.split("; ").map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name, sources];
      }),
    );

    const fontsStylesheetMatch = PAGE.match(
      /<link href="(https:\/\/fonts\.googleapis\.com\/[^"]+)" rel="stylesheet" \/>/u,
    );
    expect(fontsStylesheetMatch).toBeTruthy();
    const fontsStylesheetOrigin = new URL(fontsStylesheetMatch![1]).origin;

    expect(directives["style-src"]).toContain(fontsStylesheetOrigin);
    expect(directives["font-src"]).toContain("https://fonts.gstatic.com");
  });

  test("the overlay stack is capped to the graph panel and scrolls", () => {
    const css = readFileSync(
      path.join(import.meta.dirname, "../../src/visualize/styles.css"),
      "utf8",
    );
    const overlayBlock = css.match(/\.graph-overlay\s*\{[^}]*\}/u);
    expect(overlayBlock).toBeTruthy();
    expect(overlayBlock![0]).toContain("position: absolute");
    expect(overlayBlock![0]).toContain("max-height:");

    const legendBlock = css.match(/\.legend\s*\{[^}]*\}/u);
    expect(legendBlock).toBeTruthy();
    expect(legendBlock![0]).toContain("overflow-y: auto");
    expect(legendBlock![0]).not.toContain("position: absolute");
  });

  test("offline mode renders local vendor scripts and eliminates CDNs", () => {
    const offlineLive = renderPage({ noCdn: true });
    expect(offlineLive).toContain('src="/vendor/force-graph.min.js"');
    expect(offlineLive).toContain('src="/vendor/marked.min.js"');
    expect(offlineLive).toContain('src="/vendor/purify.min.js"');
    expect(offlineLive).toContain('src="/vendor/mermaid.min.js"');
    expect(offlineLive).not.toContain("cdn.jsdelivr.net");
    expect(offlineLive).not.toContain("fonts.googleapis.com");

    const offlineStatic = renderPage({ staticExport: true, noCdn: true });
    expect(offlineStatic).toContain('src="./vendor/force-graph.min.js"');
    expect(offlineStatic).not.toContain("cdn.jsdelivr.net");
    expect(offlineStatic).toContain(OFFLINE_CSP);

    expect(OFFLINE_PAGE).toBe(offlineLive);
    expect(OFFLINE_STATIC_PAGE).toBe(offlineStatic);
  });

  test("supports german localization in rendered markup", () => {
    const germanPage = renderPage({ lang: "de" });
    expect(germanPage).toContain('<html lang="de"');
    expect(germanPage).toContain('placeholder="Seiten suchen..."');
    expect(germanPage).toContain("Alle Typen");
    expect(germanPage).toContain('data-lang="de"');
  });

  test("maintains full backwards compatibility for boolean parameter in renderPage", () => {
    expect(renderPage(true)).toBe(STATIC_PAGE);
    expect(renderPage(false)).toBe(PAGE);
  });
});
