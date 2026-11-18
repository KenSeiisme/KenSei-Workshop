import { sendControl } from "./handoff.js";
import { $, image, canvasBlob, download } from "./common.js";
import { uiText } from "../site/ui.js";

let cropper = null,
  selection = null,
  current = null,
  revision = 0,
  previewURL = null,
  previewBlob = null,
  sourceURL = null;
function applyRatio() {
  if (!selection) return;
  const ratio =
    $("#edit-ratio").value === "free" ? NaN : Number($("#edit-ratio").value);
  selection.aspectRatio = ratio;
  let w = selection.width,
    h = selection.height;
  if (Number.isFinite(ratio)) {
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
  }
  selection.$change(
    selection.x + (selection.width - w) / 2,
    selection.y + (selection.height - h) / 2,
    w,
    h,
    ratio,
  );
  dimensions();
}
function fitSelection() {
  if (!cropper || !selection) return;
  const img = cropper.getCropperImage(),
    area = cropper.getCropperCanvas().getBoundingClientRect();
  let r = img.getBoundingClientRect();
  const scale = Math.min(1, area.width / r.width, area.height / r.height);
  if (scale < 1) img.$scale(scale, scale);
  r = img.getBoundingClientRect();
  selection.aspectRatio = NaN;
  selection.$change(r.x - area.x, r.y - area.y, r.width, r.height);
  applyRatio();
}
const note = (s, error = false) => {
  uiText($("#edit-status"), s);
  $("#edit-status").classList.toggle("error-text", error);
};
function clear() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = previewBlob = null;
  document.querySelector("#image-edit-send")?.remove();
  $("#edit-preview").hidden = true;
  $("#edit-download").disabled = true;
}
for (const mode of ["batch", "edit"])
  $("#image-mode-" + mode).onclick = () => {
    $("#image-batch-mode").hidden = mode !== "batch";
    $("#image-edit-mode").hidden = mode !== "edit";
    $("#image-mode-batch").setAttribute(
      "aria-pressed",
      String(mode === "batch"),
    );
    $("#image-mode-edit").setAttribute("aria-pressed", String(mode === "edit"));
  };
function dimensions() {
  if (!selection || !cropper) return;
  const t = cropper.getCropperImage().$getTransform(),
    scale = Math.hypot(t[0], t[1]) || 1;
  $("#edit-width").value = Math.max(1, Math.round(selection.width / scale));
  $("#edit-height").value = Math.max(1, Math.round(selection.height / scale));
  clear();
}
$("#edit-file").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const token = ++revision;
  clear();
  try {
    await image(f);
    const { default: Cropper } = await import("/vendor/cropper.js");
    if (token !== revision) return;
    cropper?.destroy();
    if (sourceURL) URL.revokeObjectURL(sourceURL);
    sourceURL = URL.createObjectURL(f);
    const element = new Image();
    element.src = sourceURL;
    await element.decode();
    if (token !== revision) return;
    current = f;
    const target = $("#edit-cropper");
    target.replaceChildren();
    cropper = new Cropper(element, { container: target });
    await cropper.getCropperImage().$ready();
    selection = cropper.getCropperSelection();
    cropper.getCropperImage().$center("contain");
    await new Promise(requestAnimationFrame);
    fitSelection();
    selection.addEventListener("change", () => {
      requestAnimationFrame(dimensions);
    });
    dimensions();
    $("#edit-run").disabled = false;
    note(
      f.name +
        " · Image ready. Drag the crop area, then preview the exported result.",
    );
  } catch (e) {
    note(
      e.message ||
        "This image editor could not load. Batch processing remains available.",
      true,
    );
  }
};
$("#edit-ratio").onchange = applyRatio;
for (const [id, action] of [
  ["edit-rotate", () => cropper.getCropperImage().$rotate("90deg")],
  ["edit-flip-x", () => cropper.getCropperImage().$scale(-1, 1)],
  ["edit-flip-y", () => cropper.getCropperImage().$scale(1, -1)],
  [
    "edit-reset",
    () => {
      cropper.getCropperImage().$resetTransform().$center("contain");
      selection.$reset();
    },
  ],
]) {
  $("#" + id).onclick = () => {
    if (!cropper) return;
    action();
    if (id === "edit-rotate" || id === "edit-reset") fitSelection();
    dimensions();
  };
}
$("#edit-width").oninput = () => {
  if (selection && +$("#edit-width").value > 0)
    $("#edit-height").value = Math.max(
      1,
      Math.round(
        (+$("#edit-width").value * selection.height) / selection.width,
      ),
    );
  clear();
};
for (const id of [
  "edit-format",
  "edit-quality",
  "edit-watermark",
  "edit-position",
  "edit-color",
  "edit-opacity",
  "edit-font-size",
])
  $("#" + id).addEventListener("input", clear);
