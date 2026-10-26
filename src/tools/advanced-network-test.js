import { uiMsg, uiRender } from "../site/ui.js";
import { $ } from "./common.js";
import {
  el,
  panel,
  row,
  button,
  field,
  select,
  renderTable,
} from "./advanced-ui.js";
export function init() {
  const context = (canvas) => {
    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  };
  const ctx = window.KenseiAdvancedContexts["network-test"],
    p = panel(
      "Network labels and history trends",
      $("#network-history").closest("section"),
    ),
    label = el("input", "", {
      maxLength: 80,
      placeholder: "For example: Home Wi-Fi",
    }),
    pick = el("select", "", {
      multiple: true,
      size: 5,
      "aria-label": "Tests to overlay",
    }),
    kind = select([
      ["download", "Download"],
      ["upload", "Upload"],
    ]),
    canvas = el("canvas", "", {
      width: 700,
      height: 260,
      role: "img",
      "aria-label": "Actual completed test samples",
    }),
    out = el("div"),
    trend = el("canvas", "", {
      width: 700,
      height: 180,
      role: "img",
      "aria-label": "Recent twenty completed tests trend",
    });
  trend.style.width = "100%";
  canvas.style.width = "100%";
  label.oninput = () => (window.KenseiNetworkLabel = label.value);
  window.KenseiNetworkLabel = "";
  function draw() {
    const previous = new Set([...pick.selectedOptions].map((n) => n.value));
    pick.replaceChildren();
    const history = ctx.history;
    for (const r of history) {
      const n = new Option(
        (r.label || r.date) + " · " + r.metrics.download,
        r.id,
      );
      n.selected = previous.has(r.id);
      pick.add(n);
    }
    if (!pick.selectedOptions.length && pick.options.length)
      pick.options[0].selected = true;
    const factor = $("#network-unit").value === "mbytes" ? 1 / 8 : 1,
      unit = factor === 1 ? "Mbps" : "MB/s",
      x = context(canvas),
      chosen = history.filter((r) =>
        [...pick.selectedOptions].some((n) => n.value === r.id),
      ),
      sets = chosen.map((r) =>
        (r.samples?.[kind.value] || []).filter(
          (p) => Number.isFinite(p.t) && Number.isFinite(p.mbps),
        ),
      ),
      maxT = Math.max(1, ...sets.flat().map((p) => p.t)),
      maxY = Math.max(1, ...sets.flat().map((p) => p.mbps * factor));
    if (x) {
      x.clearRect(0, 0, 700, 260);
      x.font = "12px sans-serif";
      x.fillStyle = "#c8bdd1";
      for (let i = 0; i <= 5; i++) {
        const y = 220 - i * 38;
        x.strokeStyle = "#3f3548";
        x.beginPath();
        x.moveTo(55, y);
        x.lineTo(680, y);
        x.stroke();
        x.fillText(((maxY * i) / 5).toFixed(1), 4, y);
        x.fillText(((maxT * i) / 5).toFixed(1), 55 + i * 125, 244);
      }
      x.fillText(unit, 4, 15);
      x.fillText("s", 682, 244);
      sets.forEach((points, i) => {
        x.strokeStyle = ["#d6b6ec", "#ef9bb7", "#8cd4cf", "#f3d7ac", "#9aaae5"][
          i % 5
        ];
        x.beginPath();
        points.forEach((p, j) => {
          const a = 55 + (p.t / maxT) * 625,
            b = 220 - ((p.mbps * factor) / maxY) * 190;
          j ? x.lineTo(a, b) : x.moveTo(a, b);
        });
        x.stroke();
      });
    }
    const tx = context(trend),
      timeline = [...history].reverse(),
      top = Math.max(
        1,
        ...timeline
          .flatMap((r) => [r.metrics.download, r.metrics.upload])
          .filter((v) => v !== null)
          .map((v) => v * factor),
      );
    if (tx) {
      tx.clearRect(0, 0, 700, 180);
      tx.fillStyle = "#c8bdd1";
      tx.font = "12px sans-serif";
      for (let i = 0; i <= 4; i++) {
        const y = 150 - i * 32;
        tx.strokeStyle = "#3f3548";
        tx.beginPath();
        tx.moveTo(55, y);
        tx.lineTo(680, y);
        tx.stroke();
        tx.fillText(((top * i) / 4).toFixed(1), 4, y);
      }
      ["download", "upload"].forEach((key, index) => {
        tx.strokeStyle = index ? "#ef9bb7" : "#d6b6ec";
        tx.beginPath();
        let connected = false;
        timeline.forEach((r, i) => {
          const v = r.metrics[key];
          if (v === null) {
            connected = false;
            return;
          }
          const x = 55 + (i * 625) / Math.max(1, timeline.length - 1),
            y = 150 - ((v * factor) / top) * 128;
          connected ? tx.lineTo(x, y) : tx.moveTo(x, y);
          connected = true;
        });
        tx.stroke();
      });
      tx.fillText(uiRender(uiMsg("{0} · download / upload", [unit])), 55, 15);
      tx.fillText("1", 55, 174);
      tx.fillText(String(timeline.length), 670, 174);
    }
    out.replaceChildren(
      renderTable(
        ["Date / label", "Download", "Upload", "Idle latency"],
        history.map((r) => [
          r.date + (r.label ? " · " + r.label : ""),
          r.metrics.download === null
            ? "—"
            : (r.metrics.download * factor).toFixed(2) + " " + unit,
          r.metrics.upload === null
            ? "—"
            : (r.metrics.upload * factor).toFixed(2) + " " + unit,
          r.metrics.latency === null
            ? "—"
            : r.metrics.latency.toFixed(2) + " ms",
        ]),
      ),
    );
    if (!sets.some((s) => s.length))
      out.prepend(el("p", "No samples available for the selected tests."));
  }
  p.append(
    field("Label for the next completed test", label),
    row(
      field("Tests to overlay", pick),
      kind,
      button("Update history view", draw),
    ),
    canvas,
    el("h3", "Recent completed tests"),
    trend,
    out,
  );
  pick.onchange = kind.onchange = draw;
  $("#network-unit").addEventListener("change", draw);
  window.addEventListener("network-history-changed", draw);
  window.addEventListener("locale-change", draw);
  draw();
}
