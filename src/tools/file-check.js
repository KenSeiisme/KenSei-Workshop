import { $, busy, status, downloadText, copy, size } from "./common.js";
import { uiMsg, uiJoin, uiText } from "../site/ui.js";

let files = [],
  results = [],
  worker = null;
function finish() {
  worker?.terminate();
  worker = null;
  busy(false);
  $("#check-run").disabled = !files.length;
}
function comparison() {
  const value = $("#check-expected").value.trim().toLowerCase(),
    algorithm = $("#check-algorithm").value,
    field = algorithm === "SHA-512" ? "sha512" : "sha256",
    length = algorithm === "SHA-512" ? 128 : 64;
  uiText(
    $("#check-match"),
    !value
      ? uiMsg("Paste a checksum to compare with the first file.")
      : !new RegExp("^[0-9a-f]{" + length + "}$").test(value)
        ? uiJoin([
            uiMsg("Enter a "),
            length,
            uiMsg("-character hexadecimal "),
            algorithm,
            uiMsg(" checksum."),
          ])
        : !results[0]?.[field]
          ? uiMsg("Run the selected algorithm first.")
          : results[0][field] === value
            ? uiMsg("Match · checksum equals the first selected file.")
            : uiMsg(
                "Mismatch · checksum differs from the first selected file.",
              ),
  );
}
$("#check-files").onchange = (e) => {
  files = [...e.target.files];
  results = [];
  $("#check-results").replaceChildren();
  $("#check-download").disabled = true;
  if (
    files.length > 20 ||
    files.some((f) => f.size > 100000000) ||
    files.reduce((n, f) => n + f.size, 0) > 200000000
  ) {
    files = [];
    e.target.value = "";
    status(uiMsg("Choose up to 20 files, 100 MB each and 200 MB total."), true);
  } else
    status(
      uiJoin([
        files.length,
        uiMsg(" files selected. Contents stay on this device."),
      ]),
    );
  $("#check-run").disabled = !files.length;
  comparison();
};
$("#check-run").onclick = () => {
  finish();
  busy(true);
  status(uiMsg("Starting file checks…"));
  worker = new Worker("/tool-scripts/file-check-worker.js");
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      status(
        uiJoin([
          uiMsg("Hashing file "),
          data.index,
          uiMsg(" of "),
          data.total,
          "…",
        ]),
      );
      $("#check-progress").value = ((data.index - 1) / data.total) * 100;
    }
    if (data.type === "error") {
      finish();
      status(data.error, true);
    }
    if (data.type === "complete") {
      results = data.results;
      finish();
      $("#check-progress").value = 100;
      const out = $("#check-results");
      out.replaceChildren();
      const groups = new Map();
      for (const row of results) {
        const k = row.size + ":" + row.sha256;
        groups.set(k, (groups.get(k) || 0) + 1);
      }
      for (const row of results) {
        const el = document.createElement("section");
        el.className = "panel daily-history";
        const title = document.createElement("h3");
        uiText(title, row.name + " · " + size(row.size));
        el.append(title);
        for (const field of ["sha256", "sha512"]) {
          if (!row[field]) continue;
          const label = document.createElement("label");
          uiText(label, field.toUpperCase());
          const input = document.createElement("textarea");
          input.readOnly = true;
          input.value = row[field];
          input.rows = 2;
          const button = document.createElement("button");
          button.className = "text-link";
          uiText(button, uiJoin([uiMsg("Copy "), field.toUpperCase()]));
          button.onclick = () => copy(input);
          label.append(input);
          el.append(label, button);
        }
        const note = document.createElement("p");
        note.className = "muted small";
        uiText(
          note,
          groups.get(row.size + ":" + row.sha256) > 1
            ? uiMsg("Same size and SHA-256 as another selected file.")
            : uiMsg("No matching selected file."),
        );
        el.append(note);
        out.append(el);
      }
      $("#check-download").disabled = false;
      comparison();
      status(
        uiMsg("File checks complete. This checks integrity, not malware."),
      );
    }
  };
  worker.onerror = (e) => {
    e.preventDefault();
    finish();
    status(
      uiMsg("File check failed. Your selection is available for retry."),
      true,
    );
  };
  worker.postMessage({ files, algorithm: $("#check-algorithm").value });
};
$("#check-expected").oninput = comparison;
$("#check-algorithm").onchange = () => {
  comparison();
  if (results.length) {
    $("#check-download").disabled = true;
    status(uiMsg("Settings changed. Check files again to update the result."));
  }
};
$("#check-download").onclick = () =>
  downloadText(
    JSON.stringify({ version: 1, files: results }, null, 2),
    "kensei-checksums.json",
    "application/json",
  );
$("#cancel-job").onclick = () => {
  finish();
  status(uiMsg("Cancelled. No checksums were saved."));
};
window.addEventListener("pagehide", finish);
