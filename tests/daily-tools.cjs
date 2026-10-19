const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { zipSync, unzipSync } = require("fflate");
const {
  chromium,
} = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8795";
const slugs = [
    "network-test",
    "zip-studio",
    "color-studio",
    "unit-converter",
    "password-generator",
  ],
  checks = [];
const pass = (s) => {
  checks.push(s);
  console.log("PASS " + s);
};
(async () => {
  fs.mkdirSync("_qa", { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true }),
    ctx = await browser.newContext(),
    errors = [],
    uploads = [];
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (
        ["POST", "PUT", "PATCH"].includes(r.method()) &&
        !r.url().startsWith("https://speed.cloudflare.com/")
      )
        uploads.push(r.url());
    });
  });
  await ctx.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  const p = await ctx.newPage();
  async function open(slug) {
    await p.goto(base + "/tools/" + slug + "/");
    await p.waitForSelector('[data-tool][data-ready="true"]');
  }
  try {
    for (const width of [360, 768, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      await p.goto(base + "/tools/");
      assert.equal(await p.locator("[data-tool-card]").count(), 17);
      assert.equal(await p.locator('[data-filter="fun"]').count(), 0);
      assert.equal(
        await p.getByRole("link", { name: "Games", exact: true }).count(),
        0,
      );
      for (const slug of slugs) {
        await open(slug);
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " overflow at " + width,
        );
      }
    }
    await p.goto(base + "/");
    await p.fill("#tool-search", "Network");
    assert.equal(await p.locator("[data-tool-card]:visible").count(), 1);
    await p.locator('[data-favorite="network-test"]').click();
    await p.goto(base + "/workspace/");
    assert.ok(await p.getByRole("link", { name: /Network Test/ }).count());
    pass(
      "17 shared tools, search, favorites, Utilities classification and 3 responsive widths",
    );

    await open("unit-converter");
    await p.selectOption("#unit-category", "Temperature");
    await p.fill("#unit-value", "32");
    await p.selectOption("#unit-from", "1");
    await p.selectOption("#unit-to", "0");
    assert.equal(await p.inputValue("#unit-result"), "0");
    await p.click("#unit-swap");
    assert.equal(await p.inputValue("#unit-result"), "32");
    await p.fill("#unit-value", "-999");
    assert.match(await p.textContent("#unit-status"), /absolute zero/);
    await p.selectOption("#unit-category", "Storage");
    await p.fill("#unit-value", "1");
    await p.selectOption("#unit-from", "6");
    await p.selectOption("#unit-to", "0");
    assert.equal(await p.inputValue("#unit-result"), "1048576");
    await p.fill("#unit-value", "bad");
    assert.equal(await p.inputValue("#unit-result"), "");
    assert.ok(await p.isDisabled("#unit-copy"));
    pass("unit conversion, swap, decimal/binary storage and invalid inputs");

    await open("color-studio");
    await p.fill("#color-hex", "#0f0");
    await p.locator("#color-hex").blur();
    assert.equal(await p.inputValue("#color-rgb"), "0, 255, 0");
    await p.fill("#color-hsl", "240, 100%, 50%");
    await p.locator("#color-hsl").blur();
    assert.equal(await p.inputValue("#color-hex"), "#0000ff");
    await p.fill("#color-hex", "#nope");
    await p.locator("#color-hex").blur();
    assert.match(await p.textContent("#color-status"), /HEX/);
    const locked = await p
      .locator('.palette-card input[type="color"]')
      .first()
      .inputValue();
    await p.locator('.palette-card input[type="checkbox"]').first().check();
    await p.click("#palette-generate");
    assert.equal(
      await p.locator('.palette-card input[type="color"]').first().inputValue(),
      locked,
    );
    await p.locator("#contrast-fg").fill("#000000");
    await p.locator("#contrast-bg").fill("#ffffff");
    assert.match(await p.textContent("#contrast-result"), /21.00:1.*Pass/);
    await p.fill("#gradient-angle", "90");
    assert.match(await p.inputValue("#gradient-css"), /90deg/);
    await p.screenshot({ path: "_qa/daily-color.png", fullPage: true });
    pass(
      "HEX/RGB/HSL conversion, locked palette, gradient CSS and contrast reference",
    );

    await open("password-generator");
    assert.equal((await p.inputValue("#password-output")).length, 20);
    await p.fill("#password-length", "64");
    await p.locator("#password-length").blur();
    assert.equal((await p.inputValue("#password-output")).length, 64);
    await p.check("#password-ambiguous");
    assert.ok(!/[Il1O0]/.test(await p.inputValue("#password-output")));
    await p.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("Denied")) },
        configurable: true,
      }),
    );
    await p.click("#password-copy");
    assert.equal(
      await p.evaluate(() => {
        const e = document.querySelector("#password-output");
        return e.selectionEnd - e.selectionStart;
      }),
      64,
    );
    assert.ok(
      !(await p.evaluate(() => JSON.stringify({ ...localStorage }))).includes(
        await p.inputValue("#password-output"),
      ),
    );
    for (const id of ["upper", "lower", "digits", "symbols"])
      await p.uncheck("#password-" + id);
    assert.equal(await p.inputValue("#password-output"), "");
    assert.match(await p.textContent("#password-status"), /at least one/);
    pass(
      "password constraints, clipboard fallback and no generated-password persistence",
    );

    await open("zip-studio");
    await p.setInputFiles("#zip-files", [
      {
        name: "你好.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("中文内容"),
      },
      {
        name: "sample.bin",
        mimeType: "application/octet-stream",
        buffer: Buffer.from([0, 1, 2, 3]),
      },
    ]);
    let downloadPromise = p.waitForEvent("download");
    await p.click("#zip-pack");
    let download = await downloadPromise;
    const packed = unzipSync(fs.readFileSync(await download.path()));
    assert.equal(Buffer.from(packed["你好.txt"]).toString(), "中文内容");
    assert.deepEqual([...packed["sample.bin"]], [0, 1, 2, 3]);
    const input = zipSync({
      "folder/你好.txt": Buffer.from("Line one\nLine two"),
      "empty.txt": new Uint8Array(),
    });
    await p.setInputFiles("#zip-open", {
      name: "nested.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(input),
    });
    await p.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.includes("entries checked"),
    );
    assert.equal(await p.locator(".zip-row").count(), 2);
    downloadPromise = p.waitForEvent("download");
    await p
      .locator(".zip-row")
      .filter({ hasText: "folder/你好.txt" })
      .getByRole("button")
      .click();
    download = await downloadPromise;
    assert.equal(
      fs.readFileSync(await download.path(), "utf8"),
      "Line one\nLine two",
    );
    const encrypted = Buffer.from(input);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(
      encrypted.readUInt16LE(central + 8) | 1,
      central + 8,
    );
    await p.setInputFiles("#zip-open", {
      name: "encrypted.zip",
      mimeType: "application/zip",
      buffer: encrypted,
    });
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("Encrypted"),
    );
    const corrupt = Buffer.from(input);
    corrupt[corrupt.length - 22] = 0;
    await p.setInputFiles("#zip-open", {
      name: "bad.zip",
      mimeType: "application/zip",
      buffer: corrupt,
    });
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("damaged"),
    );
    const bomb = Buffer.from(zipSync({ "bomb.txt": Buffer.alloc(100000, 65) })),
      cp = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(1, 22);
    bomb.writeUInt32LE(1, cp + 24);
    await p.setInputFiles("#zip-open", {
      name: "lying-size.zip",
      mimeType: "application/zip",
      buffer: bomb,
    });
    await p.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.includes("Actual decompressed"),
    );
    const unsafe = zipSync({ "../escape.txt": Buffer.from("x") });
    await p.setInputFiles("#zip-open", {
      name: "unsafe.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(unsafe),
    });
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("unsafe"),
    );
    const entries = {};
    for (let i = 0; i < 2001; i++) entries[i + ".txt"] = new Uint8Array();
    await p.setInputFiles("#zip-open", {
      name: "many.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(zipSync(entries)),
    });
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("2,000"),
    );
    await p.setInputFiles(
      "#zip-files",
      Array.from({ length: 101 }, (_, i) => ({
        name: i + ".txt",
        mimeType: "text/plain",
        buffer: Buffer.from("x"),
      })),
    );
    assert.ok(await p.isDisabled("#zip-pack"));
    await p.setInputFiles("#zip-files", {
      name: "large.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(10000000, 65),
    });
    await p.click("#zip-pack");
    await p.click("#cancel-job");
    assert.match(await p.textContent("#tool-status"), /Cancelled/);
    pass(
      "real ZIP roundtrip, Chinese paths, extraction, encrypted/corrupt archives, actual-byte guard, entry limits and cancellation",
    );

    let cloudRequests = [];
    await ctx.route("https://speed.cloudflare.com/**", async (r) => {
      const url = new URL(r.request().url());
      cloudRequests.push({
        path: url.pathname,
        bytes: Number(url.searchParams.get("bytes")),
        method: r.request().method(),
      });
      const n = Number(url.searchParams.get("bytes"));
      await new Promise((resolve) => setTimeout(resolve, n ? 1150 : 20));
      try {
        await r.fulfill({
          status: 200,
          body: Buffer.alloc(url.pathname === "/__down" ? n : 0, 65),
          headers: {
            "content-type": "text/plain",
            "access-control-allow-origin": "*",
            "timing-allow-origin": "*",
            "cache-control": "no-store",
            "server-timing": "cf;dur=0",
          },
        });
      } catch {}
    });
    await open("network-test");
    await p.waitForTimeout(300);
    assert.equal(cloudRequests.length, 0);
    await p.click("#network-start");
    await p.waitForFunction(
      () =>
        document
          .querySelector("#network-status")
          .textContent.includes("complete") ||
        document
          .querySelector("#network-status")
          .textContent.includes("failed"),
      null,
      { timeout: 45000 },
    );
    assert.match(await p.textContent("#network-status"), /complete/);
    assert.ok(cloudRequests.length > 20);
    assert.ok(
      cloudRequests.every((r) => ["/__down", "/__up"].includes(r.path)),
    );
    assert.ok(cloudRequests.reduce((n, r) => n + r.bytes, 0) <= 500000000);
    assert.equal(await p.locator("#network-history .saved-row").count(), 1);
    await p.screenshot({ path: "_qa/daily-network.png", fullPage: true });
    await p.reload();
    await p.waitForSelector('[data-ready="true"]');
    assert.equal(await p.locator("#network-history .saved-row").count(), 1);
    const before = cloudRequests.length;
    await p.click("#network-start");
    await p.waitForTimeout(300);
    await p.click("#network-cancel");
    await p.waitForTimeout(250);
    const after = cloudRequests.length;
    await p.waitForTimeout(500);
    assert.equal(cloudRequests.length, after);
    assert.equal(await p.locator("#network-history .saved-row").count(), 1);
    await p.click("#network-start");
    await p.waitForTimeout(150);
    await p.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.match(await p.textContent("#network-status"), /hidden/);
    await p.evaluate(() => delete document.hidden);
    await p
      .locator("#network-history .saved-row")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    assert.equal(await p.locator("#network-history .saved-row").count(), 0);
    pass(
      "real pinned speed engine with controlled HTTP responses: no auto traffic, metrics, no reporting, payload budget, history, cancel and background stop",
    );
    await ctx.unroute("https://speed.cloudflare.com/**");
    await ctx.route("https://speed.cloudflare.com/**", (r) =>
      r.abort("internetdisconnected"),
    );
    await p.click("#network-start");
    await p.waitForFunction(() =>
      document.querySelector("#network-status").textContent.includes("failed"),
    );
    assert.equal(await p.locator("#network-history .saved-row").count(), 0);
    pass("network failures do not save incomplete history");
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    fs.writeFileSync(
      "_qa/daily-results.json",
      JSON.stringify(
        {
          base,
          checks,
          errors,
          uploads,
          cloudRequests,
          networkBoundary:
            "Controlled Cloudflare HTTP responses; actual vendored engine and browser timing",
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
