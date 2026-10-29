// Colours and grouping for the live scan breakdown.

const ORDER = [
  "Cache", "Temp Files", "node_modules", "Build Artifacts", "Package Cache", "Log Files", "Media", "Archives",
  "Large Files", "Old Files", "Duplicate Names", "Downloads", "Documents", "Library Files", "Hidden Files", "System Files",
];
const NEUTRAL = new Set(["Regular", "Other"]);

export function categoryColor(name) {
  if (NEUTRAL.has(name)) return "var(--skip)";
  const i = ORDER.indexOf(name);
  const slot = (i < 0 ? hash(name) : i) % 8;
  const base = `var(--series-${slot + 1})`;
  return i >= 8 ? `color-mix(in srgb, ${base} 58%, var(--bg))` : base;
}

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Biggest `max` categories plus one "Other" bucket, as donut slices. */
export function toSlices(categories, max = 8) {
  const sorted = categories.filter((c) => c.size > 0).sort((a, b) => b.size - a.size);
  const top = sorted.slice(0, max).map((c) => ({ key: c.name, label: c.name, value: c.size, color: categoryColor(c.name) }));
  const rest = sorted.slice(max).reduce((sum, c) => sum + c.size, 0);
  if (rest > 0) top.push({ key: "__other", label: "Other", value: rest, color: categoryColor("Other") });
  return top;
}
