import assert from "node:assert/strict";
import {
  projection,
  scanDimensions,
  suggestCorners,
  validCorners,
  warpRows,
  wholePhoto,
} from "../../src/tools/scan-geometry.js";

const points = [
  [0.12, 0.2],
  [0.88, 0.08],
  [0.95, 0.79],
  [0.07, 0.9],
];
const map = projection(points);
wholePhoto().forEach(([u, v], i) => {
  const [x, y] = map(u, v);
  assert.ok(Math.abs(x - points[i][0]) < 1e-10);
  assert.ok(Math.abs(y - points[i][1]) < 1e-10);
});
assert.equal(validCorners([points[0], points[2], points[1], points[3]]), false);
assert.equal(validCorners(points), true);
assert.deepEqual(scanDimensions(wholePhoto(), 400, 800, 1e6), [400, 800]);
const source = {
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([20, 50, 80, 255, 40, 70, 90, 255]),
};
const output = { ...source, data: new Uint8ClampedArray(8) };
assert.equal(
  await warpRows(source, output, wholePhoto(), "color", () => true),
  true,
);
assert.deepEqual(output.data, source.data);
assert.equal(
  await warpRows(source, output, wholePhoto(), "bw", () => false),
  false,
);
assert.equal(
  suggestCorners({ width: 10, height: 10, data: new Uint8Array(400) }),
  null,
);
console.log(
  "PASS perspective maps all four control points, rejects crossing, keeps pixel samples, and supports cancellation",
);
