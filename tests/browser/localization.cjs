const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
async function locale(page, value) {
  await page.evaluate((value) => window.KenseiI18n.setLocale(value), value);
  await page.waitForTimeout(70);
  assert.equal(await page.locator("html").getAttribute("lang"), value);
}
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const errors = [],
    writes = [];
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  context.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) writes.push(r.url());
  });
  await context.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.KENSEI_CONFIG={}",
    }),
  );
  const page = await context.newPage();
  try {
    await page.goto(base + "/tools/text-toolkit/?draft=keep#editor");
    await page.waitForSelector('[data-ready="true"]');
    const content =
      "Start game\nSaved on this device\n你好，保留我的文字 & <tag>";
    await page.fill("#text-input", content);
    await page.evaluate(() => {
      window.__editor = document.querySelector("#text-input");
      __editor.focus();
      __editor.setSelectionRange(3, 11);
    });
    await locale(page, "zh-Hant");
    assert(
      page.url().includes("/zh-hant/tools/text-toolkit/?draft=keep#editor"),
    );
    assert.equal(await page.inputValue("#text-input"), content);
    assert.deepEqual(
      await page.evaluate(() => [
        __editor === document.querySelector("#text-input"),
        __editor.selectionStart,
        __editor.selectionEnd,
      ]),
      [true, 3, 11],
    );
    assert.equal(
      await page.locator('[data-transform="upper"]').textContent(),
      "轉成大寫",
    );
    assert(
      await page
        .locator("[data-open-help]")
        .textContent()
        .then((x) => x.includes("說明")),
    );
    assert(
      await page
        .locator("#draft-name")
        .getAttribute("placeholder")
        .then((x) => !x || !x.includes("Name")),
    );
    assert.equal(await page.locator(".site-language select").count(), 1);
    await locale(page, "en");
    assert.equal(await page.inputValue("#text-input"), content);
    // A failed language fetch keeps the original URL, content and locale.
    await context.route("**/assets/locales/*.json", (r) =>
      r.fulfill({ status: 503, body: "Unavailable" }),
    );
    await page.reload();
    await page.waitForSelector('[data-ready="true"]');
    await page.fill("#text-input", content);
    await page.selectOption(".site-language select", "zh-Hant");
    await page.waitForSelector(".site-language-status:not([hidden])");
    await page.waitForFunction(() =>
      document
        .querySelector(".site-language-status")
        .textContent.includes("could not"),
    );
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.inputValue("#text-input"), content);
    await context.unroute("**/assets/locales/*.json");
    await context.route("**/assets/locales/*.json", async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await r.continue();
    });
    await page.evaluate(async () => {
      const pending = KenseiI18n.setLocale("zh-Hant");
      await KenseiI18n.setLocale("en");
      await pending;
    });
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    await context.unroute("**/assets/locales/*.json");
    console.log(
      "PASS locale: input/selection/URL preservation, retry and latest-choice wins",
    );
    await page.goto(base + "/tools/markdown-studio/");
    await page.waitForSelector('[data-ready="true"]');
    await page.fill(
      "#markdown-input",
      "# Start game\n\nSaved on this device\n\n![remote](https://example.invalid/image.png)",
    );
    await page.waitForTimeout(150);
    const preview = await page.locator("#markdown-preview").innerHTML();
    await locale(page, "zh-Hant");
    assert.equal(await page.locator("#markdown-preview").innerHTML(), preview);
    assert.equal(await page.locator("#markdown-preview img").count(), 0);
    await page.goto(base + "/tools/image-studio/");
    await page.waitForSelector('[data-ready="true"]');
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
      "base64",
    );
    await page.setInputFiles("#image-file", {
      name: "Start game.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.waitForTimeout(250);
    await page.evaluate(
      () => (window.__file = document.querySelector("#image-file").files[0]),
    );
    await locale(page, "zh-Hant");
    assert(
      await page.evaluate(
        () => __file === document.querySelector("#image-file").files[0],
      ),
    );
    assert.equal(
      await page.locator("#image-file").evaluate((n) => n.files[0].name),
      "Start game.png",
    );
    console.log("PASS opaque Markdown preview and original file identity");
    await page.goto(base + "/");
    await page.click(".site-search-button");
    await page.fill(".site-search-input", "扫雷");
    await page.waitForSelector(".site-search-result");
    assert(
      (
        await page.locator(".site-search-result").first().getAttribute("href")
      ).includes("/games/minesweeper/"),
    );
    await page.fill(".site-search-input", "二维码");
    assert(
      (
        await page.locator(".site-search-result").first().getAttribute("href")
      ).includes("/tools/qr-studio/"),
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".site-search").evaluate((n) => n.open),
      false,
    );
    assert(
      await page
        .locator(".site-search-button")
        .evaluate((n) => n === document.activeElement),
    );
    await page.setViewportSize({ width: 360, height: 800 });
    await page.click(".menu-toggle");
    assert(await page.locator(".site-drawer").evaluate((n) => n.open));
    assert(await page.locator(".site-drawer #navigation").isVisible());
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#navigation").count(), 1);
    assert.equal(await page.locator("#account-controls").count(), 1);
    console.log(
      "PASS public search aliases, modal focus return and single-node mobile navigation",
    );
    await page.goto(base + "/tools/unit-converter/");
    await page.waitForSelector('[data-ready="true"]');
    await page.selectOption("#unit-category", "Temperature");
    await page.fill("#unit-value", "100");
    const output = await page.inputValue("#unit-result");
    await locale(page, "zh-Hant");
    assert.equal(await page.inputValue("#unit-result"), output);
    assert.equal(
      await page.locator("#unit-category option:checked").textContent(),
      "溫度",
    );
    assert.equal(await page.inputValue("#unit-category"), "Temperature");
    await page.goto(base + "/tools/whiteboard/");
    await page.waitForSelector('[data-ready="true"]');
    await page.click("#board-new");
    await page.waitForSelector("#board-canvas canvas");
    await page.fill("#board-name", "Start game");
    await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
    const canvas = page.locator("#board-canvas canvas").last();
    await canvas.scrollIntoViewIfNeeded();
    let box = await canvas.boundingBox();
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 210, { steps: 6 });
    await page.mouse.up();
    await page.evaluate(
      () => (window.__canvas = document.querySelector("#board-canvas canvas")),
    );
    async function scene() {
      const event = page.waitForEvent("download");
      await page.click("#board-json");
      return JSON.parse(fs.readFileSync(await (await event).path(), "utf8"));
    }
    const before = await scene();
    assert(before.elements.some((x) => x.type === "rectangle" && !x.isDeleted));
    await locale(page, "zh-Hant");
    await page.waitForTimeout(500);
    assert(
      await page.evaluate(
        () => __canvas === document.querySelector("#board-canvas canvas"),
      ),
    );
    const after = await scene();
    assert.deepEqual(after.elements, before.elements);
    assert.equal(after.name, "Start game");
    console.log(
      "PASS unit identifiers/results and Whiteboard canvas/vector contents preserved",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log("PASS no file/recovery/media upload requests");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
