// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Overview, wikiState } from "../src/pages/Overview.tsx";
import type { Project } from "../src/api.ts";

const base: Project = {
  id: 1,
  path: "platform/core",
  webUrl: "https://gitlab.test/platform/core",
  source: "group",
  enabled: true,
  archived: false,
  lastHeadSha: "head",
  latest: null,
};

describe("wikiState", () => {
  it("shows a wiki as current only when it matches the last seen head", () => {
    expect(wikiState({ ...base, latest: { sha: "head", status: "success", syncedAt: "", error: null } }).label).toBe("Doku aktuell");
    expect(wikiState({ ...base, latest: { sha: "old", status: "success", syncedAt: "", error: null } }).label).toBe("Doku veraltet");
    expect(wikiState(base).label).toBe("Noch keine Doku");
    expect(wikiState({ ...base, archived: true }).label).toBe("Archiviert");
  });
});

describe("Overview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders projects from the API without any external asset", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { ...base, latest: { sha: "head", status: "success", syncedAt: "2026-10-27T08:00:00Z", error: null } },
          ]),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Overview />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(container.textContent).toContain("platform/core");
    expect(container.textContent).toContain("Doku aktuell");
    expect(container.innerHTML).not.toMatch(/https:\/\/cdn\./);
    await act(async () => root.unmount());
  });
});
