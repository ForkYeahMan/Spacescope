// Sunburst: the current folder in the middle, its contents in rings around it.
// Each ring slices its parent's arc by size, so a thick wedge is a big folder
// and the rings outward are what's inside it. Hover reads out a wedge, click
// opens a folder, click the middle to go up.

import { html, setHtml } from "../lib/dom.js";
import { ringArc } from "./geometry.js";

const VIEW = 1000;
const C = VIEW / 2;
const HOLE = 150;
const EDGE = 8;
const MIN_ANGLE = 0.006; // radians; thinner wedges aren't drawn

/** Hue follows the angle, so neighbouring folders get neighbouring colours. */
export function nodeColor(angle, ring, kind) {
  if (kind === "rest") return `hsl(220 6% ${ring === 1 ? 56 : 62}%)`;
  const hue = 18 + (angle / (Math.PI * 2)) * 300;
  return `hsl(${hue.toFixed(0)} 68% ${54 + ring * 5}%)`;
}

/** Lay `root`'s descendants out as arcs: `{node, ring, a0, a1, color}`. */
export function layout(root) {
  const arcs = [];
  const rings = depthOf(root);
  const width = (C - EDGE - HOLE) / Math.max(rings, 1);

  const place = (node, ring, a0, a1, hueAngle) => {
    const total = node.children.reduce((s, c) => s + c.size, 0) || node.size;
    let at = a0;
    for (const child of node.children) {
      const span = ((a1 - a0) * child.size) / total;
      const start = at;
      at += span;
      if (span < MIN_ANGLE) continue;
      const hue = ring === 1 ? (start + span / 2) : hueAngle;
      arcs.push({ node: child, ring, a0: start, a1: start + span, inner: HOLE + (ring - 1) * width, outer: HOLE + ring * width, color: nodeColor(hue, ring, child.kind) });
      if (child.children.length) place(child, ring + 1, start, start + span, hue);
    }
  };
  place(root, 1, 0, Math.PI * 2, 0);
  return arcs;
}

function depthOf(node) {
  return node.children.length ? 1 + Math.max(...node.children.map(depthOf)) : 0;
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {(node)=>void} opts.onOpen   a folder wedge was clicked
 * @param {()=>void} opts.onUp         the middle was clicked
 * @param {(path:string|null)=>void} [opts.onHover]
 */
export function sunburst(container, { onOpen, onUp, onHover }) {
  let arcs = [];
  let root = null;
  let hover = null;
  let canGoUp = false;
  let format = String;

  container.classList.add("sunburst");

  function draw() {
    setHtml(container, html`
      <svg viewBox="0 0 ${VIEW} ${VIEW}" role="img" aria-label="Disk usage of ${root.name}">
        ${arcs.map((a, i) => html`<path class="wedge" data-i="${i}" data-path="${a.node.path}"
          d="${a.a1 - a.a0 > Math.PI * 1.9999 ? ringArc(C, C, a.outer, a.inner, 0, Math.PI * 2 - 0.0001) : ringArc(C, C, a.outer - 1.5, a.inner, a.a0, a.a1)}"
          fill="${a.color}" data-kind="${a.node.kind}"><title>${a.node.name}: ${format(a.node.size)}</title></path>`)}
        <circle class="hole ${canGoUp ? "up" : ""}" cx="${C}" cy="${C}" r="${HOLE - 6}" />
      </svg>
      <div class="sb-center"><b></b><span></span></div>`);
    paint();
  }

  function paint() {
    const hot = hover !== null ? arcs[hover]?.node : null;
    container.querySelectorAll(".wedge").forEach((el, i) => {
      el.classList.toggle("dim", hover !== null && i !== hover);
    });
    const centre = container.querySelector(".sb-center");
    if (!centre) return;
    centre.querySelector("b").textContent = format((hot ?? root).size);
    centre.querySelector("span").textContent = (hot ?? root).name + (!hot && canGoUp ? " · back" : "");
  }

  const indexOf = (e) => {
    const el = e.target.closest(".wedge");
    return el ? Number(el.dataset.i) : null;
  };
  container.addEventListener("pointerover", (e) => {
    const i = indexOf(e);
    if (i !== hover) { hover = i; paint(); onHover?.(i === null ? null : arcs[i].node.path); }
  });
  container.addEventListener("pointerleave", () => {
    if (hover !== null) { hover = null; paint(); onHover?.(null); }
  });
  container.addEventListener("click", (e) => {
    const i = indexOf(e);
    if (i !== null) { if (arcs[i].node.kind === "dir") onOpen(arcs[i].node); return; }
    if (e.target.closest(".hole, .sb-center") && canGoUp) onUp();
  });

  return {
    update(node, { up, formatSize }) {
      root = node; canGoUp = up; format = formatSize; hover = null;
      arcs = layout(node);
      draw();
    },
    /** Highlight a wedge from outside (a list row was hovered). */
    highlight(path) {
      const i = path === null ? null : arcs.findIndex((a) => a.node.path === path);
      hover = i === -1 ? null : i;
      paint();
    },
  };
}
