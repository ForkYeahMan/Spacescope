// App entry: mounts the sidebar, starts live metrics and routes between pages.
// A page module exports `mount(view, ctx)` and may return a cleanup function.

import { getConfig } from "./lib/api.js";
import { startMetrics, subscribe } from "./lib/store.js";
import { currentRoute, navigate } from "./lib/router.js";
import "./lib/theme.js";
import { mountSidebar, NAV } from "./components/sidebar.js";
import { notify, dismiss } from "./components/notify.js";
import { mount as dashboard } from "./pages/dashboard.js";
import { mount as system } from "./pages/system.js";
import { mount as cleaner } from "./pages/cleaner/index.js";
import { setHtml } from "./lib/dom.js";
import { banner } from "./components/ui.js";

const PAGES = { dashboard, system, cleaner };
const view = document.getElementById("view");

let config;
let sidebar;
let cleanup = null;
let renderToken = 0;

async function render() {
  const route = currentRoute();
  if (!(route.page in PAGES)) return navigate(NAV[0].id, { replace: true });

  const token = ++renderToken;
  cleanup?.();
  cleanup = null;
  sidebar.setActive(route.page);
  document.title = `${NAV.find((n) => n.id === route.page).label} · Spacescope`;
  // Each mount gets its own container, so listeners a page attaches to it go
  // away with it. `display: contents` keeps its children in the page grid.
  const stage = document.createElement("div");
  stage.className = "stage";
  view.replaceChildren(stage);
  window.scrollTo(0, 0);

  try {
    const teardown = await PAGES[route.page](stage, { config, route, navigate });
    // A newer navigation won while this page was loading: discard it.
    if (token !== renderToken) teardown?.();
    else cleanup = teardown ?? null;
  } catch (e) {
    console.error(e);
    if (token !== renderToken) return;
    setHtml(stage, banner({ kind: "error", title: "This page couldn't load", message: e.message, retry: true }));
    stage.querySelector("[data-retry]")?.addEventListener("click", render);
  }
}

/** Tell the user once when the service goes away, and once when it's back. */
function watchConnection() {
  let lostId = null;
  subscribe(({ online }) => {
    if (!online && lostId === null) {
      lostId = notify({ kind: "error", title: "Connection lost", message: "The service stopped responding.", sticky: true });
    } else if (online && lostId !== null) {
      dismiss(lostId);
      lostId = null;
    }
  });
}

async function boot() {
  try {
    config = await getConfig();
  } catch (e) {
    setHtml(view, banner({ kind: "error", title: "Can't reach Spacescope", message: e.message, retry: true }));
    view.querySelector("[data-retry]")?.addEventListener("click", () => location.reload());
    return;
  }
  sidebar = mountSidebar(document.getElementById("sidebar"));
  startMetrics();
  watchConnection();
  window.addEventListener("hashchange", render);
  window.addEventListener("unhandledrejection", (e) => notify({ kind: "error", title: "Unexpected error", message: e.reason?.message ?? String(e.reason) }));
  render();
}

boot();
