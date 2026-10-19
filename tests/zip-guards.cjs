const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { zipSync, unzipSync } = require("fflate");
const {
  chromium,
} = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8795";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true }),
    c = await browser.newContext(),
    p = await c.newPage(),
    checks = [];
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  async function inspect(data) {
    return p.evaluate(
      (bytes) =>
        new Promise((resolve) => {
          const w = new Worker("/tool-scripts/zip-worker.js");
          w.onmessage = ({ data }) => {
            if (data.type !== "progress") {
              w.terminate();
              resolve(data);
            }
          };
          w.postMessage({
            action: "open",
            file: new File([new Uint8Array(bytes)], "test.zip"),
          });
        }),
      [...data],
    );
  }
  try {
    await p.goto(base + "/tools/zip-studio/");
    await p.waitForSelector('[data-ready="true"]');
    const crc = Buffer.from(
      zipSync({ "checksum.txt": Buffer.from("original") }, { level: 0 }),
    );
    const start = 30 + crc.readUInt16LE(26) + crc.readUInt16LE(28);
    crc[start] ^= 1;
    assert.match((await inspect(crc)).message, /checksum/);
    const huge = Buffer.from(zipSync({ "big.txt": Buffer.from("x") })),
      at = huge.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    huge.writeUInt32LE(500000001, 22);
    huge.writeUInt32LE(500000001, at + 24);
    assert.match((await inspect(huge)).message, /500 MB/);
    const oversized = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const worker = new Worker("/tool-scripts/zip-worker.js");
          worker.onmessage = ({ data }) => {
            if (data.type === "error") {
              worker.terminate();
              resolve(data.message);
            }
          };
          worker.postMessage({
            action: "open",
            file: new File([new Uint8Array(100000001)], "large.zip"),
          });
        }),
    );
    assert.match(oversized, /100 MB/);
    checks.push(
      "CRC corruption, declared expanded budget and oversized archive are rejected by actual worker",
    );
    const duplicate = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const w = new Worker("/tool-scripts/zip-worker.js");
          w.onmessage = async ({ data }) => {
            if (data.type === "packed") {
              const bytes = [...new Uint8Array(await data.blob.arrayBuffer())];
              w.terminate();
              resolve(bytes);
            } else if (data.type === "error") {
              w.terminate();
              resolve(data.message);
            }
          };
          w.postMessage({
            action: "pack",
            files: [
              new File(["first"], "same.txt"),
              new File(["second"], "same.txt"),
              new File([], "empty.txt"),
            ],
          });
        }),
    );
    const files = unzipSync(new Uint8Array(duplicate));
    assert.equal(Buffer.from(files["same.txt"]).toString(), "first");
    assert.equal(Buffer.from(files["same (2).txt"]).toString(), "second");
    assert.equal(files["empty.txt"].length, 0);
    checks.push(
      "duplicate pack names are disambiguated and empty files survive a real roundtrip",
    );
    fs.writeFileSync(
      "_qa/zip-guards.json",
      JSON.stringify({ base, checks }, null, 2),
    );
    for (const check of checks) console.log("PASS " + check);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
