import {
  $,
  $$,
  status,
  busy,
  image,
  copy,
  draftEditor,
  downloadText,
  filename,
} from "./common.js";
const output = $("#ocr-output");
let selected = null,
  worker = null;
const changed = draftEditor("image-to-text", output);
$("#ocr-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await image(file);
    selected = file;
    $("#ocr-file-info").textContent = file.name;
    const url = URL.createObjectURL(file);
    $("#ocr-preview").src = url;
    $("#ocr-preview").hidden = false;
    $("#ocr-preview").onload = () => URL.revokeObjectURL(url);
    status("Image ready. Choose languages, then extract text.");
  } catch (e) {
    selected = null;
    status(e.message, true);
  }
};
function stop() {
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
  worker = null;
  busy(false);
}
$("#cancel-job").onclick = () => {
  stop();
  status("Recognition cancelled. Your previous text is kept.");
};
$("#ocr-run").onclick = () => {
  if (!selected) return status("Choose an image first.", true);
  const languages = $$('[name="ocr-language"]:checked').map((n) => n.value);
  if (!languages.length) return status("Select at least one language.", true);
  busy(true);
  status("Loading recognition engine and selected language packs…");
  worker = new Worker("/tool-scripts/ocr-worker.js");
  const currentWorker = worker;
  worker.onmessage = ({ data }) => {
    if (worker !== currentWorker) return;
    if (data.progress) {
      const m = data.progress;
      status(
        `${m.status}${Number.isFinite(m.progress) ? " · " + Math.round(m.progress * 100) + "%" : ""}`,
      );
      return;
    }
    if (data.error) {
      stop();
      status(
        "Recognition failed. Check your connection for model downloads, then retry. " +
          data.error,
        true,
      );
      return;
    }
    output.value = data.text.slice(0, 100000);
    changed();
    stop();
    status(
      data.text.trim()
        ? `Text extracted. Review it before use.${data.text.length > 100000 ? " Output limited to 100,000 characters." : ""}`
        : "No text found. Try a clearer image or different language.",
    );
  };
  worker.onerror = (e) => {
    e.preventDefault();
    if (worker !== currentWorker) return;
    stop();
    status(
      "Recognition failed. Tool files could not load. Check your connection and retry.",
      true,
    );
  };
  worker.postMessage({ file: selected, languages });
};
$("#ocr-copy").onclick = () => copy(output);
$("#ocr-download").onclick = () =>
  downloadText(
    output.value,
    filename($("#draft-name").value || "kensei-ocr") + ".txt",
  );
window.addEventListener("beforeunload", () => worker?.terminate());
