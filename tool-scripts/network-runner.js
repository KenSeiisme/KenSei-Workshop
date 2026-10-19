import { NETWORK_BUDGET, NETWORK_MEASUREMENTS } from "./network-config.js";
const id = location.hash.slice(1),
  parentOrigin = location.origin;
const emit = (type, data = {}) =>
  parent.postMessage({ id, type, ...data }, parentOrigin);
const originalFetch = window.fetch.bind(window);
let used = 0,
  engine,
  stopped = false,
  started = false;
function stop() {
  stopped = true;
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
  emit("traffic", { used });
  return originalFetch(input, {
    ...options,
    credentials: "omit",
    cache: "no-store",
  });
};
const metric = (getter, scale = 1) => {
  const value = engine.results[getter]();
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value / scale
    : null;
};
function metrics() {
  return {
    download: metric("getDownloadBandwidth", 1e6),
    upload: metric("getUploadBandwidth", 1e6),
    latency: metric("getUnloadedLatency"),
    jitter: metric("getUnloadedJitter"),
    downloadLatency: metric("getDownLoadedLatency"),
    uploadLatency: metric("getUpLoadedLatency"),
  };
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
  try {
    const { default: SpeedTest } = await import("/vendor/speedtest.js");
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
      if (!stopped) emit("metrics", { metrics: metrics() });
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
