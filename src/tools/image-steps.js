import { $, canvasBlob, download, image } from "./common.js";
import { el } from "./advanced-ui.js";
import { sendControl } from "./handoff.js";
import { drawStep, stepsLayout } from "./steps-composition.js";
import { uiAttr, uiError, uiMsg, uiText } from "../site/ui.js";

const root = $("#image-steps-mode"),
  canvas = $("#steps-image"),
  picker = $("#steps-files");
const ctx = canvas.getContext("2d", { alpha: false });
const mode = $("#steps-type"),
  layout = $("#steps-layout"),
  width = $("#steps-width");
const note = $("#steps-status"),
  result = $("#steps-result");
const list = $("#steps-files-list"),
  editor = $("#steps-editor");
const earlier = $("#steps-earlier"),
  later = $("#steps-later");
const undo = $("#steps-undo"),
  prepare = $("#steps-preview");
let screenshots = [],
  selected = null,
  gesture = null;
let generation = 0,
  running = false,
  finalFile = null,
  finalUrl = null;

const send = sendControl(
  $("#steps-transfer"),
  () => ({
    kind: "files",
    files: finalFile && finalFile.size <= 20 * 1048576 ? [finalFile] : [],
  }),
  ["pdf-toolkit"],
);
function report(text, error = false) {
  uiText(note, text);
  note.classList.toggle("error-text", error);
}
function discardOutput() {
  if (finalUrl) URL.revokeObjectURL(finalUrl);
  finalUrl = finalFile = null;
  $("#steps-composite").removeAttribute("src");
  result.hidden = true;
  window.dispatchEvent(new Event("tool-content-changed"));
}
function changed() {
  if (finalFile) {
    discardOutput();
    report(uiMsg("Composition changed. Prepare a new preview."));
  }
}
function refreshControls() {
  for (const n of root.querySelectorAll("input,select,button"))
    if (n.id !== "steps-cancel" && !n.closest(".handoff-controls"))
      n.disabled = running;
  $("#steps-cancel").hidden = !running;
  prepare.disabled ||= !screenshots.length;
  undo.disabled ||= !selected?.marks.length;
  earlier.disabled ||= selected === screenshots[0];
  later.disabled ||= selected === screenshots.at(-1);
}
function redraw(draft) {
  if (!selected) return;
  const { thumb, marks } = selected;
  canvas.width = thumb.width;
  canvas.height = thumb.height;
  drawStep(
    ctx,
    thumb,
    { x: 0, y: 0, width: thumb.width, height: thumb.height },
    draft ? [...marks, draft] : marks,
  );
}
function show() {
  list.replaceChildren();
  screenshots.forEach((entry, index) => {
    const item = el("li"),
      button = el("button", "", { type: "button" });
    const number = el("span");
    uiText(number, uiMsg("Step {0}", [index + 1]));
    uiAttr(
      button,
      "aria-label",
      uiMsg("Step {0}: {1}", [index + 1, entry.file.name]),
    );
    button.setAttribute("aria-current", String(entry === selected));
    button.append(el("img", "", { src: entry.url, alt: "" }), number);
    button.onclick = () => {
      selected = entry;
      $("#steps-value").value = String(index + 1);
      show();
      list.children[index].firstChild.focus();
    };
    item.append(button);
    list.append(item);
  });
  editor.hidden = !selected;
  redraw();
  refreshControls();
}
function updateMode() {
  const drag = mode.value === "arrow" || mode.value === "cover";
  canvas.toggleAttribute("data-drag", drag);
  $("#steps-end").hidden = !drag;
  $("#steps-value-field").hidden = drag;
  if (mode.value === "number")
    $("#steps-value").value = String(screenshots.indexOf(selected) + 1);
  else if (mode.value === "text") $("#steps-value").value = "";
  uiText(
    $("#steps-instructions"),
    drag
      ? uiMsg("Drag on the screenshot, or enter two points below.")
      : uiMsg(
          "Click a spot on the screenshot, or enter its coordinates below.",
        ),
  );
}
mode.onchange = updateMode;
updateMode();

async function run(work) {
  if (running) return;
  const token = ++generation;
  const current = () => token === generation;
  running = true;
  refreshControls();
  try {
    await work(current);
  } catch (error) {
    if (current()) report(uiError(error), true);
  } finally {
    if (current()) {
      running = false;
      refreshControls();
    }
  }
}
$("#steps-cancel").onclick = () => {
  generation++;
  running = false;
  refreshControls();
  report(uiMsg("Cancelled."));
};
picker.onchange = () => {
  const files = [...picker.files];
  picker.value = "";
  if (!files.length) return;
  run(async (current) => {
    if (
      files.length > 6 ||
      files.reduce((total, f) => total + f.size, 0) > 100 * 1048576
    )
      throw Error("Choose up to six screenshots totaling no more than 100 MB.");
    const next = [];
    report(uiMsg("Opening screenshots…"));
    try {
      for (const file of files) {
        const img = await image(file);
        if (!current()) return;
        const thumb = document.createElement("canvas");
        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
        thumb.width = Math.max(1, Math.round(img.width * scale));
        thumb.height = Math.max(1, Math.round(img.height * scale));
        thumb.getContext("2d").drawImage(img, 0, 0, thumb.width, thumb.height);
        const preview = await canvasBlob(thumb, "image/png");
        if (!current()) return;
        next.push({
          file,
          thumb,
          width: img.width,
          height: img.height,
          marks: [],
          url: URL.createObjectURL(preview),
        });
      }
      screenshots.forEach((entry) => URL.revokeObjectURL(entry.url));
      screenshots = next.splice(0);
      selected = screenshots[0];
      discardOutput();
      $("#steps-value").value = "1";
      show();
      report(uiMsg("Screenshots ready for annotations."));
    } finally {
      next.forEach((entry) => URL.revokeObjectURL(entry.url));
    }
  });
};
function reorder(by) {
  const index = screenshots.indexOf(selected);
  const target = index + by;
  if (target < 0 || target >= screenshots.length) return;
  [screenshots[index], screenshots[target]] = [
    screenshots[target],
    screenshots[index],
  ];
  changed();
  show();
}
earlier.onclick = () => reorder(-1);
later.onclick = () => reorder(1);
undo.onclick = () => {
  selected.marks.pop();
  changed();
  redraw();
  refreshControls();
};
$("#steps-remove").onclick = () => {
  const index = screenshots.indexOf(selected);
  URL.revokeObjectURL(selected.url);
  screenshots.splice(index, 1);
  selected = screenshots[index] || screenshots.at(-1) || null;
  changed();
  show();
};

