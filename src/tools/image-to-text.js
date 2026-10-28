import { init as professionalOCR } from "./studio-image-to-text.js";
import { OCRClient } from "./ocr-client.js";
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
  canvasBlob,
  library,
  zip,
} from "./common.js";
import { uiMsg, uiJoin, uiFrom, uiError, uiText } from "../site/ui.js";
import { el, panel, row, button, field, select } from "./advanced-ui.js";
import { sendControl, receiveHandoff } from "./handoff.js";
const output = $("#ocr-output"),
  changed = draftEditor("image-to-text", output),
  input = $("#ocr-file");
input.multiple = true;
input.accept = "image/png,image/jpeg,image/webp,application/pdf,.pdf";
output.removeAttribute("maxlength");
let selected = [],
  entries = [],
  worker = null,
  generation = 0,
  request = 0,
  current = -1,
  pdfTask = null,
  pdf = null,
  settle = null,
  running = false;
const settings = panel(
    "Batch and recognition settings",
    $("#ocr-run").closest("section"),
  ),
  chooser = el("select", "", { id: "ocr-entry" }),
  range = el("input", "", { placeholder: "1-3,5", id: "ocr-pages" }),
  rotate = select([
    ["0", "0°"],
    ["90", "90°"],
    ["180", "180°"],
    ["270", "270°"],
  ]),
  gray = el("input", "", { type: "checkbox" }),
  threshold = el("input", "", { type: "checkbox" }),
  level = el("input", "", { type: "number", min: 0, max: 255, value: 160 }),
  crop = Array.from({ length: 4 }, (_, i) =>
    el("input", "", {
      type: "number",
      min: 0,
      max: 100,
      value: i < 2 ? 0 : 100,
    }),
  ),
  list = el("div", "", { class: "advanced-list", id: "ocr-batch-results" });
settings.append(
  field("PDF pages to recognize (up to 20)", range),
  field("Current image or page", chooser),
  field("Rotate", rotate),
  row(
    field("Grayscale", gray),
    field("Threshold", threshold),
    field("Threshold level", level),
  ),
  el("p", "Crop percentages: left, top, width, height."),
  row(
    ...crop.map((n, i) =>
      field(["Left %", "Top %", "Width %", "Height %"][i], n),
    ),
  ),
  row(
    button("Preview preprocessing", async () => {
      saveSettings();
      const f = await prepared(entries[current]);
      const u = URL.createObjectURL(f);
      $("#ocr-preview").src = u;
      $("#ocr-preview").hidden = false;
      $("#ocr-preview").onload = () => URL.revokeObjectURL(u);
    }),
    button("Retry failed items", () => run(true)),
  ),
  list,
);
let recipeDefaults = null;
const defaults = () =>
  recipeDefaults
    ? structuredClone(recipeDefaults)
    : {
        rotation: 0,
        gray: false,
        threshold: false,
        level: 160,
        crop: [0, 0, 100, 100],
      };
