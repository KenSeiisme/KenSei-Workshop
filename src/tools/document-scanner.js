import {
  $,
  $$,
  busy,
  canvasBlob,
  download,
  image,
  library,
  status,
} from "./common.js";
import { el } from "./advanced-ui.js";
import { sendControl, targets, validateHandoff } from "./handoff.js";
import { addFittedImage } from "./image-pdf.js";
import {
  scanDimensions,
  suggestCorners,
  validCorners,
  warpRows,
  wholePhoto,
} from "./scan-geometry.js";
import { uiAttr, uiError, uiMsg, uiText } from "../site/ui.js";

const pages = [];
const mib = 1048576;
const frame = $("#scan-frame"),
  canvas = $("#scan-source");
const list = $("#scan-pages"),
  color = $("#scan-color");
const camera = $("#scan-camera"),
  imports = $("#scan-import");
const handles = $$(".scan-corner");
let selected = null,
  replacement = null,
  generation = 0,
  working = false;
let ocrFiles = null,
  pdfFile = null;

const filePayload = (files) => ({ kind: "files", files: files || [] });
sendControl($("#scan-transfer"), () => filePayload(ocrFiles), [
  "image-to-text",
]);
sendControl($("#scan-transfer"), () => filePayload(pdfFile && [pdfFile]), [
  "pdf-toolkit",
]);

function invalidate() {
  ocrFiles = pdfFile = null;
  window.dispatchEvent(new Event("tool-content-changed"));
}

