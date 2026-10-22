import { $, download, busy, status, size } from "./common.js";
import { renamed } from "./rename-core.js";
let files = [],
  worker = null,
  preview = [],
  manual = new Map(),
  active = false;
function options() {
  return Object.fromEntries(
    ["prefix", "suffix", "find", "replace", "case", "start", "digits"]
      .map((k) => [k, $("#rename-" + k).value])
      .concat([["number", $("#rename-number").checked]]),
  );
}
function render() {
  if (active) return;
  $("#rename-download").disabled = true;
  const out = $("#rename-preview");
  out.replaceChildren();
  try {
    preview = renamed(
      files.map((file) => ({ name: file.name })),
      { ...options() },
    );
    files.forEach((file, i) => {
      const row = document.createElement("div");
      row.className = "rename-row";
      const original = document.createElement("p"),
        name = document.createElement("input"),
        error = document.createElement("small"),
        actions = document.createElement("div");
      original.textContent = file.name + " · " + size(file.size);
      name.value = preview[i].name;
      name.dataset.lock = "";
      name.setAttribute("aria-label", "New name for " + file.name);
      name.onchange = () => {
        manual.set(file, name.value);
        render();
      };
      // 单项修改应作为最终名字，而非再次经过相同前缀和编号。
      if (manual.has(file)) {
        preview[i].name = manual.get(file);
        name.value = manual.get(file);
      }
      const up = document.createElement("button"),
        down = document.createElement("button");
      for (const b of [up, down]) {
        b.className = "text-link";
        b.dataset.lock = "";
      }
      up.textContent = "↑";
      up.setAttribute("aria-label", "Move " + file.name + " up");
      up.disabled = i === 0;
      down.textContent = "↓";
      down.setAttribute("aria-label", "Move " + file.name + " down");
      down.disabled = i === files.length - 1;
      const move = (to) => {
        [files[i], files[to]] = [files[to], files[i]];
        render();
      };
      up.onclick = () => move(i - 1);
      down.onclick = () => move(i + 1);
      actions.append(up, down);
      row.append(original, name, error, actions);
      out.append(row);
    });
    const checked = renamed(
      preview.map((x) => ({ name: x.name })),
      { case: "keep", number: false },
    );
    preview.forEach((row, i) => {
      row.error = checked[i].error;
      const el = out.children[i];
      el.querySelector("small").textContent = row.error || "Ready";
      el.querySelector("input").classList.toggle("input-error", !!row.error);
    });
    $("#rename-download").disabled =
      !files.length || preview.some((x) => x.error);
    status(
      files.length +
        " files · " +
        size(files.reduce((n, f) => n + f.size, 0)) +
        " · " +
        (preview.some((x) => x.error)
          ? "Resolve conflicts or invalid names."
          : "Preview ready."),
    );
  } catch (e) {
    status(e.message, true);
  }
}
$("#rename-files").onchange = () => {
  const next = [...$("#rename-files").files];
  if (next.length > 100 || next.reduce((n, f) => n + f.size, 0) > 100000000) {
    files = [];
    manual.clear();
    $("#rename-preview").replaceChildren();
    $("#rename-download").disabled = true;
    status("Choose up to 100 files totaling 100 MB.", true);
    return;
  }
  files = next;
  manual.clear();
  render();
};
for (const id of [
  "prefix",
  "suffix",
  "find",
  "replace",
  "case",
  "number",
  "start",
  "digits",
])
  $("#rename-" + id).addEventListener("input", () => {
    manual.clear();
    render();
  });
$("#rename-order").onchange = () => {
  if ($("#rename-order").value === "name")
    files.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  else files = [...$("#rename-files").files];
  manual.clear();
  render();
};
function finish(message) {
  worker?.terminate();
  worker = null;
  active = false;
  busy(false);
  render();
  if (message) status(message);
}
$("#rename-download").onclick = () => {
  if (!files.length || preview.some((x) => x.error)) return;
  active = true;
  busy(true);
  status("Packing renamed copies…");
  const renamedFiles = files.map(
    (file, i) =>
      new File([file], preview[i].name, {
        type: file.type,
        lastModified: file.lastModified,
      }),
  );
  worker = new Worker("/tool-scripts/zip-worker.js");
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      $("#rename-progress").value = data.value;
      status(data.message);
    }
    if (data.type === "error") finish(data.message);
    if (data.type === "packed") {
      download(data.blob, "kensei-renamed-files.zip");
      finish("Renamed ZIP ready. Original files are unchanged.");
    }
  };
  worker.onerror = (e) => {
    e.preventDefault();
    finish("Could not create this ZIP. Retry or select fewer files.");
  };
  worker.postMessage({ action: "pack", files: renamedFiles });
};
$("#cancel-job").onclick = () =>
  finish("Cancelled. Your preview is still here.");
window.addEventListener("pagehide", () => worker?.terminate());
