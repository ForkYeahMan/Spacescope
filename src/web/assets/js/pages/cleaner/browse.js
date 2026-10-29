// Cleaner · step 3 — browse what was scanned, folder by folder.
//
// A sunburst of the current folder on the left, its contents listed on the
// right. Open a folder to go deeper, tick anything to move it to the Trash.
// The folder lives in the URL (?path=), so Back goes up and links can be shared.

import { html, setHtml } from "../../lib/dom.js";
import { bytes, plural } from "../../lib/format.js";
import { getTree, deletePaths } from "../../lib/api.js";
import { navigate } from "../../lib/router.js";
import { sunburst, layout } from "../../charts/sunburst.js";
import { empty } from "../../components/ui.js";
import { notify } from "../../components/notify.js";
import { confirm } from "../../components/confirm.js";

// Deleting is confirmed once per session (the server remembers until the app quits).
let sessionAuthorized = false;

// What's ticked survives moving between folders; it's cleared on delete or a new scan.
const picked = new Map(); // path → { name, size, safe }

const go = (path, replace = false) => navigate("cleaner/results", { query: { path }, replace });

/** Picked items minus anything inside another picked folder. */
function effectivePicks() {
  const paths = [...picked.keys()];
  return paths
    .filter((p) => !paths.some((o) => o !== p && p.startsWith(o) && (p[o.length] === "/" || p[o.length] === "\\")))
    .map((p) => ({ path: p, ...picked.get(p) }));
}

