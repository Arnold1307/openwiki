/**
 * Visualizer UI translation dictionary. Supports English (default) and German,
 * with fallbacks for unsupported locales.
 */
export interface VisualizerTranslations {
  title: string;
  wikiVisualizer: string;
  live: string;
  static: string;
  hideGraph: string;
  showGraph: string;
  toggleTheme: string;
  dragToResize: string;
  graphHint: string;
  emptyPrompt: string;
  wikiUpdated: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  allTypes: string;
  filterTypeAriaLabel: string;
}

export const TRANSLATIONS: Record<"en" | "de", VisualizerTranslations> = {
  en: {
    title: "OpenWiki visualizer",
    wikiVisualizer: "wiki visualizer",
    live: "Live",
    static: "Static",
    hideGraph: "Hide graph",
    showGraph: "Show graph",
    toggleTheme: "Toggle theme",
    dragToResize: "Drag to resize",
    graphHint:
      "<b>Drag</b> to pan · <b>Scroll</b> to zoom · <b>Click</b> a node to read",
    emptyPrompt: "Select a page to read it, or explore the graph.",
    wikiUpdated: "Wiki updated",
    searchPlaceholder: "Search pages...",
    searchAriaLabel: "Search pages",
    allTypes: "All types",
    filterTypeAriaLabel: "Filter by type",
  },
  de: {
    title: "OpenWiki Visualizer",
    wikiVisualizer: "Wiki-Visualizer",
    live: "Live",
    static: "Statisch",
    hideGraph: "Graph ausblenden",
    showGraph: "Graph einblenden",
    toggleTheme: "Farbschema wechseln",
    dragToResize: "Ziehen zum Anpassen",
    graphHint:
      "<b>Ziehen</b> zum Bewegen · <b>Scrollen</b> zum Zoomen · <b>Klick</b> zum Lesen",
    emptyPrompt: "Seite zum Lesen auswählen oder Graph erkunden.",
    wikiUpdated: "Wiki aktualisiert",
    searchPlaceholder: "Seiten suchen...",
    searchAriaLabel: "Seiten durchsuchen",
    allTypes: "Alle Typen",
    filterTypeAriaLabel: "Nach Typ filtern",
  },
};

/**
 * Resolve UI translations for a given language code (e.g. "de", "de-DE", "en").
 */
export function getTranslations(lang?: string): VisualizerTranslations {
  if (lang && lang.toLowerCase().startsWith("de")) {
    return TRANSLATIONS.de;
  }
  return TRANSLATIONS.en;
}
