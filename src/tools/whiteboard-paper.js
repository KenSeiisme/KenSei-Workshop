import { sceneSettings } from "./whiteboard-core.js";
// CSS Filter Effects 的 invert(.93) + hue-rotate(180deg)，分條處理避免大型畫布額外佔用整幅記憶體。
// 部分 WebKit 不支援 CanvasRenderingContext2D.filter；PNG 仍須與畫面和 SVG 一致。
async function darken(canvas) {
  const ctx = canvas.getContext("2d");
  if ("filter" in Object.getPrototypeOf(ctx)) {
    // 使用原生濾鏡，避免支援此能力的瀏覽器讀取像素或額外建立整幅副本。
    ctx.filter = "invert(93%) hue-rotate(180deg)";
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(canvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    return;
  }
  const rows = Math.max(1, Math.floor(262144 / canvas.width));
  for (let y = 0; y < canvas.height; y += rows) {
    const image = ctx.getImageData(
        0,
        y,
        canvas.width,
        Math.min(rows, canvas.height - y),
      ),
      p = image.data;
    for (let i = 0; i < p.length; i += 4) {
      const r = 237.15 - 0.86 * p[i],
        g = 237.15 - 0.86 * p[i + 1],
        b = 237.15 - 0.86 * p[i + 2];
      p[i] = -0.574 * r + 1.43 * g + 0.144 * b;
      p[i + 1] = 0.426 * r + 0.43 * g + 0.144 * b;
      p[i + 2] = 0.426 * r + 1.43 * g - 0.856 * b;
    }
    ctx.putImageData(image, 0, y);
    if (y + rows < canvas.height)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
export function paintPaper(
  ctx,
  width,
  height,
  state,
  {
    zoom = 1,
    scrollX = 0,
    scrollY = 0,
    pattern = true,
    filter = "none",
    dpr = 1,
  } = {},
) {
  const settings = sceneSettings(state),
    { type, spacing } = settings.paper;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.filter = filter;
  ctx.fillStyle = settings.viewBackgroundColor;
  ctx.fillRect(0, 0, width, height);
  if (!pattern || type === "plain") return;
  ctx.strokeStyle = "rgba(80,70,100,.22)";
  ctx.fillStyle = "rgba(80,70,100,.38)";
  ctx.lineWidth = 0.7;
  const lines = (step, strong = false, horizontalOnly = false) => {
    const size = step * zoom;
    if (size < 1.5) return;
    ctx.strokeStyle = strong ? "rgba(80,70,100,.32)" : "rgba(80,70,100,.16)";
    ctx.lineWidth = strong ? 0.9 : 0.55;
    ctx.beginPath();
    const ox = (((scrollX * zoom) % size) + size) % size,
      oy = (((scrollY * zoom) % size) + size) % size;
    if (!horizontalOnly)
      for (let x = ox; x <= width; x += size) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
    for (let y = oy; y <= height; y += size) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  };
  if (type === "ruled") lines(spacing, true, true);
  if (type === "grid") lines(spacing, true);
  if (type === "graph") {
    lines(spacing / 5);
    lines(spacing, true);
  }
  if (type === "dots") {
    const size = spacing * zoom;
    if (size >= 3) {
      const ox = (((scrollX * zoom) % size) + size) % size,
        oy = (((scrollY * zoom) % size) + size) % size;
      for (let x = ox; x <= width; x += size)
        for (let y = oy; y <= height; y += size) {
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.6, zoom), 0, Math.PI * 2);
          ctx.fill();
        }
    }
  }
  ctx.filter = "none";
}
function patternNode(document, state, offsetX, offsetY) {
  const { type, spacing } = sceneSettings(state).paper,
    ns = "http://www.w3.org/2000/svg";
  const make = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const id = "kensei-paper-pattern",
    p = make("pattern", {
      id,
      patternUnits: "userSpaceOnUse",
      overflow: "visible",
      width: spacing,
      height: spacing,
      patternTransform: `translate(${offsetX} ${offsetY})`,
    });
  const path = (d, strong = false) =>
    make("path", {
      d,
      fill: "none",
      stroke: strong ? "#504664" : "#504664",
      "stroke-opacity": strong ? 0.32 : 0.16,
      "stroke-width": strong ? 0.9 : 0.55,
    });
  if (type === "dots")
    p.append(
      make("circle", {
        cx: 0,
        cy: 0,
        r: 1,
        fill: "#504664",
        "fill-opacity": 0.38,
      }),
    );
  else {
    if (type === "graph")
      for (let i = 1; i < 5; i++) {
        const a = (i * spacing) / 5;
        p.append(path(`M${a} 0V${spacing}M0 ${a}H${spacing}`));
      }
    p.append(
      path(
        type === "ruled" ? `M0 0H${spacing}` : `M${spacing} 0H0V${spacing}`,
        true,
      ),
    );
  }
  return {
    pattern: p,
    rect: make("rect", {
      x: 0,
      y: 0,
      width: "100%",
      height: "100%",
      fill: `url(#${id})`,
      "data-kensei-paper": type,
    }),
  };
}
export async function exportArtwork(
  engine,
  data,
  {
    format = "png",
    includePaper = true,
    elements = data.elements.filter((e) => !e.isDeleted),
  } = {},
) {
  if (!elements.length)
    throw Error("Add a drawing or text before exporting an image.");
  const bounds = engine.getCommonBounds(elements),
    padding = 20;
  if (
    bounds[2] - bounds[0] > 16000 ||
    bounds[3] - bounds[1] > 16000 ||
    (bounds[2] - bounds[0] + 40) * (bounds[3] - bounds[1] + 40) > 32000000
  )
    throw Error(
      "This canvas is too large to export as an image. Export the editable file instead.",
    );
  const settings = sceneSettings(data.appState),
    options = {
      elements,
      appState: {
        ...settings,
        exportBackground: true,
        exportWithDarkMode: true,
        exportScale: 1,
      },
      files: {},
      exportPadding: padding,
    };
  if (format === "svg") {
    const svg = await engine.exportToSvg(options),
      width = +svg.getAttribute("width"),
      height = +svg.getAttribute("height");
    if (width * height > 32000000)
      throw Error("This selection is too large. Export an editable file.");
    if (includePaper && settings.paper.type !== "plain") {
      const extraY = elements.some((e) => e.type === "frame")
        ? Math.max(0, height - (bounds[3] - bounds[1] + padding * 2))
        : 0;
      const { pattern, rect } = patternNode(
        svg.ownerDocument,
        settings,
        padding - bounds[0],
        padding - bounds[1] + extraY,
      );
      svg.querySelector("defs").append(pattern);
      const bg = [...svg.children].find(
        (n) => n.tagName.toLowerCase() === "rect",
      );
      if (bg) bg.after(rect);
      else
        svg.insertBefore(
          rect,
          [...svg.children].find((n) => n.tagName.toLowerCase() === "g") ||
            null,
        );
    }
    return svg;
  }
  const ink = await engine.exportToCanvas({
      ...options,
      appState: {
        ...options.appState,
        exportBackground: false,
        exportWithDarkMode: false,
      },
    }),
    canvas = document.createElement("canvas");
  if (ink.width * ink.height > 32000000)
    throw Error("This selection is too large. Export an editable file.");
  canvas.width = ink.width;
  canvas.height = ink.height;
  const extraY = elements.some((e) => e.type === "frame")
    ? Math.max(0, ink.height - (bounds[3] - bounds[1] + padding * 2))
    : 0;
  const ctx = canvas.getContext("2d");
  paintPaper(ctx, canvas.width, canvas.height, settings, {
    scrollX: padding - bounds[0],
    scrollY: padding - bounds[1] + extraY,
    pattern: includePaper,
  });
  ctx.filter = "none";
  ctx.drawImage(ink, 0, 0);
  ink.width = ink.height = 0;
  await darken(canvas);
  return canvas;
}
