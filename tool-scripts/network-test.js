import { $, copy } from "./common.js";
const key = "kensei-network-history-v1",
  fields = {
    download: ["Download", "Mbps"],
    upload: ["Upload", "Mbps"],
    latency: ["Idle latency", "ms"],
    jitter: ["Idle jitter", "ms"],
    downloadLatency: ["Download latency", "ms"],
    uploadLatency: ["Upload latency", "ms"],
  };
let frame = null,
  run = null,
  timeout = null,
  running = false,
  last = null;
let history = [];
try {
  history = JSON.parse(localStorage.getItem(key)) || [];
  if (!Array.isArray(history)) history = [];
  history = history
    .filter(
      (x) =>
        x &&
        typeof x.date === "string" &&
        x.metrics &&
        typeof x.id === "string",
    )
    .slice(0, 20);
} catch {}
function saveHistory() {
  try {
    localStorage.setItem(key, JSON.stringify(history));
    return true;
  } catch {
    $("#network-reason").textContent =
      "Result ready, but this browser could not save history. Copy your result instead.";
    return false;
  }
}
function paintMetrics(values = {}) {
  $("#network-metrics").replaceChildren();
  for (const [key, [label, unit]] of Object.entries(fields)) {
    const card = document.createElement("div");
    card.className = "metric-card";
    const name = document.createElement("span"),
      value = document.createElement("strong"),
      suffix = document.createElement("small");
    name.textContent = label;
    value.textContent =
      typeof values[key] === "number" && Number.isFinite(values[key])
        ? values[key].toFixed(2)
        : "—";
    suffix.textContent = unit;
    card.append(name, value, suffix);
    $("#network-metrics").append(card);
  }
}
function resultText(row) {
  return [
    "KenSei Network Test · connection to Cloudflare",
    new Date(row.date).toLocaleString(),
    ...Object.entries(fields).map(
      ([key, [label, unit]]) =>
        label +
        ": " +
        (typeof row.metrics[key] === "number"
          ? row.metrics[key].toFixed(2) + " " + unit
          : "Unavailable (not enough usable samples)"),
    ),
    "Test payload attempted: " + (row.used / 1e6).toFixed(1) + " MB",
  ].join("\n");
}
function showHistory() {
  const list = $("#network-history");
  list.replaceChildren();
  if (!history.length) {
    const p = document.createElement("p");
    p.className = "muted small";
    p.textContent = "No completed tests yet.";
    list.append(p);
  }
  for (const row of history) {
    const item = document.createElement("div");
    item.className = "saved-row";
    const label = document.createElement("span");
    label.textContent =
      new Date(row.date).toLocaleString() +
      " · ↓ " +
      Number(row.metrics.download).toFixed(2) +
      " / ↑ " +
      Number(row.metrics.upload).toFixed(2) +
      " Mbps";
    const actions = document.createElement("div");
    actions.className = "saved-actions";
    const view = document.createElement("button");
    view.className = "text-link";
    view.textContent = "View";
    view.disabled = running;
    view.onclick = () => {
      if (running) return;
      last = row;
      paintMetrics(row.metrics);
      $("#network-result").value = resultText(row);
      $("#network-copy").disabled = false;
      $("#network-reason").textContent =
        "Saved result · " + new Date(row.date).toLocaleString();
    };
    const remove = document.createElement("button");
    remove.className = "text-link";
    remove.textContent = "Delete";
    remove.onclick = () => {
      history = history.filter((x) => x.id !== row.id);
      saveHistory();
      showHistory();
    };
    actions.append(view, remove);
    item.append(label, actions);
    list.append(item);
  }
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
  running = false;
  run = null;
  $("#network-start").disabled = false;
  $("#network-cancel").disabled = true;
  if (message) $("#network-status").textContent = message;
  showHistory();
}
$("#network-start").onclick = () => {
  if (running) return;
  running = true;
  last = null;
  paintMetrics();
  $("#network-copy").disabled = true;
  $("#network-result").hidden = true;
  $("#network-reason").textContent = "";
  $("#network-status").textContent = "Loading test engine…";
  $("#network-progress").value = 0;
  $("#network-start").disabled = true;
  $("#network-cancel").disabled = false;
  run = crypto.randomUUID();
  frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Isolated network measurement";
  frame.src = "/tool-scripts/network-runner.html#" + run;
  document.body.append(frame);
  showHistory();
  timeout = setTimeout(
    () =>
      stop(
        "Stopped after 120 seconds. Retry manually when ready; no completed result was saved.",
      ),
    120000,
  );
};
window.addEventListener("message", (event) => {
  const data = event.data;
  if (
    !running ||
    event.origin !== location.origin ||
    event.source !== frame?.contentWindow ||
    !data ||
    data.id !== run
  )
    return;
  if (data.type === "ready")
    frame.contentWindow.postMessage(
      { id: run, type: "start" },
      location.origin,
    );
  if (data.type === "metrics") paintMetrics(data.metrics);
  if (data.type === "phase") {
    $("#network-status").textContent =
      {
        latency: "Measuring idle latency…",
        download: "Measuring download…",
        upload: "Measuring upload…",
      }[data.phase] || "Measuring…";
    $("#network-progress").value = data.progress;
  }
  if (data.type === "traffic")
    $("#network-reason").textContent =
      "Test payload attempted: " +
      (data.used / 1e6).toFixed(1) +
      " / 500 MB. Network overhead is additional.";
  if (data.type === "error") {
    if (data.metrics) paintMetrics(data.metrics);
    stop(data.message);
  }
  if (data.type === "complete") {
    last = {
      id: crypto.randomUUID(),
      date: data.date,
      metrics: data.metrics,
      used: data.used,
    };
    paintMetrics(data.metrics);
    $("#network-progress").value = 100;
    $("#network-result").value = resultText(last);
    $("#network-copy").disabled = false;
    history = [last, ...history].slice(0, 20);
    stop("Full Test complete. Missing latency samples remain unavailable.");
    saveHistory();
  }
});
$("#network-cancel").onclick = () =>
  stop("Cancelled. No completed result was saved.");
$("#network-clear").onclick = () => {
  history = [];
  saveHistory();
  showHistory();
};
$("#network-copy").onclick = () => {
  if (last) {
    $("#network-result").hidden = false;
    copy($("#network-result"));
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running)
    stop("Stopped because this page was hidden. Start a new test when ready.");
});
window.addEventListener("pagehide", () => stop());
paintMetrics();
showHistory();
