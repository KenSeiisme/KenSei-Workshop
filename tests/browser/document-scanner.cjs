const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { PDFDocument } = require("pdf-lib");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";

async function pixels(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 540;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#40364a";
    ctx.fillRect(0, 0, 480, 540);
    ctx.fillStyle = "#f7eedf";
    ctx.beginPath();
    [
      [80, 65],
      [400, 39],
      [429, 431],
      [51, 476],
    ].forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.font = "25px sans-serif";
    ctx.fillText("Workshop scan", 111, 180);
    ctx.fillText("文件掃描 123", 111, 228);
    const first = canvas.toDataURL().split(",")[1];
    canvas.width = 520;
    canvas.height = 330;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 520, 330);
    ctx.fillStyle = "#222";
    ctx.font = "bold 38px sans-serif";
    ctx.fillText("WORKSHOP SCAN", 44, 132);
    ctx.fillText("Page two", 44, 202);
    return [first, canvas.toDataURL().split(",")[1]];
  });
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 320, height: 790 },
    });
    await context.route("**/config.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.KENSEI_CONFIG={};",
      }),
    );
    const errors = [],
      uploads = [];
    context.on("request", (request) => {
      if (["POST", "PUT", "PATCH"].includes(request.method()))
        uploads.push(request.url());
    });
    context.on("page", (p) =>
      p.on("pageerror", (error) => errors.push(error.message)),
    );
    const page = await context.newPage();
    await page.goto(base + "/tools/document-scanner/");
    await page.waitForSelector('[data-ready="true"]');
    const images = (await pixels(page)).map((png, i) => ({
      name: "paper-" + i + ".png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    }));
    await page.setInputFiles("#scan-import", images);
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#scan-pages li").length === 2 &&
        document.querySelector("[data-tool]").getAttribute("aria-busy") ===
          "false",
    );
    assert.equal(
      await page.locator("#scan-camera").getAttribute("capture"),
      "environment",
    );
    await page.locator("#scan-pages button").first().click();
    const left = page.locator('[data-corner="0"]');
    const original = parseFloat(await left.evaluate((node) => node.style.left));
    assert.ok(Math.abs(original - (100 * 80) / 480) < 2.5, String(original));
    await left.press("ArrowRight");
    assert.ok(
      parseFloat(await left.evaluate((node) => node.style.left)) > original,
    );
    await page.click("#scan-compare");
    await page.waitForSelector("#scan-frame[data-preview]");
    await page.click("#scan-compare");
    await page.click("#scan-rotate");
    await page.click("#scan-rotate");
    await page.click("#scan-rotate");
    await page.click("#scan-rotate");
    assert.ok(
      parseFloat(await left.evaluate((node) => node.style.left)) > original,
    );
    const replace = page.waitForEvent("filechooser");
    await page.click("#scan-retake");
    await (
      await replace
    ).setFiles({
      name: "unreadable.png",
      mimeType: "image/png",
      buffer: Buffer.from("invalid"),
    });
    await page.waitForSelector("#scan-failures li");
    assert.equal(await page.locator("#scan-pages li").count(), 2);
    assert.ok(
      parseFloat(await left.evaluate((node) => node.style.left)) > original,
    );
    const importMore = page.waitForEvent("filechooser");
    await page.click("#scan-import-button");
    await (await importMore).setFiles(Array(19).fill(images[0]));
    await page.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("20 images"),
    );
    assert.equal(await page.locator("#scan-pages li").count(), 2);
    await page.click("#scan-later");
    const download = page.waitForEvent("download");
    await page.click("#scan-pdf");
    const pdf = await PDFDocument.load(
      await fs.readFile(await (await download).path()),
    );
    assert.deepEqual(
      pdf.getPages().map((p) => p.getSize()),
      [
        { width: 842, height: 595 },
        { width: 595, height: 842 },
      ],
    );
    const destination = context.waitForEvent("page");
    await page
      .locator("#scan-transfer")
      .getByRole("button", { name: "PDF Toolkit", exact: true })
      .click();
    const toolkit = await destination;
    await toolkit.waitForFunction(() =>
      document.querySelector("#pdf-summary")?.textContent.includes("2 pages"),
    );
    await page.click("#scan-ocr");
    const ocr = context.waitForEvent("page");
    await page
      .locator("#scan-transfer")
      .getByRole("button", { name: "Image to Text", exact: true })
      .click();
    const text = await ocr;
    await text.waitForFunction(() =>
      document
        .querySelector("#ocr-file-info")
        ?.textContent.includes("scan-02.jpg"),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      320,
    );
    await page.goto(base + "/zh-hant/tools/document-scanner/");
    await page.waitForSelector('[data-ready="true"]');
    assert.match(
      await page.locator("#scan-import-button").innerText(),
      /匯入照片/,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    console.log(
      "PASS scanner corner suggestion and keyboard, four rotations, mobile width, bilingual UI, actual PDF page order and both local handoffs",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
