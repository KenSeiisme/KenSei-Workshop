import { imageRecipes } from "./image-recipes.js";
import { targetCompression } from "./target-compression.js";
import { el, field, row, button } from "./advanced-ui.js";
import { sendControl, receiveHandoff } from "./handoff.js";
import "./image-editor.js";
import {
  $,
  $$,
  api,
  esc,
  toast,
  library,
  size,
  image,
  canvasBlob,
  zip,
  busy,
  filename,
  download,
} from "./common.js";
import { uiMsg, uiError, uiText, uiHtml, uiPrompt } from "../site/ui.js";

let files = [],
  results = [],
  generation = 0,
  presetWidth = null;
const failedIndices = new Set();
let retryOnly = false;
let recipe;
let resultsStale = false;
let lastValidResults = [],
  previousUrls = [];
const filesListeners = [];
const targetSize = el("input", "", {
  type: "number",
  min: 1,
  max: 20480,
  placeholder: "Optional",
  id: "image-target-kib",
});
targetSize.dataset.lock = "";
const targetField = field("Target size per image (KiB)", targetSize);
document.querySelector("#format-note").after(targetField);
const retryFailed = button("Retry failed images", () => {
  retryOnly = true;
  document.querySelector("#image-process").click();
});
retryFailed.id = "image-retry-failed";
retryFailed.hidden = true;
document.querySelector("#image-zip").after(retryFailed);
targetSize.oninput = () => markResultsStale();
const w = $("#image-width"),
  h = $("#image-height"),
  format = $("#image-format"),
  quality = $("#image-quality");
function markResultsStale() {
  generation++;
  if (results.length) {
    resultsStale = true;
    document.querySelector("#batch-results").dataset.stale = "true";
    uiText(
      document.querySelector("#image-result"),
      uiMsg("Settings changed. Process the images again before downloading."),
    );
  }
}
function showPrevious() {
  previousUrls.forEach((url) => URL.revokeObjectURL(url));
  previousUrls = [];
  document.querySelector("#image-previous-results")?.remove();
  const old = lastValidResults.filter(
    (r) => !results.some((x) => x.sourceIndex === r.sourceIndex),
  );
  if (!old.length) return;
  const box = el("details", "", {
    id: "image-previous-results",
    class: "panel studio-recipes",
  });
  box.append(el("summary", "Previous valid results · not current settings"));
  for (const r of old) {
    const url = URL.createObjectURL(r.blob);
    previousUrls.push(url);
    const name = el("p");
    name.textContent =
      r.name + " · " + r.width + " × " + r.height + " · " + size(r.blob.size);
    box.append(
      name,
      el("img", "", { src: url, alt: r.name, class: "edited-preview" }),
      button("Download previous result", () =>
        download(r.blob, "previous-" + r.name),
      ),
    );
  }
  document.querySelector("#batch-results").after(box);
}
function fileState(index, state) {
  window.dispatchEvent(
    new CustomEvent("tool-file-state", {
      detail: { tool: "image-studio", index, state },
    }),
  );
}
function clearResults(clearHistory = false) {
  previousUrls.forEach((url) => URL.revokeObjectURL(url));
  previousUrls = [];
  document.querySelector("#image-previous-results")?.remove();
  if (clearHistory) lastValidResults = [];
  resultsStale = false;
  document.querySelector("#batch-results").removeAttribute("data-stale");
  fileState(-1, "Waiting");
  generation++;
  results.forEach((x) => {
    URL.revokeObjectURL(x.url);
    if (x.originalUrl) URL.revokeObjectURL(x.originalUrl);
  });
  failedIndices.clear();
  retryFailed.hidden = true;
  document.querySelectorAll("#image-send").forEach((n) => n.remove());
  results = [];
  const summary = document.querySelector("#image-batch-summary");
  if (summary) {
    delete summary.dataset.measured;
    uiText(summary, uiMsg("Select images and process to see results."));
  }
  $("#batch-results").replaceChildren();
  $("#image-download").hidden = $("#image-zip").hidden = true;
  uiText($("#image-result"), "");
}
async function load(list) {
  if (!list.length) return;
  if (
    list.length > 20 ||
    [...list].reduce((a, f) => a + f.size, 0) > 100 * 1048576
  )
    return toast(
      uiMsg("Choose up to 20 images, totaling no more than 100 MB."),
    );
  try {
    for (const f of list) {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
        f.size > 20 * 1048576
      )
        throw new Error("Use JPG, PNG or WebP, up to 20 MB per image.");
    }
    const img = await image(list[0]);
    clearResults(true);
    files = [...list];
    queueMicrotask(() => filesListeners.forEach((fn) => fn()));
    w.disabled = h.disabled = false;
    w.value = presetWidth || img.width;
    h.value = Math.max(1, Math.round((+w.value * img.height) / img.width));
    $("#dropzone").hidden = true;
    $(".image-stage").hidden = false;
    // 预览使用独立 URL，避免已释放的解码 URL 被浏览器重新读取。
    $("#image-preview").src = URL.createObjectURL(files[0]);
    $("#image-preview").onload = () =>
      URL.revokeObjectURL($("#image-preview").src);
    uiText(
      $("#image-info"),
      uiMsg("{0} image{1} · {2} · {3} × {4} first image", [
        files.length,
        files.length > 1 ? "s" : "",
        size(files.reduce((n, f) => n + f.size, 0)),
        img.width,
        img.height,
      ]),
    );
    $("#image-process").disabled = false;
  } catch (e) {
    toast(uiError(e));
  }
}
$("#image-file").addEventListener("change", (e) => load(e.target.files));
$("#change-image").onclick = () => {
  $("#image-file").value = "";
  $("#image-file").click();
};
for (const type of ["dragenter", "dragover", "dragleave", "drop"])
  $("#dropzone").addEventListener(type, (e) => {
    e.preventDefault();
    $("#dropzone").classList.toggle("drag-over", type === "dragover");
    if (type === "drop") load(e.dataTransfer.files);
  });
