import { useEffect, useState } from "react";
import { parseRoute, type Route } from "./route.ts";
import { Overview } from "./pages/Overview.tsx";
import { ProjectDocs } from "./pages/ProjectDocs.tsx";
import { Admin } from "./pages/Admin.tsx";

/** Follow the URL hash so links and the back button work without a router library. */
function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  return (
    <>
      <header>
        <a href="#/" className="brand">OpenWiki Hub</a>
        <nav>
          <a href="#/" aria-current={route.name === "overview" ? "page" : undefined}>Projekte</a>
          <a href="#/verwaltung" aria-current={route.name === "admin" ? "page" : undefined}>Verwaltung</a>
        </nav>
      </header>
      <main>
        {route.name === "overview" && <Overview />}
        {route.name === "docs" && (
          <ProjectDocs projectId={route.projectId} page={route.page} anchor={route.anchor} />
        )}
        {route.name === "admin" && <Admin />}
      </main>
    </>
  );
}
