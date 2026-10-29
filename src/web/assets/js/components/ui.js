// Shared page furniture: page head, panels, the hairline metric strip and
// loading / error / empty states.

import { html } from "../lib/dom.js";

export function pageHead({ title, sub, actions }) {
  return html`<header class="page-head">
    <div style="min-width:0"><h1>${title}</h1>${sub ? html`<div class="sub">${sub}</div>` : ""}</div>
    ${actions ? html`<div class="page-actions">${actions}</div>` : ""}
  </header>`;
}

export function panel({ title, caption, actions, body, id, className = "" }) {
  return html`<section class="panel ${className}" ${id ? html`id="${id}"` : ""}>
    ${title || actions ? html`<div class="panel-head">${title ? html`<h2>${title}</h2>` : ""}${actions ?? ""}</div>` : ""}
    ${caption ? html`<p class="panel-caption">${caption}</p>` : ""}
    ${body}
  </section>`;
}

/** `items`: `{id?, label, value?, note?}`; `id` makes the value/note updatable in place. */
export function metricGrid(items) {
  return html`<div class="metric-grid">${items.map((m) => html`
    <div class="metric">
      <span class="metric-label">${m.label}</span>
      <span class="metric-value" ${m.id ? html`data-metric="${m.id}"` : ""}>${m.value ?? "—"}</span>
      <span class="metric-note" ${m.id ? html`data-note="${m.id}"` : ""}>${m.note ?? ""}</span>
    </div>`)}</div>`;
}

/** Update a metric rendered by `metricGrid` without rebuilding it. */
export function setMetric(root, id, value, note) {
  const v = root.querySelector(`[data-metric="${id}"]`);
  const n = root.querySelector(`[data-note="${id}"]`);
  if (v && v.textContent !== String(value)) v.textContent = value;
  if (n && note !== undefined && n.textContent !== String(note)) n.textContent = note;
}

export function empty(title, detail) {
  return html`<div class="empty"><b>${title}</b>${detail ? html`<span>${detail}</span>` : ""}</div>`;
}

/**
 * Inline, persistent message for a page or section.
 * `kind`: info | success | warning | error. `action` renders a button
 * (`data-banner-action`); `retry` renders a Retry button (`data-retry`).
 */
export function banner({ kind = "info", title, message = "", action = null, retry = false }) {
  return html`<div class="banner ${kind}" role="${kind === "error" ? "alert" : "status"}">
    <div class="banner-text"><b>${title}</b>${message ? html`<span>${message}</span>` : ""}</div>
    ${action ? html`<button type="button" class="btn btn-sm" data-banner-action>${action}</button>` : ""}
    ${retry ? html`<button type="button" class="btn btn-sm" data-retry>Retry</button>` : ""}
  </div>`;
}

export function skeletonPage() {
  const bar = (h, w = "100%") => html`<span class="skeleton" style="height:${h}px;width:${w}"></span>`;
  return html`<div aria-busy="true" aria-label="Loading" style="display:grid;gap:20px">
    ${bar(74)}<div class="grid-2"><div class="panel" style="display:grid;gap:12px">${bar(12, 120)}${bar(150)}</div><div class="panel" style="display:grid;gap:12px">${bar(12, 120)}${bar(150)}</div></div>
  </div>`;
}
