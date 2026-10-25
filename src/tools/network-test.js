import { $, copy, downloadText, download, canvasBlob } from "./common.js";
import { publicReport, summarize } from "./network-stats.js";
import {
  uiOption,
  uiDate,
  uiMsg,
  uiJoin,
  uiFrom,
  uiText,
  uiAttr,
} from "../site/ui.js";

const key = "kensei-network-history-v1",
  fields = {
    download: ["Download", "speed"],
    upload: ["Upload", "speed"],
    latency: ["Idle latency", "ms"],
    jitter: ["Idle jitter", "ms"],
    downloadLatency: ["Download latency", "ms"],
    uploadLatency: ["Upload latency", "ms"],
  };
let frame = null,
  run = null,
  timeout = null,
  ticker = null,
  running = false,
  last = null,
  phase = "ready",
  current = {},
  connection = {},
  showIP = false,
  began = 0,
  plotClass = null,
  speedPlot = null,
  latencyPlot = null,
  plotLoad = null,
  renderRevision = 0;
let history = [];
try {
  history = JSON.parse(localStorage.getItem(key)) || [];
  if (!Array.isArray(history)) history = [];
  history = history
    .filter(
      (x) =>
        x &&
        typeof x.id === "string" &&
        typeof x.date === "string" &&
        x.metrics,
    )
    .slice(0, 20)
    .map(publicReport);
} catch {}
const factor = () => ($("#network-unit").value === "mbytes" ? 1 / 8 : 1);
const unit = () => ($("#network-unit").value === "mbytes" ? "MB/s" : "Mbps");
const fmt = (n, suffix = "") =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toFixed(2) + suffix
    : uiMsg("Unavailable");
