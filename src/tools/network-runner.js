import { NETWORK_BUDGET, NETWORK_MEASUREMENTS } from "./network-config.js";
import { summarize } from "./network-stats.js";
const id = location.hash.slice(1),
  parentOrigin = location.origin;
const emit = (type, data = {}) =>
  parent.postMessage({ id, type, ...data }, parentOrigin);
const originalFetch = window.fetch.bind(window);
let used = 0,
  engine,
  stopped = false,
  started = false;
let metaUsed = false,
  metaController = null,
  connection = {},
  startTime = 0,
  startEpoch = 0,
  lastPublish = 0;
const attempts = { download: 0, upload: 0, requests: 0, rateLimits: 0 };
function stop() {
  stopped = true;
  metaController?.abort();
  engine?.pause();
}
// 只修改隔离 iframe 的 fetch，不影响登录、工作区或其他工具。
window.fetch = (input, options = {}) => {
  const url = new URL(
    typeof input === "string" ? input : input.url,
    location.href,
  );
  const method = (options.method || "GET").toUpperCase();
  if (
    url.origin === "https://speed.cloudflare.com" &&
    url.pathname === "/meta" &&
    !url.search &&
    method === "GET" &&
    !metaUsed &&
    !stopped
  ) {
    metaUsed = true;
    return originalFetch(input, {
      ...options,
      credentials: "omit",
      cache: "no-store",
    });
  }
  if (
    url.origin !== "https://speed.cloudflare.com" ||
    !["/__down", "/__up"].includes(url.pathname) ||
    stopped
  )
    return Promise.reject(
      new Error("Unexpected or stopped measurement request."),
    );
  const bytes = Number(url.searchParams.get("bytes"));
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > 50000000 ||
    (url.pathname === "/__up"
      ? method !== "POST" ||
        typeof options.body !== "string" ||
        options.body.length !== bytes
      : method !== "GET")
  )
    return Promise.reject(new Error("Invalid measurement request."));
  if (used + bytes > NETWORK_BUDGET) {
    stop();
    emit("error", {
      message:
        "The 500 MB test payload budget was reached. Retry manually if needed.",
    });
    return Promise.reject(new Error("Test payload budget reached."));
  }
  used += bytes;
  attempts[url.pathname === "/__up" ? "upload" : "download"] += bytes;
  attempts.requests++;
  emit("traffic", { used });
  return originalFetch(input, {
    ...options,
    credentials: "omit",
    cache: "no-store",
  }).then((response) => {
    if (response.status === 429) attempts.rateLimits++;
    return response;
  });
};
function metrics() {
  return snapshot().metrics;
}
function snapshot() {
  const rawDown = engine.results.getDownloadBandwidthPoints(),
    rawUp = engine.results.getUploadBandwidthPoints();
  const speeds = (points) =>
    points
      .filter((p) => p.duration >= 10 && Number.isFinite(p.bps) && p.bps > 0)
      .map((p) => ({
        t: Math.max(0, (new Date(p.measTime).getTime() - startEpoch) / 1000),
        mbps: p.bps / 1e6,
        bytes: p.bytes,
        duration: p.duration,
      }))
      .sort((a, b) => a.t - b.t);
  const clean = (list) =>
    list.filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
  const samples = {
    download: speeds(rawDown),
    upload: speeds(rawUp),
    idle: clean(engine.results.getUnloadedLatencyPoints()),
    downLatency: clean(engine.results.getDownLoadedLatencyPoints()),
    upLatency: clean(engine.results.getUpLoadedLatencyPoints()),
  };
  const stats = summarize(samples);
  return {
    metrics: {
      download: stats.download.p90,
      upload: stats.upload.p90,
      latency: stats.idle.median,
      jitter: stats.idle.jitter,
      downloadLatency: stats.down.median,
      uploadLatency: stats.up.median,
    },
    samples,
    stats,
    elapsed: Math.max(0, (performance.now() - startTime) / 1000),
    traffic: {
      attemptedDownload: attempts.download,
      attemptedUpload: attempts.upload,
      requests: attempts.requests,
      rateLimits: attempts.rateLimits,
      completedDownload: rawDown.reduce((s, p) => s + p.bytes, 0),
      completedUpload: rawUp.reduce((s, p) => s + p.bytes, 0),
    },
  };
}
async function readConnection() {
  metaController = new AbortController();
  const timer = setTimeout(() => metaController.abort(), 5000);
  try {
    const r = await fetch("https://speed.cloudflare.com/meta", {
      signal: metaController.signal,
    });
    if (!r.ok) throw Error("Metadata unavailable");
    const text = await r.text();
    if (text.length > 16000) throw Error("Metadata too large");
    const d = JSON.parse(text),
      value = (s) => (typeof s === "string" ? s.slice(0, 150) : "");
    connection = {
      ip: value(d.clientIp),
      organization: value(d.asOrganization),
      asn: d.asn === undefined ? "" : String(d.asn).slice(0, 20),
      country: value(d.country),
      city: value(d.city),
      node: value(d.colo?.iata),
      nodeCity: value(d.colo?.city),
      protocol: value(d.httpProtocol),
    };
  } catch {
    connection = {};
  } finally {
    clearTimeout(timer);
    metaController = null;
  }
  if (!stopped) emit("connection", { connection });
}
window.addEventListener("message", async (event) => {
  if (
    event.source !== parent ||
    event.origin !== parentOrigin ||
    event.data.id !== id
  )
    return;
  if (event.data.type === "cancel") {
    stop();
    emit("stopped");
    return;
  }
  if (event.data.type !== "start" || started) return;
  started = true;
  startTime = performance.now();
  startEpoch = Date.now();
  try {
    const { default: SpeedTest } = await import("/vendor/speedtest.js");
    if (stopped) return;
    await readConnection();
    if (stopped) return;
    engine = new SpeedTest({
      autoStart: false,
      logMeasurementApiUrl: null,
      logAimApiUrl: null,
      includeCredentials: false,
      measurements: NETWORK_MEASUREMENTS,
      bandwidthAbortRequestDuration: 15000,
      measureDownloadLoadedLatency: true,
      measureUploadLoadedLatency: true,
    });
    engine.onPhaseChange = ({ measurementId, measurement }) =>
      emit("phase", {
        phase: measurement.type,
        progress: (measurementId / NETWORK_MEASUREMENTS.length) * 100,
      });
    engine.onResultsChange = () => {
      if (!stopped && performance.now() - lastPublish >= 100) {
        lastPublish = performance.now();
        emit("metrics", snapshot());
      }
    };
    engine.onError = (message, status) => {
      if (!stopped) {
        stop();
        emit("error", {
          message:
            status === 429
              ? "Cloudflare is temporarily rate limiting tests. Wait a moment and retry."
              : "Measurement failed: " + message,
        });
      }
    };
    engine.onFinish = () => {
      if (stopped) return;
      const result = metrics();
      const details = snapshot();
      stop();
      if (result.download === null || result.upload === null)
        emit("error", {
          message:
            "Not enough usable bandwidth samples. Check your connection and retry; no completed result was saved.",
          metrics: result,
        });
      else
        emit("complete", {
          metrics: result,
          used,
          date: new Date().toISOString(),
          ...details,
        });
    };
    engine.play();
  } catch (e) {
    if (!stopped) {
      stop();
      emit("error", {
        message:
          "Could not start this test. Check your connection and retry. " +
          e.message,
      });
    }
  }
});
emit("ready");
