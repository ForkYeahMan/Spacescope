// Dashboard — live CPU, memory, disk and network. The tiles show the current
// numbers; the charts show the last minute. Data comes from the app-wide store,
// so history keeps building while you're on other pages.

import { html, setHtml } from "../lib/dom.js";
import { subscribe, CAPACITY } from "../lib/store.js";
import { bytes, rate, pct, loadColor } from "../lib/format.js";
import { lineChart } from "../charts/line.js";
import { gauge } from "../charts/bars.js";
import { metricGrid, setMetric, pageHead, panel } from "../components/ui.js";

export async function mount(view, { navigate }) {
  setHtml(view, html`
    ${pageHead({ title: "Dashboard" })}
    ${metricGrid([
      { id: "cpu", label: "CPU" },
      { id: "mem", label: "Memory" },
      { id: "disk", label: "Disk" },
      { id: "net", label: "Network" },
    ])}
    <div class="grid-2">
      ${panel({ title: "CPU", body: html`<div id="chart-cpu"></div>` })}
      ${panel({ title: "Memory", body: html`<div id="chart-mem"></div>` })}
    </div>
    ${panel({ title: "Network", body: html`<div id="chart-net"></div>` })}
    ${panel({
      title: "Storage",
      actions: html`<button type="button" class="btn btn-sm" id="go-clean">Open Cleaner</button>`,
      body: html`<div id="disk-gauge"></div><p id="disk-note" class="muted" style="text-align:center;margin-top:8px"></p>`,
    })}`);

  const $ = (sel) => view.querySelector(sel);
  const cpu = lineChart($("#chart-cpu"), { series: [{ id: "cpu", label: "CPU", color: "var(--series-1)" }], format: (v) => pct(v), capacity: CAPACITY, yMax: 100, title: "CPU usage over the last minute" });
  const mem = lineChart($("#chart-mem"), { series: [{ id: "mem", label: "Memory", color: "var(--series-4)" }], format: (v) => pct(v), capacity: CAPACITY, yMax: 100, title: "Memory usage over the last minute" });
  const net = lineChart($("#chart-net"), {
    series: [
      { id: "rx", label: "Download", color: "var(--series-1)" },
      { id: "tx", label: "Upload", color: "var(--series-3)" },
    ],
    format: rate, capacity: CAPACITY, height: 170, title: "Network throughput over the last minute",
  });
  $("#go-clean").addEventListener("click", () => navigate("cleaner"));

  const unsubscribe = subscribe((s) => {
    const m = s.latest;
    if (!m) return;
    setMetric(view, "cpu", pct(m.cpu), "All cores");
    setMetric(view, "mem", pct(m.mem_percent), `${bytes(m.mem_used)} of ${bytes(m.mem_total)}`);
    setMetric(view, "disk", pct(m.disk_percent), `${bytes(m.disk_total - m.disk_used)} free`);
    setMetric(view, "net", rate(m.net_rx_rate + m.net_tx_rate), `${rate(m.net_rx_rate)} down · ${rate(m.net_tx_rate)} up`);

    cpu.update([s.cpu]);
    mem.update([s.mem]);
    net.update([s.netRx, s.netTx]);

    setHtml($("#disk-gauge"), gauge({ percent: m.disk_percent, color: loadColor(m.disk_percent), value: pct(m.disk_percent), caption: "of disk used" }));
    $("#disk-note").textContent = `${bytes(m.disk_used)} used of ${bytes(m.disk_total)}`;
  });

  return () => {
    unsubscribe();
    cpu.destroy();
    mem.destroy();
    net.destroy();
  };
}
