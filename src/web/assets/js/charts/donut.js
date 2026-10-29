// Donut chart with a legend filling the rest of the row. Hovering a slice or a
// legend row pulls the slice out and swaps the centre readout; with `onSelect`
// both are clickable. Updates are applied in place so hover survives live data.

import { html, setHtml } from "../lib/dom.js";
import { ringArc } from "./geometry.js";

const SIZE = 188;
const C = SIZE / 2;
const OUTER = 86;
const INNER = 56;

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {(v:number)=>string} opts.format
 * @param {string} opts.title
 * @param {(key:string)=>void} [opts.onSelect]
 */
export function donut(container, { format, title, onSelect }) {
  let model = { slices: [], center: { value: "", caption: "" }, selected: null };
  let hover = null;

  container.classList.add("donut");

  function draw() {
    const { slices, center, selected } = model;
    const present = slices.filter((s) => s.value > 0);
    const total = present.reduce((sum, s) => sum + s.value, 0);
    let angle = 0;

    const arcs = present.map((s) => {
      const a0 = angle;
      angle += (s.value / total) * Math.PI * 2;
      const mid = (a0 + angle) / 2;
      const d = present.length === 1
        ? ringArc(C, C, OUTER, INNER, 0, Math.PI * 2 - 0.0001)
        : ringArc(C, C, OUTER, INNER, a0, angle);
      return html`<path class="donut-slice" data-key="${s.key}" d="${d}" fill="${s.color}" stroke="var(--bg)" stroke-width="2"
        style="--tx:${(6 * Math.sin(mid)).toFixed(2)}px;--ty:${(-6 * Math.cos(mid)).toFixed(2)}px"><title>${s.label}: ${format(s.value)} (${((s.value / total) * 100).toFixed(1)}%)</title></path>`;
    });

    const rows = present.map((s) => {
      const share = `${((s.value / total) * 100).toFixed(s.value / total < 0.1 ? 1 : 0)}%`;
      const inner = html`<i class="sq" style="--c:${s.color}"></i><span class="label">${s.label}</span><span class="val">${s.note ?? format(s.value)}</span><span class="share">${share}</span>`;
      return onSelect
        ? html`<li><button type="button" class="legend-row" data-key="${s.key}" style="--c:${s.color}" aria-pressed="${selected === s.key}">${inner}</button></li>`
        : html`<li><div class="legend-row" data-key="${s.key}" style="--c:${s.color}">${inner}</div></li>`;
    });

    setHtml(container, html`
      <div class="fig">
        <svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${title}">
          ${present.length ? arcs : html`<circle cx="${C}" cy="${C}" r="${(OUTER + INNER) / 2}" fill="none" stroke="var(--canvas)" stroke-width="${OUTER - INNER}"/>`}
        </svg>
        <div class="donut-center"></div>
      </div>
      <ul class="legend-list">${rows}</ul>`);
    paintHover(center);
  }

  function paintHover(center = model.center) {
    container.querySelectorAll("[data-key]").forEach((el) => {
      const active = el.dataset.key === hover;
      el.classList.toggle("dim", hover !== null && !active);
      el.classList.toggle("on", active);
    });
    const slice = model.slices.find((s) => s.key === hover);
    const centre = container.querySelector(".donut-center");
    if (centre) {
      setHtml(centre, slice
        ? html`<b>${format(slice.value)}</b><span>${slice.label}</span>`
        : html`<b>${center.value}</b><span>${center.caption}</span>`);
    }
  }

  const keyOf = (e) => e.target.closest("[data-key]")?.dataset.key ?? null;
  container.addEventListener("pointerover", (e) => {
    const key = keyOf(e);
    if (key !== hover) { hover = key; paintHover(); }
  });
  container.addEventListener("pointerleave", () => { hover = null; paintHover(); });
  container.addEventListener("focusin", (e) => { hover = keyOf(e); paintHover(); });
  container.addEventListener("focusout", () => { hover = null; paintHover(); });
  if (onSelect) {
    container.addEventListener("click", (e) => {
      const key = keyOf(e);
      if (key) onSelect(key);
    });
  }

  draw();
  return {
    /** `slices`: `{key,label,value,color,note?}`; `center`: `{value,caption}` shown when nothing is hovered. */
    update(next) { model = { selected: null, ...next }; draw(); },
  };
}
