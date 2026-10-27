import DOMPurify from "dompurify";
import { marked, type Token } from "marked";

/** Where a page is shown and which project it belongs to. */
export interface LinkContext {
  projectId: number;
  /** Page being rendered, relative to openwiki/, e.g. `architecture/jobs.md`. */
  currentPage: string;
  /** GitLab web URL of the project, without a trailing slash. */
  webUrl: string;
  branch: string;
}

/**
 * Resolve `..` and `.` segments. A path cannot climb above its root, so extra
 * `..` segments are dropped rather than producing a path outside the wiki.
 */
function normalize(parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * Map one Markdown link target to where it should point in the web app.
 *
 * - Relative `.md` pages become in-app routes, resolved against the current page.
 * - Repository paths (`src/...`) become links into the project on GitLab.
 * - External URLs and in-page anchors are kept as they are.
 *
 * @param href - Link target as written in the page.
 * @param ctx - Project and page context.
 * @returns The rewritten target.
 */
export function mapWikiLink(href: string, ctx: LinkContext): string {
  if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;

  const [pathPart, anchor = ""] = href.split(/#(.*)/s);
  const hash = anchor ? `#${anchor}` : "";
  const target = pathPart ?? "";

  if (/\.md$/i.test(target)) {
    const dir = ctx.currentPage.split("/").slice(0, -1);
    const page = normalize([...dir, ...target.split("/")]);
    return `#/projects/${ctx.projectId}/docs/${page}${hash}`;
  }

  const repoPath = normalize([...ctx.currentPage.split("/").slice(0, -1), ...target.split("/")]);
  if (repoPath.startsWith("src/")) {
    return `${ctx.webUrl}/-/blob/${ctx.branch}/${repoPath}${hash}`;
  }
  return href;
}

/** Visit every link token, including links nested inside other inline tokens. */
function forEachLink(tokens: Token[], visit: (token: Token & { href: string }) => void): void {
  for (const token of tokens) {
    if (token.type === "link" && typeof (token as { href?: unknown }).href === "string") {
      visit(token as Token & { href: string });
    }
    const nested = (token as { tokens?: Token[] }).tokens;
    if (nested) forEachLink(nested, visit);
  }
}

/**
 * Render a wiki page to sanitized HTML with its links rewritten.
 *
 * @param source - Markdown source of the page.
 * @param mapHref - Link rewrite, usually {@link mapWikiLink} bound to a context.
 * @returns HTML safe to insert into the DOM.
 */
export function renderMarkdown(source: string, mapHref: (href: string) => string): string {
  const tokens = marked.lexer(source);
  forEachLink(tokens, (token) => {
    token.href = mapHref(token.href);
  });
  return DOMPurify.sanitize(marked.parser(tokens));
}
