import { el, field, row, button } from "./advanced-ui.js";
import { workspaceTabs, recipeControls } from "./studio-recipes.js";
import {
  originalPoint,
  recognitionLines,
  validateOCRRecipe,
} from "./ocr-review-core.js";
import {
  unicodeFont,
  checkFontText,
  pdfPoint,
  pdfBox,
} from "./pdf-studio-core.js";
import { library, download, image, canvasBlob } from "./common.js";
import { uiMsg, uiText } from "../site/ui.js";
export function init(ctx) {
  const root = document.querySelector("[data-tool]"),
    recognize = el("div", "", { id: "ocr-recognize-workspace" }),
    review = el("section", "", {
      class: "panel tool-form",
      id: "ocr-review-workspace",
    });
  const old = [...root.children].filter(
    (n) =>
      n.matches(".panel,.studio-grid,.advanced-panel,.job-status") ||
      n.querySelector("#ocr-file,#ocr-output"),
  );
  if (!old.length) return;
  old[0].before(recognize);
  old.forEach((n) => recognize.append(n));
  root.append(review);
  const tabs = workspaceTabs(root, [
    ["Recognize", recognize],
    ["Review & PDF", review],
  ]);
  let generation = 0,
    revision = 0,
    selectedLine = -1,
    blockPage = 0,
    url = null;
  const reocr = el("input", "", {
    type: "checkbox",
    id: "ocr-reprocess-native",
  });
  document
    .querySelector("#ocr-pages")
    .closest("label")
    .after(
      field(
        "Re-OCR pages that already contain text · rasterizes those pages",
        reocr,
      ),
    );
  const entry = el("select", "", {
      "aria-label": "Review image or page",
      id: "ocr-review-entry",
    }),
    state = el(
      "p",
      "Recognize a source, then review linked text blocks. Original files are not modified.",
      { role: "status", id: "ocr-review-status" },
    ),
    picture = el("img", "", { alt: "Original source for OCR review" }),
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    stage = el("div", "", { class: "ocr-review-stage" }),
    blocks = el("div", "", { class: "ocr-review-blocks" }),
    pageLabel = el("span"),
    layout = el("div", "", { class: "studio-workspace" });
  svg.setAttribute("viewBox", "0 0 1 1");
  svg.setAttribute("preserveAspectRatio", "none");
  stage.append(picture, svg);
  const list = el("section");
  list.append(
    el("h3", "Linked text blocks"),
    row(
      button("Previous blocks", () => {
        blockPage = Math.max(0, blockPage - 1);
        paint();
      }),
      pageLabel,
      button("Next blocks", () => {
        const e = ctx.entries[ctx.current];
        blockPage = Math.min(
          Math.max(0, Math.ceil((e?.reviewLines?.length || 0) / 50) - 1),
          blockPage + 1,
        );
        paint();
      }),
    ),
    blocks,
  );
  layout.append(stage, list);
  workspaceTabs(
    layout,
    [
      ["Original image", stage],
      ["Text blocks", list],
    ],
    { mobile: true },
  );
  review.append(
    row(
      field("Image / page", entry),
      button("Open this recognition result", () => {
        ctx.choose(+entry.value);
        tabs.activate(0);
      }),
    ),
    state,
    layout,
    button("Export searchable PDF", exportPDF, true),
  );
  entry.onchange = () => ctx.choose(+entry.value);
  async function originalCanvas(e) {
    if (e.page) {
      const p = await ctx.pdf.getPage(e.page),
        v = p.getViewport({ scale: 2 });
      if (v.width * v.height > 16000000)
        throw Error("The PDF page is too large to render.");
      const c = el("canvas", "", {
        width: Math.ceil(v.width),
        height: Math.ceil(v.height),
      });
      await p.render({
        canvasContext: c.getContext("2d"),
        viewport: v,
        background: "#fff",
      }).promise;
      return c;
    }
    const img = await image(e.file),
      c = el("canvas", "", { width: img.width, height: img.height });
    c.getContext("2d").drawImage(img, 0, 0);
    return c;
  }
  async function refresh() {
    const token = ++generation,
      oldValue = ctx.current;
    entry.replaceChildren(
      ...ctx.entries.map((e, i) => {
        const n = el("option", "", { value: i });
        n.textContent = e.name;
        return n;
      }),
    );
    entry.value = oldValue;
    const e = ctx.entries[oldValue];
    if (!e) return;
    blockPage = 0;
    selectedLine = -1;
    try {
      const c = await originalCanvas(e),
        blob = await canvasBlob(c);
      c.width = c.height = 0;
      if (token !== generation) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      picture.src = url;
      paint();
    } catch (error) {
      uiText(state, uiMsg(error.message));
    }
  }
  function paint() {
    blocks.replaceChildren();
    svg.replaceChildren();
    const e = ctx.entries[ctx.current];
    if (!e) return;
    e.reviewLines ||= recognitionLines(e.blocks);
    const lines = e.reviewLines;
    pageLabel.textContent = `${blockPage + 1}/${Math.max(1, Math.ceil(lines.length / 50))}`;
    if (!lines.length) {
      blocks.append(
        el(
          "p",
          e.native
            ? "Existing PDF text is retained. Re-OCR only if you want to replace it."
            : "No linked boxes yet. Run recognition first.",
        ),
      );
      return;
    }
    uiText(
      state,
      uiMsg(
        e.processingStale
          ? "Recognition settings changed. Recognize this page again."
          : e.manualText
            ? "Full text was edited. PDF export uses the edited reading layer; box coordinates remain from recognition."
            : "Select a box or text block to correct it without recognizing again.",
      ),
    );
    lines.slice(blockPage * 50, blockPage * 50 + 50).forEach((line, offset) => {
      const i = blockPage * 50 + offset,
        r = el("div", "", {
          class: "ocr-review-line" + (i === selectedLine ? " selected" : ""),
        }),
        input = el("textarea", "", {
          rows: 2,
          value: line.text,
          disabled: ctx.running,
          "aria-label": "Correct recognized text",
        }),
        confidence = el("span");
      uiText(
        confidence,
        uiMsg("{0}% confidence", [Math.round(line.confidence || 0)]),
      );
      r.append(confidence, input);
      input.onfocus = () => {
        selectedLine = i;
        svg
          .querySelectorAll("polygon")
          .forEach((n) =>
            n.classList.toggle("selected", +n.dataset.line === i),
          );
      };
      input.oninput = () => {
        line.text = input.value;
        e.text = lines.map((l) => l.text).join("\n");
        e.manualText = false;
        ctx.updateText(e.text);
        revision++;
      };
      blocks.append(r);
      if (e.preparedMeta) {
        const { x0, y0, x1, y1 } = line.bbox,
          points = [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
          ].map(([x, y]) => originalPoint(x, y, e.preparedMeta));
        const poly = document.createElementNS(svg.namespaceURI, "polygon");
        poly.setAttribute("points", points.map((p) => p.join(",")).join(" "));
        poly.setAttribute("tabindex", "0");
        poly.setAttribute("role", "button");
        poly.setAttribute("aria-label", line.text);
        poly.dataset.line = i;
        poly.classList.toggle("selected", i === selectedLine);
        poly.onclick = () => {
          selectedLine = i;
          input.focus();
          input.scrollIntoView({ block: "nearest" });
        };
        poly.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            poly.onclick();
          }
        };
        svg.append(poly);
      }
    });
  }
  async function hiddenText(doc, page, e, viewport, font, lib) {
    const mapping = (x, y) => {
      const original = originalPoint(x, y, e.preparedMeta);
      return viewport
        ? pdfPoint(viewport, ...original)
        : [original[0] * page.getWidth(), (1 - original[1]) * page.getHeight()];
    };
    const lines = e.reviewLines?.length
      ? e.reviewLines
      : recognitionLines(e.blocks);
    if (e.manualText || !lines.length) {
      const rows = String(e.text || "").split("\n"),
        meta = e.preparedMeta || {
          sourceWidth: page.getWidth(),
          sourceHeight: page.getHeight(),
          width: page.getWidth(),
          height: page.getHeight(),
          cropWidth: page.getWidth(),
          cropHeight: page.getHeight(),
          crop: [0, 0, 100, 100],
          rotation: 0,
        };
      e.preparedMeta ||= meta;
      const height = Math.max(
        5,
        Math.min(20, meta.height / Math.max(1, rows.length)),
      );
      for (const [i, text] of rows.entries())
        if (text)
          linesForPDF(text, {
            x0: 0,
            y0: i * height,
            x1: meta.width,
            y1: (i + 1) * height,
          });
    } else
      for (const line of lines)
        if (line.text) linesForPDF(line.text, line.bbox);
    function linesForPDF(text, bbox) {
      checkFontText(font, text);
      const origin = mapping(bbox.x0, bbox.y1),
        right = mapping(bbox.x1, bbox.y1),
        top = mapping(bbox.x0, bbox.y0),
        width = Math.hypot(right[0] - origin[0], right[1] - origin[1]),
        height = Math.hypot(top[0] - origin[0], top[1] - origin[1]),
        size = Math.max(
          0.5,
          Math.min(
            height * 0.85,
            width / Math.max(0.01, font.widthOfTextAtSize(text, 1)),
          ),
        );
      page.drawText(text, {
        x: origin[0],
        y: origin[1],
        font,
        size,
        opacity: 0,
        rotate: lib.degrees(
          (Math.atan2(right[1] - origin[1], right[0] - origin[0]) * 180) /
            Math.PI,
        ),
      });
    }
  }
  async function exportPDF() {
    try {
      const token = generation,
        rev = revision,
        entries = ctx.entries;
      if (entries.some((e) => e.processingStale))
        throw Error(
          "Recognition settings changed. Recognize the changed pages before exporting.",
        );
      if (entries.some((e) => e.native && e.manualText))
        throw Error(
          "To replace existing PDF text, explicitly re-OCR that page first.",
        );
      if (!entries.some((e) => e.text !== undefined))
        throw Error("Recognize at least one page before exporting.");
      if (!entries.length) throw Error("Choose source files first.");
      if (ctx.running)
        throw Error("Finish or cancel recognition before exporting.");
      const lib = await library("pdf-lib.js", "PDFLib"),
        doc = ctx.pdf
          ? await lib.PDFDocument.load(await ctx.files[0].arrayBuffer())
          : await lib.PDFDocument.create();
      let font = null,
        missing = 0;
      uiText(state, uiMsg("Building the searchable PDF on this device…"));
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (ctx.pdf && !e.rasterize && !e.text) {
          missing++;
          continue;
        }
        if (ctx.pdf && e.native && !e.rasterize) continue;
        if (!ctx.pdf || e.rasterize) {
          const c = await originalCanvas(e),
            bytes = await canvasBlob(c, "image/jpeg", 0.95),
            embedded = await doc.embedJpg(await bytes.arrayBuffer());
          let p;
          if (ctx.pdf) {
            const old = doc.getPage(i),
              size = old.getSize(),
              crop = old.getCropBox(),
              rotation = old.getRotation();
            doc.removePage(i);
            p = doc.insertPage(i, [size.width, size.height]);
            const media = old.getMediaBox();
            p.setMediaBox(media.x, media.y, media.width, media.height);
            const unit = old.node.get(lib.PDFName.of("UserUnit"));
            if (unit) p.node.set(lib.PDFName.of("UserUnit"), unit);
            p.setCropBox(crop.x, crop.y, crop.width, crop.height);
            p.setRotation(rotation);
            const v = (await ctx.pdf.getPage(i + 1)).getViewport({ scale: 1 }),
              box = pdfBox(v, { x: 0, y: 0, w: 1, h: 1 });
            p.drawImage(embedded, {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              rotate: lib.degrees(box.angle),
            });
          } else {
            p = doc.addPage([c.width * 0.75, c.height * 0.75]);
            p.drawImage(embedded, {
              x: 0,
              y: 0,
              width: p.getWidth(),
              height: p.getHeight(),
            });
          }
          c.width = c.height = 0;
        }
        const page = doc.getPage(i);
        if (e.text?.trim()) {
          font ||= await unicodeFont(doc);
          await hiddenText(
            doc,
            page,
            e,
            ctx.pdf
              ? (await ctx.pdf.getPage(i + 1)).getViewport({ scale: 1 })
              : null,
            font,
            lib,
          );
        } else missing++;
        if (token !== generation || rev !== revision)
          throw Error("The recognition result changed. Export again.");
      }
      const bytes = await doc.save({ updateFieldAppearances: false });
      if (token !== generation || rev !== revision)
        throw Error("The recognition result changed. Export again.");
      download(
        new Blob([bytes], { type: "application/pdf" }),
        "searchable.pdf",
      );
      uiText(
        state,
        uiMsg(
          missing
            ? "PDF exported. Pages without recognized text remain image-only."
            : "Searchable PDF exported. Original page order is preserved.",
        ),
      );
    } catch (e) {
      uiText(state, uiMsg(e.message));
    }
  }
  recipeControls(
    review,
    "image-to-text",
    () =>
      validateOCRRecipe({
        languages: [
          ...document.querySelectorAll("[name=ocr-language]:checked"),
        ].map((n) => n.value),
        preprocessing: ctx.getSettings(),
        reocr: reocr.checked,
      }),
    (s) => {
      ctx.applyRecipe(s);
      reocr.checked = s.reocr;
      revision++;
    },
    validateOCRRecipe,
  );
  ctx.shouldReOCR = () => reocr.checked;
  window.addEventListener("ocr-entry-change", () => {
    revision++;
    refresh();
  });
  window.addEventListener("ocr-result-change", () => {
    revision++;
    paint();
  });
  window.addEventListener("pagehide", () => {
    generation++;
    if (url) URL.revokeObjectURL(url);
  });
}
