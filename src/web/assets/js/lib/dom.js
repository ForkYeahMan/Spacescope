// Tiny templating helpers. `html` escapes every interpolated value unless it
// was produced by another `html` call (or wrapped in `raw`), so building markup
// from scanned file names is safe by default.

class Raw {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export const raw = (value) => new Raw(String(value));

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function render(value) {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false) return "";
  return esc(value);
}

/** Tagged template → trusted markup string. */
export function html(strings, ...values) {
  return new Raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ""), ""));
}

/** Replace `el`'s contents with markup. */
export function setHtml(el, markup) {
  el.innerHTML = render(markup);
}

export const $ = (root, selector) => root.querySelector(selector);
export const $$ = (root, selector) => [...root.querySelectorAll(selector)];

/** Run `fn` at most once per animation frame, with the latest arguments. */
export function frameThrottle(fn) {
  let queued = null;
  return (...args) => {
    const idle = queued === null;
    queued = args;
    if (idle) requestAnimationFrame(() => { const a = queued; queued = null; fn(...a); });
  };
}
