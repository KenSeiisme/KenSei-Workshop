// OCR boxes are measured after crop/rotation. Reverse that exact transform.
export function originalPoint(x, y, meta) {
  const angle = (meta.rotation * Math.PI) / 180,
    dx = x - meta.width / 2,
    dy = y - meta.height / 2;
  return [
    (Math.cos(angle) * dx +
      Math.sin(angle) * dy +
      meta.cropWidth / 2 +
      (meta.sourceWidth * meta.crop[0]) / 100) /
      meta.sourceWidth,
    (-Math.sin(angle) * dx +
      Math.cos(angle) * dy +
      meta.cropHeight / 2 +
      (meta.sourceHeight * meta.crop[1]) / 100) /
      meta.sourceHeight,
  ];
}
export function recognitionLines(blocks) {
  const lines = [];
  for (const b of blocks || [])
    for (const p of b.paragraphs || [])
      for (const line of p.lines || []) {
        if (!line.bbox) continue;
        const text = String(
            line.text ?? (line.words || []).map((w) => w.text).join(" "),
          ).trimEnd(),
          confidence = Number.isFinite(line.confidence)
            ? line.confidence
            : (line.words || []).reduce((n, w) => n + (+w.confidence || 0), 0) /
              Math.max(1, line.words?.length || 0);
        lines.push({ text, confidence, bbox: { ...line.bbox } });
      }
  return lines;
}
export function validateOCRRecipe(s = {}) {
  const languages = (s.languages || ["eng"]).filter((x) =>
    ["eng", "chi_sim", "chi_tra", "msa"].includes(x),
  );
  if (!languages.length || languages.length > 4)
    throw Error("Choose one or more supported OCR languages.");
  const p = s.preprocessing || {},
    crop = (p.crop || [0, 0, 100, 100]).map(Number),
    rotation = +p.rotation || 0,
    level = +(p.level ?? 160);
  if (
    crop.length !== 4 ||
    crop.some((x) => !Number.isFinite(x)) ||
    crop[0] < 0 ||
    crop[1] < 0 ||
    crop[2] <= 0 ||
    crop[3] <= 0 ||
    crop[0] + crop[2] > 100 ||
    crop[1] + crop[3] > 100 ||
    ![0, 90, 180, 270].includes(rotation) ||
    !Number.isFinite(level) ||
    level < 0 ||
    level > 255
  )
    throw Error("Invalid OCR preprocessing recipe.");
  return {
    languages: [...new Set(languages)],
    preprocessing: {
      crop,
      rotation,
      level,
      gray: !!p.gray,
      threshold: !!p.threshold,
    },
    reocr: !!s.reocr,
  };
}
