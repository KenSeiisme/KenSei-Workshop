import { $, busy, status, canvasBlob, downloadText } from "./common.js";
import { el, panel, row, button } from "./advanced-ui.js";
import { sendControl, receiveHandoff } from "./handoff.js";
import { uiMsg } from "../site/ui.js";
export async function init() {
  const ctx = window.KenseiAdvancedContexts["pdf-toolkit"],
    p = panel("Page workspace", $("#pdf-pages").closest(".pdf-layout"));
  const picked = new Set();
  const signature = () =>
    JSON.stringify([
      ctx.pages.map((x) => [x.id, x.rotation, x.included]),
      $("#pdf-ranges").value,
    ]);
  let textVersion = null,
    imageVersion = null;
  const ensureText = () => {
    if (textVersion !== signature())
      throw Error("Settings changed. Extract the text again.");
    return text.value;
  };
  let drag = null,
    rendering = 0;
  const text = el("textarea", "", {
      rows: 7,
      readOnly: false,
      id: "pdf-extracted-text",
    }),
    filesBox = el("div");
  p.append(
    row(
      button("Select all pages", () => {
        ctx.pages.forEach((x) => (x.included = true));
        ctx.changed();
      }),
      button("Clear page selection", () => {
        ctx.pages.forEach((x) => (x.included = false));
        ctx.changed();
      }),
      button("Move picked pages up", () => move(-1)),
      button("Move picked pages down", () => move(1)),
    ),
  );
  function move(dir) {
    const a = ctx.pages;
    for (const i of dir < 0
      ? a.map((_, i) => i)
      : a.map((_, i) => i).reverse()) {
      const j = i + dir;
      if (picked.has(a[i].id) && j >= 0 && j < a.length && !picked.has(a[j].id))
        [a[i], a[j]] = [a[j], a[i]];
    }
    ctx.changed();
  }
  const obs = new MutationObserver(install);
  obs.observe($("#pdf-pages"), { childList: true });
  function install() {
    const version = ++rendering;
    for (const r of $("#pdf-pages").children) {
      const id = r.querySelector("[data-page-select]")?.dataset.pageSelect;
      if (!id || r.dataset.advanced) continue;
      r.dataset.advanced = "";
      r.draggable = true;
      const check = el("input", "", {
        type: "checkbox",
        checked: picked.has(id),
      });
      check.setAttribute("aria-label", "Pick page for moving");
      check.onchange = () =>
        check.checked ? picked.add(id) : picked.delete(id);
      r.prepend(check);
      r.ondragstart = (e) => {
        drag = picked.has(id)
          ? ctx.pages.filter((x) => picked.has(x.id)).map((x) => x.id)
          : [id];
        e.dataTransfer.setData("text/plain", id);
      };
      r.ondragover = (e) => e.preventDefault();
      r.ondrop = (e) => {
        e.preventDefault();
        if (!drag?.length || drag.includes(id)) return;
        const moving = ctx.pages.filter((x) => drag.includes(x.id)),
          rest = ctx.pages.filter((x) => !drag.includes(x.id)),
          at = rest.findIndex((x) => x.id === id);
        rest.splice(at, 0, ...moving);
        ctx.pages.splice(0, ctx.pages.length, ...rest);
        drag = null;
        ctx.changed();
      };
      const c = el("canvas", "", { class: "pdf-thumb" });
      r.prepend(c);
      const io = new IntersectionObserver(
        async (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect();
          try {
            const item = ctx.pages.find((x) => x.id === id);
            if (!item) return;
            const doc = await ctx.documentFor(ctx.sources[item.source]),
              page = await doc.getPage(item.index + 1);
            if (version !== rendering || !c.isConnected) return;
            const v0 = page.getViewport({ scale: 1, rotation: item.rotation }),
              v = page.getViewport({
                scale: 65 / v0.width,
                rotation: item.rotation,
              });
            c.width = Math.ceil(v.width);
            c.height = Math.ceil(v.height);
            await page.render({
              canvasContext: c.getContext("2d"),
              viewport: v,
            }).promise;
          } catch {
            c.remove();
          }
        },
        { rootMargin: "100px" },
      );
      io.observe(c);
    }
  }
  async function work(kind) {
    const selected = ctx.ranges($("#pdf-ranges").value.replaceAll(";", ","));
    if (!selected.length) throw Error("Select at least one page.");
    if (kind === "images" && selected.length > 20)
      throw Error("Select up to 20 pages for transfer.");
    const sourceVersion = signature();
    const token = ctx.next();
    busy(true);
    try {
      let words = [],
        images = [];
      for (let i = 0; i < selected.length; i++) {
        if (token !== ctx.revision) return;
        const item = selected[i],
          doc = await ctx.documentFor(ctx.sources[item.source]),
          page = await doc.getPage(item.index + 1);
        status(uiMsg("Processing page {0} of {1}…", [i + 1, selected.length]));
        if (kind === "text") {
          const content = await page.getTextContent();
          words.push(
            content.items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join(""),
          );
        } else {
          const v = page.getViewport({ scale: 2, rotation: item.rotation });
          if (v.width * v.height > 16000000)
            throw Error(
              "A page exceeds the image size limit. Choose a lower resolution.",
            );
          const c = el("canvas", "", {
            width: Math.ceil(v.width),
            height: Math.ceil(v.height),
          });
          try {
            await page.render({
              canvasContext: c.getContext("2d"),
              viewport: v,
              background: "#fff",
            }).promise;
            images.push(
              new File([await canvasBlob(c)], "page-" + (i + 1) + ".png", {
                type: "image/png",
              }),
            );
          } finally {
            c.width = c.height = 0;
          }
        }
        page.cleanup();
      }
      if (token !== ctx.revision) return;
      if (kind === "text") {
        text.value = words.join("\n\n");
        textVersion = sourceVersion;
        window.dispatchEvent(new Event("tool-content-changed"));
        status(uiMsg("Text extracted. Scanned pages may need OCR."));
      } else {
        filesBox.replaceChildren(el("p", "Page images ready."));
        imageVersion = sourceVersion;
        sendControl(filesBox, () => {
          if (imageVersion !== signature())
            throw Error("Settings changed. Prepare the page images again.");
          return { kind: "files", files: images };
        }, ["image-studio", "image-to-text"]);
        status(uiMsg("Page images ready for transfer."));
      }
    } finally {
      if (token === ctx.revision) busy(false);
    }
  }
  p.append(
    row(
      button("Extract selected-page text", () => work("text")),
      button("Prepare selected-page images", () => work("images")),
    ),
    text,
    row(
      button("Download extracted text", () =>
        downloadText(ensureText(), "kensei-pdf-text.txt"),
      ),
    ),
    filesBox,
  );
  sendControl(p, () => ({ kind: "text", text: ensureText() }), [
    "text-toolkit",
    "markdown-studio",
    "text-compare",
  ]);
  receiveHandoff(
    "pdf-toolkit",
    (p) => ctx.loadFiles(p.files),
    () => ctx.pages.length > 0,
  );
  install();
  await professionalPDF();
  window.addEventListener("pagehide", () => obs.disconnect(), { once: true });
}

import { init as professionalPDF } from "./studio-pdf-toolkit.js";
