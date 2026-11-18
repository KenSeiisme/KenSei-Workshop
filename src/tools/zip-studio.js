import { plannedPackage } from "./archive-package.js";
import { $, size, download, status, busy } from "./common.js";
import { uiMsg, uiJoin, uiFrom, uiError, uiText, uiAttr } from "../site/ui.js";

let worker = null,
  active = false,
  opened = false,
  archiveEntries = [],
  packFiles = [],
  packPaths = null,
  manifest = null;
function stop(message) {
  worker?.terminate();
  worker = null;
  opened = false;
  archiveEntries = [];
  window.dispatchEvent(new Event("zip-closed"));
  active = false;
  busy(false);
  $("#zip-entries").replaceChildren();
  if (message) {
    status(uiFrom(message));
    $("#zip-open").value = "";
  }
}
function create() {
  stop();
  worker = new Worker("/tool-scripts/zip-worker.js");
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      $("#zip-progress").value = data.value;
      status(uiError(data));
    } else if (data.type === "error") {
      stop(data.message);
      $("#tool-status").classList.add("error-text");
    } else if (data.type === "packed") {
      manifest = data.manifest;
      $("#zip-manifest").hidden = !manifest;
      download(
        data.blob,
        ($("#zip-name").value.trim() || "kensei-files").replace(
          /(?:\.zip)?$/i,
          ".zip",
        ),
      );
      stop("ZIP ready. Your download has started.");
      $("#zip-progress").value = 100;
    } else if (data.type === "opened") {
      active = false;
      opened = true;
      busy(false);
      $("#zip-progress").value = 100;
      archiveEntries = data.entries;
      window.dispatchEvent(new Event("zip-opened"));
      const list = $("#zip-entries");
      list.replaceChildren();
      for (const entry of data.entries) {
        const row = document.createElement("div");
        row.className = "zip-row";
        const name = document.createElement("span");
        uiText(name, entry.name);
        uiAttr(name, "title", entry.name);
        const detail = document.createElement("small");
        uiText(detail, size(entry.expanded));
        row.append(name, detail);
        if (!entry.name.endsWith("/")) {
          const button = document.createElement("button");
          button.className = "text-link";
          uiText(button, uiMsg("Download"));
          button.dataset.lock = "";
          button.onclick = () => {
            if (!active && opened) {
              active = true;
              busy(true);
              status(uiJoin([uiMsg("Extracting "), entry.name]));
              worker.postMessage({ action: "extract", index: entry.index });
            }
          };
          row.append(button);
        }
        list.append(row);
      }
      status(
        uiJoin([
          data.entries.length,
          uiMsg(" entries checked. Select a file to download."),
        ]),
      );
    } else if (data.type === "selected") {
      active = false;
      busy(false);
      window.dispatchEvent(
        new CustomEvent("zip-selection-ready", { detail: data.files }),
      );
    } else if (data.type === "extracted") {
      download(data.blob, data.name);
      active = false;
      busy(false);
      status(uiMsg("File checked and downloaded."));
    }
  };
  worker.onerror = (e) => {
    e.preventDefault();
    stop("Archive processing failed. Reselect your files and retry.");
  };
  active = true;
  busy(true);
  $("#zip-progress").value = 0;
}
function updatePack() {
  manifest = null;
  $("#zip-manifest").hidden = true;
  const files = packFiles;
  const total = files.reduce((n, f) => n + f.size, 0);
  const paths = $("#zip-pack-paths");
  paths.replaceChildren();
  paths.hidden = true;
  uiText(
    $("#zip-selected"),
    uiJoin([files.length, uiMsg(" files · "), size(total)]),
  );
  $("#zip-pack").disabled =
    !files.length || files.length > 100 || total > 100000000;
  if ($("#zip-pack").disabled && files.length)
    status(uiMsg("Choose at most 100 files totaling 100 MB."), true);
  if (!$("#zip-pack").disabled && ($("#zip-checksum").checked || packPaths)) {
    try {
      for (const name of plannedPackage(files, packPaths)) {
        const item = document.createElement("li");
        item.textContent = name;
        paths.append(item);
      }
      paths.hidden = false;
    } catch (error) {
      $("#zip-pack").disabled = true;
      status(uiError(error), true);
    }
  }
}
$("#zip-files").onchange = () => {
  packPaths = null;
  packFiles = [...$("#zip-files").files];
  updatePack();
};
$("#zip-checksum").onchange = updatePack;
$("#zip-manifest").onclick = () => {
  if (manifest) download(manifest, "SHA256SUMS");
};
$("#zip-pack").disabled = true;
$("#zip-pack").onclick = () => {
  if (!packFiles.length || $("#zip-pack").disabled) return;
  manifest = null;
  $("#zip-manifest").hidden = true;
  create();
  status(uiMsg("Preparing files…"));
  worker.postMessage({
    action: "pack",
    files: packFiles,
    paths: packPaths,
    checksum: $("#zip-checksum").checked,
  });
};
$("#zip-open").onchange = () => {
  const file = $("#zip-open").files[0];
  if (!file) return;
  create();
  status(uiMsg("Checking archive and expanded content…"));
  worker.postMessage({ action: "open", file });
};
$("#cancel-job").onclick = () => {
  stop("Cancelled. Reselect files to start again.");
  $("#zip-open").value = "";
  $("#zip-progress").value = 0;
};
window.addEventListener("pagehide", () => stop());

window.KenseiAdvancedContexts ||= {};
window.KenseiAdvancedContexts["zip-studio"] = {
  get packCount() {
    return packFiles.length;
  },
  get archive() {
    return $("#zip-open").files[0];
  },
  receivePack(files, paths) {
    plannedPackage(files, paths);
    packFiles = files;
    packPaths = paths;
    $("#zip-files").value = "";
    updatePack();
  },
  get entries() {
    return archiveEntries;
  },
  extract(indices) {
    if (active || !opened) throw Error("Open an archive first.");
    active = true;
    busy(true);
    worker.postMessage({ action: "extract-many", indices });
  },
};
