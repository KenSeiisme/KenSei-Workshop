import assert from "node:assert/strict";
import fs from "node:fs";
const load = async (file) =>
  import(
    "data:text/javascript;base64," + fs.readFileSync(file).toString("base64")
  );
const {
  password,
  parseHex,
  hexColor,
  rgbToHsl,
  hslToRgb,
  contrast,
  convert,
  units,
} = await load("tool-scripts/daily-core.js");
const { NETWORK_BUDGET, NETWORK_MEASUREMENTS } = await load(
  "tool-scripts/network-config.js",
);
assert.equal(contrast([0, 0, 0], [255, 255, 255]), 21);
assert.equal(contrast([255, 255, 255], [255, 255, 255]), 1);
assert.deepEqual(parseHex("#abc"), [170, 187, 204]);
assert.equal(hexColor(hslToRgb([120, 100, 50])), "#00ff00");
assert.deepEqual(rgbToHsl([255, 0, 0]), [0, 100, 50]);
for (const rgb of [
  [214, 175, 232],
  [123, 45, 67],
  [0, 0, 0],
  [255, 255, 255],
])
  assert.deepEqual(hslToRgb(rgbToHsl(rgb)), rgb);
assert.throws(() => parseHex("#12345"));
assert.equal(convert("32", "Temperature", 1, 0), 0);
assert.ok(Math.abs(convert("100", "Temperature", 0, 1) - 212) < 1e-10);
assert.ok(Math.abs(convert("0", "Temperature", 2, 0) + 273.15) < 1e-10);
assert.throws(() => convert("-1", "Temperature", 2, 0), /absolute zero/);
assert.equal(convert("1", "Storage", 2, 0), 1000000);
assert.equal(convert("1", "Storage", 6, 0), 1048576);
assert.equal(convert("1", "Length", 5, 0), 304.8);
assert.equal(convert("1", "Volume", 4, 1), 3.785411784);
assert.equal(convert("1", "Volume", 6, 1), 4.54609);
for (const input of ["", " ", "NaN", "Infinity", "1,000", "1e999", "2abc"])
  assert.throws(() => convert(input, "Length", 0, 1));
assert.ok(convert("1e-20", "Length", 2, 3) > 0);
for (const [name, list] of Object.entries(units))
  for (let i = 0; i < list.length; i++) {
    const result = convert("273.15", name, i, i);
    assert.ok(Math.abs(result - 273.15) < 1e-8);
  }
const sets = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "!@#$",
];
const generated = new Set();
for (let i = 0; i < 300; i++) {
  const p = password(i % 2 ? 8 : 64, sets, true);
  assert.equal(p.length, i % 2 ? 8 : 64);
  assert.ok(!/[Il1O0]/.test(p));
  assert.ok(sets.every((s) => [...p].some((c) => s.includes(c))));
  generated.add(p);
}
assert.equal(generated.size, 300);
assert.throws(() => password(7, sets, false));
assert.throws(() => password(65, sets, false));
assert.throws(() => password(20, [], false));
assert.equal(
  NETWORK_MEASUREMENTS.reduce(
    (sum, m) => sum + (m.bytes || 0) * (m.count || 0),
    0,
  ),
  488900000,
);
assert.ok(NETWORK_BUDGET === 500000000);
assert.ok(
  NETWORK_MEASUREMENTS.every((m) =>
    ["latency", "download", "upload"].includes(m.type),
  ),
);
console.log(
  "PASS conversion boundaries, color reference vectors, password constraints and network payload schedule",
);