function annotate(start, end) {
  if (!selected || running) return;
  const type = mode.value;
  if (selected.marks.length >= 50)
    throw Error("Use up to 50 annotations per screenshot.");
  const value = $("#steps-value").value.trim();
  if (type === "number" && !/^\d{1,3}$/.test(value))
    throw Error("Enter a number from 0 to 999.");
  if (type === "text" && !value) throw Error("Enter short annotation text.");
  if (
    (type === "arrow" &&
      Math.hypot(start.x - end.x, start.y - end.y) < 0.006) ||
    (type === "cover" &&
      (Math.abs(start.x - end.x) < 0.004 || Math.abs(start.y - end.y) < 0.004))
  )
    throw Error("Choose two distinct points for this annotation.");
  selected.marks.push({ type, value, ...start, endX: end.x, endY: end.y });
  changed();
  redraw();
  refreshControls();
}
function place(start, end) {
  try {
    annotate(start, end);
  } catch (error) {
    report(uiError(error), true);
    redraw();
  }
}
$("#steps-place").onclick = () => {
  const coords = ["x", "y", "end-x", "end-y"].map(
    (id) => $("#steps-" + id).valueAsNumber / 100,
  );
  const used = canvas.hasAttribute("data-drag") ? coords : coords.slice(0, 2);
  if (!used.every((x) => Number.isFinite(x) && x >= 0 && x <= 1)) {
    report(uiMsg("Enter coordinates from 0 to 100%."), true);
    return;
  }
  place({ x: coords[0], y: coords[1] }, { x: coords[2], y: coords[3] });
};

function point(event) {
  const rect = canvas.getBoundingClientRect();
  const clamp = (x) => Math.min(1, Math.max(0, x));
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
}
canvas.onpointerdown = (event) => {
  if (running || !selected || event.button !== 0 || gesture) return;
  gesture = { id: event.pointerId, start: point(event) };
  canvas.setPointerCapture(event.pointerId);
};
canvas.onpointermove = (event) => {
  if (gesture?.id !== event.pointerId || !canvas.hasAttribute("data-drag"))
    return;
  const end = point(event);
  redraw({ type: mode.value, ...gesture.start, endX: end.x, endY: end.y });
};
canvas.onpointerup = (event) => {
  if (gesture?.id !== event.pointerId) return;
  const { start } = gesture;
  gesture = null;
  place(start, point(event));
};
canvas.onpointercancel = () => {
  gesture = null;
  redraw();
};

width.oninput = layout.onchange = changed;
prepare.onclick = () =>
  run(async (current) => {
    const pixels = width.valueAsNumber;
    if (!Number.isInteger(pixels) || pixels < 320 || pixels > 2400)
      throw Error("Use a whole output width from 320 to 2400 pixels.");
    const scene = stepsLayout(screenshots, layout.value, pixels);
    if (scene.height > 8192 || scene.width * scene.height > 16000000)
      return report(
        uiMsg(
          "The composition needs {0} × {1} px. Reduce the width or split it into two images.",
          [scene.width, scene.height],
        ),
        true,
      );
    const output = document.createElement("canvas");
    output.width = scene.width;
    output.height = scene.height;
    try {
      const painter = output.getContext("2d", { alpha: false });
      painter.fillStyle = "#211a2a";
      painter.fillRect(0, 0, scene.width, scene.height);
      for (const [i, entry] of screenshots.entries()) {
        report(
          uiMsg("Preparing screenshot {0} of {1}…", [
            i + 1,
            screenshots.length,
          ]),
        );
        const img = await image(entry.file);
        if (!current()) return;
        drawStep(painter, img, scene.cells[i], entry.marks);
      }
      const blob = await canvasBlob(output, "image/png");
      if (!current()) return;
      discardOutput();
      finalFile = new File([blob], "kensei-steps.png", { type: "image/png" });
      finalUrl = URL.createObjectURL(finalFile);
      $("#steps-composite").src = finalUrl;
      result.hidden = false;
      send.hidden = finalFile.size > 20 * 1048576;
      window.dispatchEvent(new Event("tool-content-changed"));
      report(
        send.hidden
          ? uiMsg(
              "Preview ready. Use a smaller width to send this image to PDF Toolkit.",
            )
          : uiMsg("Preview ready. Check your annotations before downloading."),
      );
    } finally {
      output.width = output.height = 0;
    }
  });
$("#steps-download").onclick = () => {
  if (finalFile) download(finalFile, finalFile.name);
};
