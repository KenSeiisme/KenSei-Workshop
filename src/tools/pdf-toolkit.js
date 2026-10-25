import {
  $,
  $$,
  esc,
  status,
  busy,
  library,
  size,
  image,
  canvasBlob,
  download,
  zip,
} from "./common.js";
import { metadata, enhancedPdf } from "./pdf-enhancements.js";
import { uiMsg, uiJoin, uiError, uiText, uiAttr, uiHtml } from "../site/ui.js";

let enhancedBytes = null,
  outputTask = null;
let sources = [],
  pages = [],
  images = [],
  revision = 0,
  pdfjs = null,
  lib = null,
  previewGeneration = 0;
const fileInput = $("#pdf-files"),
  operation = $("#pdf-operation");
async function dependencies() {
  lib ||= await library("pdf-lib.js", "PDFLib");
  if (!pdfjs) {
    pdfjs = await import("/vendor/pdfjs/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc =
      "/vendor/pdfjs/build/pdf.worker.min.mjs";
  }
}
function releaseSources() {
  previewGeneration++;
  sources.forEach((s) => s.loadingTask?.destroy().catch(() => {}));
}
function previewDocument(source) {
  source.loadingTask ||= pdfjs.getDocument({
    data: source.bytes.slice(),
    cMapUrl: "/vendor/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
    wasmUrl: "/vendor/pdfjs/wasm/",
    isEvalSupported: false,
  });
  return source.loadingTask.promise;
}
function mode() {
  const pictures = operation.value === "images";
  const enhanced = ["stamp", "metadata"].includes(operation.value);
  fileInput.multiple = !enhanced;
  $("#pdf-stamp-settings").hidden = operation.value !== "stamp";
  $("#pdf-metadata-settings").hidden = operation.value !== "metadata";
  $("#pdf-enhanced-actions").hidden = !enhanced;
  fileInput.accept = pictures
    ? "image/jpeg,image/png,image/webp"
    : "application/pdf";
  $("#pdf-ranges-group").hidden = pictures;
  $("#pdf-export-settings").hidden = operation.value !== "export";
  uiText(
    $("#pdf-help"),
    pictures
      ? uiMsg(
          "Choose images in their intended page order. Each image becomes one fitted A4 page.",
        )
      : uiMsg(
          "Choose PDFs to merge, or one PDF to organize. Page numbers below refer to the current order. Ranges: 1-3,5. Split groups: 1-3;4-5 (leave blank for one file per page).",
        ),
  );
  if (enhanced)
    uiText(
      $("#pdf-help"),
      uiMsg(
        "Choose one PDF. Reorder or rotate pages below. Stamps affect selected pages; document-information cleanup applies to the whole output.",
      ),
    );
}
operation.onchange = () => {
  clearEnhanced();
  revision++;
  busy(false);
  releaseSources();
  sources = [];
  pages = [];
  images = [];
  $("#pdf-pages").replaceChildren();
  $("#pdf-preview").hidden = true;
  fileInput.value = "";
  uiText($("#pdf-summary"), uiMsg("No files selected."));
  status(uiMsg("Choose files for this operation."));
  mode();
};
mode();
function render() {
  uiText(
    $("#pdf-summary"),
    images.length
      ? uiMsg("{0} images ready.", [images.length])
      : uiMsg("{0} PDF{1} · {2} pages · {3} selected", [
          sources.length,
          sources.length === 1 ? "" : "s",
          pages.length,
          pages.filter((p) => p.included).length,
        ]),
  );
  $("#pdf-pages").innerHTML = pages
    .map(
      (p, i) =>
        uiHtml`<div class="pdf-page-row"><label><input type="checkbox" data-page-select="${p.id}" ${p.included ? "checked" : ""} data-lock><span>Page ${i + 1}<small>${esc(sources[p.source].name)} · original page ${p.index + 1} · ${p.rotation}°</small></span></label><div class="page-actions"><button class="text-link" data-preview="${p.id}" data-lock>Preview</button><button data-move="${p.id}" data-direction="-1" aria-label="Move page ${i + 1} up" ${i === 0 ? "disabled" : ""} data-lock>↑</button><button data-move="${p.id}" data-direction="1" aria-label="Move page ${i + 1} down" ${i === pages.length - 1 ? "disabled" : ""} data-lock>↓</button><button data-rotate="${p.id}" aria-label="Rotate page ${i + 1}" data-lock>↻</button></div></div>`,
    )
    .join("");
  $$("[data-page-select]").forEach(
    (n) =>
      (n.onchange = () => {
        pages.find((p) => p.id === n.dataset.pageSelect).included = n.checked;
        uiText(
          $("#pdf-summary"),
          uiMsg("{0} pages · {1} selected", [
            pages.length,
            pages.filter((p) => p.included).length,
          ]),
        );
      }),
  );
  $$("[data-move]").forEach(
    (n) =>
      (n.onclick = () => {
        const i = pages.findIndex((p) => p.id === n.dataset.move),
          j = i + +n.dataset.direction;
        [pages[i], pages[j]] = [pages[j], pages[i]];
        render();
      }),
  );
  $$("[data-rotate]").forEach(
    (n) =>
      (n.onclick = () => {
        const p = pages.find((p) => p.id === n.dataset.rotate);
        p.rotation = (p.rotation + 90) % 360;
        render();
        preview(p);
      }),
  );
  $$("[data-preview]").forEach(
    (n) =>
      (n.onclick = () =>
        preview(pages.find((p) => p.id === n.dataset.preview))),
  );
}
async function preview(p) {
  clearEnhanced();
  const token = ++previewGeneration;
  try {
    const s = sources[p.source];
    s.preview ||= await previewDocument(s);
    const page = await s.preview.getPage(p.index + 1);
    if (token !== previewGeneration) return;
    const base = page.getViewport({ scale: 1, rotation: p.rotation }),
      scale = Math.min(1.3, 900 / base.width, 1200 / base.height),
      viewport = page.getViewport({ scale, rotation: p.rotation }),
      c = document.createElement("canvas");
    c.width = Math.ceil(viewport.width);
    c.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport }).promise;
    if (token !== previewGeneration) return;
    const old = $("#pdf-preview");
    c.id = "pdf-preview";
    uiAttr(c, "aria-label", uiMsg("PDF page preview"));
    old.replaceWith(c);
  } catch (e) {
    if (token === previewGeneration)
      status(
        uiJoin([uiMsg("Preview unavailable for this page. "), uiError(e)]),
        true,
      );
  }
}
fileInput.onchange = async (e) => {
  const list = [...e.target.files];
  if (!list.length) return;
  clearEnhanced();
  if (list.reduce((n, f) => n + f.size, 0) > 50 * 1048576)
    return status(uiMsg("Choose files totaling no more than 50 MB."), true);
  const token = ++revision;
  busy(true);
  status(uiMsg("Opening files…"));
  try {
    await dependencies();
    if (["stamp", "metadata"].includes(operation.value) && list.length !== 1)
      throw Error("Choose one PDF for this operation.");
    const nextSources = [],
      nextPages = [];
    if (operation.value === "images") {
      if (list.length > 200) throw new Error("Use at most 200 images.");
      for (const f of list) {
        if (token !== revision) return;
        await image(f);
      }
      images = list;
      releaseSources();
      sources = [];
      pages = [];
      $("#pdf-pages").replaceChildren();
      uiText(
        $("#pdf-summary"),
        uiMsg("{0} images · {1}. Files follow the chosen order.", [
          list.length,
          size(list.reduce((n, f) => n + f.size, 0)),
        ]),
      );
    } else {
      for (const f of list) {
        if (token !== revision) return;
        if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf")
          throw new Error("Choose PDF files for this operation.");
        const bytes = new Uint8Array(await f.arrayBuffer());
        let doc, documentPages;
        try {
          doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
          documentPages = doc.getPages();
          if (!documentPages.length)
            throw new Error("PDF has no readable pages");
        } catch (e) {
          throw new Error(
            /encrypt/i.test(e.message)
              ? "Encrypted PDFs are not supported. Use an unencrypted copy."
              : `${f.name} could not be opened. The PDF may be damaged or unsupported.`,
          );
        }
        if (nextPages.length + documentPages.length > 200)
          throw new Error("Choose PDFs with no more than 200 pages in total.");
        const source = nextSources.length;
        nextSources.push({ name: f.name, bytes, doc });
        documentPages.forEach((p, index) =>
          nextPages.push({
            id: crypto.randomUUID(),
            source,
            index,
            included: true,
            rotation: p.getRotation().angle,
          }),
        );
      }
      if (token !== revision) return;
      releaseSources();
      sources = nextSources;
      pages = nextPages;
      images = [];
      render();
      uiText(
        $("#pdf-metadata"),
        nextSources.length
          ? JSON.stringify(metadata(nextSources[0].doc), null, 2)
          : "",
      );
      if (pages.length) await preview(pages[0]);
    }
    if (token === revision)
      status(uiMsg("Files ready. Choose pages and run the operation."));
  } catch (e) {
    if (token === revision) status(uiError(e), true);
  } finally {
    if (token === revision) busy(false);
  }
};
function ranges(value) {
  const indices = [];
  if (!value.trim()) return pages.filter((p) => p.included);
  for (const token of value.split(",")) {
    const m = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error("Use valid page ranges, such as 1-3,5.");
    const first = +m[1],
      last = +(m[2] || m[1]);
    if (first < 1 || last < first || last > pages.length)
      throw new Error(`Page ranges must be between 1 and ${pages.length}.`);
    for (let n = first; n <= last; n++)
      if (pages[n - 1].included && !indices.includes(pages[n - 1]))
        indices.push(pages[n - 1]);
  }
  return indices;
}
async function createPdf(selected, token) {
  const out = await lib.PDFDocument.create();
  for (let i = 0; i < selected.length; i++) {
    if (token !== revision) throw new Error("Cancelled.");
    const p = selected[i],
      [copy] = await out.copyPages(sources[p.source].doc, [p.index]);
    copy.setRotation(lib.degrees(p.rotation));
    out.addPage(copy);
    status(uiMsg("Preparing page {0} of {1}…", [i + 1, selected.length]));
    await new Promise((r) => setTimeout(r, 0));
  }
  return new Blob([await out.save()], { type: "application/pdf" });
}
$("#cancel-job").onclick = () => {
  revision++;
  busy(false);
  status(uiMsg("Cancelled. Choose files again if loading was interrupted."));
};
$("#pdf-run").onclick = async () => {
  const token = ++revision;
  busy(true);
  status(uiMsg("Preparing output…"));
  try {
    await dependencies();
    if (["stamp", "metadata"].includes(operation.value)) {
      await prepareEnhanced(token, false);
      if (token === revision && enhancedBytes)
        download(
          new Blob([enhancedBytes], { type: "application/pdf" }),
          "kensei-" + operation.value + ".pdf",
        );
      return;
    }
    if (operation.value === "images") {
      if (!images.length) throw new Error("Choose images first.");
      const out = await lib.PDFDocument.create();
      for (let i = 0; i < images.length; i++) {
        if (token !== revision) return;
        const img = await image(images[i]),
          c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        const b = await canvasBlob(c);
        c.width = c.height = 0;
        const embedded = await out.embedPng(await b.arrayBuffer()),
          landscape = img.width > img.height,
          p = out.addPage(landscape ? [842, 595] : [595, 842]),
          scale = Math.min(
            (p.getWidth() - 36) / img.width,
            (p.getHeight() - 36) / img.height,
          ),
          width = img.width * scale,
          height = img.height * scale;
        p.drawImage(embedded, {
          x: (p.getWidth() - width) / 2,
          y: (p.getHeight() - height) / 2,
          width,
          height,
        });
        status(uiMsg("Adding image {0} of {1}…", [i + 1, images.length]));
        await new Promise((r) => setTimeout(r, 0));
      }
      const bytes = await out.save();
      if (token !== revision) return;
      download(
        new Blob([bytes], { type: "application/pdf" }),
        "kensei-images.pdf",
      );
    } else {
      if (!pages.length) throw new Error("Choose PDFs first.");
      const range = $("#pdf-ranges").value,
        selected = ranges(range.replaceAll(";", ","));
      if (!selected.length) throw new Error("Select at least one page.");
      if (operation.value === "organize") {
        const blob = await createPdf(selected, token);
        if (token !== revision) return;
        download(blob, "kensei-document.pdf");
      } else if (operation.value === "split") {
        const groups = range.includes(";")
          ? range.split(";").map((r) => ranges(r))
          : selected.map((p) => [p]);
        if (groups.some((g) => !g.length))
          throw new Error(
            "Each split group must contain at least one selected page.",
          );
        const outputs = [];
        for (let i = 0; i < groups.length; i++) {
          const blob = await createPdf(groups[i], token);
          outputs.push([`part-${String(i + 1).padStart(3, "0")}.pdf`, blob]);
        }
        if (token !== revision) return;
        await zip(outputs, "kensei-split-pdfs.zip", () => token === revision);
      } else {
        const outputs = [],
          mime = $("#pdf-image-format").value,
          scale = +$("#pdf-scale").value;
        for (let i = 0; i < selected.length; i++) {
          if (token !== revision) return;
          const p = selected[i],
            s = sources[p.source];
          s.preview ||= await previewDocument(s);
          const page = await s.preview.getPage(p.index + 1),
            v = page.getViewport({ scale, rotation: p.rotation });
          if (v.width * v.height > 16000000)
            throw new Error(
              "A page exceeds the image size limit. Choose a lower resolution.",
            );
          const c = document.createElement("canvas");
          c.width = Math.ceil(v.width);
          c.height = Math.ceil(v.height);
          try {
            await page.render({
              canvasContext: c.getContext("2d"),
              viewport: v,
              background: "#ffffff",
            }).promise;
            const blob = await canvasBlob(c, mime, 0.9);
            outputs.push([
              `page-${String(i + 1).padStart(3, "0")}.${mime === "image/png" ? "png" : "jpg"}`,
              blob,
            ]);
          } finally {
            c.width = c.height = 0;
            page.cleanup();
          }
          status(uiMsg("Rendered {0} of {1} pages…", [i + 1, selected.length]));
        }
        if (token !== revision) return;
        if (outputs.length === 1) download(outputs[0][1], outputs[0][0]);
        else
          await zip(outputs, "kensei-pdf-images.zip", () => token === revision);
      }
    }
    if (token === revision)
      status(
        uiMsg("Done. Your download is ready. Files stayed on this device."),
      );
  } catch (e) {
    if (token === revision) status(uiError(e), true);
  } finally {
    if (token === revision) busy(false);
  }
};
function clearEnhanced() {
  enhancedBytes = null;
  $("#pdf-output-download").disabled = true;
  outputTask?.destroy().catch(() => {});
  outputTask = null;
}
$("#pdf-pages").addEventListener("click", (e) => {
  if (!e.target.closest("[data-preview]")) clearEnhanced();
});
$("#pdf-pages").addEventListener("change", clearEnhanced);
for (const id of [
  "pdf-ranges",
  "pdf-add-numbers",
  "pdf-number-start",
  "pdf-number-position",
  "pdf-watermark",
  "pdf-watermark-size",
  "pdf-watermark-opacity",
  "pdf-watermark-color",
])
  $("#" + id).addEventListener("input", clearEnhanced);
