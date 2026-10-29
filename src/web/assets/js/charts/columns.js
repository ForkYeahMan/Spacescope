// Vertical column chart for per-core load. Bars update in place so they glide
// between samples instead of redrawing.

import { html, setHtml } from "../lib/dom.js";
import { loadColor } from "../lib/format.js";

const GUTTER = 34;
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {number} [opts.max]     axis maximum (default 100)
 * @param {number} [opts.height]
 * @param {string} opts.title
 */
export function columns(container, { max = 100, height = 150, title }) {
  let width = 400;
  let values = [];
  let built = -1;
  let bars = [];

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", height + 20);
  container.classList.add("cols");
  container.replaceChildren(svg);

  const y = (v) => height - (Math.min(v, max) / max) * height;

  function build() {
    const n = values.length;
    const plot = Math.max(width - GUTTER, 40);
    const slot = plot / Math.max(n, 1);
    const barW = Math.max(Math.min(slot * 0.62, 28), 3);
    const labelEvery = Math.max(1, Math.ceil(24 / slot));

    const grid = [0, 0.5, 1].map((f) => html`
      <line class="${f === 0 ? "axis" : "gridline"}" x1="${GUTTER}" x2="${width}" y1="${y(f * max)}" y2="${y(f * max)}"/>
      <text class="tick" x="${GUTTER - 8}" y="${y(f * max) + 3.5}" text-anchor="end">${Math.round(f * max)}%</text>`);
    const cols = values.map((_, i) => {
      const cx = GUTTER + (i + 0.5) * slot;
      return html`<g class="col-group">
        <rect class="col-bar" data-i="${i}" x="${cx - barW / 2}" width="${barW}" rx="${Math.min(4, barW / 3)}" height="0" y="${height}"><title></title></rect>
        ${i % labelEvery === 0 ? html`<text class="tick" x="${cx}" y="${height + 15}" text-anchor="middle">${i}</text>` : ""}
      </g>`;
    });
    setHtml(svg, html`${grid}${cols}`);
    bars = [...svg.querySelectorAll(".col-bar")];
    built = n;
  }

  function paint() {
    if (built !== values.length) build();
    bars.forEach((bar, i) => {
      const v = values[i] ?? 0;
      bar.setAttribute("y", y(v));
      bar.setAttribute("height", Math.max(height - y(v), 1));
      bar.style.fill = loadColor(v);
      bar.firstChild.textContent = `Core ${i}: ${v.toFixed(0)}%`;
    });
  }

  const observer = new ResizeObserver(([entry]) => {
    width = Math.max(entry.contentRect.width, 80);
    built = -1;
    paint();
  });
  observer.observe(container);

  return {
    update(next) { values = next; paint(); },
    destroy() { observer.disconnect(); },
  };
}
