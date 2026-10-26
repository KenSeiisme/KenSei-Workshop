const assert = require("node:assert/strict"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext(),
    p = await c.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  try {
    const missing = [];
    const tools = [
      "image-studio",
      "pdf-toolkit",
      "image-to-text",
      "zip-studio",
      "file-renamer",
      "file-check",
      "data-studio",
      "text-compare",
      "text-toolkit",
      "markdown-studio",
      "flashcards",
      "study-planner",
      "focus-timer",
      "time-studio",
      "whiteboard",
      "typing-sprint",
      "audio-studio",
      "subtitle-studio",
      "screen-recorder",
      "qr-studio",
      "color-studio",
      "unit-converter",
      "password-generator",
      "calculator-studio",
      "decision-studio",
      "answer-book",
      "network-test",
      "device-check",
    ];
    for (const slug of tools) {
      await p.goto(base + "/zh-hant/tools/" + slug + "/");
      await p.waitForSelector("[data-ready=true]");
      assert.equal(await p.locator("html").getAttribute("lang"), "zh-Hant");
      const headings = await p.locator(".advanced-panel h2").allTextContents();
      for (const h of headings)
        if (!/[\u3400-\u9fff]/u.test(h)) missing.push(slug + ": " + h);
      assert(
        !(await p.locator(".advanced-panel").allTextContents())
          .join("")
          .includes("[object Object]"),
        slug + " invalid locale message",
      );
      await p.evaluate(() => KenseiI18n.setLocale("en"));
      assert(!p.url().includes("/zh-hant/"));
    }
    assert.deepEqual(missing, []);
    await p.goto(base + "/tools/text-toolkit/");
    await p.waitForSelector("[data-ready=true]");
    await p.fill("#text-input", "Home\nKeep original 中文");
    await p.evaluate(() => KenseiI18n.setLocale("zh-Hant"));
    assert.equal(await p.inputValue("#text-input"), "Home\nKeep original 中文");
    await p.goto(base + "/tools/password-generator/");
    await p.waitForSelector("[data-ready=true]");
    await p.getByLabel("Generator mode").selectOption("words");
    await p.click("#password-generate");
    await p.waitForFunction(
      () => document.querySelector("#password-output").value.length > 20,
    );
    const before = await p.inputValue("#password-output");
    await p.evaluate(() => KenseiI18n.setLocale("zh-Hant"));
    assert.equal(await p.inputValue("#password-output"), before);
    assert.deepEqual(errors, []);
    console.log(
      "PASS all 28 bilingual pages and state-preserving text/passphrase locale changes",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
