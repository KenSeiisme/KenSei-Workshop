const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { PDFDocument, degrees } = require("pdf-lib"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await c.newPage(),
    errors = [],
    uploads = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await c.route("**/config.js", (r) =>
    r.fulfill({
      body: "window.KENSEI_CONFIG={};",
      contentType: "application/javascript",
    }),
  );
  c.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
  });
  async function open(slug, lang = "") {
    await p.goto(base + lang + "/tools/" + slug + "/");
    await p.waitForSelector("[data-ready=true]");
  }
  async function dl(fn) {
    const w = p.waitForEvent("download", { timeout: 120000 });
    await fn();
    return fs.readFileSync(await (await w).path());
  }
  try {
    await open("image-studio");
    const png = Buffer.from(
      await p.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 320;
        c.height = 200;
        const x = c.getContext("2d");
        x.fillStyle = "red";
        x.fillRect(0, 0, 160, 200);
        x.fillStyle = "blue";
        x.fillRect(160, 0, 160, 200);
        return c.toDataURL().split(",")[1];
      }),
      "base64",
    );
    await p.setInputFiles("#image-file", [
      { name: "before.png", mimeType: "image/png", buffer: png },
      { name: "second.png", mimeType: "image/png", buffer: png },
    ]);
    await p.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label="Image settings scope"] option')
          .length === 3,
    );
    await p.getByLabel("Enable centered crop", { exact: true }).check();
    await p.fill("#image-width", "120");
    await p.click("#image-process");
    await p.waitForFunction(
      () =>
        document.querySelectorAll("#batch-results a[download]").length === 2,
    );
    const dimensions = await p.evaluate(async () => {
      const a = [...document.querySelectorAll("#batch-results a[download]")];
      return Promise.all(
        a.map(async (n) => {
          const i = new Image();
          i.src = n.href;
          await i.decode();
          return [i.width, i.height];
        }),
      );
    });
    console.log(await p.locator("#batch-results").textContent());
    assert.deepEqual(dimensions, [
      [120, 120],
      [120, 120],
    ]);
    const out = await dl(() => p.locator("#image-download").click());
    assert(out.length > 0);
    await p.locator(".studio-recipes summary").click();
    const recipe = JSON.parse(
      (
        await dl(() =>
          p
            .getByRole("button", { name: "Export recipe JSON", exact: true })
            .click(),
        )
      ).toString(),
    );
    assert.equal(recipe.recipe.settings.crop, true);
    assert(!JSON.stringify(recipe).includes("before.png"));
    console.log("PASS batch pipeline dimensions and settings-only recipe");
    await p.evaluate(() => {
      window.restoreImageEncoder = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function () {
        throw Error("Simulated export failure");
      };
    });
    await p.fill("#image-width", "121");
    await p.click("#image-process");
    await p.waitForFunction(() =>
      document
        .querySelector("#image-result")
        .textContent.includes("Processing failed"),
    );
    assert.equal(await p.locator("#image-previous-results button").count(), 2);
    await p.locator("#image-previous-results summary").click();
    const previous = await dl(() =>
      p.locator("#image-previous-results button").first().click(),
    );
    assert.deepEqual(previous, out);
    await p.evaluate(
      () => (HTMLCanvasElement.prototype.toBlob = window.restoreImageEncoder),
    );
    console.log(
      "PASS failed reprocessing retains explicitly labeled previous downloads",
    );

    const doc = await PDFDocument.create(),
      page = doc.addPage([500, 700]);
    page.setRotation(degrees(90));
    const form = doc.getForm();
    form
      .createTextField("Name")
      .addToPage(page, { x: 20, y: 500, width: 300, height: 35 });
    form
      .createCheckBox("Consent")
      .addToPage(page, { x: 20, y: 450, width: 20, height: 20 });
    const r = form.createRadioGroup("Choice");
    r.addOptionToPage("One", page, { x: 60, y: 450, width: 20, height: 20 });
    r.addOptionToPage("Two", page, { x: 90, y: 450, width: 20, height: 20 });
    const d = form.createDropdown("List");
    d.addOptions(["A", "B"]);
    d.addToPage(page, { x: 20, y: 400, width: 100, height: 30 });
    const source = Buffer.from(await doc.save());
    await open("pdf-toolkit");
    await p.getByRole("tab", { name: "Fill & Annotate", exact: true }).click();
    await p.setInputFiles("#pdf-fill-file", {
      name: "form.pdf",
      mimeType: "application/pdf",
      buffer: source,
    });
    await p.waitForFunction(() =>
      document.querySelector(".pdf-form-fields textarea"),
    );
    await p.getByLabel("Name", { exact: true }).fill("中文填寫 Malay Buku");
    await p.getByLabel("Consent", { exact: true }).check();
    await p.getByLabel("Choice", { exact: true }).selectOption("Two");
    await p.getByLabel("List", { exact: true }).selectOption("B");
    await p.getByLabel("Annotation text", { exact: true }).fill("測試批注");
    await p
      .getByRole("button", { name: "Add annotation", exact: true })
      .click();
    await p.waitForSelector(".pdf-annotation.text");
    const result = await dl(() =>
      p
        .getByRole("button", { name: "Export annotated PDF", exact: true })
        .click(),
    );
    const pdf = await PDFDocument.load(result);
    assert.equal(
      pdf.getForm().getTextField("Name").getText(),
      "中文填寫 Malay Buku",
    );
    assert(pdf.getForm().getCheckBox("Consent").isChecked());
    assert.equal(pdf.getForm().getRadioGroup("Choice").getSelected(), "Two");
    assert.deepEqual(pdf.getForm().getDropdown("List").getSelected(), ["B"]);
    assert.equal(pdf.getPage(0).getRotation().angle, 90);
    await p
      .getByLabel("Flatten form fields on export", { exact: true })
      .check();
    const flat = await PDFDocument.load(
      await dl(() =>
        p
          .getByRole("button", { name: "Export annotated PDF", exact: true })
          .click(),
      ),
    );
    assert.equal(flat.getForm().getFields().length, 0);
    console.log(
      "PASS Chinese forms, radio/dropdown, rotated annotation and flatten exports",
    );
    const plain = await PDFDocument.create();
    plain.addPage([500, 700]).setRotation(degrees(90));
    await p.setInputFiles("#pdf-fill-file", {
      name: "signature.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await plain.save()),
    });
    await p.waitForFunction(() =>
      document
        .querySelector(".pdf-form-fields")
        .textContent.includes("No editable"),
    );
    await p
      .locator("#pdf-fill-workspace .studio-properties > label select")
      .selectOption("signature");
    const pad = await p.locator(".signature-pad").boundingBox();
    await p.mouse.move(pad.x + pad.width * 0.1, pad.y + pad.height * 0.2);
    await p.mouse.down();
    await p.mouse.move(pad.x + pad.width * 0.45, pad.y + pad.height * 0.75, {
      steps: 12,
    });
    await p.mouse.move(pad.x + pad.width * 0.8, pad.y + pad.height * 0.3, {
      steps: 12,
    });
    await p.mouse.up();
    await p
      .getByRole("button", { name: "Add annotation", exact: true })
      .click();
    await p.getByRole("button", { name: "Undo", exact: true }).click();
    assert.equal(await p.locator(".pdf-annotation.signature").count(), 0);
    await p.getByRole("button", { name: "Redo", exact: true }).click();
    assert.equal(await p.locator(".pdf-annotation.signature").count(), 1);
    const signed = await dl(() =>
      p
        .getByRole("button", { name: "Export annotated PDF", exact: true })
        .click(),
    );
    await p.evaluate(() => {
      const n = document.createElement("input");
      n.type = "file";
      n.id = "verify-export-file";
      n.hidden = true;
      document.body.append(n);
    });
    await p.setInputFiles("#verify-export-file", {
      name: "signed.pdf",
      mimeType: "application/pdf",
      buffer: signed,
    });
    const bounds = await p.evaluate(async () => {
      const mod = await import("/vendor/pdfjs/build/pdf.min.mjs"),
        task = mod.getDocument({
          data: new Uint8Array(
            await document
              .querySelector("#verify-export-file")
              .files[0].arrayBuffer(),
          ),
        }),
        doc = await task.promise,
        page = await doc.getPage(1),
        v = page.getViewport({ scale: 1 }),
        c = document.createElement("canvas");
      c.width = v.width;
      c.height = v.height;
      const x = c.getContext("2d");
      await page.render({ canvasContext: x, viewport: v }).promise;
      const data = x.getImageData(0, 0, c.width, c.height).data;
      let minX = Infinity,
        minY = Infinity,
        maxX = 0,
        maxY = 0,
        count = 0;
      for (let y = 0; y < c.height; y++)
        for (let xx = 0; xx < c.width; xx++) {
          const i = (y * c.width + xx) * 4;
          if (
            data[i] > 60 &&
            data[i + 2] > data[i] * 1.1 &&
            data[i + 1] < data[i] * 0.9
          ) {
            count++;
            minX = Math.min(minX, xx);
            maxX = Math.max(maxX, xx);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      await task.destroy();
      return { minX, minY, maxX, maxY, count };
    });
    assert(bounds.count > 100);
    assert(
      bounds.minX >= 103 &&
        bounds.maxX <= 317 &&
        bounds.minY >= 98 &&
        bounds.maxY <= 182,
      JSON.stringify(bounds),
    );
    console.log(
      "PASS continuous document selection, signature undo/redo and rotated-page rendered ink coordinates",
    );

    for (const slug of ["image-studio", "pdf-toolkit"])
      for (const width of [320, 360, 768, 1440]) {
        await p.setViewportSize({ width, height: 950 });
        await open(slug, "/zh-hant");
        if (slug === "pdf-toolkit") await p.getByRole("tab").last().click();
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " " + width + " overflow",
        );
      }
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    console.log("PASS 4 widths, Traditional Chinese and no uploads");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
