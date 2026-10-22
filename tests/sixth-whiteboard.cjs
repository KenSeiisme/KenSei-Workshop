const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  {
    chromium,
  } = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8798";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true }),
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  context.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method() }),
  );
  await context.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  async function download(click) {
    const event = page.waitForEvent("download", { timeout: 30000 });
    await click();
    const d = await event;
    return {
      buffer: fs.readFileSync(await d.path()),
      name: d.suggestedFilename(),
    };
  }
  try {
    await page.goto(base + "/tools/whiteboard/");
    await page.waitForSelector('[data-ready="true"]');
    await page.click("#board-new");
    await page.waitForSelector("#board-canvas canvas");
    await page.fill("#board-name", "课程 Whiteboard");
    await page.waitForTimeout(800);
    const canvas = page.locator("#board-canvas canvas").last();
    await canvas.scrollIntoViewIfNeeded();
    await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
    let box = await canvas.boundingBox();
    await page.mouse.move(box.x + 350, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 550, box.y + 290, { steps: 10 });
    await page.mouse.up();
    await page.locator('label:has([data-testid="toolbar-text"])').click();
    await page.mouse.click(box.x + 680, box.y + 210);
    await page.keyboard.insertText("你好 KenSei");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    const editable = await download(() => page.click("#board-json")),
      scene = JSON.parse(editable.buffer);
    assert.equal(scene.name, "课程 Whiteboard");
    fs.mkdirSync("_qa/sixth-release", { recursive: true });
    fs.writeFileSync(
      "_qa/sixth-release/whiteboard-scene-debug.json",
      JSON.stringify(scene, null, 2),
    );
    await page.screenshot({
      path: "_qa/sixth-release/whiteboard-debug.png",
      fullPage: true,
    });
    assert(
      scene.elements.some((el) => el.type === "rectangle" && !el.isDeleted),
    );
    assert(
      scene.elements.some(
        (el) => el.type === "text" && el.text.includes("你好"),
      ),
    );
    assert.equal(scene.elements.filter((el) => !el.isDeleted).length, 2);
    const png = await download(() => page.click("#board-png"));
    assert.equal(png.buffer.subarray(1, 4).toString(), "PNG");
    assert(png.buffer.length > 1000);
    const svg = await download(() => page.click("#board-svg"));
    assert(svg.buffer.toString().includes("<svg"));
    assert(svg.buffer.toString().includes("你好"));
    await page.reload();
    await page.waitForSelector('[data-ready="true"]');
    await page.waitForFunction(
      () => document.querySelector("#board-name")?.value === "课程 Whiteboard",
    );
    const restored = JSON.parse(
      (await download(() => page.click("#board-json"))).buffer,
    );
    assert.equal(restored.elements.filter((el) => !el.isDeleted).length, 2);
    const before = await page.locator("#board-select option").count();
    await page.setInputFiles("#board-import", {
      name: "image.excalidraw",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          ...scene,
          elements: [{ ...scene.elements[0], type: "image" }],
          files: { image: { dataURL: "data:image/png;base64,AA==" } },
        }),
      ),
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.includes("Import failed"),
    );
    assert.equal(await page.locator("#board-select option").count(), before);
    await page.setInputFiles("#board-import", {
      name: "linked.excalidraw",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          ...scene,
          elements: [{ ...scene.elements[0], link: "https://example.com" }],
        }),
      ),
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.includes("Linked elements"),
    );
    await page.locator("#board-canvas").evaluate((n) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["fake"], "test.png", { type: "image/png" }));
      n.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert(
      (await page.locator("#tool-status").innerText()).includes(
        "drops are not supported",
      ),
    );
    fs.mkdirSync("_qa/sixth-release", { recursive: true });
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(200);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "horizontal overflow at " + width,
      );
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: "_qa/sixth-release/whiteboard-" + width + ".png",
        fullPage: true,
      });
    }
    fs.writeFileSync(
      "_qa/sixth-release/whiteboard-requests.json",
      JSON.stringify(requests, null, 2),
    );
    assert.deepEqual(errors, []);
    assert.equal(
      requests.filter((r) => ["POST", "PUT", "PATCH"].includes(r.method))
        .length,
      0,
    );
    assert.equal(
      requests.filter(
        (r) =>
          /^https?:/.test(r.url) &&
          !r.url.startsWith(base) &&
          !/^https:\/\/(?:fonts.googleapis.com|fonts.gstatic.com)\//.test(
            r.url,
          ),
      ).length,
      0,
    );
    console.log(
      "PASS whiteboard actual drawing, Chinese text, PNG/SVG/editable downloads, IndexedDB reload, unsupported imports/drop, 360/768/1440 layout, local assets only",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
