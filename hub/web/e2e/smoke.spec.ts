import { expect, test } from "@playwright/test";

test.describe("OpenWiki Hub Web Smoke Test (Netz blockiert)", () => {
  test("Durchlauf: Übersicht → Projekt → Doku-Navigation → Suche ohne externe Netzressourcen", async ({
    page,
  }) => {
    const externalRequests: string[] = [];

    // Intercept and enforce network isolation: block any external hosts
    await page.route("**/*", async (route) => {
      const reqUrl = new URL(route.request().url());
      const isLocal =
        reqUrl.hostname === "localhost" ||
        reqUrl.hostname === "127.0.0.1" ||
        reqUrl.hostname === "[::1]";

      if (!isLocal) {
        externalRequests.push(route.request().url());
        await route.abort("blockedbyclient");
        return;
      }

      // Mock hub API endpoints
      if (reqUrl.pathname === "/api/projects") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: 42,
              path: "backend/auth-service",
              webUrl: "https://gitlab.example.com/backend/auth-service",
              source: "group",
              enabled: true,
              archived: false,
              lastHeadSha: "commit-12345678",
              latest: {
                sha: "commit-12345678",
                status: "success",
                syncedAt: "2026-10-27T08:00:00Z",
                error: null,
              },
            },
          ]),
        });
        return;
      }

      if (reqUrl.pathname === "/api/projects/42/docs") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sha: "commit-12345678",
            pages: ["quickstart.md", "architecture/overview.md"],
          }),
        });
        return;
      }

      if (reqUrl.pathname === "/api/projects/42/docs/file") {
        const filePath = reqUrl.searchParams.get("path");
        if (filePath === "quickstart.md") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              path: "quickstart.md",
              sha: "commit-12345678",
              markdown:
                "# Authentifizierungsdienst\n\nWillkommen zur Dokumentation. Siehe [Architektur](./architecture/overview.md) und [Quellcode](src/index.ts).",
            }),
          });
          return;
        }

        if (filePath === "architecture/overview.md") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              path: "architecture/overview.md",
              sha: "commit-12345678",
              markdown:
                '# Architektur-Übersicht\n\n<h2 id="session-cache">Session Cache</h2>\n\nDer Dienst nutzt JWT-Tokens und Session-Caches.',
            }),
          });
          return;
        }
      }

      if (reqUrl.pathname === "/api/search") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            hits: [
              {
                projectId: 42,
                projectPath: "backend/auth-service",
                ref: "openwiki/architecture/overview.md#session-cache",
                content: "JWT-Tokens und Session-Caches für Authentifizierung.",
              },
            ],
          }),
        });
        return;
      }

      await route.continue();
    });

    // 1. Übersicht laden
    await page.goto("/#/");
    await expect(page.locator("h1")).toHaveText("Projekte");

    const projectItem = page.locator(".project-list .project");
    await expect(projectItem).toBeVisible();
    await expect(projectItem.locator("strong")).toHaveText(
      "backend/auth-service",
    );
    await expect(projectItem.locator(".badge")).toHaveText("Doku aktuell");

    // 2. Zu Projekt-Doku navigieren
    await projectItem.locator("a").click();
    await expect(page).toHaveURL(/#\/projects\/42\/docs\/quickstart\.md/);

    // Doku-Seitenleiste prüfen
    const sidebar = page.locator("nav[aria-label='Seiten']");
    await expect(sidebar.locator("a")).toHaveText([
      "quickstart.md",
      "architecture/overview.md",
    ]);

    // Renderter Inhalt der ersten Seite prüfen
    const article = page.locator("article.markdown");
    await expect(article.locator("h1")).toHaveText("Authentifizierungsdienst");

    // Quellcode-Link zeigt auf GitLab
    const gitlabLink = article.locator("a", { hasText: "Quellcode" });
    await expect(gitlabLink).toHaveAttribute(
      "href",
      "https://gitlab.example.com/backend/auth-service/-/blob/main/src/index.ts",
    );

    // Klick auf relativen Markdown-Link führt zur zweiten Seite
    const archLink = article.locator("a", { hasText: "Architektur" });
    await expect(archLink).toHaveAttribute(
      "href",
      "#/projects/42/docs/architecture/overview.md",
    );
    await archLink.click();

    await expect(page).toHaveURL(
      /#\/projects\/42\/docs\/architecture\/overview\.md/,
    );
    await expect(article.locator("h1")).toHaveText("Architektur-Übersicht");

    // 3. Zurück zur Übersicht und Suche durchführen
    await page.locator("header .brand").click();
    await expect(page).toHaveURL(/#\//);
    await expect(page.locator("h1")).toHaveText("Projekte");

    const searchInput = page.locator("input[type='search']");
    await searchInput.fill("Architektur");

    // Trefferliste abwarten (debounce 250ms)
    await expect(
      page.locator("h2", { hasText: "Treffer in der Doku" }),
    ).toBeVisible();
    const hitLink = page.locator("a", {
      hasText: "backend/auth-service · architecture/overview.md",
    });
    await expect(hitLink).toBeVisible();
    await expect(hitLink).toHaveAttribute(
      "href",
      "#/projects/42/docs/architecture/overview.md#session-cache",
    );

    // Klick auf den Suchtreffer springt direkt zum Anker
    await hitLink.click();
    await expect(page).toHaveURL(
      /#\/projects\/42\/docs\/architecture\/overview\.md#session-cache/,
    );
    await expect(article.locator("h1")).toHaveText("Architektur-Übersicht");

    // 4. Sicherheitsprüfung: keine externen Anfragen ausgeführt
    expect(externalRequests).toEqual([]);

    // Keine externen Script-Tags im DOM
    const cdnScripts = await page.locator("script[src*='cdn.']").count();
    expect(cdnScripts).toBe(0);
  });
});
