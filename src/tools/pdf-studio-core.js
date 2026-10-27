import { library } from "./common.js";
let fontBytes;
export async function unicodeFont(doc) {
  const kit = await library("fontkit.js", "fontkit");
  doc.registerFontkit(kit);
  if (!fontBytes) {
    const response = await fetch("/vendor/pdf-fonts/LXGWWenKai-Regular.ttf");
    if (!response.ok) throw Error("The PDF font could not load. Retry.");
    fontBytes = new Uint8Array(await response.arrayBuffer());
  }
  // Font subsetting in fontkit 1.1.1 corrupts some glyphs; preserve the verified full font.
  return doc.embedFont(fontBytes, { subset: false });
}
export async function pdfDocument(bytes) {
  const pdfjs = await import("/vendor/pdfjs/build/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc =
    "/vendor/pdfjs/build/pdf.worker.min.mjs";
  return pdfjs.getDocument({
    data: new Uint8Array(bytes).slice(),
    cMapUrl: "/vendor/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
    wasmUrl: "/vendor/pdfjs/wasm/",
    isEvalSupported: false,
  }).promise;
}
// 所有畫面座標以 PDF.js viewport 轉換，包含頁面旋轉與 CropBox。
export const pdfPoint = (viewport, x, y) =>
  viewport.convertToPdfPoint(x * viewport.width, y * viewport.height);
export function pdfBox(viewport, box) {
  const [x, y] = pdfPoint(viewport, box.x, box.y + box.h);
  return {
    x,
    y,
    width: (box.w * viewport.width) / viewport.scale,
    height: (box.h * viewport.height) / viewport.scale,
    angle: viewport.rotation,
  };
}
export function recipePdf(s = {}) {
  const fontSize = +s.fontSize || 16,
    lineWidth = +s.lineWidth || 2;
  if (fontSize < 6 || fontSize > 96 || lineWidth < 0.5 || lineWidth > 12)
    throw Error("PDF recipe contains invalid settings.");
  return {
    fontSize,
    lineWidth,
    color: /^#[a-f0-9]{6}$/i.test(s.color) ? s.color : "#a855f7",
    flatten: !!s.flatten,
    kind: ["text", "rectangle", "highlight", "arrow", "signature"].includes(
      s.kind,
    )
      ? s.kind
      : "text",
  };
}
