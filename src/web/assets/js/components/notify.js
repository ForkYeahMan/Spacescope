// Notifications. One system for everything transient:
//
//   notify({ kind, title, message?, action?, sticky? })
//
// Toasts stack bottom-right, pause while hovered, can carry one action and
// always have a close button. `sticky` keeps one until it's dismissed.

import { html, setHtml } from "../lib/dom.js";

const KINDS = new Set(["info", "success", "warning", "error"]);
const DURATION = { info: 4000, success: 4000, warning: 7000, error: 9000 };
const items = new Map();
let nextId = 1;

const host = () => document.getElementById("toasts");

/** @returns {number} id, for `dismiss` */
export function notify({ kind = "info", title, message = "", action = null, sticky = false }) {
  if (!KINDS.has(kind)) kind = "info";
  const id = nextId++;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  setHtml(el, html`
    <div class="toast-body"><b>${title}</b>${message ? html`<span>${message}</span>` : ""}</div>
    ${action ? html`<button type="button" class="btn btn-sm" data-action>${action.label}</button>` : ""}
    <button type="button" class="toast-close" aria-label="Dismiss">✕</button>`);

  const entry = { el, timer: null, remaining: DURATION[kind], started: 0, sticky };
  const start = () => {
    if (entry.sticky) return;
    entry.started = Date.now();
    entry.timer = setTimeout(() => dismiss(id), entry.remaining);
  };
  const pause = () => {
    if (entry.sticky || entry.timer === null) return;
    clearTimeout(entry.timer);
    entry.timer = null;
    entry.remaining -= Date.now() - entry.started;
  };
  el.addEventListener("pointerenter", pause);
  el.addEventListener("pointerleave", () => { if (entry.timer === null) start(); });
  el.addEventListener("click", (e) => {
    if (e.target.closest(".toast-close")) dismiss(id);
    if (e.target.closest("[data-action]")) { action.onClick(); dismiss(id); }
  });

  items.set(id, entry);
  host()?.append(el);
  start();
  return id;
}

export function dismiss(id) {
  const entry = items.get(id);
  if (!entry) return;
  items.delete(id);
  clearTimeout(entry.timer);
  entry.el.dataset.leaving = "";
  entry.el.addEventListener("animationend", () => entry.el.remove(), { once: true });
  setTimeout(() => entry.el.remove(), 300); // reduced-motion fallback
}
