const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { PDFDocument, StandardFonts } = require("pdf-lib");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    }),
    p = await c.newPage(),
    errors = [],
    uploads = [];
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  c.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
  });
  c.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.accept());
  });
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  async function open(tool) {
    await p.goto(base + "/tools/" + tool + "/");
    await p.waitForSelector('[data-ready="true"]');
  }
  async function dl(fn) {
    const wait = p.waitForEvent("download");
    await fn();
    const d = await wait;
    return fs.readFileSync(await d.path());
  }
  try {
    await open("image-studio");
    const png = Buffer.from(
      await p.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 320;
        c.height = 200;
        const x = c.getContext("2d");
        x.fillStyle = "#d6b6ec";
        x.fillRect(0, 0, 320, 200);
        x.fillStyle = "#302030";
        x.font = "40px sans-serif";
        x.fillText("KenSei 123", 15, 100);
        return c.toDataURL().split(",")[1];
      }),
      "base64",
    );
    await p.setInputFiles("#image-file", {
      name: "picture.png",
      mimeType: "image/png",
      buffer: png,
    });
    await p.fill("#image-target-kib", "20");
    await p.click("#image-process");
    await p.waitForFunction(() =>
      document.querySelector("#image-result").textContent.includes("1 of 1"),
    );
    assert.equal(await p.locator(".compare-images img").count(), 2);
    console.log("PASS target compression and original/output comparison");
    const incoming = c.waitForEvent("page");
    await p
      .locator("#image-send button")
      .filter({ hasText: "Image to Text" })
      .click();
    const ocr = await incoming;
    await ocr.waitForSelector('[data-ready="true"]');
    await ocr.waitForFunction(() =>
      document.querySelector("#ocr-file-info").textContent.includes("kensei"),
    );
    assert.equal(await ocr.locator("#ocr-output").inputValue(), "");
    assert(!ocr.url().includes("#handoff"));
    assert(await ocr.evaluate(() => window.KenseiTemporaryHandoff));
    await ocr.waitForTimeout(700);
    const recovery = await ocr.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("kensei-tool-recovery-v1", 1);
          r.onsuccess = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains("snapshots")) return resolve([]);
            const tx = db.transaction("snapshots");
            const q = tx.objectStore("snapshots").getAll();
            q.onsuccess = () => {
              resolve(q.result);
              db.close();
            };
          };
        }),
    );
    assert.equal(recovery.length, 0);

    console.log(
      "PASS native File transfer in a new tab, source retained, no automatic recognition",
    );
    await ocr.close();
    await open("data-studio");
    await p.fill("#data-csv", "id,name\n001,A\n002,B\n001,A");
    await p.click("#data-csv-preview");
    await p.waitForSelector("#data-table td input");
    assert.equal(
      await p.locator("#data-table td input").first().inputValue(),
      "001",
    );
    await p.locator("#data-table td input").nth(1).fill("Edited");
    await p.locator("#data-table td input").nth(1).dispatchEvent("change");
    assert((await p.inputValue("#data-csv")).includes("Edited"));
    const out = await dl(() =>
      p
        .getByRole("button", { name: "Download current view CSV", exact: true })
        .click(),
    );
    assert(out.toString().includes("001"));
    console.log("PASS editable CSV and export preserve leading zeros");
    await p.fill("#data-json", '{"a/b":{"x":1}}');
    await p
      .getByRole("button", { name: "Build JSON tree", exact: true })
      .click();
    assert(
      (await p.locator(".advanced-list").last().textContent()).includes("/"),
    );
    await open("text-compare");
    await p.fill("#compare-left", "One old sentence.");
    await p.fill("#compare-right", "One new sentence.");
    await p.selectOption("#compare-mode", "words");
    await p.click("#compare-run");
    await p.waitForSelector(".compare-columns .diff-added");
    assert((await p.locator(".compare-columns").textContent()).includes("new"));
    await p
      .getByRole("button", { name: "Next difference", exact: true })
      .click();
    console.log("PASS word diff, aligned rendering and difference navigation");
    const doc = await PDFDocument.create();
    for (const label of ["Alpha", "Beta", "Gamma"]) {
      const page = doc.addPage([300, 300]);
      page.drawText(label, { x: 30, y: 200, size: 20 });
    }
    const bytes = Buffer.from(await doc.save());
    await open("pdf-toolkit");
    await p.setInputFiles("#pdf-files", {
      name: "three.pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
    await p.waitForSelector(".pdf-page-row");
    await p
      .getByRole("button", { name: "Extract selected-page text", exact: true })
      .click();
    await p.waitForFunction(() =>
      document.querySelector("#pdf-extracted-text").value.includes("Gamma"),
    );
    assert((await p.inputValue("#pdf-extracted-text")).includes("Alpha"));
    await p.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("kensei-tool-recovery-v1", 1);
          r.onupgradeneeded = () => {
            r.result.createObjectStore("preferences");
            r.result.createObjectStore("snapshots", { keyPath: "id" });
          };
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction("preferences", "readwrite");
            tx.objectStore("preferences").put(
              true,
              JSON.stringify(["guest", "text-toolkit"]),
            );
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    const receivingText = c.waitForEvent("page");
    await p
      .locator(".handoff-controls button")
      .filter({ hasText: "Text Toolkit" })
      .click();
    const textPage = await receivingText;
    await textPage.waitForFunction(() =>
      document.querySelector("#text-input")?.value.includes("Gamma"),
    );
    await textPage.waitForTimeout(800);
    const snapshots = await textPage.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("kensei-tool-recovery-v1", 1);
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction("snapshots").objectStore("snapshots").getAll();
            q.onsuccess = () => {
              resolve(q.result.filter((x) => x.tool === "text-toolkit"));
              db.close();
            };
          };
        }),
    );
    assert.equal(snapshots.length, 0);
    await textPage.close();
    console.log(
      "PASS text transfer suppresses an already enabled recovery preference",
    );
    await p
      .getByRole("button", {
        name: "Prepare selected-page images",
        exact: true,
      })
      .click();
    await p.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.includes("Page images ready"),
    );
    assert((await p.locator(".pdf-thumb").count()) === 3);
    console.log(
      "PASS native PDF text, page thumbnails and transfer-ready page images",
    );
    await open("file-renamer");
    await p.setInputFiles("#rename-files", [
      { name: "First.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
      { name: "Second.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
    ]);
    const controls = p.locator(".advanced-panel");
    await controls.getByRole("combobox").selectOption("template");
    await controls.locator("input").last().fill("{original}_{n:03}");
    await controls
      .getByRole("button", { name: "Add rule", exact: true })
      .click();
    assert(
      (await p.locator("#rename-preview input").first().inputValue()).includes(
        "001",
      ),
    );
    const map = await dl(() =>
      controls
        .getByRole("button", { name: "Download name mapping CSV", exact: true })
        .click(),
    );
    assert(map.toString().includes("First"));
    console.log("PASS ordered filename templates and mapping export");
    for (const slug of [
      "image-studio",
      "pdf-toolkit",
      "image-to-text",
      "zip-studio",
      "file-renamer",
      "file-check",
      "data-studio",
      "text-compare",
    ]) {
      await open(slug);
      for (const width of [320, 360, 768, 1440]) {
        await p.setViewportSize({ width, height: 900 });
        await p.waitForTimeout(100);
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " overflow " + width,
        );
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    console.log(
      "PASS eight advanced pages fit 320–1440px without exceptions or uploads",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
