export function validateImageRecipe(s = {}) {
  const number = (v, min, max, fallback) => {
    v = Number(v ?? fallback);
    if (!Number.isFinite(v) || v < min || v > max)
      throw Error("Image recipe contains an invalid value.");
    return v;
  };
  const rotation = number(s.rotation, 0, 270, 0);
  if (rotation % 90) throw Error("Use a 90 degree rotation.");
  const format = s.format || "image/webp";
  if (!["image/png", "image/jpeg", "image/webp"].includes(format))
    throw Error("Unsupported image format.");
  return {
    orientation: !!s.orientation,
    rotation,
    flipX: !!s.flipX,
    flipY: !!s.flipY,
    crop: !!s.crop,
    ratio: number(s.ratio, 0.1, 10, 1),
    resize: s.resize !== false,
    width: Math.round(number(s.width, 1, 12000, 1600)),
    watermark: !!s.watermark,
    text: String(s.text || "").slice(0, 100),
    color: /^#[a-f0-9]{6}$/i.test(s.color) ? s.color : "#ffffff",
    opacity: number(s.opacity, 0, 1, 0.7),
    fontSize: number(s.fontSize, 1, 20, 5),
    position: ["center", "top-left", "bottom-right"].includes(s.position)
      ? s.position
      : "bottom-right",
    encode: s.encode !== false,
    format,
    quality: number(s.quality, 0.1, 1, 0.8),
    targetKiB: number(s.targetKiB, 0, 20480, 0),
  };
}

export function orientedCrop(
  source,
  settings,
  create = () => document.createElement("canvas"),
) {
  const s = validateImageRecipe(settings),
    angle = s.orientation ? s.rotation : 0;
  const c = create(),
    rotated = angle === 90 || angle === 270;
  c.width = rotated ? source.height : source.width;
  c.height = rotated ? source.width : source.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw Error("Canvas is unavailable.");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.scale(
    s.orientation && s.flipX ? -1 : 1,
    s.orientation && s.flipY ? -1 : 1,
  );
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  if (!s.crop) return c;
  let w = c.width,
    h = c.height;
  if (w / h > s.ratio) w = Math.max(1, Math.round(h * s.ratio));
  else h = Math.max(1, Math.round(w / s.ratio));
  const cropped = create();
  cropped.width = w;
  cropped.height = h;
  cropped
    .getContext("2d")
    .drawImage(c, (c.width - w) / 2, (c.height - h) / 2, w, h, 0, 0, w, h);
  c.width = c.height = 0;
  return cropped;
}
export function drawWatermark(canvas, s) {
  if (!s.watermark || !s.text) return;
  const ctx = canvas.getContext("2d"),
    font = Math.max(
      8,
      (Math.min(canvas.width, canvas.height) * s.fontSize) / 100,
    ),
    pad = Math.max(8, font * 0.7);
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.fillStyle = s.color;
  ctx.font = `600 ${font}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign =
    s.position === "center"
      ? "center"
      : s.position === "top-left"
        ? "left"
        : "right";
  ctx.fillText(
    s.text,
    s.position === "center"
      ? canvas.width / 2
      : s.position === "top-left"
        ? pad
        : canvas.width - pad,
    s.position === "center"
      ? canvas.height / 2
      : s.position === "top-left"
        ? pad + font / 2
        : canvas.height - pad - font / 2,
    Math.max(1, canvas.width - 2 * pad),
  );
  ctx.restore();
}
