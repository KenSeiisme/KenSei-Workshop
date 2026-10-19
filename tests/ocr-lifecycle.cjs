const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  chromium,
} = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/config.js", (r) =>
      r.fulfill({ body: "window.KENSEI_CONFIG={};" }),
    );
    if (process.env.PATCH_OCR)
      await context.route("**/tool-scripts/image-to-text.js", (r) =>
        r.fulfill({
          contentType: "application/javascript",
          body: fs.readFileSync("tool-scripts/image-to-text.js", "utf8"),
        }),
      );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/tools/image-to-text/");
    await page.locator('[data-ready="true"]').waitFor();
    const fixture = Buffer.from(
      await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 1200;
        c.height = 180;
        const x = c.getContext("2d");
        x.fillStyle = "white";
        x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = "black";
        x.font = "52px Arial";
        x.fillText("KenSei Workshop 123", 30, 105);
        return c.toDataURL().split(",")[1];
      }),
      "base64",
    );
    await page
      .locator("#ocr-file")
      .setInputFiles({
        name: "sample.png",
        mimeType: "image/png",
        buffer: fixture,
      });
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.startsWith("Image ready"),
    );
    await page.locator("#ocr-output").fill("Preserve this text");
    // Hold the child worker response so each cancellation happens during initialization.
    await context.route("**/vendor/tesseract/worker.min.js", async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await r.continue().catch(() => {});
    });
    for (let i = 0; i < 4; i++) {
      await page.locator("#ocr-run").click();
      await page.locator("#cancel-job").click();
      await page.waitForTimeout(500);
      assert.match(
        await page.locator("#tool-status").textContent(),
        /cancelled/,
      );
      assert.equal(
        await page.locator("#ocr-output").inputValue(),
        "Preserve this text",
      );
      assert(await page.locator("#ocr-run").isEnabled());
    }
    await context.unroute("**/vendor/tesseract/worker.min.js");
    await context.route("**/vendor/tesseract/lang/**", (r) =>
      r.fulfill({ status: 503, body: "Temporary failure" }),
    );
    await page.locator("#ocr-run").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#tool-status")
          .textContent.startsWith("Recognition failed"),
      {},
      { timeout: 60000 },
    );
    assert.equal(
      await page.locator("#ocr-output").inputValue(),
      "Preserve this text",
    );
    await context.unroute("**/vendor/tesseract/lang/**");
    await page.locator("#ocr-run").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#tool-status")
          .textContent.startsWith("Text extracted"),
      {},
      { timeout: 60000 },
    );
    assert.match(await page.locator("#ocr-output").inputValue(), /Workshop/);
    assert.deepEqual(errors, []);
    console.log(
      "PASS Four OCR initialization cancellations preserve status/text; model failure recovers on retry",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
