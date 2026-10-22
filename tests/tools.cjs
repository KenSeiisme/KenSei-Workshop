const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  chromium,
} = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { PDFDocument, rgb } = require("pdf-lib");
const { unzipSync } = require("fflate");
const jsQR = require("jsqr");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const slugs = [
  "image-studio",
  "qr-studio",
  "pdf-toolkit",
  "markdown-studio",
  "text-compare",
  "image-to-text",
];
const checks = [];
function pass(s) {
  checks.push(s);
  console.log("PASS " + s);
}
(async () => {
  fs.mkdirSync("_qa", { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  const page = await context.newPage(),
    errors = [],
    uploads = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
    if (
      !r.url().startsWith(base) &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:") &&
      !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url())
    )
      external.push(r.url());
  });
  async function go(slug) {
    await page.goto(base + "/tools/" + slug + "/");
    await page.locator('[data-ready="true"]').waitFor();
  }
  async function downloaded(action) {
    const [d] = await Promise.all([page.waitForEvent("download"), action()]);
    return {
      name: d.suggestedFilename(),
      bytes: fs.readFileSync(await d.path()),
    };
  }
  async function png(text = "KenSei Workshop", font = "Arial") {
    return Buffer.from(
      await page.evaluate(
        ({ text, font }) => {
          const c = document.createElement("canvas");
          c.width = 1200;
          c.height = 180;
          const x = c.getContext("2d");
          x.fillStyle = "#fff";
          x.fillRect(0, 0, c.width, c.height);
          x.fillStyle = "#000";
          x.font = `52px "${font}"`;
          x.fillText(text, 30, 105);
          return c.toDataURL().split(",")[1];
        },
        { text, font },
      ),
      "base64",
    );
  }
  try {
    await page.goto(base + "/");
    assert.equal(await page.locator("[data-tool-card]").count(), 28);
    assert.equal(await page.locator(".project-card").count(), 0);
    for (const [category, count] of [
      ["images", 3],
      ["text", 6],
      ["documents", 1],
      ["utilities", 10],
      ["productivity", 5],
      ["testing", 2],
      ["audio", 1],
    ]) {
      await page.locator(`[data-filter="${category}"]`).click();
      assert.equal(
        await page.locator("[data-tool-card]:visible").count(),
        count,
      );
    }
    pass("Twenty-eight shared tools and all seven category filters");
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      for (const slug of slugs) {
        await go(slug);
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${slug} overflow at ${width}`,
        );
        if (width === 360 || width === 1440)
          await page.screenshot({
            path: `_qa/${slug}-${width}.png`,
            fullPage: true,
          });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    pass("Six tool interfaces at mobile, tablet and desktop widths");
    await go("image-studio");
    const fixture = await png();
    await page.locator("#image-file").setInputFiles([
      { name: "one.png", mimeType: "image/png", buffer: fixture },
      { name: "two.png", mimeType: "image/png", buffer: fixture },
    ]);
    await page.waitForFunction(
      () => !document.querySelector("#image-width").disabled,
    );
    await page.locator("#image-width").fill("600");
    await page.locator("#image-process").click();
    await page.locator("#image-zip").waitFor({ state: "visible" });
    assert.equal(await page.locator("#batch-results a").count(), 2);
    const imageZip = await downloaded(() => page.locator("#image-zip").click());
    assert.equal(Object.keys(unzipSync(imageZip.bytes)).length, 2);
    const out = await page.evaluate(async () => {
      const i = new Image();
      i.src = document.querySelector("#image-download").href;
      await i.decode();
      return [i.width, i.height];
    });
    assert.deepEqual(out, [600, 90]);
    pass("Actual batch image resize, output dimensions and two-image ZIP");
    await go("qr-studio");
    await page
      .locator("#qr-content")
      .fill("https://kensei-workshop.vercel.app/");
    await page.locator("#qr-generate").click();
    await page.locator("#qr-preview svg").waitFor();
    async function decodeQR() {
      const d = await downloaded(() => page.locator("#qr-png").click());
      const pixels = await page.evaluate(async (b64) => {
        const i = new Image();
        i.src = "data:image/png;base64," + b64;
        await i.decode();
        const c = document.createElement("canvas");
        c.width = i.width;
        c.height = i.height;
        const x = c.getContext("2d");
        x.drawImage(i, 0, 0);
        return {
          width: i.width,
          height: i.height,
          pixels: Array.from(x.getImageData(0, 0, i.width, i.height).data),
        };
      }, d.bytes.toString("base64"));
      return jsQR(
        new Uint8ClampedArray(pixels.pixels),
        pixels.width,
        pixels.height,
      )?.data;
    }
    assert.equal(await decodeQR(), "https://kensei-workshop.vercel.app/");
    await page.locator("#qr-type").selectOption("wifi");
    await page.locator("#qr-ssid").fill("Cafe;Wi:Fi");
    await page.locator("#qr-password").fill("a;b:c\\d");
    await page.locator("#qr-generate").click();
    assert.equal(
      await decodeQR(),
      "WIFI:T:WPA;S:Cafe\\;Wi\\:Fi;P:a\\;b\\:c\\\\d;H:false;;",
    );
    const svg = await downloaded(() => page.locator("#qr-svg").click());
    assert(svg.bytes.toString().includes("<svg"));
    page.once("dialog", (d) => d.accept("Only appearance"));
    await page.locator("#save-qr-preset").click();
    await page.waitForFunction(() =>
      JSON.parse(localStorage.getItem("kensei-workshop:v1:guest")).items.some(
        (x) => x.data.name === "Only appearance",
      ),
    );
    const preset = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("kensei-workshop:v1:guest")).items.find(
          (x) => x.data.name === "Only appearance",
        ).data,
    );
    assert.deepEqual(Object.keys(preset).sort(), [
      "dark",
      "light",
      "name",
      "size",
      "tool",
    ]);
    pass(
      "PNG QR decoding, escaped Wi-Fi payload, SVG and appearance-only preset",
    );
    await go("markdown-studio");
    await page.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.startsWith("Ready"),
    );
    await page
      .locator("#markdown-input")
      .fill(
        "# Hello\n\n| A | B |\n|---|---|\n|1|2|\n\n```js\nalert(1)\n```\n\n<script>window.evil=1</script>\n\n![remote](https://example.invalid/pixel.png)",
      );
    await page.waitForFunction(
      () =>
        document.querySelector("#markdown-preview h1")?.textContent === "Hello",
    );
    assert.equal(await page.locator("#markdown-preview table").count(), 1);
    assert.equal(
      await page
        .locator("#markdown-preview script,#markdown-preview img")
        .count(),
      0,
    );
    await page.locator("#draft-name").fill("Markdown draft");
    await page.locator("#save-draft").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#draft-state").textContent ===
        "Saved to your workspace.",
    );
    const html = await downloaded(() => page.locator("#markdown-html").click());
    assert(html.bytes.toString().includes("&lt;script&gt;"));
    const md = await downloaded(() => page.locator("#markdown-md").click());
    assert(md.bytes.toString().startsWith("# Hello"));
    await page.goto(base + "/workspace/");
    await page.locator('#saved-drafts a[href*="markdown-studio"]').click();
    await page.locator('[data-ready="true"]').waitFor();
    assert(
      (await page.locator("#markdown-input").inputValue()).startsWith(
        "# Hello",
      ),
    );
    pass(
      "Markdown table/code preview, safe HTML, blocked images, exports and typed draft reopen",
    );
    await page.evaluate(() => {
      document.querySelector("#markdown-input").value = "";
    });
    await go("text-compare");
    await page.locator("#compare-left").fill("Hello\n你好\n<script>x</script>");
    await page
      .locator("#compare-right")
      .fill("Hello\n您好\n<script>x</script>");
    await page.locator("#compare-mode").selectOption("characters");
    await page.locator("#compare-run").click();
    await page.waitForFunction(
      () => !document.querySelector("#compare-download").disabled,
    );
    assert(
      (await page.locator(".diff-removed").allTextContents())
        .join("")
        .includes("你"),
    );
    assert.equal(await page.locator("#compare-output script").count(), 0);
    const diff = await downloaded(() =>
      page.locator("#compare-download").click(),
    );
    assert(diff.bytes.toString().includes("--- original.txt"));
    await page.locator("#compare-left").fill("Hello   World");
    await page.locator("#compare-right").fill("hello world");
    await page.locator("#compare-case").check();
    await page.locator("#compare-space").check();
    await page.locator("#compare-run").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.includes("No differences"),
    );
    pass(
      "Unicode character diff, safe rendering, normalization and patch export",
    );
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 3; i++) {
      const p = pdf.addPage([300 + i * 10, 400]);
      p.drawText("Page " + (i + 1), {
        x: 30,
        y: 340,
        size: 30,
        color: rgb(i / 3, 0, 0.3),
      });
    }
    const pdfBytes = Buffer.from(await pdf.save());
    await go("pdf-toolkit");
    await page.locator("#pdf-files").setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes,
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.startsWith("Files ready"),
    );
    assert.equal(await page.locator(".pdf-page-row").count(), 3);
    assert(await page.locator("#pdf-preview").isVisible());
    await page.locator('[data-direction="-1"]').nth(1).click();
    await page.locator("[data-rotate]").first().click();
    await page.locator("#pdf-ranges").fill("1-2");
    let d = await downloaded(() => page.locator("#pdf-run").click());
    let doc = await PDFDocument.load(d.bytes);
    assert.equal(doc.getPageCount(), 2);
    assert.equal(doc.getPage(0).getWidth(), 310);
    assert.equal(doc.getPage(0).getRotation().angle, 90);
    await page.locator("#pdf-operation").selectOption("split");
    await page.locator("#pdf-files").setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes,
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.startsWith("Files ready"),
    );
    await page.locator("#pdf-ranges").fill("1-2;3");
    d = await downloaded(() => page.locator("#pdf-run").click());
    const split = unzipSync(d.bytes);
    assert.equal(Object.keys(split).length, 2);
    assert.equal(
      (await PDFDocument.load(Object.values(split)[0])).getPageCount(),
      2,
    );
    await page.locator("#pdf-operation").selectOption("export");
    await page.locator("#pdf-files").setInputFiles({
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes,
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.startsWith("Files ready"),
    );
    await page.locator("#pdf-ranges").fill("1");
    d = await downloaded(() => page.locator("#pdf-run").click());
    assert(d.name.endsWith(".png"));
    assert.deepEqual([...d.bytes.subarray(0, 4)], [137, 80, 78, 71]);
    await page.locator("#pdf-operation").selectOption("images");
    await page.locator("#pdf-files").setInputFiles([
      { name: "image.png", mimeType: "image/png", buffer: fixture },
      { name: "other.png", mimeType: "image/png", buffer: fixture },
    ]);
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.startsWith("Files ready"),
    );
    d = await downloaded(() => page.locator("#pdf-run").click());
    assert.equal((await PDFDocument.load(d.bytes)).getPageCount(), 2);
    pass(
      "Real PDF preview, page reorder/rotation/extraction, split ZIP, PNG and images-to-PDF",
    );
    await go("image-to-text");
    for (const [lang, text, font, expected] of [
      ["eng", "KenSei Workshop 123", "Arial", /Workshop\s*123/i],
      ["chi_sim", "这是中文文字识别测试", "Microsoft YaHei", /中文/],
      ["chi_tra", "這是繁體中文測試", "Microsoft JhengHei", /中文/],
      ["msa", "Selamat pagi dunia Malaysia", "Arial", /Selamat pagi/i],
    ]) {
      const buffer = await png(text, font);
      await page
        .locator("#ocr-file")
        .setInputFiles({ name: lang + ".png", mimeType: "image/png", buffer });
      await page.waitForFunction(() =>
        document
          .querySelector("#tool-status")
          .textContent.startsWith("Image ready"),
      );
      for (const choice of ["eng", "chi_sim", "chi_tra", "msa"])
        await page
          .locator(`[name="ocr-language"][value="${choice}"]`)
          .setChecked(choice === lang);
      await page.locator("#ocr-run").click();
      await page.waitForFunction(
        () =>
          /Text extracted|Recognition failed|No text found/.test(
            document.querySelector("#tool-status").textContent,
          ),
        {},
        { timeout: 120000 },
      );
      assert.match(
        await page.locator("#ocr-output").inputValue(),
        expected,
        lang + ": " + (await page.locator("#tool-status").textContent()),
      );
      console.log("OCR " + lang + " passed");
    }
    await page.locator("#draft-name").fill("OCR draft");
    await page.locator("#save-draft").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#draft-state").textContent ===
        "Saved to your workspace.",
    );
    d = await downloaded(() => page.locator("#ocr-download").click());
    assert.match(d.bytes.toString(), /Selamat/);
    await page.goto(base + "/workspace/");
    await page.locator('#saved-drafts a[href*="image-to-text"]').click();
    await page.locator('[data-ready="true"]').waitFor();
    assert.match(await page.locator("#ocr-output").inputValue(), /Selamat/);
    pass(
      "Actual four-language local WASM OCR, text download and typed draft reopen",
    );
    await page.evaluate(
      () => (document.querySelector("#ocr-output").value = ""),
    );
    await go("image-to-text");
    await page.locator("#ocr-file").setInputFiles({
      name: "cancel.png",
      mimeType: "image/png",
      buffer: fixture,
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.startsWith("Image ready"),
    );
    await page.locator("#ocr-run").click();
    await page.locator("#cancel-job").click();
    await page.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("cancelled"),
    );
    assert(await page.locator("#ocr-run").isEnabled());
    pass("OCR cancellation releases controls for retry");
    const retryContext = await browser.newContext();
    await retryContext.route("**/config.js", (r) =>
      r.fulfill({ body: "window.KENSEI_CONFIG={};" }),
    );
    await retryContext.route("**/vendor/tesseract/lang/**", (r) =>
      r.fulfill({ status: 503, body: "Temporary model download failure" }),
    );
    const retry = await retryContext.newPage();
    retry.on("pageerror", (e) => errors.push(e.message));
    await retry.goto(base + "/tools/image-to-text/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await retry.locator('[data-ready="true"]').waitFor();
    await retry.locator("#ocr-file").setInputFiles({
      name: "retry.png",
      mimeType: "image/png",
      buffer: fixture,
    });
    await retry.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.startsWith("Image ready"),
    );
    await retry.locator("#ocr-output").fill("Keep this text on failure");
    await retry.locator("#ocr-run").click();
    await retry.waitForFunction(
      () =>
        document
          .querySelector("#tool-status")
          .textContent.startsWith("Recognition failed"),
      {},
      { timeout: 60000 },
    );
    assert.equal(
      await retry.locator("#ocr-output").inputValue(),
      "Keep this text on failure",
    );
    assert(await retry.locator("#ocr-run").isEnabled());
    await retryContext.unroute("**/vendor/tesseract/lang/**");
    await retry.locator("#ocr-run").click();
    await retry.waitForFunction(
      () =>
        document
          .querySelector("#tool-status")
          .textContent.startsWith("Text extracted"),
      {},
      { timeout: 60000 },
    );
    assert.match(await retry.locator("#ocr-output").inputValue(), /Workshop/);
    await retryContext.close();
    pass(
      "Actual OCR model-download failure preserves text and a retry succeeds",
    );
    assert.deepEqual(uploads, []);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    pass(
      "No file uploads, no third-party tool requests and no browser exceptions",
    );
    fs.writeFileSync(
      "_qa/tools-results.json",
      JSON.stringify({ base, checks, errors, uploads, external }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
