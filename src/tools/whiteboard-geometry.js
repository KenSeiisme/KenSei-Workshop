import { portSettings } from "./whiteboard-core.js";
export const isNode = (e) =>
  !!e &&
  !e.isDeleted &&
  ["rectangle", "diamond", "ellipse"].includes(e.type) &&
  Math.abs(e.width) > 0.01 &&
  Math.abs(e.height) > 0.01;
const rotate = (p, c, angle) => ({
  x: c.x + (p.x - c.x) * Math.cos(angle) - (p.y - c.y) * Math.sin(angle),
  y: c.y + (p.x - c.x) * Math.sin(angle) + (p.y - c.y) * Math.cos(angle),
});
const rectangle = [
  [0.5, 0],
  [0.75, 0],
  [1, 0.25],
  [1, 0.5],
  [1, 0.75],
  [0.75, 1],
  [0.5, 1],
  [0.25, 1],
  [0, 0.75],
  [0, 0.5],
  [0, 0.25],
  [0.25, 0],
];
export function nodePorts(e) {
  if (!isNode(e)) return [];
  const w = Math.abs(e.width),
    h = Math.abs(e.height),
    x = e.x + Math.min(0, e.width),
    y = e.y + Math.min(0, e.height),
    c = { x: x + w / 2, y: y + h / 2 };
  return Array.from({ length: 12 }, (_, index) => {
    let [u, v] = rectangle[index];
    if (e.type === "ellipse") {
      const a = -Math.PI / 2 + (index * Math.PI) / 6;
      u = 0.5 + Math.cos(a) / 2;
      v = 0.5 + Math.sin(a) / 2;
    }
    if (e.type === "diamond") {
      const vertices = [
          [0.5, 0],
          [1, 0.5],
          [0.5, 1],
          [0, 0.5],
          [0.5, 0],
        ],
        side = Math.floor(index / 3),
        t = (index % 3) / 3;
      u = vertices[side][0] * (1 - t) + vertices[side + 1][0] * t;
      v = vertices[side][1] * (1 - t) + vertices[side + 1][1] * t;
    }
    let p = { x: x + w * u, y: y + h * v };
    if (e.type === "rectangle" && e.roundness) {
      const r = Math.min(
        w / 2,
        h / 2,
        e.roundness.type === 2
          ? Math.min(w, h) * 0.25
          : e.roundness.value || 32,
      );
      const q = {
        x: u < 0.5 ? x + r : x + w - r,
        y: v < 0.5 ? y + r : y + h - r,
      };
      if (
        (p.x < x + r || p.x > x + w - r) &&
        (p.y < y + r || p.y > y + h - r)
      ) {
        const dx = p.x - c.x,
          dy = p.y - c.y,
          ax = c.x - q.x,
          ay = c.y - q.y,
          A = dx * dx + dy * dy,
          B = 2 * (ax * dx + ay * dy),
          C = ax * ax + ay * ay - r * r,
          D = B * B - 4 * A * C;
        if (D >= 0) {
          const t = Math.min(1, (-B + Math.sqrt(D)) / (2 * A));
          p = { x: c.x + dx * t, y: c.y + dy * t };
        }
      }
    }
    return {
      ...rotate(p, c, e.angle || 0),
      index,
      elementId: e.id,
      u: (p.x - e.x) / e.width,
      v: (p.y - e.y) / e.height,
    };
  });
}
export function nearestPort(elements, point, zoom = 1, touch = false) {
  let best = null,
    distance = (touch ? 18 : 10) / zoom;
  for (const e of elements) {
    if (!isNode(e)) continue;
    const reach = Math.hypot(e.width, e.height) / 2 + distance,
      cx = e.x + e.width / 2,
      cy = e.y + e.height / 2;
    if (Math.abs(point.x - cx) > reach || Math.abs(point.y - cy) > reach)
      continue;
    for (const p of nodePorts(e)) {
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d < distance) {
        best = p;
        distance = d;
      }
    }
  }
  return best;
}
export function arrowPoints(e) {
  const c = { x: e.x + e.width / 2, y: e.y + e.height / 2 };
  return e.points.map(([x, y]) =>
    rotate({ x: e.x + x, y: e.y + y }, c, e.angle || 0),
  );
}
export function projectPorts(elements) {
  const map = new Map(elements.map((e) => [e.id, e]));
  return elements.map((e) => {
    if (e.isDeleted || e.type !== "arrow") return e;
    const ports = portSettings(e);
    if (!ports) return e;
    const points = arrowPoints(e),
      patch = {},
      next = { ...ports };
    let changed = false;
    for (const end of ["start", "end"]) {
      if (ports[end] === null) continue;
      const binding = e[end + "Binding"],
        target = map.get(binding?.elementId),
        p = target && nodePorts(target)[ports[end]];
      if (!p) {
        next[end] = null;
        patch[end + "Binding"] = null;
        changed = true;
        continue;
      }
      const i = end === "start" ? 0 : points.length - 1;
      if (Math.hypot(points[i].x - p.x, points[i].y - p.y) > 0.001) {
        points[i] = { x: p.x, y: p.y };
        changed = true;
      }
      if (
        e.elbowed &&
        (!binding.fixedPoint ||
          Math.abs(binding.fixedPoint[0] - p.u) > 0.0001 ||
          Math.abs(binding.fixedPoint[1] - p.v) > 0.0001)
      ) {
        patch[end + "Binding"] = { ...binding, fixedPoint: [p.u, p.v] };
        changed = true;
      }
    }
    if (!changed) return e;
    if (e.elbowed && points.length > 2) {
      const old = arrowPoints(e),
        firstHorizontal = Math.abs(old[1].y - old[0].y) < 0.01,
        lastHorizontal = Math.abs(old.at(-1).y - old.at(-2).y) < 0.01;
      if (firstHorizontal) points[1].y = points[0].y;
      else points[1].x = points[0].x;
      if (lastHorizontal) points.at(-2).y = points.at(-1).y;
      else points.at(-2).x = points.at(-1).x;
    } else if (
      e.elbowed &&
      points.length === 2 &&
      Math.abs(points[0].x - points[1].x) > 0.01 &&
      Math.abs(points[0].y - points[1].y) > 0.01
    ) {
      const mid = (points[0].x + points[1].x) / 2;
      points.splice(
        1,
        0,
        { x: mid, y: points[0].y },
        { x: mid, y: points[1].y },
      );
    }
    return {
      ...e,
      ...patch,
      x: points[0].x,
      y: points[0].y,
      angle: 0,
      points: points.map((p) => [p.x - points[0].x, p.y - points[0].y]),
      width:
        Math.max(...points.map((p) => p.x)) -
        Math.min(...points.map((p) => p.x)),
      height:
        Math.max(...points.map((p) => p.y)) -
        Math.min(...points.map((p) => p.y)),
      customData: { kenseiPorts: next },
    };
  });
}
