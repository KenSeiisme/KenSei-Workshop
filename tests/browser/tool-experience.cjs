const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8801";
const phases = [
  [
    "image-studio",
    "qr-studio",
    "pdf-toolkit",
    "image-to-text",
    "zip-studio",
    "file-renamer",
    "file-check",
  ],
  [
    "text-toolkit",
    "markdown-studio",
    "text-compare",
    "data-studio",
    "calculator-studio",
    "subtitle-studio",
  ],
  [
    "focus-timer",
    "flashcards",
    "study-planner",
    "whiteboard",
    "time-studio",
    "answer-book",
    "decision-studio",
    "color-studio",
    "unit-converter",
    "password-generator",
  ],
  [
    "audio-studio",
    "screen-recorder",
    "network-test",
    "device-check",
    "typing-sprint",
  ],
];
const sdk = `export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},rpc:async()=>({data:[],error:null})}}`;
(async () => {
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    ctx = await browser.newContext({ reducedMotion: "reduce" }),
    errors = [],
    uploads = [];
  await ctx.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (r) =>
      r.fulfill({
        body: sdk,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
      }),
  );
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (r.method() === "POST" || r.url().includes("speed.cloudflare.com"))
        uploads.push(r.url());
    });
  });
  const tools = JSON.parse(fs.readFileSync("data/tools.json", "utf8")),
    selected = process.argv[2] ? phases[+process.argv[2] - 1] : phases.flat(),
    p = await ctx.newPage();
  try {
    for (const slug of selected) {
      await p.goto(base + "/tools/" + slug + "/", {
        waitUntil: "domcontentloaded",
      });
      await p.waitForSelector('[data-ui-ready="true"]');
      assert.equal(
        await p.locator("h1").textContent(),
        tools.find((t) => t[0] === slug)[2],
      );
      for (const width of [360, 768, 1440, 320]) {
        await p.setViewportSize({ width, height: 900 });
        await p.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        const result = await p.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          wide: [...document.querySelectorAll("[data-tool] *")]
            .filter(
              (n) =>
                n.getBoundingClientRect().right > innerWidth + 1 &&
                getComputedStyle(n).position !== "fixed",
            )
            .slice(0, 4)
            .map((n) => n.id || n.className),
        }));
        assert(
          result.scroll <= width + 1,
          slug + " overflows " + width + ": " + JSON.stringify(result),
        );
      }
      await p.locator("[data-open-help]").click();
      assert(await p.locator("#tool-help").isVisible());
      await p.keyboard.press("Escape");
      assert(await p.locator("#tool-help").isHidden());
      assert(
        await p
          .locator("[data-open-help]")
          .evaluate((n) => n === document.activeElement),
      );
      console.log(
        "PASS " + slug + " heading, Help, keyboard and 320/360/768/1440 layout",
      );
    }
    if (!process.argv[2] || process.argv[2] === "1") {
      await p.setViewportSize({ width: 360, height: 900 });
      await p.goto(base + "/tools/zip-studio/");
      await p.waitForSelector("[data-ui-ready]");
      await p.getByRole("tab", { name: "Inspect ZIP", exact: true }).click();
      assert(await p.locator("#zip-open").isVisible());
      await p.getByRole("tab", { name: "Pack files", exact: true }).focus();
      await p.keyboard.press("ArrowRight");
      await p.keyboard.press("Enter");
      assert(await p.locator("#zip-open").isVisible());
    }
    if (!process.argv[2] || process.argv[2] === "2") {
      await p.setViewportSize({ width: 360, height: 900 });
      await p.goto(base + "/tools/markdown-studio/");
      await p.waitForSelector("[data-ui-ready]");
      await p.locator("#markdown-input").fill("# 中文 preview");
      await p.getByRole("tab", { name: "Preview", exact: true }).click();
      await p.waitForSelector("#markdown-preview h1");
      await p.getByRole("tab", { name: "Edit", exact: true }).click();
      assert.equal(
        await p.locator("#markdown-input").inputValue(),
        "# 中文 preview",
      );
      await p.locator("[data-open-help]").click();
      await p.keyboard.press("Escape");
      await p.screenshot({
        path: "_qa/experience-markdown-mobile.png",
        fullPage: true,
      });
    }
    if (!process.argv[2] || process.argv[2] === "3") {
      await p.goto(base + "/tools/password-generator/");
      await p.waitForSelector("[data-ui-ready]");
      assert.equal(
        await p.locator("#password-output").getAttribute("type"),
        "password",
      );
      const secret = await p.locator("#password-output").inputValue();
      await p.locator("#password-visibility").click();
      assert.equal(
        await p.locator("#password-output").getAttribute("type"),
        "text",
      );
      assert.equal(await p.locator("#password-output").inputValue(), secret);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    console.log(
      "PASS phase " +
        (process.argv[2] || "all") +
        ": no automatic measurements, capture, uploads or browser errors",
    );
  } finally {
    await ctx.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
