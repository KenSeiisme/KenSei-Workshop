export const wholePhoto = () => [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

export function validCorners(corners) {
  return (
    corners.length === 4 &&
    corners.every(
      (p, i) =>
        p.every((value) => value >= 0 && value <= 1) &&
        cross(p, corners[(i + 1) % 4], corners[(i + 2) % 4]) > 0.002,
    )
  );
}

function hull(points) {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const chain = (list) => {
    const result = [];
    for (const p of list) {
      while (result.length > 1 && cross(result.at(-2), result.at(-1), p) <= 0)
        result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return chain(sorted).concat(chain(sorted.reverse()));
}

export function suggestCorners({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++)
    gray[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const edges = new Uint8Array(gray.length),
    points = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      if (
        Math.abs(gray[i + 1] - gray[i - 1]) +
          Math.abs(gray[i + width] - gray[i - width]) <
        40
      )
        continue;
      edges[i] = 1;
      points.push([x, y]);
    }
  }
  const outline = hull(points);
  while (outline.length > 4) {
    let cheapest = 0,
      area = Infinity;
    outline.forEach((p, i) => {
      const cost = cross(
        outline.at(i - 1),
        p,
        outline[(i + 1) % outline.length],
      );
      if (cost < area) [cheapest, area] = [i, cost];
    });
    outline.splice(cheapest, 1);
  }
  if (outline.length !== 4) return null;
  const first = outline.reduce(
    (best, p, i) =>
      p[0] / width + p[1] / height <
      outline[best][0] / width + outline[best][1] / height
        ? i
        : best,
    0,
  );
  const ordered = outline.slice(first).concat(outline.slice(0, first));
  const corners = ordered.map(([x, y]) => [x / (width - 1), y / (height - 1)]);
  const area =
    (cross(...corners.slice(0, 3)) +
      cross(corners[0], corners[2], corners[3])) /
    2;
  if (!validCorners(corners) || area < 0.14 || area > 0.96) return null;

  // Reject outlines supported by isolated background edges.
  const supported = ordered.every(([x, y], i) => {
    const [endX, endY] = ordered[(i + 1) % 4];
    let hits = 0;
    for (let j = 1; j < 20; j++) {
      const px = Math.round(x + ((endX - x) * j) / 20);
      const py = Math.round(y + ((endY - y) * j) / 20);
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) {
        for (let dx = -3; dx <= 3 && !near; dx++)
          near = !!edges[(py + dy) * width + px + dx];
      }
      if (near) hits++;
    }
    return hits >= 13;
  });
  return supported ? corners : null;
}

export const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function projection([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  // Homography from the unit rectangle to the photographed quadrilateral.
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = (dx1 * dy3 - dx3 * dy1) / denominator;
  const a = x1 - x0 + g * x1,
    b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1,
    e = y3 - y0 + h * y3;
  return (u, v) => {
    const q = g * u + h * v + 1;
    return [(a * u + b * v + x0) / q, (d * u + e * v + y0) / q];
  };
}

export function scanDimensions(corners, width, height, maxPixels) {
  const distance = (i, j) =>
    Math.hypot(
      (corners[i][0] - corners[j][0]) * width,
      (corners[i][1] - corners[j][1]) * height,
    );
  const w = Math.max(distance(0, 1), distance(3, 2));
  const h = Math.max(distance(0, 3), distance(1, 2));
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / (w * h)),
    4096 / Math.max(w, h),
  );
  return [
    Math.max(1, Math.floor(w * scale)),
    Math.max(1, Math.floor(h * scale)),
  ];
}

export async function warpRows(source, output, corners, mode, current) {
  const map = projection(corners),
    sample = source.data,
    pixels = output.data;
  for (let row = 0; row < output.height; row++) {
    if (row % 32 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!current()) return false;
    }
    for (let col = 0; col < output.width; col++) {
      const [u, v] = map(
        (col + 0.5) / output.width,
        (row + 0.5) / output.height,
      );
      const x = Math.min(source.width - 1, Math.max(0, u * source.width - 0.5));
      const y = Math.min(
        source.height - 1,
        Math.max(0, v * source.height - 0.5),
      );
      const left = Math.floor(x),
        top = Math.floor(y);
      const right = Math.min(left + 1, source.width - 1),
        bottom = Math.min(top + 1, source.height - 1);
      const i = (row * output.width + col) * 4;
      for (let c = 0; c < 3; c++) {
        const a = sample[(top * source.width + left) * 4 + c];
        const b = sample[(top * source.width + right) * 4 + c];
        const d = sample[(bottom * source.width + left) * 4 + c];
        const e = sample[(bottom * source.width + right) * 4 + c];
        const upper = a + (b - a) * (x - left);
        pixels[i + c] = upper + (d + (e - d) * (x - left) - upper) * (y - top);
      }
      if (mode !== "color") {
        const gray = luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
        const value = mode === "bw" ? (gray < 150 ? 0 : 255) : gray;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
      }
      pixels[i + 3] = 255;
    }
  }
  return true;
}
