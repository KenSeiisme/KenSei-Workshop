// 所有展示值由有效测量样本产生；缺失样本不能冒充零值。
export function quantile(values, p = 0.5) {
  const a = values
    .filter((x) => typeof x === "number" && Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  if (!a.length) return null;
  const i = (a.length - 1) * p,
    lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
}
export function distribution(values) {
  const a = values.filter(
    (x) => typeof x === "number" && Number.isFinite(x) && x >= 0,
  );
  return {
    count: a.length,
    min: quantile(a, 0),
    median: quantile(a),
    p95: quantile(a, 0.95),
    max: quantile(a, 1),
    jitter:
      a.length < 2
        ? null
        : a.slice(1).reduce((s, v, i) => s + Math.abs(v - a[i]), 0) /
          (a.length - 1),
  };
}
export function summarize(samples = {}) {
  const speed = (key) => {
    const points = (samples[key] || []).filter(
        (p) => p.duration >= 10 && Number.isFinite(p.mbps) && p.mbps > 0,
      ),
      a = points.map((p) => p.mbps);
    return { ...distribution(a), p90: quantile(a, 0.9) };
  };
  const idle = distribution(samples.idle || []),
    down = distribution(samples.downLatency || []),
    up = distribution(samples.upLatency || []);
  return {
    download: speed("download"),
    upload: speed("upload"),
    idle,
    down,
    up,
    downIncrease:
      idle.median === null || down.median === null
        ? null
        : down.median - idle.median,
    upIncrease:
      idle.median === null || up.median === null
        ? null
        : up.median - idle.median,
  };
}
export function publicReport(row) {
  // 显式白名单，原始 IP 和服务端精确坐标不会进入持久化或导出数据。
  const source = row.connection || {},
    connection = {};
  for (const key of [
    "organization",
    "asn",
    "country",
    "city",
    "node",
    "nodeCity",
    "protocol",
  ])
    if (typeof source[key] === "string")
      connection[key] = source[key].slice(0, 150);
  const numeric = (n) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  const metrics = Object.fromEntries(
    [
      "download",
      "upload",
      "latency",
      "jitter",
      "downloadLatency",
      "uploadLatency",
    ].map((k) => [k, numeric(row.metrics?.[k])]),
  );
  let samples;
  if (row.samples) {
    samples = {};
    for (const key of ["download", "upload"])
      samples[key] = (Array.isArray(row.samples[key]) ? row.samples[key] : [])
        .slice(0, 500)
        .filter(
          (p) =>
            p &&
            ["t", "mbps", "bytes", "duration"].every(
              (k) => numeric(p[k]) !== null,
            ),
        )
        .map((p) =>
          Object.fromEntries(
            ["t", "mbps", "bytes", "duration"].map((k) => [k, p[k]]),
          ),
        );
    for (const key of ["idle", "downLatency", "upLatency"])
      samples[key] = (Array.isArray(row.samples[key]) ? row.samples[key] : [])
        .filter((n) => numeric(n) !== null)
        .slice(0, 500);
  }
  const traffic = {};
  for (const key of [
    "attemptedDownload",
    "attemptedUpload",
    "completedDownload",
    "completedUpload",
    "requests",
    "rateLimits",
  ])
    if (numeric(row.traffic?.[key]) !== null) traffic[key] = row.traffic[key];
  return {
    id: row.id,
    date: row.date,
    ...(typeof row.label === "string" ? { label: row.label.slice(0, 80) } : {}),
    version: row.version || 1,
    metrics,
    used: numeric(row.used) || 0,
    ...(samples ? { samples, stats: summarize(samples) } : {}),
    ...(row.traffic ? { traffic } : {}),
    ...(numeric(row.elapsed) !== null ? { elapsed: row.elapsed } : {}),
    connection,
  };
}