async function prepareEnhanced(token, show) {
  if (sources.length !== 1 || !pages.length)
    throw Error("Choose one PDF first.");
  clearEnhanced();
  const selected = ranges($("#pdf-ranges").value);
  if (operation.value === "stamp" && !selected.length)
    throw Error("Select at least one page to stamp.");
  const bytes = await enhancedPdf(
    lib,
    sources[0],
    pages,
    selected,
    operation.value,
    {
      numbers: $("#pdf-add-numbers").checked,
      start: Number($("#pdf-number-start").value),
      position: $("#pdf-number-position").value,
      text: $("#pdf-watermark").value,
      size: Number($("#pdf-watermark-size").value),
      opacity: Number($("#pdf-watermark-opacity").value) / 100,
      color: $("#pdf-watermark-color").value,
    },
    () => token === revision,
    status,
  );
  if (token !== revision) return;
  if (show) {
    outputTask = pdfjs.getDocument({
      data: bytes.slice(),
      cMapUrl: "/vendor/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
      wasmUrl: "/vendor/pdfjs/wasm/",
      isEvalSupported: false,
    });
    const doc = await outputTask.promise,
      index =
        operation.value === "stamp"
          ? Math.max(
              0,
              pages.findIndex((p) => p.id === selected[0].id),
            )
          : 0,
      page = await doc.getPage(index + 1),
      v = page.getViewport({ scale: 1 }),
      viewport = page.getViewport({
        scale: Math.min(1.3, 900 / v.width, 1200 / v.height),
      }),
      canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw Error("Output preview is unavailable in this browser.");
    await page.render({ canvasContext: context, viewport }).promise;
    if (token !== revision) return;
    canvas.id = "pdf-preview";
    uiAttr(canvas, "aria-label", uiMsg("Actual output PDF preview"));
    $("#pdf-preview").replaceWith(canvas);
  }
  enhancedBytes = bytes;
  $("#pdf-output-download").disabled = false;
  status(
    show
      ? uiMsg(
          "Actual output preview ready. Download the previewed PDF to keep it.",
        )
      : uiMsg("PDF ready. Files stayed on this device."),
  );
}
$("#pdf-output-preview").onclick = async () => {
  const token = ++revision;
  busy(true);
  try {
    await dependencies();
    await prepareEnhanced(token, true);
  } catch (e) {
    if (token === revision) status(uiError(e), true);
  } finally {
    if (token === revision) busy(false);
  }
};
$("#pdf-output-download").onclick = () => {
  if (enhancedBytes)
    download(
      new Blob([enhancedBytes], { type: "application/pdf" }),
      "kensei-" + operation.value + ".pdf",
    );
};
