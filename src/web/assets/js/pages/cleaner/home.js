// Cleaner · step 1 — choose where to scan.

import { html, setHtml } from "../../lib/dom.js";
import { bytes, pct, loadColor } from "../../lib/format.js";
import { gauge } from "../../charts/bars.js";
import { pageHead, panel } from "../../components/ui.js";

export function mountHome(host, { config, prefs, start }) {
  const targets = [
    { id: "full", name: "Entire disk", desc: "Everything on the main drive", path: config.root_path },
    { id: "home", name: "Home folder", desc: "Your files and apps", path: config.home_path },
    { id: "custom", name: "Another folder", desc: "Choose any path" },
  ];
  const s = config.storage;

  setHtml(host, html`
    ${pageHead({ title: "Cleaner" })}
    <div class="grid-wide" style="align-items:start">
      ${panel({
        title: "Where to scan",
        body: html`
          <div class="locations" role="radiogroup" aria-label="Where to scan">
            ${targets.map((t) => html`
              <label class="location">
                <input type="radio" name="target" value="${t.id}" ${prefs.target === t.id ? "checked" : ""} />
                <span class="location-body">
                  <span class="location-main"><b>${t.name}</b><span>${t.desc}</span></span>
                  ${t.path ? html`<code>${t.path}</code>` : ""}
                </span>
              </label>`)}
          </div>
          <div class="field" id="custom-field" ${prefs.target === "custom" ? "" : "hidden"} style="margin-top:14px">
            <label for="custom-path">Folder path</label>
            <input class="input mono" id="custom-path" placeholder="/path/to/folder" value="${prefs.customPath}" autocomplete="off" spellcheck="false" />
          </div>
          <details class="options">
            <summary>Options</summary>
            <div class="scan-options">
              <div class="field"><label for="min-size">Minimum file size (MB)</label><input class="input" id="min-size" type="number" min="0" value="${prefs.minSize}" /></div>
              <div class="field"><label for="max-depth">Folder depth (0 = unlimited)</label><input class="input" id="max-depth" type="number" min="0" value="${prefs.depth}" /></div>
            </div>
          </details>
          <p class="hint error" id="form-error" role="alert" style="margin-top:12px"></p>
          <div style="margin-top:14px"><button type="button" class="btn btn-solid" id="start">Start scan</button></div>`,
      })}
      ${panel({
        title: "Disk",
        body: html`${gauge({ percent: s.percent, color: loadColor(s.percent), value: pct(s.percent), caption: "used" })}
          <p class="muted" style="text-align:center;margin-top:8px">${bytes(s.available)} free of ${bytes(s.total)}</p>`,
      })}
    </div>`);

  const $ = (sel) => host.querySelector(sel);
  const int = (v) => Math.max(0, parseInt(v, 10) || 0);
  const fail = (message) => { $("#form-error").textContent = message; };

  host.addEventListener("change", (e) => {
    if (e.target.name !== "target") return;
    prefs.target = e.target.value;
    $("#custom-field").hidden = prefs.target !== "custom";
    if (prefs.target === "custom") $("#custom-path").focus();
  });
  host.addEventListener("input", (e) => {
    fail("");
    if (e.target.id === "custom-path") { prefs.customPath = e.target.value; e.target.removeAttribute("aria-invalid"); }
    if (e.target.id === "min-size") prefs.minSize = int(e.target.value);
    if (e.target.id === "max-depth") prefs.depth = int(e.target.value);
  });

  async function submit() {
    const target = targets.find((t) => t.id === prefs.target);
    const chosen = (target.path ?? prefs.customPath).trim();
    if (!chosen) {
      fail("Enter a folder path.");
      $("#custom-path").setAttribute("aria-invalid", "true");
      $("#custom-path").focus();
      return;
    }
    const button = $("#start");
    button.disabled = true;
    try {
      await start({ path: chosen, min_size_mb: prefs.minSize, max_depth: prefs.depth }, prefs);
    } catch (e) {
      button.disabled = false;
      fail(e.message);
    }
  }

  $("#start").addEventListener("click", () => submit());
  host.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input:not([type=radio])")) submit();
  });
}
