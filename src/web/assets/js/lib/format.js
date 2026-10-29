// Number, size and time formatting shared by every page.

// Decimal units (1 GB = 1,000,000,000 B), the same as Finder and System Settings.
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function bytes(n, digits = 1) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  const v = n / 1000 ** i;
  return `${i === 0 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : digits)} ${UNITS[i]}`;
}

export const rate = (perSec) => `${bytes(perSec)}/s`;
export const pct = (n, digits = 0) => `${(Number.isFinite(n) ? n : 0).toFixed(digits)}%`;
export const num = (n) => (Number.isFinite(n) ? n : 0).toLocaleString();
export const plural = (n, word) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;

/** Seconds → "3d 4h 12m". */
export function uptime(secs) {
  secs = Math.floor(secs || 0);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(" ");
}

/** Seconds → "1:05". */
export function clock(secs) {
  secs = Math.max(0, Math.floor(secs));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function dateTime(unixSecs) {
  return unixSecs ? new Date(unixSecs * 1000).toLocaleString() : "—";
}

/** Colour for a 0–100 utilisation figure. */
export function loadColor(percent) {
  if (percent >= 90) return "var(--red)";
  if (percent >= 75) return "var(--amber)";
  return "var(--green)";
}

export function dirname(path) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path.slice(0, i + 1) || path;
}

export function truncateMiddle(text, max = 48) {
  if (text.length <= max) return text;
  const keep = max - 1;
  return `${text.slice(0, Math.ceil(keep / 2))}…${text.slice(-Math.floor(keep / 2))}`;
}

/** Milliseconds-since-epoch → "5 min ago". */
export function ago(ms) {
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}
