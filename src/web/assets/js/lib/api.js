// Thin fetch wrapper and typed endpoints for the backend JSON/SSE API.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError("Can't reach the Spacescope service. Is it still running?", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data;
}

export const getConfig = () => request("/api/config");
export const getMetrics = (signal) => request("/api/metrics", { signal });
export const getSystem = (signal) => request("/api/system", { signal });
export const getTree = (path) => request(`/api/tree${path ? `?path=${encodeURIComponent(path)}` : ""}`);
export const getResults = () => request("/api/results");
export const startScan = (payload) => request("/api/scan", { method: "POST", body: payload });
export const getScanStatus = () => request("/api/scan/status");
export const cancelScan = () => request("/api/scan/cancel", { method: "POST" });
export const deletePaths = (paths, authorize = false) => request("/api/delete", { method: "POST", body: { paths, authorize } });

/** Open the scan progress stream. Returns a function that closes it. */
export function watchScan({ onProgress, onError }) {
  const source = new EventSource("/api/scan/stream");
  source.onmessage = (ev) => {
    try { onProgress(JSON.parse(ev.data)); } catch { /* ignore a malformed frame */ }
  };
  source.onerror = () => { source.close(); onError(); };
  return () => source.close();
}
