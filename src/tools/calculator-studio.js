import { $, copy, busy, status } from "./common.js";
let worker = null,
  timer = null,
  ans = "0",
  last = null,
  history = [];
const key = "kensei-calculator-v1";
try {
  const rows = JSON.parse(localStorage.getItem(key));
  if (Array.isArray(rows))
    history = rows
      .filter(
        (x) =>
          x &&
          typeof x.expression === "string" &&
          typeof x.result === "string" &&
          ["deg", "rad"].includes(x.mode),
      )
      .slice(0, 50);
} catch {}
function draw() {
  const out = $("#calc-history");
  out.replaceChildren();
  for (const row of history) {
    const b = document.createElement("button");
    b.className = "saved-row text-link";
    b.textContent =
      row.expression + " = " + row.result + " · " + row.mode.toUpperCase();
    b.onclick = () => {
      $("#calc-expression").value = row.expression;
      $("#calc-angle").value = row.mode;
      $("#calc-expression").focus();
    };
    out.append(b);
  }
  if (!history.length)
    out.textContent = "No calculations saved on this device.";
}
function save() {
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch {
    status("Result ready, but this browser could not save history.");
  }
}
function finish() {
  worker?.terminate();
  worker = null;
  clearTimeout(timer);
  busy(false);
}
$("#calc-run").onclick = () => {
  finish();
  busy(true);
  status("Calculating locally…");
  const expression = $("#calc-expression").value,
    mode = $("#calc-angle").value;
  worker = new Worker("/tool-scripts/calculator-worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "ready") {
      clearTimeout(timer);
      worker.postMessage({ expression, mode, ans });
      timer = setTimeout(() => {
        finish();
        status(
          "Stopped after 2 seconds. Simplify the expression and retry.",
          true,
        );
      }, 2000);
      return;
    }
    finish();
    if (!data.ok) {
      status(data.error, true);
      return;
    }
    last = data;
    ans = data.exact;
    $("#calc-result").value = (data.approx ? "≈ " : "") + data.text;
    $("#calc-fraction").textContent = data.fraction
      ? "Fraction approximation: " + data.fraction
      : "Fraction display unavailable for this result.";
    $("#calc-copy").disabled = false;
    history = [{ expression, result: data.text, mode }, ...history].slice(
      0,
      50,
    );
    save();
    draw();
    status("Calculated. % means divide by 100.");
  };
  worker.onerror = (e) => {
    e.preventDefault();
    finish();
    status("Calculator files could not load. Retry when connected.", true);
  };
  timer = setTimeout(() => {
    finish();
    status(
      "Calculator files took too long to load. Retry when connected.",
      true,
    );
  }, 15000);
};
$("#calc-expression").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#calc-run").click();
  }
};
$("#calc-copy").onclick = () => copy($("#calc-result"));
$("#calc-clear").onclick = () => {
  history = [];
  save();
  draw();
};
$("#cancel-job").onclick = () => {
  finish();
  status("Cancelled. Your expression is unchanged.");
};
window.addEventListener("pagehide", finish);
draw();
