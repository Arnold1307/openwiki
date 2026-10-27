import { describe, expect, test } from "vitest";
import { getTranslations, TRANSLATIONS } from "../../src/visualize/i18n.ts";

describe("visualizer i18n", () => {
  test("returns english translations by default", () => {
    const t = getTranslations("en");
    expect(t.title).toBe("OpenWiki visualizer");
    expect(t.wikiVisualizer).toBe("wiki visualizer");
    expect(t.live).toBe("Live");
    expect(t.static).toBe("Static");
    expect(t.hideGraph).toBe("Hide graph");
    expect(t.showGraph).toBe("Show graph");
    expect(t.searchPlaceholder).toBe("Search pages...");
    expect(t.allTypes).toBe("All types");
  });

  test("returns german translations when requested", () => {
    const t = getTranslations("de");
    expect(t.title).toBe("OpenWiki Visualizer");
    expect(t.wikiVisualizer).toBe("Wiki-Visualizer");
    expect(t.live).toBe("Live");
    expect(t.static).toBe("Statisch");
    expect(t.hideGraph).toBe("Graph ausblenden");
    expect(t.showGraph).toBe("Graph einblenden");
    expect(t.searchPlaceholder).toBe("Seiten suchen...");
    expect(t.allTypes).toBe("Alle Typen");
  });

  test("supports locale subtags like de-DE and de-AT", () => {
    expect(getTranslations("de-DE")).toEqual(TRANSLATIONS.de);
    expect(getTranslations("de-CH")).toEqual(TRANSLATIONS.de);
  });

  test("falls back to english for unknown or empty locale", () => {
    expect(getTranslations("fr")).toEqual(TRANSLATIONS.en);
    expect(getTranslations(undefined)).toEqual(TRANSLATIONS.en);
  });
});