w.addEventListener("input", () => {
  if (files.length && +w.value > 0)
    h.value = Math.max(
      1,
      Math.round(
        (+w.value * $("#image-preview").naturalHeight) /
          $("#image-preview").naturalWidth,
      ),
    );
  markResultsStale();
});
h.addEventListener("input", () => {
  if (files.length && +h.value > 0)
    w.value = Math.max(
      1,
      Math.round(
        (+h.value * $("#image-preview").naturalWidth) /
          $("#image-preview").naturalHeight,
      ),
    );
  markResultsStale();
});
function formatChanged() {
  quality.disabled = format.value === "image/png";
  targetSize.disabled = quality.disabled;
  uiText(
    $("#format-note"),
    quality.disabled
      ? uiMsg("PNG is lossless. Quality does not apply; output may be larger.")
      : format.value === "image/jpeg"
        ? uiMsg("Transparent areas will use a white background.")
        : uiMsg("WebP balances size and image quality."),
  );
  markResultsStale();
}
format.onchange = formatChanged;
quality.oninput = () => {
  $("#quality-value").value = quality.value + "%";
  markResultsStale();
};
$("#cancel-job").onclick = () => {
  generation++;
  fileState(-1, "Cancelled");
  uiText(
    $("#image-result"),
    uiMsg("Cancelled. Finished images remain available."),
  );
};
$("#image-process").onclick = async () => {
  if (!targetSize.disabled && !targetSize.checkValidity())
    return toast(uiMsg("Choose a target from 1 to 20,480 KiB."));
  const width = +w.value,
    height = +h.value;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 12000 ||
    height > 12000 ||
    width * height > 40000000
  )
    return toast(
      uiMsg("Use whole dimensions from 1–12,000 px, up to 40 megapixels."),
    );
  const onlyFailed = retryOnly && !resultsStale;
  retryOnly = false;
  const indices = onlyFailed ? [...failedIndices] : files.map((_, i) => i);
  if (!onlyFailed) clearResults();
  else {
    generation++;
    for (const i of indices)
      document
        .querySelectorAll(`[data-image-result="${i}"]`)
        .forEach((n) => n.remove());
  }
  const job = generation,
    mime = format.value,
    q = +quality.value / 100;
  busy(true);
  try {
    let scaler = null,
      browserResize = false;
    for (const i of indices) {
      if (job !== generation) break;
      uiText(
        $("#image-result"),
        uiMsg("Processing {0} of {1}…", [i + 1, files.length]),
      );
      fileState(i, "Processing");
      try {
        const settings = recipe.get(i),
          original = await image(files[i]),
          img = recipe.prepare(original, settings),
          mime = settings.encode ? settings.format : files[i].type,
          q = settings.encode ? settings.quality : 1,
          targetWidth = settings.resize ? settings.width : img.width,
          targetHeight = Math.max(
            1,
            Math.round((targetWidth * img.height) / img.width),
          );
        if (targetHeight > 12000 || targetWidth * targetHeight > 40000000)
          throw new Error("Target image is too large. Reduce the width.");
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        let blob,
          source = null;
        try {
          const ctx = canvas.getContext("2d");
          if (!ctx)
            throw new Error(
              "This browser could not create an image. Try smaller dimensions or another browser.",
            );
          const drawNative = () => {
            ctx.clearRect(0, 0, targetWidth, targetHeight);
            if (mime === "image/jpeg") {
              ctx.fillStyle = "#fff";
              ctx.fillRect(0, 0, targetWidth, targetHeight);
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          };
          // 原尺寸转换不需要读取像素；受限环境使用浏览器原生缩放。
          if (
            (targetWidth === img.width && targetHeight === img.height) ||
            browserResize
          ) {
            drawNative();
          } else {
            try {
              scaler ||= (await library("pica.js", "pica"))();
              source = document.createElement("canvas");
              source.width = img.width;
              source.height = img.height;
              const inputContext = source.getContext("2d");
              if (mime === "image/jpeg") {
                inputContext.fillStyle = "#fff";
                inputContext.fillRect(0, 0, source.width, source.height);
              }
              inputContext.drawImage(img, 0, 0);
              await scaler.resize(source, canvas);
            } catch {
              browserResize = true;
              drawNative();
            }
          }
          recipe.watermark(canvas, settings);
          const compressed = await targetCompression(
            (v) => canvasBlob(canvas, mime, v),
            q,
            mime !== "image/png" && settings.encode && settings.targetKiB > 0
              ? settings.targetKiB * 1024
              : 0,
            () => job === generation,
          );
          blob = compressed.blob;
          if (!compressed.met)
            toast(
              uiMsg(
                "Target size could not be reached at these dimensions. The smallest tested output is kept.",
              ),
            );
        } catch (e) {
          if (e.name === "SecurityError")
            throw new Error(
              "This browser blocked image export. Check this site's image permissions or try another browser.",
            );
          throw e;
        } finally {
          if (source) source.width = source.height = 0;
          img.width = img.height = 0;
          canvas.width = canvas.height = 0;
        }
        if (job !== generation) break;
        const ext =
          { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" }[
            blob.type
          ] || "png";
        const name = filename(
            files[i].name.replace(/\.[^.]+$/, "") +
              "-kensei" +
              (files.length > 1 ? "-" + (i + 1) : "") +
              "." +
              ext,
          ),
          url = URL.createObjectURL(blob);
        failedIndices.delete(i);
        const originalUrl = URL.createObjectURL(files[i]);
        results.push({
          name,
          blob,
          url,
          originalUrl,
          sourceIndex: i,
          sourceSize: files[i].size,
          width: targetWidth,
          height: targetHeight,
        });
        lastValidResults = lastValidResults.filter((r) => r.sourceIndex !== i);
        lastValidResults.push(results.at(-1));
        const summary = document.querySelector("#image-batch-summary");
        if (summary) {
          const inputBytes = results.reduce((n, r) => n + r.sourceSize, 0),
            outputBytes = results.reduce((n, r) => n + r.blob.size, 0);
          summary.dataset.measured = "true";
          uiText(
            summary,
            uiMsg(
              "{0} image(s) ready · {1} → {2} · {3} {4}. Per-image dimensions and errors are below.",
              [
                results.length,
                size(inputBytes),
                size(outputBytes),
                outputBytes <= inputBytes
                  ? uiMsg("saved")
                  : uiMsg("increased by"),
                size(Math.abs(inputBytes - outputBytes)),
              ],
            ),
          );
        }
        const diff = (1 - blob.size / files[i].size) * 100;
        $("#batch-results").insertAdjacentHTML(
          "beforeend",
          uiHtml`<div class="saved-row" data-image-result="${i}"><div><strong>${esc(files[i].name)}</strong><p>${targetWidth} × ${targetHeight} · ${size(files[i].size)} → ${size(blob.size)} · ${Math.abs(diff).toFixed(0)}% ${diff >= 0 ? "smaller" : "larger"}</p></div><a class="text-link" href="${url}" download="${esc(name)}">Download ↓</a></div>`,
        );
        const comparison = el("details");
        comparison.dataset.imageResult = i;
        comparison.append(el("summary", "Compare original and result"));
        const pictures = el("div", "", { class: "compare-images" });
        pictures.append(
          el("img", "", { src: originalUrl, alt: files[i].name }),
          el("img", "", { src: url, alt: name }),
        );
        comparison.append(pictures);
        $("#batch-results").append(comparison);
        fileState(i, "Complete");
      } catch (e) {
        failedIndices.add(i);
        fileState(i, "Failed");
        $("#batch-results").insertAdjacentHTML(
          "beforeend",
          uiHtml`<div class="saved-row error-text" data-image-result="${i}">${esc(files[i].name)}: ${esc(e.message)}</div>`,
        );
      }
    }
    const completed = job === generation;
    const outcome = !completed
      ? "Cancelled"
      : results.length === files.length
        ? "Done"
        : results.length
          ? "Partially completed"
          : "Processing failed";
    uiText(
      $("#image-result"),
      uiMsg("{0} · {1} of {2} images ready.{3}", [
        uiMsg(outcome),
        results.length,
        files.length,
        completed && results.length < files.length
          ? uiMsg(" Check the messages below and retry.")
          : "",
      ]),
    );
    showPrevious();
    retryFailed.hidden = !failedIndices.size;
    document.querySelector("#image-send")?.remove();
    if (results.length) {
      const control = sendControl(
        $("#batch-results"),
        () => ({
          kind: "files",
          files: (resultsStale
            ? (() => {
                throw Error(
                  "Settings changed. Process the images again before downloading.",
                );
              })()
            : results
          ).map((r) => new File([r.blob], r.name, { type: r.blob.type })),
        }),
        ["image-to-text", "pdf-toolkit", "file-renamer"],
      );
      control.id = "image-send";
    }
    if (results.length) {
      const first = results[0];
      $("#image-download").href = first.url;
      $("#image-download").download = first.name;
      $("#image-download").hidden = false;
      $("#image-zip").hidden = results.length < 2;
    }
  } catch (e) {
    toast(uiError(e));
  } finally {
    busy(false);
    formatChangedQuality();
  }
};
function formatChangedQuality() {
  targetSize.disabled = format.value === "image/png";
  quality.disabled = format.value === "image/png";
}
$("#image-zip").onclick = async (e) => {
  if (resultsStale)
    return toast(
      uiMsg("Settings changed. Process the images again before downloading."),
    );
  e.target.disabled = true;
  try {
    await zip(
      results.map((x) => [x.name, x.blob]),
      "kensei-images.zip",
    );
  } catch (e) {
    toast(uiError(e));
  } finally {
    e.target.disabled = false;
  }
};
$("#save-preset").onclick = async () => {
  const name = uiPrompt(
    uiMsg("Name this image preset:"),
    uiMsg("My image preset"),
  );
  if (!name?.trim()) return;
  const width = +w.value || null;
  if (width && (!Number.isInteger(width) || width < 1 || width > 12000))
    return toast(uiMsg("Enter a valid width before saving."));
  try {
    await api.saveItem("preset", {
      tool: "image-studio",
      name: name.trim().slice(0, 100),
      width,
      format: format.value,
      quality: +quality.value,
    });
    toast(uiMsg("Preset saved."));
  } catch {
    toast(uiMsg("Preset could not be saved. Try again."));
  }
};
function applyPreset() {
  const id = new URLSearchParams(location.search).get("preset"),
    p = api
      .items("preset")
      .find(
        (x) =>
          x.id === id && (x.data.tool || "image-studio") === "image-studio",
      )?.data;
  if (p) {
    presetWidth = p.width;
    w.value = p.width || "";
    format.value = p.format;
    quality.value = p.quality;
    $("#quality-value").value = p.quality + "%";
    formatChanged();
  }
}
applyPreset();
window.addEventListener("workspace-ready", applyPreset);
window.addEventListener("beforeunload", () =>
  results.forEach((x) => URL.revokeObjectURL(x.url)),
);

receiveHandoff(
  "image-studio",
  (p) => load(p.files),
  () => files.length > 0,
);

recipe = imageRecipes({
  get files() {
    return files;
  },
  stale() {
    if (results.length) {
      resultsStale = true;
      document.querySelector("#batch-results").dataset.stale = "true";
      uiText(
        document.querySelector("#image-result"),
        uiMsg("Settings changed. Process the images again before downloading."),
      );
    }
    window.dispatchEvent(new Event("tool-content-changed"));
  },
  onFiles(fn) {
    filesListeners.push(fn);
  },
});

for (const node of [
  document.querySelector("#batch-results"),
  document.querySelector("#image-download"),
])
  node.addEventListener(
    "click",
    (event) => {
      if (resultsStale && event.target.closest("a[download]")) {
        event.preventDefault();
        toast(
          uiMsg(
            "Settings changed. Process the images again before downloading.",
          ),
        );
      }
    },
    true,
  );
