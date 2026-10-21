export function metadata(doc) {
  const safe = (getter) => {
    try {
      const v = doc[getter]();
      return v instanceof Date ? v.toISOString() : v || "";
    } catch {
      return "Unreadable field";
    }
  };
  return Object.fromEntries(
    [
      ["Title", "getTitle"],
      ["Author", "getAuthor"],
      ["Subject", "getSubject"],
      ["Keywords", "getKeywords"],
      ["Creator", "getCreator"],
      ["Producer", "getProducer"],
      ["Created", "getCreationDate"],
      ["Modified", "getModificationDate"],
    ].map(([key, fn]) => [key, safe(fn)]),
  );
}
export async function enhancedPdf(
  lib,
  source,
  pages,
  selected,
  operation,
  settings,
  isCurrent,
  progress,
) {
  const doc = await lib.PDFDocument.load(source.bytes.slice(), {
      updateMetadata: false,
    }),
    original = doc.getPages(),
    ordered = pages.map((p) => original[p.index]);
  while (doc.getPageCount()) doc.removePage(0);
  for (const p of ordered) doc.addPage(p);
  const all = doc.getPages(),
    selectedIds = new Set(selected.map((p) => p.id));
  let number = settings.start,
    watermark = null,
    font;
  if (operation === "stamp") {
    if (
      settings.numbers &&
      (!Number.isInteger(number) || number < 1 || number > 999999)
    )
      throw Error("Use a page-number start from 1 to 999,999.");
    if (!settings.numbers && !settings.text.trim())
      throw Error("Enable page numbers or enter watermark text.");
    font = await doc.embedFont(lib.StandardFonts.Helvetica);
    if (settings.text.trim()) {
      if (
        !Number.isFinite(settings.size) ||
        settings.size < 8 ||
        settings.size > 120
      )
        throw Error("Use a watermark size from 8 to 120 points.");
      const c = document.createElement("canvas"),
        ctx = c.getContext("2d");
      if (!ctx) throw Error("Canvas drawing is required for text watermarks.");
      ctx.font = "600 " + settings.size * 2 + "px system-ui, sans-serif";
      const measured = ctx.measureText(settings.text).width;
      c.width = Math.min(4096, Math.max(20, Math.ceil(measured) + 16));
      c.height = Math.ceil(settings.size * 3);
      ctx.font = "600 " + settings.size * 2 + "px system-ui, sans-serif";
      ctx.fillStyle = settings.color;
      ctx.textBaseline = "middle";
      ctx.fillText(settings.text, 8, c.height / 2, c.width - 16);
      const blob = await new Promise((resolve, reject) =>
        c.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(Error("Watermark image export is unavailable.")),
          "image/png",
        ),
      );
      watermark = await doc.embedPng(await blob.arrayBuffer());
      c.width = c.height = 0;
    }
  }
  for (let i = 0; i < all.length; i++) {
    if (!isCurrent()) throw Error("Cancelled.");
    const page = all[i],
      p = pages[i],
      rotation = ((p.rotation % 360) + 360) % 360;
    page.setRotation(lib.degrees(rotation));
    if (operation === "metadata") {
      const ref = page.node.get(lib.PDFName.of("Metadata"));
      if (ref instanceof lib.PDFRef) doc.context.delete(ref);
      page.node.delete(lib.PDFName.of("Metadata"));
    }
    if (operation === "stamp" && selectedIds.has(p.id)) {
      const { width: w, height: h } = page.getSize(),
        width = rotation % 180 ? h : w,
        height = rotation % 180 ? w : h;
      const matrix =
        rotation === 90
          ? [0, 1, -1, 0, w, 0]
          : rotation === 180
            ? [-1, 0, 0, -1, w, h]
            : rotation === 270
              ? [0, -1, 1, 0, 0, h]
              : [1, 0, 0, 1, 0, 0];
      page.pushOperators(
        lib.pushGraphicsState(),
        lib.concatTransformationMatrix(...matrix),
      );
      if (watermark) {
        const scale = Math.min(
            (0.8 * width) / watermark.width,
            (0.6 * height) / watermark.height,
            0.5,
          ),
          mw = watermark.width * scale,
          mh = watermark.height * scale;
        page.drawImage(watermark, {
          x: (width - mw) / 2,
          y: (height - mh) / 2,
          width: mw,
          height: mh,
          opacity: settings.opacity,
        });
      }
      if (settings.numbers) {
        const text = String(number++),
          tw = font.widthOfTextAtSize(text, 12);
        page.drawText(text, {
          x:
            settings.position === "bottom-right"
              ? width - 24 - tw
              : (width - tw) / 2,
          y: 24,
          size: 12,
          font,
          color: lib.rgb(0.3, 0.25, 0.35),
        });
      }
      page.pushOperators(lib.popGraphicsState());
    }
    progress("Preparing page " + (i + 1) + " of " + all.length + "…");
    await new Promise((r) => setTimeout(r, 0));
  }
  if (operation === "metadata") {
    const info = doc.context.trailerInfo.Info,
      xmp = doc.catalog.get(lib.PDFName.of("Metadata"));
    if (info instanceof lib.PDFRef) doc.context.delete(info);
    if (xmp instanceof lib.PDFRef) doc.context.delete(xmp);
    doc.context.trailerInfo.Info = undefined;
    doc.catalog.delete(lib.PDFName.of("Metadata"));
  }
  return new Uint8Array(await doc.save());
}