function saveHistory() {
  try {
    localStorage.setItem(key, JSON.stringify(history.map(publicReport)));
  } catch {
    uiText(
      $("#network-reason"),
      uiMsg(
        "Result ready, but history could not save. Download or copy your report.",
      ),
    );
  }
}
function textElement(tag, text, className) {
  const el = document.createElement(tag);
  uiText(el, text);
  if (className) el.className = className;
  return el;
}
function table(headers, rows) {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const t = document.createElement("table");
  t.className = "data-table";
  const head = document.createElement("thead"),
    hr = document.createElement("tr");
  headers.forEach((x) => hr.append(textElement("th", uiFrom(x))));
  head.append(hr);
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((x) => tr.append(textElement("td", x)));
    body.append(tr);
  });
  t.append(head, body);
  wrap.append(t);
  return wrap;
}
function paintConnection() {
  const list = $("#network-connection");
  list.replaceChildren();
  for (const [label, value] of [
    ["Network", connection.organization],
    ["ASN", connection.asn],
    [
      "IP-derived region",
      [connection.city, connection.country].filter(Boolean).join(", "),
    ],
    [
      "Cloudflare metadata edge",
      [connection.node, connection.nodeCity].filter(Boolean).join(" · "),
    ],
    ["Protocol", connection.protocol],
    [
      "IP",
      connection.ip
        ? showIP
          ? connection.ip
          : "•••• · click Show IP"
        : uiMsg("Unavailable"),
    ],
  ]) {
    list.append(
      textElement("dt", uiFrom(label)),
      textElement("dd", value || uiMsg("Unavailable")),
    );
  }
  $("#network-ip").disabled = $("#network-copy-ip").disabled = !connection.ip;
  uiText($("#network-ip"), showIP ? uiMsg("Hide IP") : uiMsg("Show IP"));
}
function paintMetrics(row = {}) {
  const metrics = row.metrics || {};
  $("#network-metrics").replaceChildren();
  for (const [key, [label, type]] of Object.entries(fields)) {
    const card = textElement("div", "", "metric-card");
    const value = metrics[key];
    card.append(
      textElement("span", uiFrom(label)),
      textElement(
        "strong",
        typeof value === "number" && Number.isFinite(value)
          ? (value * (type === "speed" ? factor() : 1)).toFixed(2)
          : "—",
      ),
      textElement("small", type === "speed" ? unit() : type),
    );
    $("#network-metrics").append(card);
  }
  const sample = running
    ? row.samples?.[phase]?.at(-1)?.mbps
    : metrics.download;
  uiText(
    $("#gauge-value"),
    typeof sample === "number" ? fmt(sample * factor()) : "—",
  );
  uiText($("#gauge-unit"), unit());
  const max = sample > 0 ? 10 ** Math.ceil(Math.log10(sample * 1.1)) : 100;
  $("#gauge-arc").setAttribute(
    "stroke-dasharray",
    (sample > 0 ? Math.min(100, (sample / max) * 100) : 0) + " 100",
  );
  $("#gauge-arc").style.stroke = phase === "upload" ? "#a8a0ee" : "#ef9bb7";
  uiText(
    $("#gauge-caption"),
    running
      ? uiJoin([
          phase === "upload" ? uiMsg("Upload") : uiMsg("Download"),
          uiMsg(" · latest valid sample"),
        ])
      : last
        ? uiMsg("Download · final P90")
        : uiMsg("Latest valid sample while running · P90 after completion"),
  );
  uiText(
    $("#network-phase"),
    uiJoin([
      uiMsg("FULL TEST / "),
      uiFrom(phase.charAt(0).toUpperCase() + phase.slice(1)),
    ]),
  );
}
function paintDetails(row) {
  const samples = row.samples,
    stats = samples ? summarize(samples) : null;
  const latencyBody = $("#network-latency-stats");
  latencyBody.replaceChildren();
  for (const [key, label] of [
    ["idle", "Idle"],
    ["down", "Download load"],
    ["up", "Upload load"],
  ]) {
    const s = stats?.[key];
    const tr = document.createElement("tr");
    [
      label,
      s?.count ?? "—",
      ...["min", "median", "p95", "max", "jitter"].map((k) =>
        fmt(s?.[k], " ms"),
      ),
    ].forEach((v) => tr.append(textElement("td", v)));
    latencyBody.append(tr);
  }
  $("#network-impact").replaceChildren();
  for (const [name, value] of [
    ["Download latency change", stats?.downIncrease],
    ["Upload latency change", stats?.upIncrease],
  ]) {
    const card = textElement("div", "", "metric-card");
    card.append(
      textElement("span", name),
      textElement("strong", fmt(value, " ms")),
    );
    $("#network-impact").append(card);
  }
  const detail = $("#network-details");
  detail.replaceChildren();
  detail.append(
    table(
      ["Speed", "Samples", "Minimum", "Median", "Final P90", "Observed peak"],
      ["download", "upload"].map((k) => [
        k,
        stats?.[k]?.count ?? "—",
        ...["min", "median", "p90", "max"].map((n) =>
          fmt(
            stats?.[k]?.[n] === null ? null : stats?.[k]?.[n] * factor(),
            " " + unit(),
          ),
        ),
      ]),
    ),
  );
  const traffic = row.traffic || {};
  detail.append(
    textElement(
      "p",
      "Elapsed: " +
        fmt(row.elapsed, " s") +
        " · Attempted download: " +
        fmt(traffic.attemptedDownload / 1e6, " MB") +
        " · Attempted upload: " +
        fmt(traffic.attemptedUpload / 1e6, " MB") +
        " · Completed download/upload payload: " +
        fmt(traffic.completedDownload / 1e6, " MB") +
        " / " +
        fmt(traffic.completedUpload / 1e6, " MB") +
        " · Requests: " +
        (traffic.requests ?? "—") +
        " · Rate-limit responses: " +
        (traffic.rateLimits ?? "—"),
      "muted small",
    ),
  );
  const values = $("#network-samples");
  values.replaceChildren();
  if (!samples) {
    values.append(
      textElement(
        "p",
        uiMsg(
          "Legacy summary only. Sample curves were not recorded for this result.",
        ),
        "muted small",
      ),
    );
    return;
  }
  values.append(
    table(
      [
        "Direction",
        "Test time (s)",
        "Speed (" + unit() + ")",
        "Payload (MB)",
        "Request duration (ms)",
      ],
      ["download", "upload"].flatMap((k) =>
        (samples[k] || []).map((p) => [
          k,
          fmt(p.t),
          fmt(p.mbps * factor()),
          fmt(p.bytes / 1e6),
          fmt(p.duration),
        ]),
      ),
    ),
  );
}
async function plots(row) {
  const revision = ++renderRevision;
  if (!plotLoad) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/vendor/uplot.css";
    document.head.append(css);
    plotLoad = import("/vendor/uplot.js")
      .then((m) => (plotClass = m.default))
      .catch(() => null);
  }
  await plotLoad;
  if (revision !== renderRevision) return;
  const a = $("#network-speed-chart"),
    b = $("#network-latency-chart");
  if (!plotClass || !row.samples) {
    speedPlot?.destroy();
    latencyPlot?.destroy();
    speedPlot = latencyPlot = null;
    for (const el of [a, b])
      el.replaceChildren(
        textElement(
          "p",
          row.samples
            ? "Chart unavailable. All values remain in the sample tables."
            : "No recorded samples yet.",
          "muted small",
        ),
      );
    return;
  }
  const data = row.samples,
    down = new Map((data.download || []).map((p) => [p.t, p.mbps * factor()])),
    up = new Map((data.upload || []).map((p) => [p.t, p.mbps * factor()])),
    times = [...new Set([...down.keys(), ...up.keys()])].sort((x, y) => x - y);
  const base = {
    width: Math.max(240, Math.floor(a.clientWidth)),
    height: 260,
    scales: { x: { time: false } },
    axes: [
      { stroke: "#a99db5", grid: { stroke: "#302936" } },
      { stroke: "#a99db5", grid: { stroke: "#302936" } },
    ],
    cursor: { drag: { x: false, y: false } },
    legend: { show: true },
    series: [
      {},
      { label: "Download", stroke: "#ef9bb7", width: 2, spanGaps: false },
      {
        label: "Upload",
        stroke: "#afa0ef",
        width: 2,
        dash: [6, 3],
        spanGaps: false,
      },
    ],
  };
  try {
    if (!document.createElement("canvas").getContext("2d"))
      throw Error("Canvas unavailable");
    if (times.length) {
      const points = [
        times,
        times.map((t) => down.get(t) ?? null),
        times.map((t) => up.get(t) ?? null),
      ];
      if (
        speedPlot &&
        speedPlot.width === base.width &&
        a.dataset.unit === unit()
      )
        speedPlot.setData(points);
      else {
        speedPlot?.destroy();
        a.replaceChildren();
        a.dataset.unit = unit();
        speedPlot = new plotClass(
          {
            ...base,
            axes: [
              { ...base.axes[0], label: "Test time (s)" },
              { ...base.axes[1], label: unit() },
            ],
          },
          points,
          a,
        );
      }
    } else {
      speedPlot?.destroy();
      speedPlot = null;
      a.replaceChildren(
        textElement(
          "p",
          uiMsg("Waiting for valid speed samples."),
          "muted small",
        ),
      );
    }
    const idle = data.idle || [],
      dl = data.downLatency || [],
      ul = data.upLatency || [],
      n = Math.max(idle.length, dl.length, ul.length);
    if (n) {
      const width = Math.max(240, Math.floor(b.clientWidth)),
        points = [
          Array.from({ length: n }, (_, i) => i + 1),
          ...[idle, dl, ul].map((series) =>
            Array.from({ length: n }, (_, i) => series[i] ?? null),
          ),
        ];
      if (latencyPlot && latencyPlot.width === width)
        latencyPlot.setData(points);
      else {
        latencyPlot?.destroy();
        b.replaceChildren();
        latencyPlot = new plotClass(
          {
            ...base,
            width,
            axes: [
              { ...base.axes[0], label: "Sample number" },
              { ...base.axes[1], label: "ms" },
            ],
            series: [
              {},
              { label: "Idle", stroke: "#b8d8ca", width: 2 },
              { label: "Download", stroke: "#ef9bb7", width: 2 },
              { label: "Upload", stroke: "#afa0ef", width: 2, dash: [6, 3] },
            ],
          },
          points,
          b,
        );
      }
    } else {
      latencyPlot?.destroy();
      latencyPlot = null;
      b.replaceChildren(
        textElement(
          "p",
          uiMsg("Waiting for valid latency samples."),
          "muted small",
        ),
      );
    }
  } catch {
    try {
      speedPlot?.destroy();
      latencyPlot?.destroy();
    } catch {}
    speedPlot = latencyPlot = null;
    for (const el of [a, b])
      el.replaceChildren(
        textElement(
          "p",
          uiMsg(
            "Chart drawing is unavailable. Sample tables and statistics remain available.",
          ),
          "muted small",
        ),
      );
  }
}
function paint(row) {
  current = row;
  paintMetrics(row);
  paintDetails(row);
  plots(row);
  if (!running) uiText($("#network-elapsed"), fmt(row.elapsed, " s"));
}
function resultText(row) {
  const safe = publicReport(row);
  return [
    "KenSei Network Test · connection to Cloudflare",
    uiDate(new Date(safe.date), { dateStyle: "medium", timeStyle: "short" }),
    ...Object.entries(fields).map(
      ([k, [label, type]]) =>
        label +
        ": " +
        fmt(safe.metrics[k], " " + (type === "speed" ? "Mbps" : "ms")),
    ),
    "Elapsed: " + fmt(safe.elapsed, " s"),
    "Attempted test payload: " + fmt(safe.used / 1e6, " MB"),
    ...Object.entries(safe.connection).map(([k, v]) => k + ": " + v),
    "Full IP excluded. Peak speed and final P90 are distinct metrics.",
  ].join("\n");
}
function selectResult(row) {
  if (running) return;
  last = row;
  phase = "complete";
  connection = row.connection || {};
  showIP = false;
  paintConnection();
  paint(row);
  $("#network-result").value = resultText(row);
  for (const id of ["copy", "png", "json", "csv"])
    $("#network-" + id).disabled = id === "csv" && !row.samples;
  uiText(
    $("#network-reason"),
    uiJoin([
      uiMsg("Saved result · "),
      uiDate(new Date(row.date), { dateStyle: "medium", timeStyle: "short" }),
    ]),
  );
}
function showHistory() {
  const list = $("#network-history");
  list.replaceChildren();
  if (!history.length)
    list.append(
      textElement("p", uiMsg("No completed tests yet."), "muted small"),
    );
  for (const row of history) {
    const item = textElement("div", "", "saved-row"),
      actions = textElement("div", "", "saved-actions");
    item.append(
      textElement(
        "span",
        uiDate(new Date(row.date), {
          dateStyle: "medium",
          timeStyle: "short",
        }) +
          " · ↓ " +
          fmt(row.metrics.download) +
          " / ↑ " +
          fmt(row.metrics.upload) +
          " Mbps",
      ),
    );
    const view = textElement("button", uiMsg("View"), "text-link");
    view.disabled = running;
    view.onclick = () => selectResult(row);
    const remove = textElement("button", uiMsg("Delete"), "text-link");
    remove.onclick = () => {
      history = history.filter((x) => x.id !== row.id);
      saveHistory();
      showHistory();
    };
    actions.append(view, remove);
    item.append(actions);
    list.append(item);
  }
  for (const id of ["a", "b"]) {
    const select = $("#network-compare-" + id),
      previous = select.value;
    select.replaceChildren();
    for (const row of history)
      select.add(
        uiOption(
          uiDate(new Date(row.date), {
            dateStyle: "medium",
            timeStyle: "short",
          }),
          row.id,
        ),
      );
    if (history.some((r) => r.id === previous)) select.value = previous;
    else select.selectedIndex = id === "b" && history.length > 1 ? 1 : 0;
  }
  if (
    history.length > 1 &&
    $("#network-compare-a").value === $("#network-compare-b").value
  )
    $("#network-compare-b").value = history.find(
      (r) => r.id !== $("#network-compare-a").value,
    ).id;
  $("#network-compare").disabled = history.length < 2;
}
function stop(message) {
  if (frame) {
    frame.contentWindow?.postMessage(
      { id: run, type: "cancel" },
      location.origin,
    );
    const old = frame;
    setTimeout(() => old.remove(), 100);
    frame = null;
  }
  clearTimeout(timeout);
  clearInterval(ticker);
  running = false;
  run = null;
  $("#network-start").disabled = false;
  $("#network-cancel").disabled = true;
  if (message) uiText($("#network-status"), uiFrom(message));
  showHistory();
}
$("#network-start").onclick = () => {
  if (running) return;
  running = true;
  last = null;
  phase = "loading";
  current = {};
  connection = {};
  showIP = false;
  paintConnection();
  paint({});
  for (const id of ["copy", "png", "json", "csv"])
    $("#network-" + id).disabled = true;
  $("#network-result").hidden = true;
  uiText($("#network-reason"), "");
  uiText(
    $("#network-status"),
    uiMsg("Loading engine and optional connection information…"),
  );
  $("#network-progress").value = 0;
  $("#network-start").disabled = true;
  $("#network-cancel").disabled = false;
  began = performance.now();
  ticker = setInterval(
    () =>
      uiText(
        $("#network-elapsed"),
        ((performance.now() - began) / 1000).toFixed(1) + " s",
      ),
    100,
  );
  run = crypto.randomUUID();
  frame = document.createElement("iframe");
  frame.hidden = true;
  uiAttr(frame, "title", uiMsg("Isolated network measurement"));
  frame.src = "/tool-scripts/network-runner.html#" + run;
  document.body.append(frame);
  showHistory();
  timeout = setTimeout(
    () =>
      stop(
        "Stopped after 120 seconds. No incomplete result was saved. Retry manually when ready.",
      ),
    120000,
  );
};
window.addEventListener("message", (event) => {
  const d = event.data;
  if (
    !running ||
    event.origin !== location.origin ||
    event.source !== frame?.contentWindow ||
    !d ||
    d.id !== run
  )
    return;
  if (d.type === "ready")
    frame.contentWindow.postMessage(
      { id: run, type: "start" },
      location.origin,
    );
  if (d.type === "connection") {
    connection = d.connection || {};
    paintConnection();
  }
  if (d.type === "metrics") paint(d);
  if (d.type === "phase") {
    phase = d.phase;
    uiText(
      $("#network-status"),
      {
        latency: "Measuring idle latency…",
        download: "Measuring download…",
        upload: "Measuring upload…",
      }[phase] || uiMsg("Measuring…"),
    );
    $("#network-progress").value = d.progress;
    paintMetrics(current);
  }
  if (d.type === "traffic")
    uiText(
      $("#network-reason"),
      uiJoin([
        uiMsg("Attempted payload: "),
        (d.used / 1e6).toFixed(1),
        uiMsg(" / 500 MB · not a billing-byte count."),
      ]),
    );
  if (d.type === "error") {
    if (d.metrics) paint(d);
    stop(d.message);
  }
  if (d.type === "complete") {
    const ip = connection.ip;
    last = publicReport({
      ...d,
      id: crypto.randomUUID(),
      version: 2,
      date: d.date,
      connection,
    });
    history = [last, ...history].slice(0, 20);
    stop("Full Test complete. Sample statistics and reports are ready.");
    phase = "complete";
    paint(last);
    connection = { ...last.connection, ...(ip ? { ip } : {}) };
    showIP = false;
    paintConnection();
    $("#network-progress").value = 100;
    $("#network-result").value = resultText(last);
    for (const id of ["copy", "png", "json", "csv"])
      $("#network-" + id).disabled = false;
    saveHistory();
  }
});
$("#network-cancel").onclick = () =>
  stop("Cancelled. No completed result was saved.");
