import assert from "node:assert/strict";
import fs from "node:fs";
(async () => {
  const src = fs.readFileSync("src/tools/network-gauge.js", "utf8");
  const m = await import(
    "data:text/javascript;base64," + Buffer.from(src).toString("base64")
  );
  assert.equal(m.gaugeRange(100, 100), 100);
  assert.equal(m.gaugeRange(100, 101), 200);
  assert.equal(m.gaugeRange(500, 5), 500);
  assert.equal(m.gaugeRange(100, 2001), 5000);
  const ticks = m.gaugeTicks(500, 0.125).filter((t) => t.major);
  assert.equal(ticks.length, 6);
  assert.deepEqual(
    ticks.map((t) => t.value),
    [0, 12.5, 25, 37.5, 50, 62.5],
  );
  assert(
    Math.abs(ticks[0].x1 - 30) < 1e-8 && Math.abs(ticks.at(-1).x1 - 270) < 1e-8,
  );
  console.log(
    "PASS gauge: five exact intervals, monotonic nice ranges, units and endpoints",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
