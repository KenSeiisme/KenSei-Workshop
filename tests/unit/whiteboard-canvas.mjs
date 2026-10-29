import assert from "node:assert/strict";
import {
  paperSettings,
  sceneSettings,
  portSettings,
  validateWhiteboard,
} from "../../src/tools/whiteboard-core.js";
import {
  nodePorts,
  nearestPort,
  projectPorts,
} from "../../src/tools/whiteboard-geometry.js";
const node = (type = "rectangle", extra = {}) => ({
  id: "a",
  type,
  x: 10,
  y: 20,
  width: 120,
  height: 60,
  angle: 0,
  ...extra,
});
for (const type of ["rectangle", "ellipse", "diamond"]) {
  const e = node(type),
    p = nodePorts(e);
  assert.equal(p.length, 12);
  assert.equal(new Set(p.map((x) => `${x.x},${x.y}`)).size, 12);
  assert(Math.abs(p[0].x - 70) < 1e-8 && Math.abs(p[0].y - 20) < 1e-8);
  if (type === "ellipse")
    for (const q of p)
      assert(
        Math.abs(((q.x - 70) / 60) ** 2 + ((q.y - 50) / 30) ** 2 - 1) < 1e-10,
      );
  if (type === "diamond")
    for (const q of p)
      assert(
        Math.abs(Math.abs(q.x - 70) / 60 + Math.abs(q.y - 50) / 30 - 1) < 1e-10,
      );
}
const rotated = nodePorts(node("rectangle", { angle: Math.PI / 2 }));
assert(
  Math.abs(rotated[0].x - 100) < 1e-8 && Math.abs(rotated[0].y - 50) < 1e-8,
);
assert.equal(nearestPort([node()], { x: 131, y: 50 }).index, 3);
assert.equal(nearestPort([node()], { x: 160, y: 50 }), null);
const rounded = node("rectangle", { roundness: { type: 3, value: 32 } });
for (const p of nodePorts(rounded)) {
  assert(p.x >= 10 && p.x <= 130 && p.y >= 20 && p.y <= 80);
}
assert.deepEqual(paperSettings(), { version: 1, type: "plain", spacing: 20 });
for (const type of ["plain", "ruled", "grid", "dots", "graph"])
  for (const spacing of [10, 20, 40])
    assert.equal(paperSettings({ version: 1, type, spacing }).spacing, spacing);
for (const value of [
  { version: 1, type: "image", spacing: 20 },
  { version: 1, type: "grid", spacing: 0 },
  { version: 2, type: "grid", spacing: 20 },
  { version: 1, type: "grid", spacing: 20, url: "https://invalid" },
])
  assert.throws(() => paperSettings(value));
const arrow = {
  id: "wire",
  type: "arrow",
  x: 0,
  y: 0,
  width: 300,
  height: 0,
  angle: 0,
  points: [
    [0, 0],
    [300, 0],
  ],
  version: 3,
  versionNonce: 10,
  startBinding: { elementId: "a", focus: 0, gap: 1 },
  endBinding: { elementId: "b", focus: 0, gap: 1 },
  customData: { kenseiPorts: { version: 1, start: 3, end: 9 } },
};
const scene = [node(), node("ellipse", { id: "b", x: 300 }), arrow],
  snapshot = JSON.stringify(scene),
  projected = projectPorts(scene),
  wire = projected[2];
assert.equal(JSON.stringify(scene), snapshot);
assert.equal(wire.version, 3);
assert.equal(wire.x, 130);
assert.equal(wire.y, 50);
assert.equal(wire.points.at(-1)[0] + wire.x, 300);
assert(Math.abs(wire.points.at(-1)[1] + wire.y - 50) < 1e-8);
const moved = projectPorts([
  node("rectangle", { x: 110, width: 240 }),
  scene[1],
  wire,
])[2];
assert.equal(moved.x, 350);
assert.equal(moved.points.at(-1)[0] + moved.x, 300);
const missing = projectPorts([scene[1], wire])[1];
assert.equal(missing.startBinding, null);
assert.equal(missing.customData.kenseiPorts.start, null);
assert.equal(missing.x, wire.x);
const copy = projectPorts([
  node("rectangle", { id: "copy", x: 500 }),
  {
    ...wire,
    startBinding: { ...wire.startBinding, elementId: "copy" },
    endBinding: null,
    customData: { kenseiPorts: { version: 1, start: 3, end: null } },
  },
])[1];
assert.equal(copy.x, 620);
for (const customData of [
  { random: "x" },
  { kenseiPorts: { version: 1, start: 12, end: null } },
  { kenseiPorts: { version: 1, start: 0, end: null, html: "x" } },
])
  assert.throws(() => portSettings({ ...arrow, customData }));
assert.deepEqual(portSettings(arrow), { version: 1, start: 3, end: 9 });
assert.throws(() => portSettings({ ...node(), customData: arrow.customData }));
const old = validateWhiteboard({
  version: 1,
  name: "舊白板",
  elements: [node()],
  appState: { viewBackgroundColor: "#abc", gridSize: 20 },
});
assert.equal(old.appState.viewBackgroundColor, "#abc");
assert.equal(old.appState.paper.type, "plain");
assert(!("activeTool" in sceneSettings({ activeTool: { locked: true } })));
console.log(
  "PASS paper validation, 12 independent outline positions, rotation, scoped metadata, node transforms/deletion/copy and unchanged legacy data",
);

const wideRotation = {
  ...node("rectangle"),
  width: 1000,
  height: 1000,
  angle: Math.atan(0.5),
};
const distant = nodePorts(wideRotation)[2];
assert.equal(nearestPort([wideRotation], distant).index, 2);