function saveSettings() {
  if (current < 0 || !entries[current]) return;
  const nextSettings = {
    rotation: +rotate.value,
    gray: gray.checked,
    threshold: threshold.checked,
    level: +level.value,
    crop: crop.map((n) => +n.value),
  };
  if (
    JSON.stringify(nextSettings) !== JSON.stringify(entries[current].settings)
  )
    entries[current].processingStale = true;
  entries[current].settings = nextSettings;
}
function choose(i) {
  saveSettings();
  current = i;
  const e = entries[i];
  if (!e) return;
  const s = e.settings;
  rotate.value = s.rotation;
  gray.checked = s.gray;
  threshold.checked = s.threshold;
  level.value = s.level;
  crop.forEach((n, j) => (n.value = s.crop[j]));
  chooser.value = String(i);
  output.value = e.text ?? "";
  if (e.text !== undefined) output.value = e.text;
  else if (e.file) {
    const u = URL.createObjectURL(e.file);
    $("#ocr-preview").src = u;
    $("#ocr-preview").hidden = false;
    $("#ocr-preview").onload = () => URL.revokeObjectURL(u);
  }
  updateSave();
  window.dispatchEvent(new Event("ocr-entry-change"));
}
function updateSave() {
  const b = $("#save-draft");
  if (b) b.disabled = output.value.length > 100000;
  if (output.value.length > 100000)
    status(
      uiMsg(
        "This result exceeds the draft limit. The full text can still be downloaded.",
      ),
      true,
    );
}
function render() {
  chooser.replaceChildren(
    ...entries.map((e, i) =>
      el("option", "", { value: i, textContent: e.name }),
    ),
  );
  list.replaceChildren();
  entries.forEach((e, i) => {
    const r = el("div", "", { class: "saved-row" }),
      label = el("span");
    uiText(
      label,
      uiJoin([
        e.name,
        " · ",
        e.error
          ? uiError(Error(e.error))
          : e.text === undefined
            ? uiMsg("Waiting")
            : uiMsg("{0}% confidence", [Math.round(e.confidence || 0)]),
      ]),
    );
    r.append(
      label,
      button("Open result", () => choose(i)),
    );
    list.append(r);
  });
  chooser.value = String(current);
}
function stop() {
  generation++;
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
  worker = null;
  settle?.reject(Error("Cancelled."));
  settle = null;
  running = false;
  busy(false);
}
async function load(fs) {
  if (running) stop();
  if (!fs.length) return;
  if (
    fs.some((f) => f.type === "application/pdf") &&
    (fs.length !== 1 || fs[0].size > 50 * 1048576)
  )
    throw Error("Choose one PDF up to 50 MB, or a batch of images.");
  if (fs.length > 20 || fs.reduce((n, f) => n + f.size, 0) > 100 * 1048576)
    throw Error("Choose up to 20 images, totaling no more than 100 MB.");
  const token = ++generation;
  const next = [];
  let incomingTask = null,
    incomingPdf = null;
  if (fs[0].type === "application/pdf") {
    await library("pdf-lib.js", "PDFLib").then((lib) =>
      fs[0].arrayBuffer().then((b) => lib.PDFDocument.load(b)),
    );
    const mod = await import("/vendor/pdfjs/build/pdf.min.mjs");
    mod.GlobalWorkerOptions.workerSrc =
      "/vendor/pdfjs/build/pdf.worker.min.mjs";
    incomingTask = mod.getDocument({
      data: new Uint8Array(await fs[0].arrayBuffer()),
      cMapUrl: "/vendor/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
      wasmUrl: "/vendor/pdfjs/wasm/",
      isEvalSupported: false,
    });
    incomingPdf = await incomingTask.promise;
    if (incomingPdf.numPages > 200)
      throw Error("Choose PDFs with no more than 200 pages in total.");
    range.value =
      incomingPdf.numPages > 20 ? "1-20" : "1-" + incomingPdf.numPages;
    range.disabled = false;
    for (let n = 1; n <= incomingPdf.numPages; n++)
      next.push({
        name: fs[0].name + " · " + n,
        page: n,
        settings: defaults(),
      });
  } else {
    for (const f of fs) {
      await image(f);
      next.push({ name: f.name, file: f, settings: defaults() });
    }

    range.value = "";
    range.disabled = true;
  }
  if (token !== generation) {
    incomingTask?.destroy();
    return;
  }
  pdfTask?.destroy();
  pdfTask = incomingTask;
  pdf = incomingPdf;
  selected = fs;
  entries = next;
  current = -1;
  render();
  choose(0);
  uiText($("#ocr-file-info"), fs.map((f) => f.name).join(", "));
  status(
    uiMsg(
      !pdf && fs.length === 1
        ? "Image ready. Choose languages, then extract text."
        : "Files ready. Choose settings, then extract text.",
    ),
  );
}
input.onchange = async (e) => {
  try {
    await load([...e.target.files]);
  } catch (e) {
    status(uiError(e), true);
  }
};
chooser.onchange = () => choose(+chooser.value);
function pageIndices() {
  if (!pdf) return entries.map((_, i) => i);
  const list = [];
  for (const part of range.value.split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw Error("Use valid page ranges, such as 1-3,5.");
    const a = +m[1],
      b = +(m[2] || a);
    if (a < 1 || b < a || b > entries.length)
      throw Error("The selected page range is invalid.");
    for (let n = a; n <= b; n++) if (!list.includes(n - 1)) list.push(n - 1);
  }
  if (!list.length || list.length > 20)
    throw Error("Select up to 20 pages for recognition.");
  return list;
}
async function prepared(e) {
  if (!e) throw Error("Choose an image first.");
  let source,
    temporary = null;
  if (e.page) {
    const page = await pdf.getPage(e.page),
      v = page.getViewport({ scale: 2 });
    if (v.width * v.height > 16000000)
      throw Error("The PDF page is too large to render.");
    temporary = el("canvas", "", {
      width: Math.ceil(v.width),
      height: Math.ceil(v.height),
    });
    await page.render({
      canvasContext: temporary.getContext("2d"),
      viewport: v,
      background: "#fff",
    }).promise;
    source = temporary;
  } else source = await image(e.file);
  const s = e.settings,
    [x, y, w, h] = s.crop;
  if (
    ![x, y, w, h].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    w <= 0 ||
    h <= 0 ||
    x + w > 100 ||
    y + h > 100 ||
    !Number.isFinite(s.level) ||
    s.level < 0 ||
    s.level > 255
  )
    throw Error(
      "Choose a crop inside the image and a threshold from 0 to 255.",
    );
  const width = Math.max(1, Math.round((source.width * w) / 100)),
    height = Math.max(1, Math.round((source.height * h) / 100)),
    swap = s.rotation % 180 !== 0,
    c = el("canvas", "", {
      width: swap ? height : width,
      height: swap ? width : height,
    });
  try {
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((s.rotation * Math.PI) / 180);
    ctx.drawImage(
      source,
      (source.width * x) / 100,
      (source.height * y) / 100,
      (source.width * w) / 100,
      (source.height * h) / 100,
      -width / 2,
      -height / 2,
      width,
      height,
    );
    if (s.gray || s.threshold) {
      const pixels = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        let v =
          0.2126 * pixels.data[i] +
          0.7152 * pixels.data[i + 1] +
          0.0722 * pixels.data[i + 2];
        if (s.threshold) v = v >= s.level ? 255 : 0;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    const blob = await canvasBlob(c);
    e.nextPreparedMeta = {
      sourceWidth: source.width,
      sourceHeight: source.height,
      width: c.width,
      height: c.height,
      cropWidth: width,
      cropHeight: height,
      crop: [...s.crop],
      rotation: s.rotation,
    };
    return blob;
  } finally {
    c.width = c.height = 0;
    if (temporary) temporary.width = temporary.height = 0;
  }
}
async function recognize(file, languages, token, name) {
  worker ||= new OCRClient();
  const id = ++request,
    currentWorker = worker;
  return new Promise((resolve, reject) => {
    settle = { reject };
    worker.onmessage = ({ data }) => {
      if (token !== generation || (data.requestId && data.requestId !== id))
        return;
      if (data.progress) {
        const m = data.progress;
        status(
          uiJoin([
            name,
            " · ",
            uiFrom(m.status),
            Number.isFinite(m.progress)
              ? " · " + Math.round(m.progress * 100) + "%"
              : "",
          ]),
        );
        return;
      }
      settle = null;
      if (data.error) {
        currentWorker.terminate();
        if (worker === currentWorker) worker = null;
        reject(Error(data.error));
      } else resolve(data);
    };
    worker.onerror = (e) => {
      if (token !== generation || worker !== currentWorker) return;
      e.preventDefault();
      currentWorker.terminate();
      worker = null;
      settle = null;
      reject(Error("Recognition engine could not load. Retry the item."));
    };
    worker.postMessage({ file, languages, requestId: id });
  });
}
async function run(retry = false) {
  if (running) return;
  saveSettings();
  const languages = $$('[name="ocr-language"]:checked').map((n) => n.value);
  if (!languages.length) throw Error("Select at least one language.");
  let indices = pageIndices();
  if (retry) indices = indices.filter((i) => entries[i].error);
  if (!indices.length)
    throw Error(
      retry
        ? "No failed items to retry."
        : "Choose an image or PDF, then select the pages to recognize.",
    );
  const token = ++generation;
  running = true;
  busy(true);
  try {
    for (const i of indices) {
      if (token !== generation) break;
      const e = entries[i];
      try {
        if (e.page) {
          const content = await (await pdf.getPage(e.page)).getTextContent();
          const native = content.items
            .filter((x) => x.str?.trim())
            .map((x) => x.str)
            .join(" ");
          if (
            native &&
            !window.KenseiAdvancedContexts["image-to-text"].shouldReOCR()
          ) {
            e.native = true;
            e.rasterize = false;
            e.manualText = false;
            e.processingStale = false;
            e.text = native;
            e.blocks = [];
            e.reviewLines = [];
            e.error = null;
            e.confidence = 100;
            current = -1;
            choose(i);
            render();
            changed();
            continue;
          }
          e.rasterize = !!native;
          e.native = false;
        }
        const data = await recognize(
          await prepared(e),
          languages,
          token,
          e.name,
        );
        if (token !== generation) break;
        e.text = data.text;
        e.blocks = data.blocks || [];
        e.reviewLines = null;
        e.processingStale = false;
        e.manualText = false;
        e.preparedMeta = e.nextPreparedMeta;
        e.confidence = data.confidence;
        e.error = null;
        current = -1;
        choose(i);
        changed();
        if (e.confidence != null && e.confidence < 70)
          status(
            uiMsg("Low confidence. Review the recognized text carefully."),
          );
        render();
      } catch (error) {
        if (token !== generation) break;
        e.error = error.message;
        render();
      }
    }
    if (token === generation)
      status(
        uiMsg(
          indices.every((i) => entries[i].error)
            ? "Recognition failed. Check each item and retry."
            : indices.length === 1
              ? "Text extracted. Review it before use."
              : "Recognition finished. Review each result before use.",
        ),
        indices.every((i) => entries[i].error),
      );
  } finally {
    if (token === generation) {
      running = false;
      busy(false);
      updateSave();
      window.dispatchEvent(new Event("ocr-result-change"));
    }
  }
}
$("#ocr-run").onclick = () => run().catch((e) => status(uiError(e), true));
$("#cancel-job").onclick = () => {
  stop();
  status(uiMsg("Recognition cancelled. Your previous text is kept."));
};
output.addEventListener("input", () => {
  if (entries[current]) {
    entries[current].text = output.value;
    entries[current].manualText = true;
  }
  window.dispatchEvent(new Event("ocr-result-change"));
  updateSave();
});
$("#ocr-copy").onclick = () => copy(output);
$("#ocr-download").onclick = () =>
  downloadText(
    output.value,
    filename(entries[current]?.name || "kensei-ocr") + ".txt",
  );
settings.append(
  row(
    button("Download all recognized text", () =>
      zip(
        entries
          .filter((e) => e.text !== undefined)
          .map((e, i) => [
            i + 1 + "-" + filename(e.name) + ".txt",
            new Blob([e.text]),
          ]),
        "kensei-ocr.zip",
      ),
    ),
  ),
);
sendControl(
  settings,
  () => ({
    kind: "text",
    text:
      output.selectionEnd > output.selectionStart
        ? output.value.slice(output.selectionStart, output.selectionEnd)
        : output.value,
  }),
  ["text-toolkit", "markdown-studio", "text-compare"],
);
receiveHandoff(
  "image-to-text",
  (p) => load(p.files),
  () => selected.length > 0,
);
window.addEventListener("pagehide", () => {
  stop();
  pdfTask?.destroy();
});

window.addEventListener("locale-change", render);

window.KenseiAdvancedContexts ||= {};
const professionalContext = {
  get entries() {
    return entries;
  },
  get current() {
    return current;
  },
  get pdf() {
    return pdf;
  },
  get files() {
    return selected;
  },
  get running() {
    return running;
  },
  choose,
  getSettings() {
    saveSettings();
    return structuredClone(entries[current]?.settings || defaults());
  },
  updateText(text) {
    output.value = text;
    if (entries[current]) entries[current].text = text;
    changed();
    updateSave();
  },
  applyRecipe(s) {
    recipeDefaults = structuredClone(s.preprocessing);
    document
      .querySelectorAll('[name="ocr-language"]')
      .forEach((n) => (n.checked = s.languages.includes(n.value)));
    for (const e of entries) {
      if (JSON.stringify(e.settings) !== JSON.stringify(s.preprocessing))
        e.processingStale = true;
      e.settings = structuredClone(s.preprocessing);
    }
    if (current >= 0) {
      const i = current;
      current = -1;
      choose(i);
    }
  },
  shouldReOCR: () => false,
};
window.KenseiAdvancedContexts["image-to-text"] = professionalContext;
professionalOCR(professionalContext);

for (const n of [rotate, gray, threshold, level, ...crop])
  n.addEventListener("input", () => {
    saveSettings();
    window.dispatchEvent(new Event("ocr-result-change"));
  });