$("#edit-run").onclick = async () => {
  const token = ++revision;
  try {
    if (!selection || !current) throw Error("Choose an image first.");
    const width = +$("#edit-width").value,
      height = +$("#edit-height").value;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 12000 ||
      height > 12000 ||
      width * height > 40000000
    )
      throw Error("Use dimensions up to 12,000 px and 40 megapixels.");
    $("#edit-run").disabled = true;
    note("Rendering your edit locally…");
    const canvas = await selection.$toCanvas({ width, height }),
      ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Canvas drawing is unavailable in this browser.");
    const format = $("#edit-format").value;
    if (format === "image/jpeg") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    const text = $("#edit-watermark").value;
    if (text) {
      ctx.save();
      const font = Math.max(
          8,
          Math.round(
            (Math.min(width, height) * Number($("#edit-font-size").value)) /
              100,
          ),
        ),
        pad = Math.max(8, font * 0.6);
      ctx.font = "600 " + font + "px system-ui, sans-serif";
      ctx.fillStyle = $("#edit-color").value;
      ctx.globalAlpha = Number($("#edit-opacity").value) / 100;
      ctx.textBaseline = "middle";
      const position = $("#edit-position").value;
      ctx.textAlign =
        position === "center"
          ? "center"
          : position === "top-left"
            ? "left"
            : "right";
      ctx.fillText(
        text,
        position === "center"
          ? width / 2
          : position === "top-left"
            ? pad
            : width - pad,
        position === "center"
          ? height / 2
          : position === "top-left"
            ? pad + font / 2
            : height - pad - font / 2,
        width - pad * 2,
      );
      ctx.restore();
    }
    const blob = await canvasBlob(
      canvas,
      format,
      Number($("#edit-quality").value) / 100,
    );
    canvas.width = canvas.height = 0;
    if (token !== revision) return;
    clear();
    previewBlob = blob;
    previewURL = URL.createObjectURL(blob);
    $("#edit-preview").src = previewURL;
    $("#edit-preview").hidden = false;
    $("#edit-download").disabled = false;
    const transfer = sendControl(
      $("#edit-download").parentElement,
      () => ({
        kind: "files",
        files: [
          new File(
            [previewBlob],
            (current?.name.replace(/\.[^.]+$/, "") || "image") +
              "-edited." +
              { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
                previewBlob.type
              ],
            { type: previewBlob.type },
          ),
        ],
      }),
      ["image-to-text", "pdf-toolkit", "file-renamer"],
    );
    transfer.id = "image-edit-send";
    note(
      "Preview ready · " +
        width +
        " × " +
        height +
        " · " +
        (blob.size / 1024).toFixed(1) +
        " KB.",
    );
  } catch (e) {
    note("Edit could not export. " + e.message, true);
  } finally {
    $("#edit-run").disabled = !cropper;
  }
};
$("#edit-download").onclick = () => {
  if (previewBlob)
    download(
      previewBlob,
      (current?.name.replace(/\.[^.]+$/, "") || "image") +
        "-edited." +
        { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
          $("#edit-format").value
        ],
    );
};
window.addEventListener("pagehide", (e) => {
  if (!e.persisted) {
    cropper?.destroy();
    if (sourceURL) URL.revokeObjectURL(sourceURL);
    if (previewURL) URL.revokeObjectURL(previewURL);
  }
});
