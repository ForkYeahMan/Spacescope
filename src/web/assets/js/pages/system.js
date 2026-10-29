// System — operating system, health, processor, memory, storage and sensors.
// The page skeleton is built once; each poll then updates its sections in place.

import { html, setHtml } from "../lib/dom.js";
import { getSystem } from "../lib/api.js";
import { bytes, pct, uptime, dateTime, loadColor } from "../lib/format.js";
import { barRow, gauge } from "../charts/bars.js";
import { columns } from "../charts/columns.js";
import { pageHead, panel, metricGrid, setMetric, empty, banner } from "../components/ui.js";

const POLL_MS = 3000;
const HEALTH = {
  healthy: ["green", "Healthy"],
  warning: ["amber", "Needs attention"],
  critical: ["red", "Critical"],
};

const kv = (rows) => html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v || "—"}</dd>`)}</dl>`;

export async function mount(view) {
  setHtml(view, html`
    ${pageHead({ title: "System" })}
    <div id="sys-error"></div>
    <div id="sys-body" class="view-stack"></div>`);
  const body = view.querySelector("#sys-body");
  const errorSlot = view.querySelector("#sys-error");
  let cores = null;
  let timer = null;
  let stopped = false;
  let controller = null;

  function build(s) {
    setHtml(body, html`
      ${metricGrid([
        { id: "cpu", label: "CPU" },
        { id: "ram", label: "Memory" },
        { id: "swap", label: "Swap" },
        { id: "load", label: "Load average" },
        { id: "uptime", label: "Uptime" },
      ])}
      <div class="grid-2">
        ${panel({ title: "Operating system", body: html`<div id="os"></div>` })}
        ${panel({ title: "Health", actions: html`<span id="health-pill"></span>`, body: html`<div id="health"></div>` })}
      </div>
      <div>${panel({
        title: "Processor",
        caption: s.cpu.brand || "Unknown CPU",
        body: html`<div class="grid-wide" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr)"><div id="cpu-kv"></div><div><div class="muted" style="margin-bottom:8px">Load per core</div><div id="core-chart"></div></div></div>`,
      })}</div>
      ${panel({ title: "Memory", body: html`<div id="mem" class="bar-rows"></div>` })}
      ${panel({ title: "Temperatures", actions: html`<button type="button" class="btn btn-sm" id="temps-toggle" hidden></button>`, body: html`<div id="temps"></div>` })}
      <div>${panel({ title: "Disks", body: html`<div id="disks" class="bar-rows"></div>` })}</div>`);
    cores = columns(body.querySelector("#core-chart"), { title: "CPU load per core", height: 130 });
    body.querySelector("#temps-toggle").addEventListener("click", () => { showAllTemps = !showAllTemps; drawTemps(lastTemps); });
  }

  // Temperatures as gauges: 0–110 °C, green below 60, amber below 80, red above.
  let showAllTemps = false;
  let lastTemps = [];
  function drawTemps(temps) {
    lastTemps = temps.filter((t) => t.celsius > 0 && t.celsius < 150).sort((a, b) => b.celsius - a.celsius);
    const limit = 12;
    const shown = showAllTemps ? lastTemps : lastTemps.slice(0, limit);
    const toggle = body.querySelector("#temps-toggle");
    toggle.hidden = lastTemps.length <= limit;
    toggle.textContent = showAllTemps ? "Show fewer" : `Show all ${lastTemps.length}`;
    setHtml(body.querySelector("#temps"), shown.length
      ? html`<div class="gauge-grid">${shown.map((t) => gauge({
        percent: Math.min(100, (t.celsius / 110) * 100),
        color: t.celsius >= 80 ? "var(--red)" : t.celsius >= 60 ? "var(--amber)" : "var(--green)",
        value: `${t.celsius.toFixed(0)}°C`,
        caption: t.label,
        small: true,
      }))}</div>`
      : empty("No temperature sensors available", "This system doesn't report temperatures."));
  }

  function apply(s) {
    const $ = (sel) => body.querySelector(sel);
    const worstDisk = Math.max(0, ...(s.disks ?? []).map((d) => d.percent));

    setMetric(body, "cpu", pct(s.cpu.usage), `${s.cpu.logical_cores} logical cores`);
    setMetric(body, "ram", pct(s.memory.percent), `${bytes(s.memory.used)} of ${bytes(s.memory.total)}`);
    setMetric(body, "swap", s.memory.swap_total ? pct(s.memory.swap_percent) : "Off", s.memory.swap_total ? `${bytes(s.memory.swap_used)} of ${bytes(s.memory.swap_total)}` : "Not configured");
    setMetric(body, "load", s.load.one.toFixed(2), `${s.load.five.toFixed(2)} (5m) · ${s.load.fifteen.toFixed(2)} (15m)`);
    setMetric(body, "uptime", uptime(s.os.uptime), `Since ${dateTime(s.os.boot_time)}`);

    setHtml($("#os"), kv([
      ["System", s.os.name], ["Version", s.os.os_version], ["Kernel", s.os.kernel],
      ["Architecture", s.os.arch], ["Hostname", s.os.hostname],
    ]));

    const [tone, label] = HEALTH[s.health.status] ?? HEALTH.healthy;
    setHtml($("#health-pill"), html`<span class="pill ${tone}">${label}</span>`);
    setHtml($("#health"), html`
      ${(s.health.issues ?? []).length
        ? html`<ul class="issues">${s.health.issues.map((i) => html`<li>${i}</li>`)}</ul>`
        : html`<p class="muted" style="margin-bottom:16px">No problems detected.</p>`}
      <div class="bar-rows">
        ${[["CPU", s.cpu.usage], ["Memory", s.memory.percent], ["Swap", s.memory.swap_percent], ["Busiest disk", worstDisk]].map(([name, v]) =>
          barRow({ name, meta: html`<b class="nums">${pct(v)}</b>`, percent: v, color: loadColor(v) }))}
      </div>`);

    setHtml($("#cpu-kv"), kv([
      ["Cores", `${s.cpu.physical_cores} physical · ${s.cpu.logical_cores} logical`],
      ["Frequency", `${(s.cpu.frequency_mhz / 1000).toFixed(2)} GHz`],
      ["Total load", pct(s.cpu.usage)],
    ]));
    cores.update((s.cpu.per_core ?? []).map((v) => Math.min(100, v)));

    setHtml($("#mem"), html`
      ${barRow({ name: "RAM", meta: html`<b class="nums">${bytes(s.memory.used)}</b> / ${bytes(s.memory.total)} · ${pct(s.memory.percent)}`, percent: s.memory.percent, color: loadColor(s.memory.percent) })}
      ${barRow({ name: "Swap", meta: s.memory.swap_total ? html`<b class="nums">${bytes(s.memory.swap_used)}</b> / ${bytes(s.memory.swap_total)} · ${pct(s.memory.swap_percent)}` : "not configured", percent: s.memory.swap_percent, color: "var(--series-4)" })}`);

    drawTemps(s.temperatures ?? []);

    setHtml($("#disks"), (s.disks ?? []).length
      ? s.disks.map((d) => barRow({
        name: d.mount,
        meta: html`<b class="nums">${bytes(d.used)}</b> / ${bytes(d.total)} · ${pct(d.percent)}`,
        percent: d.percent, color: loadColor(d.percent),
        sub: [d.fs, d.kind, d.name].filter(Boolean).join(" · "),
      }))
      : empty("No disks reported"));
  }

  async function refresh() {
    controller = new AbortController();
    try {
      const s = await getSystem(controller.signal);
      if (stopped) return;
      errorSlot.replaceChildren();
      if (!cores) build(s);
      apply(s);
    } catch (e) {
      if (e.name === "AbortError" || stopped) return;
      setHtml(errorSlot, banner({ kind: "error", title: "Couldn't read system information", message: e.message, retry: true }));
      errorSlot.querySelector("[data-retry]").addEventListener("click", refresh);
    }
  }

  function schedule() {
    clearInterval(timer);
    timer = document.hidden ? null : setInterval(refresh, POLL_MS);
  }
  const onVisibility = () => { schedule(); if (!document.hidden) refresh(); };
  document.addEventListener("visibilitychange", onVisibility);

  await refresh();
  schedule();

  return () => {
    stopped = true;
    clearInterval(timer);
    controller?.abort();
    cores?.destroy();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
