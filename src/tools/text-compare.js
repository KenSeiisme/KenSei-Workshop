import { $, $$, status, downloadText, busy } from "./common.js";
let worker = null,
  patch = "";
for (const side of ["left", "right"])
  $("#compare-file-" + side).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 200000) throw new Error("Choose a TXT file up to 200 KB.");
      const text = await f.text();
      if (text.length > 100000)
        throw new Error("Use at most 100,000 characters per side.");
      $("#compare-" + side).value = text;
      invalidate();
    } catch (e) {
      status(e.message, true);
    }
  };
function invalidate() {
  patch = "";
  $("#compare-download").disabled = true;
  $("#compare-output").replaceChildren();
  status("Ready to compare.");
}
$$(
  "#compare-left,#compare-right,#compare-case,#compare-space,#compare-mode",
).forEach((n) => n.addEventListener("input", invalidate));
$("#compare-swap").onclick = () => {
  const left = $("#compare-left"),
    right = $("#compare-right");
  [left.value, right.value] = [right.value, left.value];
  invalidate();
};
$("#cancel-job").onclick = () => {
  worker?.terminate();
  worker = null;
  busy(false);
  status("Comparison cancelled.");
};
$("#compare-run").onclick = () => {
  invalidate();
  busy(true);
  status("Comparing…");
  worker?.terminate();
  worker = new Worker("/tool-scripts/compare-worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    busy(false);
    worker.terminate();
    worker = null;
    if (data.error) return status(data.error, true);
    patch = data.patch;
    const characters = $("#compare-mode").value === "characters";
    $("#compare-output").classList.toggle("diff-characters", characters);
    const fragment = document.createDocumentFragment();
    let additions = 0,
      deletions = 0;
    for (const part of data.changes) {
      const span = document.createElement("span");
      span.className = part.added
        ? "diff-added"
        : part.removed
          ? "diff-removed"
          : "diff-same";
      span.textContent =
        (characters ? "" : part.added ? "+ " : part.removed ? "- " : "  ") +
        part.value;
      fragment.append(span);
      if (part.added) additions += part.count;
      if (part.removed) deletions += part.count;
    }
    $("#compare-output").replaceChildren(fragment);
    $("#compare-download").disabled = false;
    status(
      additions || deletions
        ? `Added ${additions} · removed ${deletions} ${$("#compare-mode").value === "characters" ? "characters" : "lines"}. ${$("#compare-case").checked || $("#compare-space").checked ? "Output uses the selected normalization." : ""}`
        : "No differences with these settings.",
    );
  };
  worker.onerror = () => {
    worker?.terminate();
    worker = null;
    busy(false);
    status("Comparison could not run. Reload the page and retry.", true);
  };
  worker.postMessage({
    left: $("#compare-left").value,
    right: $("#compare-right").value,
    ignoreCase: $("#compare-case").checked,
    ignoreWhitespace: $("#compare-space").checked,
    mode: $("#compare-mode").value,
  });
};
$("#compare-download").onclick = () =>
  downloadText(patch, "kensei-comparison.diff");