$("#network-clear").onclick = () => {
  history = [];
  saveHistory();
  showHistory();
  $("#network-comparison").replaceChildren();
};
$("#network-unit").onchange = () => paint(current);
$("#network-ip").onclick = () => {
  showIP = !showIP;
  if (!showIP) {
    $("#network-result").hidden = true;
    $("#network-result").value = last ? resultText(last) : "";
  }
  paintConnection();
};
$("#network-copy-ip").onclick = () => {
  const input = $("#network-result");
  input.hidden = false;
  input.value = connection.ip || "";
  copy(input);
};
$("#network-copy").onclick = () => {
  if (last) {
    $("#network-result").hidden = false;
    $("#network-result").value = resultText(last);
    copy($("#network-result"));
  }
};
$("#network-json").onclick = () => {
  if (last)
    downloadText(
      JSON.stringify(publicReport(last), null, 2),
      "kensei-network.json",
      "application/json",
    );
};
$("#network-csv").onclick = () => {
  if (!last?.samples) return;
  const rows = [
    [
      "type",
      "sample",
      "time_seconds",
      "speed_mbps",
      "latency_ms",
      "bytes",
      "duration_ms",
    ],
  ];
  for (const k of ["download", "upload"])
    (last.samples[k] || []).forEach((p, i) =>
      rows.push([k, i + 1, p.t, p.mbps, "", p.bytes, p.duration]),
    );
  for (const k of ["idle", "downLatency", "upLatency"])
    (last.samples[k] || []).forEach((n, i) =>
      rows.push([k, i + 1, "", "", n, "", ""]),
    );
  downloadText(
    rows.map((r) => r.join(",")).join("\r\n"),
    "kensei-network-samples.csv",
    "text/csv;charset=utf-8",
  );
};
$("#network-png").onclick = async () => {
  if (!last) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 760;
    const c = canvas.getContext("2d");
    if (!c) throw Error();
    c.fillStyle = "#111015";
    c.fillRect(0, 0, 1200, 760);
    c.fillStyle = "#d6afe8";
    c.font = "bold 38px sans-serif";
    c.fillText("KenSei · Network Test", 50, 65);
    c.fillStyle = "#bbb0c5";
    c.font = "20px sans-serif";
    c.fillText(
      uiDate(new Date(last.date), { dateStyle: "medium", timeStyle: "short" }) +
        " · connection to Cloudflare",
      50,
      105,
    );
    let y = 160;
    for (const [k, [label, type]] of Object.entries(fields)) {
      c.fillStyle = "#eee6f3";
      c.fillText(
        label +
          ": " +
          fmt(last.metrics[k], " " + (type === "speed" ? "Mbps" : "ms")),
        50,
        y,
      );
      y += 40;
    }
    const samples = last.samples || {},
      points = [...(samples.download || []), ...(samples.upload || [])],
      mx = Math.max(1, ...points.map((p) => p.t)),
      my = Math.max(1, ...points.map((p) => p.mbps));
    for (const [key, color] of [
      ["download", "#ef9bb7"],
      ["upload", "#afa0ef"],
    ]) {
      c.strokeStyle = color;
      c.lineWidth = 3;
      c.beginPath();
      (samples[key] || []).forEach((p, i) => {
        const x = 600 + (p.t / mx) * 540,
          v = 390 - (p.mbps / my) * 220;
        i ? c.lineTo(x, v) : c.moveTo(x, v);
      });
      c.stroke();
    }
    c.fillStyle = "#bbb0c5";
    c.fillText("Sample speed · pink download / purple upload", 600, 435);
    c.fillText("Final speeds are P90; chart shows actual samples.", 50, 490);
    c.fillText(
      "Payload attempted: " +
        (last.used / 1e6).toFixed(1) +
        " MB · " +
        fmt(last.elapsed, " s"),
      50,
      535,
    );
    c.fillText(
      [last.connection?.organization, last.connection?.node]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 80),
      50,
      580,
    );
    c.fillText(
      "Full IP excluded. No packet-loss or gaming-grade claim.",
      50,
      680,
    );
    download(await canvasBlob(canvas), "kensei-network.png");
  } catch {
    uiText(
      $("#network-status"),
      uiMsg(
        "PNG export is unavailable in this browser. CSV, JSON and text reports still work.",
      ),
    );
  }
};
$("#network-compare").onclick = () => {
  const a = history.find((r) => r.id === $("#network-compare-a").value),
    b = history.find((r) => r.id === $("#network-compare-b").value),
    out = $("#network-comparison");
  out.replaceChildren();
  if (!a || !b || a.id === b.id) {
    uiText(out, uiMsg("Choose two different tests."));
    return;
  }
  out.append(
    table(
      ["Metric", "First", "Second", "Second − first"],
      Object.entries(fields).map(([k, [label, type]]) => [
        label,
        fmt(a.metrics[k], type === "speed" ? " Mbps" : " ms"),
        fmt(b.metrics[k], type === "speed" ? " Mbps" : " ms"),
        fmt(
          typeof a.metrics[k] === "number" && typeof b.metrics[k] === "number"
            ? b.metrics[k] - a.metrics[k]
            : null,
          type === "speed" ? " Mbps" : " ms",
        ),
      ]),
    ),
  );
  out.append(
    textElement(
      "p",
      uiMsg(
        "Compare connection, route and conditions as well as the numbers. Legacy records may contain summaries only.",
      ),
      "muted small",
    ),
  );
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running)
    stop("Stopped because this page was hidden. Start a new test when ready.");
});
window.addEventListener("pagehide", () => {
  stop();
  connection = {};
  showIP = false;
  $("#network-result").value = last ? resultText(last) : "";
  paintConnection();
});
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => plots(current), 150);
});
paintConnection();
paint({});
showHistory();
