const assert = require("node:assert/strict");
const {
  chromium,
} = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { PDFDocument } = require("pdf-lib");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/config.js", (r) =>
      r.fulfill({ body: "window.KENSEI_CONFIG={};" }),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const go = async (slug) => {
      await page.goto(base + "/tools/" + slug + "/");
      await page.locator('[data-ready="true"]').waitFor();
    };
    await go("image-studio");
    await page.locator("#image-file").setInputFiles(
      Array.from({ length: 21 }, (_, i) => ({
        name: i + ".png",
        mimeType: "image/png",
        buffer: Buffer.from("dummy"),
      })),
    );
    await page.waitForFunction(() =>
      document.querySelector(".toast").textContent.includes("up to 20"),
    );
    await page.locator("#image-file").setInputFiles({
      name: "too-large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(21 * 1048576),
    });
    await page.waitForFunction(() =>
      document.querySelector(".toast").textContent.includes("20 MB per image"),
    );
    assert(await page.locator("#image-process").isDisabled());
    console.log("PASS Image count and per-file size limits prevent processing");
    await go("pdf-toolkit");
    await page.locator("#pdf-files").setInputFiles({
      name: "damaged.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nnot a document"),
    });
    await page.waitForFunction(() =>
      document.querySelector("#tool-status").classList.contains("error-text"),
    );
    assert.match(
      await page.locator("#tool-status").textContent(),
      /damaged|unsupported/,
    );
    assert(await page.locator("#pdf-files").isEnabled());
    const tooMany = await PDFDocument.create();
    for (let i = 0; i < 201; i++) tooMany.addPage();
    await page.locator("#pdf-files").setInputFiles({
      name: "too-many.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await tooMany.save()),
    });
    await page.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("200 pages"),
    );
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(51 * 1048576)], "large.pdf", {
          type: "application/pdf",
        }),
      );
      const input = document.querySelector("#pdf-files");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    });
    await page.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("50 MB"),
    );
    const a = await PDFDocument.create();
    a.addPage([200, 300]);
    const b = await PDFDocument.create();
    b.addPage([400, 500]);
    await page.locator("#pdf-files").setInputFiles([
      {
        name: "a.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await a.save()),
      },
      {
        name: "b.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await b.save()),
      },
    ]);
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.startsWith("Files ready"),
    );
    assert.equal(await page.locator(".pdf-page-row").count(), 2);
    await page.locator("#pdf-ranges").fill("0-100");
    await page.locator("#pdf-run").click();
    await page.waitForFunction(() =>
      document.querySelector("#tool-status").classList.contains("error-text"),
    );
    assert.match(
      await page.locator("#tool-status").textContent(),
      /between 1 and 2/,
    );
    await page.locator("#pdf-ranges").fill("");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#pdf-run").click(),
    ]);
    const doc = await PDFDocument.load(
      require("node:fs").readFileSync(await download.path()),
    );
    assert.deepEqual(
      doc.getPages().map((p) => p.getWidth()),
      [200, 400],
    );
    console.log(
      "PASS Damaged PDF, page/size limits and invalid ranges; merge works after errors",
    );
    await go("qr-studio");
    await page.locator("#qr-content").fill("javascript:alert(1)");
    await page.locator("#qr-generate").click();
    await page.waitForFunction(() =>
      document.querySelector("#tool-status").classList.contains("error-text"),
    );
    assert(await page.locator("#qr-png").isDisabled());
    await go("image-to-text");
    await page.locator("#ocr-run").click();
    assert.match(
      await page.locator("#tool-status").textContent(),
      /Choose an image/,
    );
    await page.locator('[value="eng"]').uncheck();
    assert.deepEqual(errors, []);
    console.log(
      "PASS Invalid QR scheme, missing OCR image and no browser exceptions",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
