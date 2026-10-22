import assert from "node:assert/strict";
import {
  validateWhiteboard,
  importWhiteboard,
  editableScene,
  whiteboardData,
} from "../../src/tools/whiteboard-core.js";
const element = {
  id: "rectangle-one",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 180,
  height: 90,
  angle: 0,
  isDeleted: false,
};
const data = {
  version: 1,
  name: "中英 Whiteboard",
  elements: [element],
  appState: {
    viewBackgroundColor: "#ffffff",
    gridSize: null,
    selectedElementIds: { secret: true },
    scrollX: 200,
  },
};
const valid = validateWhiteboard(data);
assert.deepEqual(Object.keys(valid.appState), [
  "viewBackgroundColor",
  "gridSize",
]);
assert.equal(importWhiteboard(editableScene(valid)).name, data.name);
assert.equal(valid.elements[0].width, 180);
for (const type of ["image", "embeddable", "iframe", "unknown"])
  assert.throws(
    () => validateWhiteboard({ ...data, elements: [{ ...element, type }] }),
    /unsupported/,
  );
assert.throws(
  () =>
    validateWhiteboard({
      ...data,
      files: { one: { dataURL: "data:image/png;base64,AA==" } },
    }),
  /files/,
);
assert.throws(
  () =>
    validateWhiteboard({
      ...data,
      elements: [{ ...element, link: "https://example.com" }],
    }),
  /Linked/,
);
assert.throws(
  () =>
    validateWhiteboard({
      ...data,
      elements: [{ ...element, width: Infinity }],
    }),
  /geometry/,
);
assert.throws(
  () => validateWhiteboard({ ...data, elements: [element, element] }),
  /unsupported/,
);
assert.throws(() => validateWhiteboard({ ...data, name: "" }), /name/);
assert.throws(
  () =>
    validateWhiteboard({
      ...data,
      elements: [{ ...element, type: "text", text: "文".repeat(700000) }],
    }),
  /2 MB/,
);
const oversized = whiteboardData(
  data.name,
  [{ ...element, type: "text", text: "文".repeat(700000) }],
  data.appState,
);
assert.equal(editableScene(oversized).elements[0].text.length, 700000);
console.log(
  "PASS whiteboard vector-only imports, safe settings, editable roundtrip, geometry and size limits, oversized export recovery",
);
