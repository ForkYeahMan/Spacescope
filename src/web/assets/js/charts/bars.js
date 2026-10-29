// Static markup builders for the lighter chart forms: bar rows and a
// segmented stack. They return `html` fragments to drop into a page.

import { html } from "../lib/dom.js";
import { arcPath } from "./geometry.js";

const clamp = (v) => Math.min(100, Math.max(0, v));

/** A labelled progress bar. Pass `onClickKey` to make the row a button. */
export function barRow({ name, meta, sub, percent, color = "var(--series-1)", key, pressed }) {
  const inner = html`
    <span class="bar-row-head"><span class="name" title="${name}">${name}</span><span class="meta">${meta}</span></span>
    <span class="track"><i style="--w:${clamp(percent)}%;--c:${color}"></i></span>
    ${sub ? html`<span class="sub" title="${sub}">${sub}</span>` : ""}`;
  return key === undefined
    ? html`<div class="bar-row">${inner}</div>`
    : html`<button type="button" class="bar-row" data-key="${key}" aria-pressed="${!!pressed}">${inner}</button>`;
}

/** A segmented bar with an inline legend. `parts`: `{label,value,color,display}`. */
export function stack(parts) {
  const shown = parts.filter((p) => p.value > 0);
  return html`
    <div class="stack" role="img" aria-label="${parts.map((p) => `${p.label} ${p.display}`).join(", ")}">
      ${shown.map((p) => html`<i style="--v:${p.value};--c:${p.color}" title="${p.label}: ${p.display}"></i>`)}
    </div>
    <div class="stack-legend">${parts.map((p) => html`<span><i class="dot" style="--c:${p.color}"></i>${p.label} <b>${p.display}</b></span>`)}</div>`;
}

/** Half-ring gauge: `percent` filled in `color`, with a headline value and caption. */
export function gauge({ percent, color, value, caption, small = false }) {
  const R = 92;
  const SW = 18;
  const W = (R + SW) * 2;
  const H = R + SW + 4;
  const cx = W / 2;
  const cy = R + SW;
  const start = -Math.PI / 2;
  const end = start + (clamp(percent) / 100) * Math.PI;
  return html`
    <div class="gauge${small ? " sm" : ""}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${caption}: ${value}">
        <path class="gauge-track" d="${arcPath(cx, cy, R, start, Math.PI / 2)}" stroke-width="${SW}" fill="none"/>
        ${percent > 0.2 ? html`<path d="${arcPath(cx, cy, R, start, end)}" stroke="${color}" stroke-width="${SW}" fill="none"/>` : ""}
      </svg>
      <div class="gauge-center"><span class="gauge-value">${value}</span><span class="gauge-caption">${caption}</span></div>
    </div>`;
}
