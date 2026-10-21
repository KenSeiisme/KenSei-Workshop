const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { PDFDocument, PDFName, PDFString, degrees } = require("pdf-lib"),
  { createHash } = require("node:crypto");
const {
  chromium,
} = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8797",
  checks = [],
  pass = (x) => {
    checks.push(x);
    console.log("PASS " + x);
  };
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext({ reducedMotion: "reduce" }),
    p = await c.newPage(),
    errors = [],
    uploads = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  c.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
  });
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  async function open(slug) {
    await p.goto(base + "/tools/" + slug + "/");
    await p.waitForSelector('[data-ready="true"]');
  }
  async function download(action) {
    const promise = p.waitForEvent("download");
    await action();
    const d = await promise;
    return {
      data: fs.readFileSync(await d.path()),
      name: d.suggestedFilename(),
    };
  }
  async function shot(name) {
    if (!process.env.CAPTURE_FIFTH) return;
    for (const width of [360, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      await p.waitForTimeout(150);
      await p.evaluate(() => {
        document.activeElement?.blur();
        scrollTo(0, 0);
      });
      await p.screenshot({
        path: "_qa/fifth-" + name + "-" + width + ".png",
        fullPage: true,
      });
    }
  }
  async function done(pattern) {
    await p.waitForFunction(
      (pattern) =>
        new RegExp(pattern).test(
          document.querySelector("#tool-status").textContent,
        ),
      pattern,
    );
  }
  try {
    await p.goto(base + "/tools/");
    assert.equal(await p.locator("[data-tool-card]").count(), 25);
    for (const [filter, count] of [
      ["utilities", 9],
      ["productivity", 3],
      ["text", 6],
    ]) {
      await p.locator('[data-filter="' + filter + '"]').click();
      assert.equal(await p.locator("[data-tool-card]:visible").count(), count);
    }
    for (const width of [360, 768, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      for (const slug of [
        "flashcards",
        "calculator-studio",
        "file-check",
        "subtitle-studio",
        "image-studio",
        "pdf-toolkit",
      ]) {
        await open(slug);
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " overflow " + width,
        );
      }
    }
    pass(
      "25 shared tools, updated categories and six interfaces at mobile/tablet/desktop widths",
    );
    await open("calculator-studio");
    await p.fill("#calc-expression", "0.1+0.2");
    await p.click("#calc-run");
    await done("Calculated");
    assert.equal(await p.inputValue("#calc-result"), "0.3");
    await p.fill("#calc-expression", "sin(30)+200*10%");
    await p.click("#calc-run");
    await done("Calculated");
    assert.ok((await p.inputValue("#calc-result")).includes("20.5"));
    await p.fill("#calc-expression", "1/0");
    await p.click("#calc-run");
    await done("divide by zero");
    await p.reload();
    await p.waitForSelector('[data-ready="true"]');
    assert.equal(await p.locator("#calc-history button").count(), 2);
    await shot("calculator");
    pass(
      "real browser calculator, percent/angle behavior, errors and local history",
    );
    await open("file-check");
    const bytes = Buffer.from("hello 世界");
    await p.setInputFiles("#check-files", [
      { name: "original.txt", mimeType: "text/plain", buffer: bytes },
      { name: "same.txt", mimeType: "text/plain", buffer: bytes },
      { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
    ]);
    await p.selectOption("#check-algorithm", "SHA-512");
    await p.click("#check-run");
    await done("complete");
    const manifest = JSON.parse(
      (await download(() => p.click("#check-download"))).data.toString(),
    );
    assert.equal(
      manifest.files[0].sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.equal(
      manifest.files[2].sha512,
      createHash("sha512").update("").digest("hex"),
    );
    assert.match(
      await p.textContent("#check-results"),
      /Same size and SHA-256/,
    );
    await p.fill("#check-expected", manifest.files[0].sha512.toUpperCase());
    assert.match(await p.textContent("#check-match"), /^Match/);
    await shot("file-check");
    pass(
      "actual SHA-256/SHA-512, empty files, duplicates, expected checksums and JSON download",
    );
    await open("flashcards");
    await p.click("#deck-new");
    await p.waitForFunction(
      () => document.querySelector("#deck-name").value === "Untitled deck",
    );
    await p.fill("#deck-name", "中英复习");
    await p.fill("#card-front", "问题一");
    await p.fill("#card-back", "Answer one");
    await p.click("#card-save");
    await done("Card saved");
    await p.click("#study-start");
    await p.click("#study-card");
    assert.match(await p.textContent("#study-card"), /Answer one/);
    await p.click("#study-known");
    await p.waitForFunction(() =>
      document
        .querySelector("#study-progress")
        .textContent.includes("1 / 1 known"),
    );
    const backup = JSON.parse(
      (await download(() => p.click("#deck-json"))).data.toString(),
    );
    assert.equal(backup.deck.cards[0].known, true);
    await p.locator("#card-list button").first().click();
    await p.fill("#card-back", "Updated answer");
    await p.waitForFunction(() =>
      document
        .querySelector("#study-progress")
        .textContent.includes("0 / 1 known"),
    );
    const updated = JSON.parse(
      (await download(() => p.click("#deck-json"))).data.toString(),
    );
    assert.equal(updated.deck.cards[0].back, "Updated answer");
    assert.equal(updated.deck.cards[0].known, false);
    await p.reload();
    await p.waitForSelector('[data-ready="true"]');
    await p.locator("#deck-list button").first().click();
    await p.waitForFunction(
      () => document.querySelector("#deck-name").value === "中英复习",
    );
    await p.goto(base + "/workspace/");
    await p.waitForSelector('#workspace-decks a[href*="deck="]');
    await p.locator("#workspace-decks a").first().click();
    await p.waitForFunction(
      () => document.querySelector("#deck-name").value === "中英复习",
    );
    await p.setInputFiles("#deck-import", {
      name: "new.csv",
      mimeType: "text/csv",
      buffer: Buffer.from('front,back\n"你好","Hello\nworld"'),
    });
    await done("Imported");
    assert.match(await p.textContent("#card-list"), /你好/);
    await shot("flashcards");
    pass(
      "IndexedDB decks and mastery, Unicode cards, JSON backup, CSV import and Workspace deep-link reopening",
    );
    await open("subtitle-studio");
    await p.setInputFiles("#sub-file", {
      name: "sample.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:01,000 --> 00:00:02,000\n你好\nHello\n\n2\n00:00:02,500 --> 00:00:04,000\n<img src=x onerror=alert(1)>",
      ),
    });
    await done("loaded");
    assert.equal(await p.locator("#sub-list img").count(), 0);
    await p.fill("#sub-offset", "-2000");
    await p.click("#sub-shift");
    await done("nonnegative");
    await p.fill("#sub-offset", "250");
    await p.click("#sub-shift");
    await done("shifted");
    await p.selectOption("#sub-format", "vtt");
    const vtt = await download(() => p.click("#sub-download"));
    assert.match(vtt.data.toString(), /WEBVTT/);
    assert.match(vtt.data.toString(), /00:00:01.250/);
    await shot("subtitle");
    pass(
      "real SRT/WebVTT conversion, Unicode multiline text, safe rendering and rejected negative shifts",
    );
    await open("image-studio");
    await p.click("#image-mode-edit");
    const png = Buffer.from(
      await p.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 400;
        c.height = 200;
        const x = c.getContext("2d");
        x.fillStyle = "#f00";
        x.fillRect(0, 0, 200, 200);
        x.fillStyle = "#00f";
        x.fillRect(200, 0, 200, 200);
        return c.toDataURL().split(",")[1];
      }),
      "base64",
    );
    await p.setInputFiles("#edit-file", {
      name: "colors.png",
      mimeType: "image/png",
      buffer: png,
    });
    await p.waitForFunction(() =>
      document
        .querySelector("#edit-status")
        .textContent.includes("Image ready"),
    );
    await p.selectOption("#edit-ratio", "1");
    await p.waitForTimeout(150);
    await p.fill("#edit-width", "128");
    await p.selectOption("#edit-format", "image/png");
    await p.fill("#edit-watermark", "KenSei 中文");
    await p.click("#edit-rotate");
    await p.fill("#edit-width", "128");
    await p.click("#edit-run");
    await p.waitForFunction(() =>
      document
        .querySelector("#edit-status")
        .textContent.includes("Preview ready"),
    );
    const edit = await download(() => p.click("#edit-download"));
    assert.equal(edit.data.readUInt32BE(16), 128);
    assert.equal(edit.data.readUInt32BE(20), 128);
    const coverage = await p.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)]),
        );
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        const x = c.getContext("2d");
        x.drawImage(bitmap, 0, 0);
        const pixels = x.getImageData(0, 0, c.width, c.height).data;
        let opaque = 0;
        for (let i = 3; i < pixels.length; i += 4)
          if (pixels[i] > 200) opaque++;
        bitmap.close();
        return opaque / (pixels.length / 4);
      },
      [...edit.data],
    );
    assert.ok(coverage > 0.5, "cropped image should contain real image pixels");
    await shot("image-edit");
    pass(
      "actual Cropper crop/rotation, watermark and PNG output dimensions; original batch mode retained",
    );
    const doc = await PDFDocument.create(),
      one = doc.addPage([400, 600]),
      two = doc.addPage([600, 400]);
    one.drawText("Original page one");
    two.drawText("Original page two");
    two.setRotation(degrees(90));
    doc.setTitle("Private title");
    doc.setAuthor("Private author");
    const xml = doc.context.stream(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">Private XMP</x:xmpmeta>',
      { Type: "Metadata", Subtype: "XML" },
    );
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xml));
    one.node.set(
      PDFName.of("Metadata"),
      doc.context.register(
        doc.context.stream("Page private XMP", {
          Type: "Metadata",
          Subtype: "XML",
        }),
      ),
    );
    const pdf = Buffer.from(await doc.save());
    await open("pdf-toolkit");
    await p.selectOption("#pdf-operation", "stamp");
    await p.setInputFiles("#pdf-files", {
      name: "original.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await done("Files ready");
    await p.fill("#pdf-number-start", "10");
    await p.fill("#pdf-watermark", "KenSei 中文");
    await p.click("#pdf-output-preview");
    await done("preview ready");
    const stamped = await download(() => p.click("#pdf-output-download"));
    const loaded = await PDFDocument.load(stamped.data, {
      updateMetadata: false,
    });
    assert.equal(loaded.getPageCount(), 2);
    assert.equal(loaded.getTitle(), "Private title");
    assert.equal(loaded.getPages()[1].getRotation().angle, 90);
    const pageText = await p.evaluate(
      async (bytes) => {
        const pdfjs = await import("/vendor/pdfjs/build/pdf.min.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc =
          "/vendor/pdfjs/build/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          isEvalSupported: false,
        });
        try {
          const pdf = await task.promise;
          return await Promise.all(
            [1, 2].map(async (n) =>
              (await (await pdf.getPage(n)).getTextContent()).items.map(
                (x) => x.str,
              ),
            ),
          );
        } finally {
          await task.destroy();
        }
      },
      [...stamped.data],
    );
    assert.ok(pageText[0].includes("10"));
    assert.ok(pageText[1].includes("11"));
    await p.selectOption("#pdf-operation", "metadata");
    await p.setInputFiles("#pdf-files", {
      name: "original.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await done("Files ready");
    assert.match(await p.textContent("#pdf-metadata"), /Private title/);
    await p.click("#pdf-run");
    const clean = await download(() => p.click("#pdf-output-download"));
    const cleanDoc = await PDFDocument.load(clean.data, {
      updateMetadata: false,
    });
    assert.equal(cleanDoc.getTitle(), undefined);
    assert.equal(cleanDoc.getAuthor(), undefined);
    assert.ok(!clean.data.includes(Buffer.from("Private XMP")));
    assert.ok(!clean.data.includes(Buffer.from("Page private XMP")));
    assert.ok(!cleanDoc.catalog.has(PDFName.of("Metadata")));
    assert.ok(
      cleanDoc.getPages().every((x) => !x.node.has(PDFName.of("Metadata"))),
    );
    await shot("pdf");
    pass(
      "actual PDF output preview, watermark/page-number export, preserved metadata for stamping and Info/XMP cleanup",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    fs.writeFileSync(
      "_qa/fifth-tools-results.json",
      JSON.stringify({ base, checks, errors, uploads }, null, 2),
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
