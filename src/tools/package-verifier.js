import { el, field, renderTable, row } from "./advanced-ui.js";
import { uiAttr, uiError, uiMsg, uiRender, uiText } from "../site/ui.js";

export function mountPackageVerifier(anchor, openedArchive = () => null) {
  const area = el("details", "", { class: "tool-form package-verifier" });
  const summary = el("summary", "Verify package");
  const archive = el("input", "", {
    type: "file",
    accept: ".zip,application/zip",
  });
  const manifest = el("input", "", { type: "file" });
  const progress = el("progress", "", { max: 100, value: 0, hidden: true });
  uiAttr(progress, "aria-label", uiMsg("Package verification progress"));
  const result = el("div", "", { class: "advanced-list" });
  const note = el("p", "", { class: "small", role: "status" });
  const go = el("button", "Check package", {
    class: "button primary",
    type: "button",
  });
  const cancel = el("button", "Cancel", {
    class: "button secondary",
    type: "button",
    hidden: true,
  });
  let worker = null,
    rows = null;

  area.append(
    summary,
    el(
      "p",
      "Checks the ZIP against its root SHA256SUMS or a separate checksum manifest. Limit: 100 MB archive and 100 MB expanded files.",
      { class: "muted small" },
    ),
    field("ZIP to verify", archive),
    field("Separate manifest (optional)", manifest),
    row(go, cancel),
    progress,
    note,
    result,
  );
  anchor.append(area);
  function finish(message, failed = false) {
    worker?.terminate();
    worker = null;
    go.disabled = false;
    archive.disabled = manifest.disabled = false;
    cancel.hidden = progress.hidden = true;
    note.classList.toggle("error-text", failed);
    if (message) uiText(note, message);
  }
  function drawReport() {
    if (!rows) return;
    const matched = rows.filter((entry) => entry.state === "Match").length;
    if (!worker && !note.classList.contains("error-text"))
      uiText(
        note,
        uiMsg("Matched {0} of {1} package paths.", [matched, rows.length]),
      );
    result.replaceChildren(
      renderTable(
        ["File", "Verification"],
        rows.map((entry) => [entry.name, uiRender(uiMsg(entry.state))]),
      ),
    );
  }
  function changed() {
    finish(uiMsg("Check the selected ZIP to see its verification results."));
    rows = null;
    result.replaceChildren();
  }
  archive.onchange = manifest.onchange = changed;
  cancel.onclick = () =>
    finish(uiMsg("Verification cancelled. Your files are still selected."));
  go.onclick = () => {
    if (worker) return;
    const file = archive.files[0] || openedArchive();
    if (!file) {
      finish(uiMsg("Choose a ZIP to verify."), true);
      return;
    }
    const source = new Worker("/tool-scripts/zip-worker.js");
    worker = source;
    archive.disabled = manifest.disabled = go.disabled = true;
    cancel.hidden = progress.hidden = false;
    progress.value = 0;
    uiText(note, uiMsg("Verifying package…"));
    note.classList.remove("error-text");
    source.onmessage = ({ data }) => {
      if (source !== worker) return;
      if (data.type === "progress") progress.value = data.value;
      if (data.type === "error") finish(uiError(data), true);
      if (data.type === "verified") {
        finish();
        rows = data.rows;
        drawReport();
      }
    };
    source.onerror = (event) => {
      event.preventDefault();
      if (source === worker)
        finish(
          uiMsg("Archive processing failed. Reselect your files and retry."),
          true,
        );
    };
    source.postMessage({ action: "verify", file, manifest: manifest.files[0] });
  };
  window.addEventListener("locale-change", drawReport);
  window.addEventListener("pagehide", () => finish());
  if (openedArchive() || document.querySelector("#zip-open"))
    document.querySelector("#zip-open")?.addEventListener("change", () => {
      if (!archive.files.length) changed();
    });
  return area;
}
