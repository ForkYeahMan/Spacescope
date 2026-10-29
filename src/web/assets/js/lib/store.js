// App-wide live-metrics store.
//
// Polling is owned by the app shell, not by the dashboard page, so history keeps
// accumulating while you're on another page. Pages subscribe to the rolling
// buffers when they mount and unsubscribe when they leave. Polling pauses while
// the tab is hidden, and the store reports when the service stops answering.

import { getMetrics } from "./api.js";

export const CAPACITY = 60; // ~1 minute of history at 1 sample/second
const POLL_MS = 1000;
const OFFLINE_AFTER = 3; // consecutive failures

const history = { cpu: [], mem: [], disk: [], netRx: [], netTx: [] };
const state = { ...history, latest: null, online: true };
const subscribers = new Set();
let timer = null;
let failures = 0;
let inFlight = false;

function push(series, value) {
  series.push(Number.isFinite(value) ? value : 0);
  if (series.length > CAPACITY) series.shift();
}

function emit() {
  subscribers.forEach((fn) => {
    try { fn(state); } catch (e) { console.error(e); }
  });
}

function record(m) {
  push(state.cpu, m.cpu);
  push(state.mem, m.mem_percent);
  push(state.disk, m.disk_percent);
  push(state.netRx, m.net_rx_rate);
  push(state.netTx, m.net_tx_rate);
  state.latest = m;
}

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    record(await getMetrics());
    failures = 0;
    state.online = true;
  } catch {
    failures += 1;
    if (failures >= OFFLINE_AFTER) state.online = false;
  } finally {
    inFlight = false;
    emit();
  }
}

function schedule() {
  clearInterval(timer);
  timer = document.hidden ? null : setInterval(tick, POLL_MS);
  if (!document.hidden) tick();
}

/** Start the app-wide polling loop. Safe to call more than once. */
export function startMetrics() {
  document.addEventListener("visibilitychange", schedule);
  schedule();
}

/**
 * Subscribe to updates. Fires immediately with the current state, then on every
 * sample. Returns an unsubscribe function; the polling loop is never stopped.
 */
export function subscribe(fn) {
  subscribers.add(fn);
  if (state.latest) fn(state);
  return () => subscribers.delete(fn);
}
