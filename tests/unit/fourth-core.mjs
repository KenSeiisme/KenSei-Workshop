import assert from "node:assert/strict";
import fs from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
const load = (file) =>
  import(
    "data:text/javascript;base64," + fs.readFileSync(file).toString("base64")
  );
const { moments, dateDays } = await load("src/tools/time-core.js"),
  { renamed } = await load("src/tools/rename-core.js"),
  { summarize, quantile, publicReport } = await load(
    "src/tools/network-stats.js",
  );
assert.throws(
  () => moments(Temporal, "2026-03-08", "02:30", "America/New_York"),
  /does not exist/,
);
const repeated = moments(Temporal, "2026-11-01", "01:30", "America/New_York");
assert.equal(repeated.length, 2);
assert.equal(repeated[1].epoch - repeated[0].epoch, 3600000);
assert.equal(
  moments(Temporal, "2026-10-21", "12:00", "Asia/Kuala_Lumpur").length,
  1,
);
assert.equal(dateDays(Temporal, "2024-02-28", "2024-03-01"), 2);
assert.equal(dateDays(Temporal, "2024-02-28", "2024-03-01", true), 3);
assert.equal(dateDays(Temporal, "2024-03-01", "2024-02-28"), -2);
const options = {
  prefix: "set_",
  suffix: "_new",
  find: "DSC",
  replace: "Photo",
  number: true,
  start: 1,
  digits: 3,
  case: "lower",
};
const names = renamed(
  [{ name: "DSC_你好.JPG" }, { name: "DSC_other.png" }],
  options,
);
assert.equal(names[0].name, "set_001_photo_你好_new.JPG");
assert.equal(names[1].name, "set_002_photo_other_new.png");
assert.ok(names.every((x) => !x.error));
assert.ok(
  renamed([{ name: "a.txt" }, { name: "A.TXT" }], { number: false })[0].error,
);
assert.ok(renamed([{ name: "con.txt" }], {})[0].error);
assert.ok(renamed([{ name: "a.txt" }], { prefix: "../" })[0].error);
assert.equal(quantile([10, 20, 30], 0.9), 28);
const samples = {
  download: [10, 20, 30].map((mbps) => ({
    mbps,
    duration: 20,
    t: 1,
    bytes: 100000,
  })),
  upload: [{ mbps: 99, duration: 9 }],
  idle: [10, 20, 30],
  downLatency: [30, 40],
  upLatency: [],
};
const stats = summarize(samples);
assert.equal(stats.download.p90, 28);
assert.equal(stats.upload.p90, null);
assert.equal(stats.idle.jitter, 10);
assert.equal(stats.downIncrease, 15);
assert.equal(stats.upIncrease, null);
const report = publicReport({
  id: "x",
  date: "now",
  metrics: { download: 28 },
  samples,
  connection: {
    organization: "Test",
    ip: "198.51.100.42",
    latitude: 1,
    longitude: 2,
    postalCode: "private",
  },
});
assert.ok(!JSON.stringify(report).includes("198.51.100.42"));
assert.ok(!JSON.stringify(report).includes("postalCode"));
console.log(
  "PASS DST gaps/repeats, calendar dates, rename conflicts, network statistics and IP-free report serialization",
);
