// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mapWikiLink, renderMarkdown, type LinkContext } from "../src/markdown.ts";

const ctx: LinkContext = {
  projectId: 7,
  currentPage: "architecture/jobs.md",
  webUrl: "https://gitlab.test/platform/core",
  branch: "main",
};

describe("mapWikiLink", () => {
  it("routes a relative wiki page to the in-app docs route", () => {
    expect(mapWikiLink("../quickstart.md", ctx)).toBe("#/projects/7/docs/quickstart.md");
    expect(mapWikiLink("./queue.md#queue", ctx)).toBe(
      "#/projects/7/docs/architecture/queue.md#queue",
    );
  });

  it("points source references at the GitLab web interface", () => {
    expect(mapWikiLink("../../src/cli/cli.tsx", ctx)).toBe(
      "https://gitlab.test/platform/core/-/blob/main/src/cli/cli.tsx",
    );
  });

  it("keeps external links and in-page anchors", () => {
    expect(mapWikiLink("https://example.org/docs", ctx)).toBe("https://example.org/docs");
    expect(mapWikiLink("#queue", ctx)).toBe("#queue");
  });

  it("does not let a link climb above the wiki root", () => {
    expect(mapWikiLink("../../../../etc/passwd.md", ctx)).toBe(
      "#/projects/7/docs/etc/passwd.md",
    );
  });
});

describe("renderMarkdown", () => {
  it("removes scripts and event handlers from rendered content", () => {
    const html = renderMarkdown(
      "Hello <script>alert(1)</script> <img src=x onerror=alert(1)>",
      (href) => href,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("applies the link mapping to rendered anchors", () => {
    const html = renderMarkdown("[Queue](./queue.md)", (href) =>
      mapWikiLink(href, ctx),
    );
    expect(html).toContain('href="#/projects/7/docs/architecture/queue.md"');
  });
});
