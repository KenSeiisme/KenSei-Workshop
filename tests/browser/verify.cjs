const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require("../support/browser.cjs");
}
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const pages = [
  "",
  "projects/",
  "projects/3a3d/",
  "projects/salon-system/",
  "projects/ai-art/",
  "tools/",
  "tools/image-studio/",
  "tools/text-toolkit/",
  "tools/focus-timer/",
  "workspace/",
  "privacy/",
];
const checks = [];
function pass(name) {
  checks.push(name);
  console.log("PASS " + name);
}
(async () => {
  fs.mkdirSync("_qa", { recursive: true });
  const browser = await playwright.chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    // Local-tool regressions run without external auth; configured auth has its own tests.
    await ctx.route("**/config.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.KENSEI_CONFIG={personalUrl:'https://kensei-eta.vercel.app/',carUrl:'https://3a3d.vercel.app/'};",
      }),
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    const oldWorkspace = {
      items: [
        {
          id: "old-draft",
          type: "draft",
          data: { name: "Existing draft", text: "Keep this saved text." },
          updated_at: "2026-10-01T00:00:00Z",
        },
        {
          id: "old-preset",
          type: "preset",
          data: {
            name: "Existing preset",
            width: 800,
            quality: 80,
            format: "image/webp",
          },
          updated_at: "2026-10-01T00:00:00Z",
        },
        {
          id: "favorite-image-studio",
          type: "favorite",
          data: { slug: "image-studio" },
          updated_at: "2026-10-01T00:00:00Z",
        },
        {
          id: "old-session",
          type: "session",
          data: { minutes: 15, completedAt: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        },
      ],
    };
    await page.evaluate(
      (value) =>
        localStorage.setItem("kensei-workshop:v1:guest", JSON.stringify(value)),
      oldWorkspace,
    );
    await page.goto(base + "/workspace/");
    assert.equal(await page.locator("#draft-count").textContent(), "1");
    assert.equal(await page.locator("#today-focus").textContent(), "15 min");
    assert(
      (await page.locator("#saved-presets").textContent()).includes(
        "Existing preset",
      ),
    );
    await page.locator("#saved-drafts a").click();
    await page.waitForLoadState("load");
    await page.waitForFunction(
      () =>
        document.querySelector("#text-input")?.value ===
        "Keep this saved text.",
    );
    assert.equal(
      await page.locator("#text-input").inputValue(),
      "Keep this saved text.",
    );
    assert.deepEqual(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("kensei-workshop:v1:guest")),
      ),
      oldWorkspace,
    );
    await page.evaluate(() => localStorage.clear());
    pass("Previously saved workspace data remains readable and unchanged");
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      for (const route of pages) {
        const response = await page.goto(base + "/" + route);
        assert.equal(response.status(), 200, route);
        assert(
          (await page.locator("h1").count()) === 1,
          route + " one main heading",
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          route + " overflow at " + width,
        );
        assert(
          (await page
            .locator("[data-personal]")
            .first()
            .getAttribute("href")) === "https://kensei-eta.vercel.app/",
        );
      }
    }
    pass("11 pages at 4 viewport widths, no horizontal overflow");
    await page.goto(base + "/");
    assert.equal(
      await page.locator("h1").textContent(),
      "Useful tools.A little lessfriction.",
    );
    assert.equal(await page.locator(".project-card,.car-art").count(), 0);
    assert.equal(await page.locator(".demo-example").count(), 2);
    assert.deepEqual(await page.locator("#navigation a").allTextContents(), [
      "Home",
      "Tools",
      "Games",
      "Projects",
      "About Me ↗",
    ]);
    await page
      .getByRole("link", { name: "Explore Tools", exact: true })
      .click();
    assert.equal(new URL(page.url()).hash, "#toolbox");
    const toolboxTop = await page
      .locator("#toolbox")
      .evaluate((el) => el.getBoundingClientRect().top);
    assert(
      toolboxTop >= 80 && toolboxTop < 120,
      "Toolbox heading should clear sticky navigation",
    );
    await page.locator("#tool-search").fill("batch compress");
    assert.equal(await page.locator("[data-tool-card]:visible").count(), 1);
    await page.locator('[data-filter="text"]').click();
    assert(await page.locator("#search-empty").isVisible());
    await page.locator('[data-filter="all"]').click();
    await page.locator("#tool-search").fill("");
    await page.locator('[data-favorite="image-studio"]').click();
    await page.goto(base + "/tools/");
    assert.equal(
      await page
        .locator('[data-favorite="image-studio"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.locator('[data-favorite="image-studio"]').click();
    await page.goto(base + "/");
    pass(
      "Tools-first homepage, navigation order, anchor offset and shared search/favorites",
    );
    assert.equal(await page.locator('a[href="/about/"]').count(), 0);
    await page.screenshot({ path: "_qa/home-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "_qa/home-mobile.png", fullPage: true });
    await page.locator(".menu-toggle").click();
    assert.equal(
      await page.locator(".menu-toggle").getAttribute("aria-expanded"),
      "true",
    );
    await page
      .locator("#navigation")
      .getByRole("link", { name: "Tools", exact: true })
      .click();
    await page.waitForLoadState("load");
    await page.locator("#tool-search").fill("batch compress");
    assert.equal(await page.locator("[data-tool-card]:visible").count(), 1);
    await page.locator("#tool-search").fill("nothing-at-all");
    assert(await page.locator("#search-empty").isVisible());
    await page.locator("#tool-search").fill("");
    await page.locator('[data-filter="text"]').click();
    assert.equal(await page.locator("[data-tool-card]:visible").count(), 6);
    await page.locator('[data-favorite="text-toolkit"]').click();
    assert.equal(
      await page
        .locator('[data-favorite="text-toolkit"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    pass("Mobile navigation, combined tool filtering and favorites");
    await page.goto(base + "/projects/");
    await page.locator('[data-filter="software"]').click();
    assert.equal(await page.locator(".project-card:visible").count(), 1);
    pass("Project category filtering");
    await page.goto(base + "/tools/text-toolkit/");
    await page
      .locator("#text-input")
      .fill("  Hello   world  \n\n\n Next line  ");
    await page.locator('[data-transform="clean"]').click();
    assert.equal(
      await page.locator("#text-input").inputValue(),
      "Hello world\n\nNext line",
    );
    await page.locator('[data-transform="upper"]').click();
    assert.equal(
      await page.locator("#text-input").inputValue(),
      "HELLO WORLD\n\nNEXT LINE",
    );
    await page.locator("#text-undo").click();
    assert.equal(
      await page.locator("#text-input").inputValue(),
      "Hello world\n\nNext line",
    );
    assert.equal(await page.locator("#stat-words").textContent(), "4");
    await page.locator("#draft-name").fill("First idea <script>");
    await page.locator("#save-draft").click();
    await page.waitForFunction(() =>
      document.querySelector("#draft-state").textContent.includes("Saved"),
    );
    const [textDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#text-download").click(),
    ]);
    assert.equal(textDownload.suggestedFilename(), "First idea -script-.txt");
    await page.goto(base + "/workspace/");
    assert.equal(await page.locator("#draft-count").textContent(), "1");
    assert(
      await page
        .locator("#saved-drafts")
        .textContent()
        .then((t) => t.includes("First idea <script>")),
    );
    await page.locator("#saved-drafts a").click();
    await page.waitForLoadState("load");
    await page.waitForFunction(
      () =>
        document.querySelector("#text-input")?.value ===
        "Hello world\n\nNext line",
    );
    assert.equal(
      await page.locator("#text-input").inputValue(),
      "Hello world\n\nNext line",
    );
    pass(
      "Text transforms, undo, stats, downloads, escaped draft save and reopen",
    );
    await page.goto(base + "/tools/image-studio/");
    await page.waitForSelector('[data-ready="true"]');
    const imageBase64 = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 16;
      c.getContext("2d").fillRect(0, 0, 8, 8);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page.locator("#image-file").setInputFiles({
      name: "transparent.png",
      mimeType: "image/png",
      buffer: Buffer.from(imageBase64, "base64"),
    });
    await page.waitForFunction(
      () => !document.querySelector("#image-width").disabled,
    );
    await page.locator("#image-width").fill("16");
    assert.equal(await page.locator("#image-height").inputValue(), "8");
    await page.locator("#image-format").selectOption("image/jpeg");
    await page.locator("#image-process").click();
    await page.locator("#image-download").waitFor({ state: "visible" });
    const pixel = await page.evaluate(async () => {
      const i = new Image();
      i.src = document.querySelector("#image-download").href;
      await i.decode();
      const c = document.createElement("canvas");
      c.width = i.width;
      c.height = i.height;
      const x = c.getContext("2d");
      x.drawImage(i, 0, 0);
      return {
        w: i.width,
        h: i.height,
        p: [...x.getImageData(15, 7, 1, 1).data],
      };
    });
    assert.equal(pixel.w, 16);
    assert.equal(pixel.h, 8);
    assert(pixel.p[0] > 245 && pixel.p[3] === 255);
    const [imgDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#image-download").click(),
    ]);
    assert(imgDownload.suggestedFilename().endsWith(".jpg"));
    page.once("dialog", (d) => d.accept("Web preset"));
    await page.locator("#save-preset").click();
    await page.goto(base + "/workspace/");
    await page.locator("#saved-presets a").click();
    await page.waitForLoadState("load");
    await page.waitForSelector('[data-ready="true"]');
    await page.locator("#image-file").setInputFiles({
      name: "second.png",
      mimeType: "image/png",
      buffer: Buffer.from(imageBase64, "base64"),
    });
    await page.waitForFunction(
      () => !document.querySelector("#image-width").disabled,
    );
    assert.equal(await page.locator("#image-width").inputValue(), "16");
    await page.locator("#image-width").fill("0");
    await page.locator("#image-process").click();
    assert(
      await page
        .locator(".toast")
        .textContent()
        .then((t) => t.includes("whole dimensions")),
    );
    pass(
      "Image resize, JPEG white background, download, preset reuse and invalid dimensions",
    );
    await page.clock.install();
    await page.goto(base + "/tools/focus-timer/");
    await page.locator("summary").click();
    await page.locator("#duration-focus").fill("1");
    await page.locator("#timer-save-settings").click();
    assert.equal(await page.locator("#timer-display").textContent(), "01:00");
    await page.locator("#timer-start").click();
    await page.clock.fastForward(10000);
    assert.equal(await page.locator("#timer-display").textContent(), "00:50");
    await page.locator("#timer-start").click();
    await page.clock.fastForward(10000);
    assert.equal(await page.locator("#timer-display").textContent(), "00:50");
    await page.locator("#timer-start").click();
    await page.clock.fastForward(51000);
    await page.waitForFunction(() =>
      document.querySelector("#timer-summary").textContent.includes("saved"),
    );
    assert.equal(await page.locator("#timer-display").textContent(), "05:00");
    await page.goto(base + "/workspace/");
    assert.equal(await page.locator("#today-focus").textContent(), "1 min");
    assert.equal(await page.locator("#saved-sessions .saved-row").count(), 1);
    pass(
      "Timer settings, pause/resume, background-time completion and workspace history",
    );
    await page.locator("[data-sign-in]").first().click();
    assert(await page.locator("#auth-dialog").isVisible());
    assert(await page.locator("#google-login").isDisabled());
    assert(
      (await page.locator("#auth-note").textContent()).includes(
        "not connected",
      ),
    );
    await page.keyboard.press("Escape");
    assert(!(await page.locator("#auth-dialog").isVisible()));
    pass("Honest unconfigured cloud state and accessible dialog");
    assert.deepEqual(errors, []);
    pass("No uncaught browser errors");
    fs.writeFileSync(
      "_qa/results.json",
      JSON.stringify(
        { checkedAt: new Date().toISOString(), checks, cloudTested: false },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
