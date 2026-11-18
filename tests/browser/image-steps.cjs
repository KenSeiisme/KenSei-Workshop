const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { PDFDocument } = require("pdf-lib");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 830 },
    });
    await context.route("**/config.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "window.KENSEI_CONFIG={};",
      }),
    );
    const page = await context.newPage();
    await page.goto(base + "/tools/image-studio/");
    await page.waitForSelector('[data-ready="true"]');
    const inputs = await page.evaluate(() =>
      [
        [240, 480, "#ff3939"],
        [480, 240, "#30b47c"],
        [520, 320, "#3a62de"],
      ].map(([w, h, color]) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fff";
        ctx.font = "24px sans-serif";
        ctx.fillText("Original", w * 0.35, h * 0.45);
        return c.toDataURL().split(",")[1];
      }),
    );
    await page.click("#image-mode-steps");
    await page.waitForFunction(
      () =>
        typeof document.querySelector("#steps-files")?.onchange === "function",
    );
    await page.setInputFiles(
      "#steps-files",
      inputs.map((data, index) => ({
        name: "screenshot-" + index + ".png",
        mimeType: "image/png",
        buffer: Buffer.from(data, "base64"),
      })),
    );
    await page.waitForFunction(
      () => document.querySelectorAll("#steps-files-list li").length === 3,
    );
    await page.locator("#steps-files-list button").first().click();
    await page.selectOption("#steps-type", "cover");
    await page.locator("#steps-coordinates summary").click();
    await page.click("#steps-place");
    await page.selectOption("#steps-type", "text");
    await page.fill("#steps-value", "說明 Step");
    await page.fill("#steps-x", "10");
    await page.fill("#steps-y", "10");
    await page.click("#steps-place");
    await page.click("#steps-undo");
    await page.click("#steps-place");
    await page.selectOption("#steps-type", "arrow");
    await page.fill("#steps-x", "12");
    await page.fill("#steps-y", "70");
    await page.click("#steps-place");
    await page.selectOption("#steps-type", "number");
    await page.click("#steps-place");
    await page.locator("#steps-files-list button").last().click();
    await page.click("#steps-earlier");
    await page.selectOption("#steps-layout", "compare");
    await page.fill("#steps-width", "800");
    await page.click("#steps-preview");
    await page.waitForSelector("#steps-result:not([hidden])");
    const download = page.waitForEvent("download");
    await page.click("#steps-download");
    const png = await fs.readFile(await (await download).path());
    assert.equal(png.readUInt32BE(16), 800);
    const rgba = await page.evaluate(async (b64) => {
      const photo = new Image();
      photo.src = "data:image/png;base64," + b64;
      await photo.decode();
      const c = document.createElement("canvas");
      c.width = photo.width;
      c.height = photo.height;
      const x = c.getContext("2d");
      x.drawImage(photo, 0, 0);
      const at = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data);
      return [at(200, 350), at(50, 230), at(500, 60)];
    }, png.toString("base64"));
    assert.deepEqual(rgba, [
      [32, 24, 39, 255],
      [255, 57, 57, 255],
      [58, 98, 222, 255],
    ]);
    const dest = context.waitForEvent("page");
    await page
      .locator("#steps-transfer")
      .getByRole("button", { name: "PDF Toolkit", exact: true })
      .click();
    const pdfPage = await dest;
    await pdfPage.waitForFunction(() =>
      document.querySelector("#pdf-summary")?.textContent.includes("1 images"),
    );
    const pdfDownload = pdfPage.waitForEvent("download");
    await pdfPage.click("#pdf-run");
    const pdf = await PDFDocument.load(
      await fs.readFile(await (await pdfDownload).path()),
    );
    assert.equal(pdf.getPageCount(), 1);
    await page.fill("#steps-width", "1000");
    assert.equal(await page.locator("#steps-result").isHidden(), true);
    await page.click("#image-mode-batch");
    await page.click("#image-mode-steps");
    assert.equal(await page.locator("#steps-files-list li").count(), 3);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    console.log(
      "PASS mixed-ratio screenshots, annotation undo/reordering, masked PNG pixels, real PDF handoff and mode persistence",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
