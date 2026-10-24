const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8798";
(async () => {
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    c = await browser.newContext(),
    p = await c.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  const checks = [],
    pass = (x) => {
      checks.push(x);
      console.log("PASS " + x);
    };
  async function open(slug) {
    await p.goto(base + "/tools/" + slug + "/");
    await p.waitForSelector('[data-ready="true"]');
  }
  try {
    await open("calculator-studio");
    await c.route("**/tool-scripts/calculator-worker.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: 'postMessage({type:"ready"});onmessage=()=>{};',
      }),
    );
    await p.fill("#calc-expression", "2+2");
    await p.click("#calc-run");
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("2 seconds"),
    );
    assert.ok(await p.isEnabled("#calc-run"));
    await p.click("#calc-run");
    await p.click("#cancel-job");
    assert.match(await p.textContent("#tool-status"), /Cancelled/);
    await c.unroute("**/tool-scripts/calculator-worker.js");
    pass(
      "isolated computation timeout and cancellation leave the expression retryable",
    );
    await open("file-check");
    await p.setInputFiles(
      "#check-files",
      Array.from({ length: 21 }, (_, i) => ({
        name: i + ".txt",
        mimeType: "text/plain",
        buffer: Buffer.from("x"),
      })),
    );
    assert.match(await p.textContent("#tool-status"), /20 files/);
    assert.ok(await p.isDisabled("#check-run"));
    await p.setInputFiles("#check-files", {
      name: "retry.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("retry"),
    });
    await p.evaluate(() => {
      document.querySelector("#check-run").click();
      document.querySelector("#cancel-job").click();
    });
    assert.match(await p.textContent("#tool-status"), /Cancelled/);
    assert.ok(await p.isEnabled("#check-run"));
    pass("file-count limits, reselection and worker cancellation");
    await open("subtitle-studio");
    await p.setInputFiles("#sub-file", {
      name: "bad.vtt",
      mimeType: "text/vtt",
      buffer: Buffer.from("WEBVTT\n\nSTYLE\n::cue{color:red}"),
    });
    await p.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.includes("not supported"),
    );
    const cue = "00:00:01.000 --> 00:00:02.000\nHello";
    await p.setInputFiles("#sub-file", {
      name: "large.vtt",
      mimeType: "text/vtt",
      buffer: Buffer.from("WEBVTT\n\n" + Array(5001).fill(cue).join("\n\n")),
    });
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("5,000"),
    );
    assert.ok(await p.isDisabled("#sub-download"));
    await p.setInputFiles("#sub-file", {
      name: "bad.srt",
      mimeType: "text/plain",
      buffer: Buffer.from([255, 254, 253]),
    });
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("UTF-8"),
    );
    pass("subtitle layout/row-limit/encoding rejection and no partial import");
    const restricted = await browser.newContext();
    await restricted.route("**/config.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: "window.KENSEI_CONFIG={};",
      }),
    );
    await restricted.addInitScript(() =>
      Object.defineProperty(window, "indexedDB", {
        get() {
          throw Error("Site storage is disabled");
        },
      }),
    );
    const q = await restricted.newPage();
    await q.goto(base + "/tools/flashcards/");
    await q.waitForSelector('[data-ready="true"]');
    await q.click("#deck-new");
    await q.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("storage"),
    );
    assert.ok(await q.isEnabled("#deck-new"));
    await restricted.close();
    pass("blocked IndexedDB reports a recoverable local-save error");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/fifth-boundaries.json",
      JSON.stringify({ base, checks, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
