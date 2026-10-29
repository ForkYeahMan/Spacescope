// Cleaner · scanning — live totals and a donut of what's been found so far.

import { html, setHtml } from "../../lib/dom.js";
import { bytes, num, clock, truncateMiddle } from "../../lib/format.js";
import { watchScan, cancelScan } from "../../lib/api.js";
import { donut } from "../../charts/donut.js";
import { pageHead, panel, metricGrid, setMetric } from "../../components/ui.js";
import { toSlices } from "./categories.js";

export function mountScanning(host, { path, startedAt, finish }) {
  setHtml(host, html`
    ${pageHead({
      title: "Scanning",
      sub: html`<span class="mono" style="font-size:13px">${path}</span>`,
      actions: html`<button type="button" class="btn" id="cancel">Cancel</button>`,
    })}
    <div class="progress" role="progressbar" aria-label="Scan progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
    ${metricGrid([
      { id: "percent", label: "Progress", value: "0%" },
      { id: "files", label: "Files", value: "0" },
      { id: "dirs", label: "Folders", value: "0" },
      { id: "size", label: "Size", value: "0 B" },
      { id: "time", label: "Elapsed", value: "0:00" },
    ])}
    ${panel({
      title: "Found so far",
      body: html`<div id="live"></div><p class="scan-path mono" id="current" aria-live="off"></p>`,
    })}`);

  const chart = donut(host.querySelector("#live"), { format: bytes, title: "Space found by category" });
  const current = host.querySelector("#current");
  const bar = host.querySelector(".progress");
  let percent = 0;
  const cancel = host.querySelector("#cancel");
  let stopped = false;

  const clockTimer = setInterval(() => setMetric(host, "time", clock((Date.now() - startedAt) / 1000)), 1000);

  const closeStream = watchScan({
    onProgress(p) {
      if (stopped) return;
      percent = Math.max(percent, Math.min(100, Math.floor(p.percent ?? 0)));
      setMetric(host, "percent", `${percent}%`);
      bar.style.setProperty("--p", `${percent}%`);
      bar.setAttribute("aria-valuenow", String(percent));
      setMetric(host, "files", num(p.files));
      setMetric(host, "dirs", num(p.dirs));
      setMetric(host, "size", bytes(p.size));
      if (p.current_path) current.textContent = truncateMiddle(p.current_path, 90);
      chart.update({ slices: toSlices(p.categories), center: { value: bytes(p.size), caption: "found" } });
      if (p.complete) { stopped = true; finish(p); }
    },
    onError() {
      if (!stopped) { stopped = true; finish({ complete: true, interrupted: true }); }
    },
  });

  cancel.addEventListener("click", async () => {
    cancel.disabled = true;
    try { await cancelScan(); } catch { cancel.disabled = false; }
  });

  return () => {
    stopped = true;
    clearInterval(clockTimer);
    closeStream();
  };
}
