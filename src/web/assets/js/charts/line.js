// Live line chart: smooth monotone lines, a dotted fill under the first series,
// hairline grid and a crosshair that reads out any moment in the window.

import { html, setHtml } from "../lib/dom.js";
import { monotone, niceMax } from "./geometry.js";

let nextId = 0;

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {{id:string,label:string,color:string}[]} opts.series  first series gets the dotted fill
 * @param {(v:number)=>string} opts.format
 * @param {number} opts.capacity   samples in a full window
 * @param {number|null} [opts.yMax] fixed axis maximum; null = fit the data
 * @param {number} [opts.height]
 * @param {string} opts.title      accessible label
 */
export function lineChart(container, { series, format, capacity, yMax = null, height = 150, title }) {
  const pattern = `dots-${nextId++}`;
  let data = series.map(() => []);
  let width = 400;
  let hover = null; // index into the visible window

  setHtml(container, html`
    <div class="viz">
      <div class="lines-legend" aria-live="off"></div>
      <div class="lines"><span class="lines-max"></span><svg role="img" aria-label="${title}" width="100%" height="${height}"></svg></div>
      <div class="axis-ends"><span>${capacity}s ago</span><span>Now</span></div>
    </div>`);
  const legend = container.querySelector(".lines-legend");
  const maxLabel = container.querySelector(".lines-max");
  const svg = container.querySelector("svg");

  const pad = 14;
  const count = () => data[0].length;
  const xAt = (i) => (width * (capacity - count() + i)) / Math.max(capacity - 1, 1);
  const axisMax = () => yMax ?? niceMax(Math.max(1, ...data.flat()));
  const yAt = (v, max) => pad + (height - pad) * (1 - v / max);

  function draw() {
    const max = axisMax();
    const n = count();
    const pts = (values) => values.map((v, i) => [xAt(i), yAt(v, max)]);
    const first = pts(data[0]);
    const fill = n > 1
      ? html`<path d="${monotone(first)}L${first[n - 1][0]},${height}L${first[0][0]},${height}Z" fill="url(#${pattern})" opacity="0.55"/>`
      : "";
    const lines = series.map((s, si) => html`<path d="${monotone(pts(data[si]))}" fill="none" stroke="${s.color}" stroke-width="${si === 0 ? 2 : 1.75}" stroke-dasharray="${si === 0 ? "none" : "4 3"}" stroke-linejoin="round"/>`);

    const cross = hover !== null && hover < n
      ? html`<line class="crosshair" x1="${xAt(hover)}" x2="${xAt(hover)}" y1="0" y2="${height}"/>
          ${series.map((s, si) => html`<circle cx="${xAt(hover)}" cy="${yAt(data[si][hover], max)}" r="3.5" fill="var(--bg)" stroke="${s.color}" stroke-width="2"/>`)}`
      : "";

    setHtml(svg, html`
      <defs><pattern id="${pattern}" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.1" fill="${series[0].color}"/></pattern></defs>
      <line class="gridline" x1="0" x2="${width}" y1="${yAt(max, max)}" y2="${yAt(max, max)}"/>
      <line class="gridline" x1="0" x2="${width}" y1="${yAt(max / 2, max)}" y2="${yAt(max / 2, max)}"/>
      <line class="axis" x1="0" x2="${width}" y1="${height}" y2="${height}"/>
      ${fill}${lines}${cross}`);
    maxLabel.textContent = format(max);

    const at = hover !== null && hover < n ? hover : n - 1;
    const when = hover !== null && hover < n ? (n - 1 - hover === 0 ? "Now" : `${n - 1 - hover}s ago`) : "";
    setHtml(legend, html`${series.map((s, si) => {
      const v = data[si][at];
      return html`<span><i style="background:${s.color}"></i>${s.label} <b>${v === undefined ? "—" : format(v)}</b></span>`;
    })}${when ? html`<span class="when">${when}</span>` : ""}`);
  }

  svg.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const slot = Math.round(((e.clientX - box.left) / box.width) * (capacity - 1)) - (capacity - count());
    hover = slot >= 0 && slot < count() ? slot : null;
    draw();
  });
  svg.addEventListener("pointerleave", () => { hover = null; draw(); });

  const observer = new ResizeObserver(([entry]) => {
    width = Math.max(entry.contentRect.width, 80);
    draw();
  });
  observer.observe(svg);

  draw();
  return {
    /** Replace the visible window; `next[i]` is the samples for series i, oldest first. */
    update(next) { data = next; draw(); },
    destroy() { observer.disconnect(); },
  };
}
