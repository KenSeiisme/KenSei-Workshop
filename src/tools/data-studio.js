import { $, $$, busy, status, downloadText } from "./common.js";
import { uiMsg, uiJoin, uiText } from "../site/ui.js";

let worker = null,
  table = null,
  page = 0;
function render() {
  const target = $("#data-table");
  target.replaceChildren();
  uiText(
    $("#data-page"),
    table
      ? uiJoin([
          page +
            1 +
            " / " +
            Math.max(1, Math.ceil(table.rows.length / 50)) +
            " · " +
            table.rows.length,
          uiMsg(" rows"),
        ])
      : uiMsg("No table yet"),
  );
  $("#data-prev").disabled = !table || page === 0;
  $("#data-next").disabled = !table || (page + 1) * 50 >= table.rows.length;
  if (!table) return;
  const t = document.createElement("table");
  t.className = "data-table";
  const head = document.createElement("thead"),
    hr = document.createElement("tr");
  table.headers.forEach((name) => {
    const cell = document.createElement("th");
    uiText(cell, name);
    hr.append(cell);
  });
  head.append(hr);
  const body = document.createElement("tbody");
  table.rows.slice(page * 50, page * 50 + 50).forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((value) => {
      const td = document.createElement("td");
      uiText(td, value);
      tr.append(td);
    });
    body.append(tr);
  });
  t.append(head, body);
  target.append(t);
}
function process(kind, action, file = null) {
  worker?.terminate();
  worker = new Worker("/tool-scripts/data-worker.js");
  busy(true);
  status(uiMsg("Processing locally…"));
  worker.onmessage = ({ data }) => {
    worker?.terminate();
    worker = null;
    busy(false);
    if (!data.ok) {
      status(data.error, true);
      return;
    }
    const source = $("#data-" + data.kind);
    if (file) source.value = data.source;
    if (data.kind === "json" && data.action !== "to-csv")
      source.value = data.text;
    if (data.action === "to-csv") $("#data-csv").value = data.text;
    if (data.action === "to-json") $("#data-json").value = data.text;
    if (data.table) {
      table = data.table;
      page = 0;
      render();
    }
    if (data.action === "download")
      downloadText(
        data.text,
        "kensei-data." + (kind === "json" ? "json" : "csv"),
        kind === "json" ? "application/json" : "text/csv;charset=utf-8",
      );
    window.dispatchEvent(new Event("tool-content-changed"));
    if (data.action === "to-csv" || data.action === "to-json")
      window.dispatchEvent(
        new CustomEvent("tool-show-tab", {
          detail: {
            selector: data.action === "to-csv" ? "#data-csv" : "#data-json",
          },
        }),
      );
    status(
      uiJoin([
        uiMsg("Done."),
        data.escaped
          ? uiJoin([
              " " + data.escaped,
              uiMsg(
                " spreadsheet-formula cell(s) escaped with a leading apostrophe. Original inputs remain available.",
              ),
            ])
          : "",
      ]),
    );
  };
  worker.onerror = (e) => {
    e.preventDefault();
    worker?.terminate();
    worker = null;
    busy(false);
    status(
      uiMsg(
        "Processing failed. Your inputs are still here; retry with a smaller file.",
      ),
      true,
    );
  };
  worker.postMessage({
    kind,
    action,
    text: file ? "" : $("#data-" + kind).value,
    file,
  });
}
$$("[data-json-action]").forEach(
  (button) =>
    (button.onclick = () => process("json", button.dataset.jsonAction)),
);
$("#data-json-download").onclick = () => process("json", "download");
$("#data-csv-preview").onclick = () => process("csv", "preview");
$("#data-csv-to-json").onclick = () => process("csv", "to-json");
$("#data-csv-download").onclick = () => process("csv", "download");
for (const kind of ["json", "csv"])
  $("#data-" + kind + "-file").onchange = (e) => {
    const file = e.target.files[0];
    if (file) process(kind, kind === "json" ? "format" : "preview", file);
    e.target.value = "";
  };
$("#data-prev").onclick = () => {
  page--;
  render();
};
$("#data-next").onclick = () => {
  page++;
  render();
};
$("#cancel-job").onclick = () => {
  worker?.terminate();
  worker = null;
  busy(false);
  status(uiMsg("Cancelled. Your inputs are unchanged."));
};
window.addEventListener("pagehide", () => worker?.terminate());
render();
