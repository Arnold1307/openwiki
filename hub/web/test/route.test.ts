import { describe, expect, it } from "vitest";
import { docsHref, parseRoute } from "../src/route.ts";

describe("parseRoute", () => {
  it("reads project pages and heading anchors", () => {
    expect(parseRoute("#/projects/7/docs/architecture/jobs.md#queue")).toEqual({
      name: "docs",
      projectId: 7,
      page: "architecture/jobs.md",
      anchor: "queue",
    });
  });

  it("routes the admin page and falls back to the overview", () => {
    expect(parseRoute("#/verwaltung")).toEqual({ name: "admin" });
    expect(parseRoute("")).toEqual({ name: "overview" });
    expect(parseRoute("#/unbekannt")).toEqual({ name: "overview" });
  });

  it("round-trips docsHref", () => {
    const href = docsHref(3, "quickstart.md", "setup");
    expect(parseRoute(href)).toMatchObject({ projectId: 3, page: "quickstart.md", anchor: "setup" });
  });
});