function drawPhoto(node, img, rotation, scale = 1) {
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  node.width = rotation % 180 ? h : w;
  node.height = rotation % 180 ? w : h;
  const ctx = node.getContext("2d", { alpha: false, willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, node.width, node.height);
  ctx.translate(node.width / 2, node.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.resetTransform();
  return ctx;
}

function drawCorners() {
  $("#scan-outline").setAttribute(
    "points",
    selected.corners.map(([x, y]) => [x * 100, y * 100].join(",")).join(" "),
  );
  selected.corners.forEach(([x, y], i) => {
    handles[i].style.left = x * 100 + "%";
    handles[i].style.top = y * 100 + "%";
    uiAttr(
      handles[i],
      "aria-description",
      uiMsg("Horizontal {0}%, vertical {1}%", [
        Math.round(x * 100),
        Math.round(y * 100),
      ]),
    );
  });
}

function drawSource() {
  if (!selected) return;
  delete frame.dataset.preview;
  $("#scan-compare").setAttribute("aria-pressed", "false");
  drawPhoto(canvas, selected.thumb, selected.rotation, 1);
  frame.style.setProperty(
    "--scan-width",
    Math.round(Math.min(760, (500 * canvas.width) / canvas.height)) + "px",
  );
  drawCorners();
}

function render() {
  list.replaceChildren();
  pages.forEach((page, i) => {
    const item = el("li");
    const b = el("button", "", { type: "button" });
    const label = el("span");
    uiText(label, uiMsg("Page {0}", [i + 1]));
    uiAttr(b, "aria-label", uiMsg("Page {0}: {1}", [i + 1, page.file.name]));
    const thumb = el("img", "", { src: page.url, alt: "" });
    thumb.style.transform = "rotate(" + page.rotation + "deg)";
    b.setAttribute("aria-current", String(page === selected));
    b.append(thumb, label);
    b.onclick = () => {
      selected = page;
      render();
      list.children[i]?.firstChild.focus();
    };
    item.append(b);
    list.append(item);
  });
  $("#scan-editor").hidden = $("#scan-output").hidden = !selected;
  if (selected) {
    $("#scan-earlier").disabled = pages.indexOf(selected) === 0;
    $("#scan-later").disabled = selected === pages.at(-1);
    color.value = selected.mode;
    drawSource();
  }
}

async function operation(work) {
  if (working) return;
  const id = ++generation;
  const current = () => generation === id;
  working = true;
  busy(true);
  try {
    await work(current);
  } catch (error) {
    if (current()) status(uiError(error), true);
  } finally {
    if (current()) {
      working = false;
      busy(false);
      window.dispatchEvent(new Event("tool-content-changed"));
      $("#scan-earlier").disabled = pages.indexOf(selected) <= 0;
      $("#scan-later").disabled = selected === pages.at(-1);
    }
  }
}

$("#cancel-job").onclick = () => {
  generation++;
  working = false;
  busy(false);
  status(uiMsg("Cancelled."));
};

async function makePage(file, current) {
  const img = await image(file);
  if (!current()) return null;
  const thumb = document.createElement("canvas");
  drawPhoto(thumb, img, 0, Math.min(1, 900 / Math.max(img.width, img.height)));
  const small = document.createElement("canvas");
  const edges = drawPhoto(
    small,
    thumb,
    0,
    Math.min(1, 560 / Math.max(thumb.width, thumb.height)),
  );
  const detected = suggestCorners(
    edges.getImageData(0, 0, small.width, small.height),
  );
  const preview = await canvasBlob(thumb, "image/jpeg", 0.82);
  if (!current()) return null;
  return {
    file,
    thumb,
    url: URL.createObjectURL(preview),
    rotation: 0,
    corners: detected || wholePhoto(),
    detected,
    mode: "color",
    jpeg: null,
  };
}

function addFiles(files, replace) {
  if (!files.length) return;
  operation(async (current) => {
    const initialCount = pages.length - (replace ? 1 : 0);
    const initialBytes = pages.reduce(
      (sum, page) => sum + (page === replace ? 0 : page.file.size),
      0,
    );
    if (
      initialCount + files.length > 20 ||
      initialBytes + files.reduce((sum, file) => sum + file.size, 0) > 100 * mib
    )
      throw Error("Choose up to 20 images, totaling no more than 100 MB.");
    const failures = $("#scan-failures");
    failures.replaceChildren();
    failures.hidden = true;
    let added = 0;
    for (const file of files) {
      try {
        const page = await makePage(file, current);
        if (!current()) return;
        if (replace) {
          URL.revokeObjectURL(replace.url);
          pages[pages.indexOf(replace)] = page;
        } else pages.push(page);
        selected = page;
        added++;
        invalidate();
        render();
        // The newly rendered controls must respect the running operation.
        busy(true);
      } catch (error) {
        if (!current()) return;
        const item = el("li");
        const name = document.createTextNode(file.name + " · ");
        const message = el("span");
        uiText(message, uiError(error));
        item.append(name, message);
        failures.append(item);
        failures.hidden = false;
      }
    }
    if (!added) status(uiMsg("No new pages could be opened."), true);
    else
      status(
        selected.detected
          ? uiMsg("Check the suggested corners before exporting.")
          : uiMsg(
              "Paper edges could not be detected. Adjust the corners or keep the full photo.",
            ),
      );
  });
}

$("#scan-camera-button").onclick = () => {
  replacement = null;
  camera.click();
};
$("#scan-retake-camera").onclick = () => {
  replacement = selected;
  camera.click();
};
$("#scan-import-button").onclick = () => {
  replacement = null;
  imports.multiple = true;
  imports.click();
};
$("#scan-retake").onclick = () => {
  replacement = selected;
  imports.multiple = false;
  imports.click();
};
camera.onchange = () => {
  addFiles([...camera.files], replacement);
  replacement = null;
  camera.value = "";
};
imports.onchange = () => {
  const list = [...imports.files];
  const target = replacement;
  replacement = null;
  imports.value = "";
  addFiles(target ? list.slice(0, 1) : list, target);
};

function changed() {
  selected.jpeg = null;
  invalidate();
}
function move(step) {
  const i = pages.indexOf(selected);
  const j = i + step;
  if (j < 0 || j >= pages.length) return;
  [pages[i], pages[j]] = [pages[j], pages[i]];
  invalidate();
  render();
}
$("#scan-earlier").onclick = () => move(-1);
$("#scan-later").onclick = () => move(1);
$("#scan-remove").onclick = () => {
  const i = pages.indexOf(selected);
  URL.revokeObjectURL(selected.url);
  pages.splice(i, 1);
  selected = pages[i] || pages.at(-1) || null;
  invalidate();
  render();
};
$("#scan-rotate").onclick = () => {
  const points = selected.corners.map(([x, y]) => [1 - y, x]);
  selected.corners = [points[3], ...points.slice(0, 3)];
  selected.rotation = (selected.rotation + 90) % 360;
  changed();
  drawSource();
};
$("#scan-reset").onclick = () => {
  selected.corners = wholePhoto();
  changed();
  drawSource();
};
color.onchange = () => {
  selected.mode = color.value;
  changed();
  drawSource();
};

function moveCorner(index, x, y) {
  if (working || !selected) return;
  const points = selected.corners.slice();
  points[index] = [x, y].map((v) => Math.min(1, Math.max(0, v)));
  if (!validCorners(points)) return;
  selected.corners = points;
  changed();
  drawCorners();
}
for (const handle of handles) {
  const index = +handle.dataset.corner;
  handle.onpointerdown = (event) => {
    if (event.button === 0) handle.setPointerCapture(event.pointerId);
  };
  handle.onpointermove = (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const rect = canvas.getBoundingClientRect();
    moveCorner(
      index,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  };
  handle.onkeydown = (event) => {
    const offsets = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.02 : 0.004;
    const [x, y] = selected.corners[index];
    moveCorner(index, x + step * offset[0], y + step * offset[1]);
  };
}

async function renderPage(img, page, output, preview, current) {
  const source = document.createElement("canvas");
  // Keep full-resolution sampling for ordinary photos and bound the decoded working buffer.
  const scale = Math.min(
    1,
    Math.sqrt(16000000 / (img.width * img.height)),
    4096 / Math.max(img.width, img.height),
  );
  const context = drawPhoto(source, img, preview ? 0 : page.rotation, scale);
  try {
    [output.width, output.height] = scanDimensions(
      page.corners,
      source.width,
      source.height,
      preview ? 1000000 : 12000000,
    );
    const target = output.getContext("2d");
    const pixels = target.createImageData(output.width, output.height);
    const complete = await warpRows(
      context.getImageData(0, 0, source.width, source.height),
      pixels,
      page.corners,
      page.mode,
      current,
    );
    if (!complete) return false;
    target.putImageData(pixels, 0, 0);
    return true;
  } finally {
    source.width = source.height = 0;
  }
}
$("#scan-compare").onclick = () => {
  if (frame.hasAttribute("data-preview")) return drawSource();
  operation(async (current) => {
    const rotated = document.createElement("canvas");
    drawPhoto(rotated, selected.thumb, selected.rotation);
    const preview = document.createElement("canvas");
    if (!(await renderPage(rotated, selected, preview, true, current))) return;
    canvas.width = preview.width;
    canvas.height = preview.height;
    canvas.getContext("2d").drawImage(preview, 0, 0);
    frame.style.setProperty(
      "--scan-width",
      Math.round(Math.min(760, (500 * canvas.width) / canvas.height)) + "px",
    );
    frame.dataset.preview = "";
    $("#scan-compare").setAttribute("aria-pressed", "true");
    status(
      uiMsg(
        "Showing the corrected page. Compare original to return to the corners.",
      ),
    );
  });
};
async function jpeg(page, current) {
  if (page.jpeg) return page.jpeg;
  const img = await image(page.file);
  if (!current()) return null;
  const output = document.createElement("canvas");
  try {
    if (!(await renderPage(img, page, output, false, current))) return null;
    const blob = await canvasBlob(output, "image/jpeg", 0.92);
    if (current()) page.jpeg = blob;
    return blob;
  } finally {
    output.width = output.height = 0;
  }
}
function exportPages(kind) {
  operation(async (current) => {
    const chosen = kind === "jpg" ? [selected] : pages.slice();
    const files = [];
    const lib = kind === "pdf" ? await library("pdf-lib.js", "PDFLib") : null;
    const pdf = lib && (await lib.PDFDocument.create());
    for (const [i, page] of chosen.entries()) {
      if (!current()) return;
      status(uiMsg("Preparing page {0} of {1}…", [i + 1, chosen.length]));
      const blob = await jpeg(page, current);
      if (!current()) return;
      const file = new File(
        [blob],
        "scan-" + String(i + 1).padStart(2, "0") + ".jpg",
        { type: "image/jpeg" },
      );
      files.push(file);
      if (pdf)
        addFittedImage(pdf, await pdf.embedJpg(await file.arrayBuffer()));
    }
    if (pdf) {
      const bytes = await pdf.save();
      if (!current()) return;
      pdfFile = new File([bytes], "kensei-scan.pdf", {
        type: "application/pdf",
      });
      download(pdfFile, pdfFile.name);
      status(
        pdfFile.size > targets["pdf-toolkit"].bytes
          ? uiMsg("PDF downloaded. Use fewer pages to send it to PDF Toolkit.")
          : uiMsg("PDF downloaded. You can also send it to PDF Toolkit."),
      );
    } else if (kind === "jpg") {
      download(files[0], "scan-" + (pages.indexOf(selected) + 1) + ".jpg");
      status(uiMsg("Page downloaded."));
    } else {
      validateHandoff("image-to-text", filePayload(files));
      ocrFiles = files;
      status(uiMsg("Pages ready. Send them to Image to Text to start OCR."));
    }
    window.dispatchEvent(new Event("tool-content-changed"));
  });
}
$("#scan-pdf").onclick = () => exportPages("pdf");
$("#scan-jpg").onclick = () => exportPages("jpg");
$("#scan-ocr").onclick = () => exportPages("ocr");
