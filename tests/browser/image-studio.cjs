const assert = require("node:assert/strict");
const fs = require("node:fs");
const { unzipSync } = require("fflate");
const {
  chromium,
} = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const checks = [];
const pass = (s) => {
  checks.push(s);
  console.log("PASS " + s);
};
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
  const errors = [],
    uploads = [];
  async function open({ blocked = false, picaUnavailable = false } = {}) {
    const context = await browser.newContext();
    await context.route("**/config.js", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: "window.KENSEI_CONFIG={};",
      }),
    );
    if (picaUnavailable)
      await context.route("**/vendor/pica.js", (r) => r.abort());
    await context.addInitScript((blocked) => {
      window.__blockedReads = 0;
      const nativeRead = CanvasRenderingContext2D.prototype.getImageData;
      window.__readPixels = (ctx, ...args) => nativeRead.apply(ctx, args);
      if (!blocked) return;
      for (const kind of [
        window.CanvasRenderingContext2D,
        window.OffscreenCanvasRenderingContext2D,
      ]) {
        if (!kind) continue;
        kind.prototype.getImageData = function () {
          window.__blockedReads++;
          throw new DOMException(
            "Canvas pixel access blocked by privacy protection",
            "SecurityError",
          );
        };
      }
    }, blocked);
    const page = await context.newPage(),
      picaRequests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().endsWith("/vendor/pica.js")) picaRequests.push(r.url());
      if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
    });
    await page.goto(base + "/tools/image-studio/", {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-ready="true"]').waitFor();
    return { context, page, picaRequests };
  }
  async function fixture(page, width, height) {
    return Buffer.from(
      await page.evaluate(
        ({ width, height }) => {
          const c = document.createElement("canvas");
          c.width = width;
          c.height = height;
          const x = c.getContext("2d");
          x.fillStyle = "#a42762";
          x.fillRect(0, 0, width / 2, height / 2);
          return c.toDataURL("image/png").split(",")[1];
        },
        { width, height },
      ),
      "base64",
    );
  }
  const inputFile = (buffer, name = "sample.png") => ({
    name,
    mimeType: "image/png",
    buffer,
  });
  async function select(page, files) {
    await page.locator("#image-file").setInputFiles(files);
    await page.waitForFunction(
      () => !document.querySelector("#image-width").disabled,
    );
  }
  async function runProcessing(page) {
    await page.locator("#image-process").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#image-process").disabled &&
        /Done|failed|completed/.test(
          document.querySelector("#image-result").textContent,
        ),
      {},
      { timeout: 60000 },
    );
  }
  async function exported(page) {
    return page.evaluate(async () => {
      const img = new Image();
      img.src = document.querySelector("#image-download").href;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      return {
        width: img.width,
        height: img.height,
        type: (await (await fetch(img.src)).blob()).type,
        pixel: Array.from(
          window.__readPixels(x, img.width - 1, img.height - 1, 1, 1).data,
        ),
      };
    });
  }
  try {
    const first = await open({ blocked: true });
    const large = await fixture(first.page, 2560, 1600);
    await select(
      first.page,
      Array.from({ length: 14 }, (_, i) =>
        inputFile(large, `screenshot-${i + 1}.png`),
      ),
    );
    await first.page.locator("#image-quality").fill("100");
    await runProcessing(first.page);
    if (process.env.EXPECT_IMAGE_FAILURE) {
      assert.equal(
        await first.page.locator("#batch-results .error-text").count(),
        14,
      );
      assert.match(
        await first.page.locator("#batch-results").textContent(),
        /cannot use getImageData/,
      );
      console.log(
        "REPRODUCED original error: all 14 images fail Pica canvas-read capability check.",
      );
      return;
    }
    assert.equal(await first.page.locator("#batch-results a").count(), 14);
    assert.equal(
      await first.page.locator("#batch-results .error-text").count(),
      0,
    );
    assert.equal(first.picaRequests.length, 0);
    assert.equal(await first.page.evaluate(() => window.__blockedReads), 0);
    assert.deepEqual(await exported(first.page), {
      width: 2560,
      height: 1600,
      type: "image/webp",
      pixel: [0, 0, 0, 0],
    });
    const [zipDownload] = await Promise.all([
      first.page.waitForEvent("download"),
      first.page.locator("#image-zip").click(),
    ]);
    assert.equal(
      Object.keys(unzipSync(fs.readFileSync(await zipDownload.path()))).length,
      14,
    );
    pass(
      "14 images at 2560×1600 / WebP quality 100 convert and ZIP without pixel reads or Pica",
    );
    const small = await fixture(first.page, 32, 16);
    await select(first.page, inputFile(small));
    await first.page.locator("#image-width").fill("16");
    await first.page.locator("#image-format").selectOption("image/jpeg");
    await runProcessing(first.page);
    const jpeg = await exported(first.page);
    assert.equal(jpeg.width, 16);
    assert.equal(jpeg.height, 8);
    assert.equal(jpeg.type, "image/jpeg");
    assert(
      jpeg.pixel[0] > 245 &&
        jpeg.pixel[1] > 245 &&
        jpeg.pixel[2] > 245 &&
        jpeg.pixel[3] === 255,
    );
    assert(first.picaRequests.length > 0);
    assert((await first.page.evaluate(() => window.__blockedReads)) > 0);
    pass(
      "Real Pica canvas-read denial falls back to native resize with a white JPEG background",
    );
    await first.page.locator("#image-format").selectOption("image/png");
    await runProcessing(first.page);
    const png = await exported(first.page);
    assert.equal(png.type, "image/png");
    assert.equal(png.pixel[3], 0);
    pass("Native fallback preserves PNG transparency and target dimensions");
    await first.context.close();
    const normal = await open();
    await select(normal.page, inputFile(small));
    await normal.page.locator("#image-width").fill("16");
    await runProcessing(normal.page);
    assert.equal((await exported(normal.page)).width, 16);
    assert.equal(normal.picaRequests.length, 1);
    await normal.context.close();
    pass("Normal browser resize still uses Pica");
    const noLibrary = await open({ picaUnavailable: true });
    await select(noLibrary.page, inputFile(small));
    await noLibrary.page.locator("#image-width").fill("16");
    await runProcessing(noLibrary.page);
    assert.equal((await exported(noLibrary.page)).width, 16);
    await noLibrary.context.close();
    pass("Unavailable resize library still allows native processing");
    const noExport = await open({ blocked: true });
    await select(noExport.page, inputFile(small));
    await noExport.page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        queueMicrotask(() => callback(null));
      };
    });
    await runProcessing(noExport.page);
    assert.match(
      await noExport.page.locator("#image-result").textContent(),
      /^Processing failed/,
    );
    assert(await noExport.page.locator("#image-download").isHidden());
    assert.equal(
      await noExport.page.locator("#batch-results .error-text").count(),
      1,
    );
    await noExport.context.close();
    pass("Blocked image export reports failure and offers no invalid download");
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    pass("No browser exceptions or file uploads");
    fs.mkdirSync("_qa", { recursive: true });
    fs.writeFileSync(
      "_qa/image-studio-results.json",
      JSON.stringify({ base, checks, errors, uploads }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
