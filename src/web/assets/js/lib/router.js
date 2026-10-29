// Hash router with nested paths and query strings:
//
//   #/cleaner/results?category=Cache&sort=name
//    └─ page ─┘└ rest ┘ └──── query ────┘
//
// Every step of a flow is its own URL, so Back/Forward, reloads and shared
// links all land where you'd expect.

/** Parse the current location into `{ page, rest, query }`. */
export function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, search = ""] = raw.split("?");
  const [page = "", ...rest] = path.split("/").filter(Boolean);
  return { page, rest, query: new URLSearchParams(search) };
}

const toHash = (path, query) => {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString() : "";
  return `#/${path.replace(/^\//, "")}${qs ? `?${qs}` : ""}`;
};

/** Go to `path` (e.g. "cleaner/results"). `replace` swaps the history entry instead of adding one. */
export function navigate(path, { query, replace = false } = {}) {
  const hash = toHash(path, query);
  if (location.hash === hash) return;
  if (replace) {
    // replaceState doesn't fire `hashchange`, so ask the router to re-render itself.
    history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = hash;
  }
}

/** Update the query of the current URL without re-rendering (filters, sort, search). */
export function replaceQuery(query) {
  const { page, rest } = currentRoute();
  history.replaceState(null, "", toHash([page, ...rest].join("/"), query));
}
