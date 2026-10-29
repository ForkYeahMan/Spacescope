// Cleaner — choose, scan, review; each has its own URL:
//
//   #/cleaner            choose what to scan
//   #/cleaner/scanning   live progress
//   #/cleaner/results    review and clean up
//
// The server is the source of truth for where the flow stands, so a reload (or
// a pasted link) lands on the right step and a running scan is picked back up.

import { getScanStatus, startScan, getResults } from "../../lib/api.js";
import { load, save } from "../../lib/storage.js";
import { notify } from "../../components/notify.js";
import { mountHome } from "./home.js";
import { mountScanning } from "./scanning.js";
import { mountBrowse } from "./browse.js";

export async function mount(view, { config, route, navigate }) {
  const [status, step] = [await getScanStatus(), route.rest[0] ?? ""];
  const go = (to, opts = { replace: true }) => navigate(to ? `cleaner/${to}` : "cleaner", opts);

  if (status.running) {
    if (step !== "scanning") return go("scanning");
  } else if (step === "scanning") {
    return go(status.has_results ? "results" : "");
  } else if (step === "results" && !status.has_results) {
    return go("");
  }

  if (step === "scanning") {
    return mountScanning(view, {
      path: status.path,
      startedAt: Date.now() - status.elapsed_secs * 1000,
      finish,
    });
  }
  if (step === "results") {
    return mountBrowse(view, { route, authorized: status.delete_authorized, again: () => go("", { replace: false }) });
  }

  const prefs = {
    target: "full",
    customPath: config.default_path,
    minSize: config.min_size_mb,
    depth: config.max_depth,
    ...load("cleaner-prefs", {}),
  };
  return mountHome(view, { config, prefs, start });

  async function start(payload, nextPrefs) {
    await startScan(payload);
    save("cleaner-prefs", nextPrefs);
    go("scanning", { replace: false });
  }

  async function finish(progress) {
    if (progress.cancelled) {
      notify({ kind: "info", title: "Scan cancelled" });
      return go("");
    }
    if (progress.error) {
      notify({ kind: "error", title: "Scan failed", message: progress.error });
      return go("");
    }
    try {
      await getResults();
      go("results");
    } catch (e) {
      notify({ kind: "error", title: "Couldn't load results", message: e.message });
      go("");
    }
  }
}
