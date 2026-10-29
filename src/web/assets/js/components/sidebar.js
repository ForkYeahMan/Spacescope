// Sidebar: navigation, connection status and the appearance switch.

import { html, setHtml } from "../lib/dom.js";
import { setTheme, getTheme } from "../lib/theme.js";
import { subscribe } from "../lib/store.js";

export const NAV = [
  { id: "dashboard", label: "Dashboard" },
  { id: "system", label: "System" },
  { id: "cleaner", label: "Cleaner" },
];

const THEMES = [["system", "Auto"], ["light", "Light"], ["dark", "Dark"]];

export function mountSidebar(el) {
  let active = NAV[0].id;
  let online = true;

  function draw() {
    const theme = getTheme();
    setHtml(el, html`
      <div class="brand"><img src="/assets/logo.svg" alt="" width="26" height="26" />Spacescope</div>
      <nav class="side-nav" aria-label="Main">
        <div class="side-title">Menu</div>
        ${NAV.map((n) => html`<a class="nav-item" href="#/${n.id}" ${n.id === active ? html`aria-current="page"` : ""}>${n.label}</a>`)}
      </nav>
      <div class="sidebar-foot">
        <div class="segmented" role="group" aria-label="Appearance">
          ${THEMES.map(([id, label]) => html`<button type="button" data-theme-set="${id}" aria-pressed="${theme === id}">${label}</button>`)}
        </div>
        <div class="conn" data-state="${online ? "online" : "offline"}" role="status"><span class="conn-text">${online ? "Connected" : "Disconnected"}</span></div>
      </div>`);
  }

  el.addEventListener("click", (e) => {
    const id = e.target.closest("[data-theme-set]")?.dataset.themeSet;
    if (id) { setTheme(id); draw(); el.querySelector(`[data-theme-set="${id}"]`).focus(); }
  });
  subscribe((s) => {
    if (s.online !== online) { online = s.online; draw(); }
  });

  draw();
  return { setActive(id) { if (id !== active) { active = id; draw(); } } };
}
