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
} from "./common.js";
let files = [],
  results = [],
  generation = 0,
  presetWidth = null;
const w = $("#image-width"),
  h = $("#image-height"),
  format = $("#image-format"),
  quality = $("#image-quality");
function clearResults() {
  generation++;
  results.forEach((x) => URL.revokeObjectURL(x.url));
  results = [];
  $("#batch-results").replaceChildren();
  $("#image-download").hidden = $("#image-zip").hidden = true;
  $("#image-result").textContent = "";
}
async function load(list) {
  if (!list.length) return;
  if (
    list.length > 20 ||
    [...list].reduce((a, f) => a + f.size, 0) > 100 * 1048576
  )
    return toast("Choose up to 20 images, totaling no more than 100 MB.");
  try {
    for (const f of list) {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
        f.size > 20 * 1048576
      )
        throw new Error("Use JPG, PNG or WebP, up to 20 MB per image.");
    }
    const img = await image(list[0]);
    clearResults();
    files = [...list];
    w.disabled = h.disabled = false;
    w.value = presetWidth || img.width;
    h.value = Math.max(1, Math.round((+w.value * img.height) / img.width));
    $("#dropzone").hidden = true;
    $(".image-stage").hidden = false;
    // 预览使用独立 URL，避免已释放的解码 URL 被浏览器重新读取。
    $("#image-preview").src = URL.createObjectURL(files[0]);
    $("#image-preview").onload = () =>
      URL.revokeObjectURL($("#image-preview").src);
    $("#image-info").textContent =
      `${files.length} image${files.length > 1 ? "s" : ""} · ${size(files.reduce((n, f) => n + f.size, 0))} · ${img.width} × ${img.height} first image`;
    $("#image-process").disabled = false;
  } catch (e) {
    toast(e.message);
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
  clearResults();
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
  clearResults();
});
function formatChanged() {
  quality.disabled = format.value === "image/png";
  $("#format-note").textContent = quality.disabled
    ? "PNG is lossless. Quality does not apply; output may be larger."
    : format.value === "image/jpeg"
      ? "Transparent areas will use a white background."
      : "WebP balances size and image quality.";
  clearResults();
}
format.onchange = formatChanged;
quality.oninput = () => {
  $("#quality-value").value = quality.value + "%";
  clearResults();
};
$("#cancel-job").onclick = () => {
  generation++;
  $("#image-result").textContent =
    "Cancelled. Finished images remain available.";
};
$("#image-process").onclick = async () => {
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
    return toast("Use whole dimensions from 1–12,000 px, up to 40 megapixels.");
  clearResults();
  const job = generation,
    mime = format.value,
    q = +quality.value / 100;
  busy(true);
  try {
    let scaler = null,
      browserResize = false;
    for (let i = 0; i < files.length; i++) {
      if (job !== generation) break;
      $("#image-result").textContent =
        `Processing ${i + 1} of ${files.length}…`;
      try {
        const img = await image(files[i]),
          targetWidth = width,
          targetHeight = Math.max(
            1,
            Math.round((width * img.height) / img.width),
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
          blob = await canvasBlob(canvas, mime, q);
        } catch (e) {
          if (e.name === "SecurityError")
            throw new Error(
              "This browser blocked image export. Check this site's image permissions or try another browser.",
            );
          throw e;
        } finally {
          if (source) source.width = source.height = 0;
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
        results.push({ name, blob, url });
        const diff = (1 - blob.size / files[i].size) * 100;
        $("#batch-results").insertAdjacentHTML(
          "beforeend",
          `<div class="saved-row"><div><strong>${esc(files[i].name)}</strong><p>${targetWidth} × ${targetHeight} · ${size(files[i].size)} → ${size(blob.size)} · ${Math.abs(diff).toFixed(0)}% ${diff >= 0 ? "smaller" : "larger"}</p></div><a class="text-link" href="${url}" download="${esc(name)}">Download ↓</a></div>`,
        );
      } catch (e) {
        $("#batch-results").insertAdjacentHTML(
          "beforeend",
          `<div class="saved-row error-text">${esc(files[i].name)}: ${esc(e.message)}</div>`,
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
    $("#image-result").textContent =
      `${outcome} · ${results.length} of ${files.length} images ready.${completed && results.length < files.length ? " Check the messages below and retry." : ""}`;
    if (results.length) {
      const first = results[0];
      $("#image-download").href = first.url;
      $("#image-download").download = first.name;
      $("#image-download").hidden = false;
      $("#image-zip").hidden = results.length < 2;
    }
  } catch (e) {
    toast(e.message);
  } finally {
    busy(false);
    formatChangedQuality();
  }
};
function formatChangedQuality() {
  quality.disabled = format.value === "image/png";
}
$("#image-zip").onclick = async (e) => {
  e.target.disabled = true;
  try {
    await zip(
      results.map((x) => [x.name, x.blob]),
      "kensei-images.zip",
    );
  } catch (e) {
    toast(e.message);
  } finally {
    e.target.disabled = false;
  }
};
$("#save-preset").onclick = async () => {
  const name = prompt("Name this image preset:", "My image preset");
  if (!name?.trim()) return;
  const width = +w.value || null;
  if (width && (!Number.isInteger(width) || width < 1 || width > 12000))
    return toast("Enter a valid width before saving.");
  try {
    await api.saveItem("preset", {
      tool: "image-studio",
      name: name.trim().slice(0, 100),
      width,
      format: format.value,
      quality: +quality.value,
    });
    toast("Preset saved.");
  } catch {
    toast("Preset could not be saved. Try again.");
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