export async function mountBrowse(host, { route, again, authorized }) {
  sessionAuthorized = authorized;
  const wanted = route.query.get("path") || undefined;
  let data;
  try {
    data = await getTree(wanted);
  } catch (e) {
    // The folder is gone (deleted, or a stale link): fall back to the top.
    if (wanted && e.status === 404) return go("", true);
    throw e;
  }

  const { node, scan_root: root, hidden, free } = data;
  const sep = root.includes("\\") ? "\\" : "/";
  const atRoot = node.path === root;
  const parent = atRoot ? null : node.path.slice(0, Math.max(node.path.lastIndexOf(sep), 0)) || sep;
  const crumbs = [];
  {
    let p = node.path;
    while (true) {
      crumbs.unshift(p);
      if (p === root || p.length <= root.length) break;
      p = p.slice(0, Math.max(p.lastIndexOf(sep), 0)) || sep;
    }
  }
  const label = (p) => (p === root ? (root === sep ? "Disk" : p.split(/[\\/]/).filter(Boolean).pop()) : p.split(/[\\/]/).pop());

  const rows = node.children;
  // Each row's swatch is the colour of its wedge.
  const colorOf = new Map(layout(node).filter((a) => a.ring === 1).map((a) => [a.node.path, a.color]));
  setHtml(host, html`
    <div class="browse-top"><button type="button" class="btn" id="again">New scan</button></div>
    <div class="browse">
      <div class="browse-chart"><div id="chart"></div></div>
      <section class="browse-list" aria-label="Contents of ${node.name}">
        <nav class="crumbs" aria-label="Folder">
          <button type="button" class="btn btn-sm" id="up" ${atRoot ? "disabled" : ""} aria-label="Up one folder">‹</button>
          ${crumbs.map((p, i) => i === crumbs.length - 1
            ? html`<span class="crumb current" aria-current="location">${label(p)}</span>`
            : html`<a class="crumb" href="#/cleaner/results?path=${encodeURIComponent(p)}">${label(p)}</a>`)}
        </nav>
        <header>
          <h1>${label(node.path)}</h1>
          <span class="browse-total nums">${bytes(node.size)}</span>
        </header>
        <div class="browse-sub mono">${node.path}</div>
        ${rows.length ? html`<div class="browse-tools"><button type="button" class="btn btn-sm" id="sel-safe">Select safe items</button></div>` : ""}
        <div class="browse-scroll">
          ${rows.length ? html`<ul class="brows">${rows.map((r, i) => row(r, i))}</ul>` : empty("This folder is empty")}
          ${atRoot && (free || hidden) ? html`<ul class="brows extra">
            ${free ? html`<li class="brow plain"><i class="sw ghost"></i><span class="bname">Free space</span><span class="bsize nums">${bytes(free)}</span></li>` : ""}
            ${hidden ? html`<li class="brow plain" title="Used space the scan couldn't read: other volumes, snapshots, purgeable data."><i class="sw hatched"></i><span class="bname">Unscanned space</span><span class="bsize nums">${bytes(hidden)}</span></li>` : ""}
          </ul>` : ""}
        </div>
      </section>
    </div>
    <div class="tray" id="tray" data-open="false" role="region" aria-label="Selection">
      <span id="tray-count" class="nums"></span>
      <button type="button" class="btn btn-quiet btn-sm" id="tray-clear">Clear</button>
      <button type="button" class="btn btn-danger" id="trash">Move to Trash</button>
    </div>`);

  function row(r, i) {
    const open = r.kind === "dir";
    const checked = picked.has(r.path);
    return html`<li class="brow" data-path="${r.path}" data-i="${i}">
      <input type="checkbox" ${r.protected ? "disabled" : ""} ${checked ? "checked" : ""} data-pick="${r.path}" aria-label="Select ${r.name}" ${r.protected ? html`title="Protected"` : ""} />
      ${open
        ? html`<button type="button" class="bmain" data-open="${r.path}"><i class="sw" style="--c:${colorOf.get(r.path) ?? "var(--skip)"}"></i><span class="bname">${r.name}</span>${r.safe ? html`<span class="bflag">Safe</span>` : ""}<span class="bsize nums">${bytes(r.size)}</span><span class="chev" aria-hidden="true">›</span></button>`
        : html`<div class="bmain"><i class="sw" style="--c:${colorOf.get(r.path) ?? "var(--skip)"}"></i><span class="bname" title="${r.path}">${r.name}</span>${r.safe ? html`<span class="bflag">Safe</span>` : ""}<span class="bsize nums">${bytes(r.size)}</span><span class="chev"></span></div>`}
    </li>`;
  }

  const chart = sunburst(host.querySelector("#chart"), {
    onOpen: (n) => go(n.path),
    onUp: () => parent && go(parent),
    onHover: (path) => host.querySelectorAll(".brow").forEach((el) => el.classList.toggle("on", path !== null && el.dataset.path === path)),
  });
  chart.update(node, { up: !atRoot, formatSize: bytes });

  const $ = (sel) => host.querySelector(sel);

  host.querySelector(".brows")?.addEventListener("pointerover", (e) => {
    const li = e.target.closest(".brow");
    chart.highlight(li ? li.dataset.path : null);
  });
  host.querySelector(".brows")?.addEventListener("pointerleave", () => chart.highlight(null));
  $("#up").addEventListener("click", () => parent && go(parent));
  $("#again").addEventListener("click", () => { picked.clear(); again(); });

  host.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]")?.dataset.open;
    if (open) go(open);
  });
  host.addEventListener("change", (e) => {
    const path = e.target.dataset.pick;
    if (!path) return;
    const r = rows.find((x) => x.path === path);
    if (e.target.checked) picked.set(path, { name: r.name, size: r.size, safe: r.safe });
    else picked.delete(path);
    updateTray();
  });
  $("#sel-safe")?.addEventListener("click", () => {
    rows.filter((r) => r.safe && !r.protected && r.kind !== "rest").forEach((r) => picked.set(r.path, { name: r.name, size: r.size, safe: true }));
    host.querySelectorAll("[data-pick]").forEach((cb) => { cb.checked = picked.has(cb.dataset.pick); });
    updateTray();
  });

  function updateTray() {
    const chosen = effectivePicks();
    const total = chosen.reduce((s, c) => s + c.size, 0);
    $("#tray-count").textContent = `${plural(chosen.length, "item")} · ${bytes(total)}`;
    $("#tray").dataset.open = String(chosen.length > 0);
  }
  $("#tray-clear").addEventListener("click", () => {
    picked.clear();
    host.querySelectorAll("[data-pick]").forEach((cb) => { cb.checked = false; });
    updateTray();
  });

  $("#trash").addEventListener("click", async () => {
    const chosen = effectivePicks();
    if (!chosen.length) return;
    const total = chosen.reduce((s, c) => s + c.size, 0);
    const risky = chosen.filter((c) => !c.safe).length;
    // Ask the first time in a session; after that the click itself is the decision.
    if (!sessionAuthorized) {
      const ok = await confirm({
        title: `Move ${plural(chosen.length, "item")} to the Trash?`,
        body: html`<p>${bytes(total)} in total. Restore from the Trash at any time.</p>
          ${risky ? html`<p>${risky} of these ${risky === 1 ? "isn't" : "aren't"} marked safe to remove.</p>` : ""}
          <p>You won't be asked again until you quit Spacescope.</p>`,
        items: [...chosen].sort((a, b) => b.size - a.size).map((c) => ({ name: c.name, detail: bytes(c.size) })),
        confirmLabel: "Move to Trash",
        danger: true,
      });
      if (!ok) return;
    }

    const button = $("#trash");
    button.disabled = true;
    try {
      const res = await deletePaths(chosen.map((c) => c.path), !sessionAuthorized);
      sessionAuthorized = true;
      const failed = chosen.length - res.deleted;
      notify({ kind: "success", title: `Moved ${plural(res.deleted, "item")} to the Trash`, message: `${bytes(res.freed)} freed` });
      if (failed) notify({ kind: "warning", title: `${plural(failed, "item")} not moved`, message: "Protected or already removed." });
      picked.clear();
      go(node.path, true);
      window.dispatchEvent(new HashChangeEvent("hashchange")); // same URL: force a refresh
    } catch (e) {
      notify({ kind: "error", title: "Couldn't move the items", message: e.message });
      button.disabled = false;
    }
  });

  updateTray();
}
