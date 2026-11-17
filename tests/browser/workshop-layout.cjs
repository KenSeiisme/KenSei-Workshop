const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || "msedge",
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 320, height: 640 },
      reducedMotion: "no-preference",
    });
    await context.route("**/config.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.KENSEI_CONFIG={}",
      }),
    );
    const page = await context.newPage();
    const open = (route) => page.goto(base + route);
    const layer = page.locator(".workshop-atmosphere");
    const motion = page.locator("[data-background-motion]").first();
    const noOverflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      );

    await open("/tools/");
    await motion.waitFor();
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-background-motion]")
          .getAttribute("aria-pressed") === "true",
    );
    assert.equal(
      await layer.locator(".workshop-bubble-anchor:visible").count(),
      4,
    );
    await motion.click();
    assert.equal(await motion.getAttribute("aria-pressed"), "false");
    await open("/");
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-home-motion-toggle]")
          .getAttribute("aria-pressed") === "false",
    );
    await page.locator("[data-home-motion-toggle]").click();
    await open("/zh-hant/games/");
    await motion.waitFor();
    assert.equal(await motion.getAttribute("aria-pressed"), "true");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-background-motion]")
          .getAttribute("aria-disabled") === "true",
    );
    assert.equal(await layer.getAttribute("data-motion-enabled"), null);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await open("/tools/");
    await page.waitForFunction(() => window.KenseiWorkspace?.ready);
    const card = page.locator('[data-tool-slug="image-studio"]');
    await card.locator("[data-favorite]").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-tool-slug="image-studio"] [data-favorite]')
          .getAttribute("aria-pressed") === "true",
    );
    await page.locator("#tool-favorite-filter").click();
    await page.locator("#tool-search").fill("Image Studio");
    await page
      .locator('[data-filter-group="tools"] [data-filter="images"]')
      .click();
    assert.equal(await page.locator("[data-tool-card]:visible").count(), 1);
    await card.locator(".card-primary-link").click();
    await page.waitForFunction(() =>
      Object.keys(localStorage).some(
        (key) =>
          key.endsWith(":recent-tools") &&
          localStorage.getItem(key).includes("image-studio"),
      ),
    );
    await page.locator(".workshop-tool-toolbar .back-link").click();
    await page.waitForFunction(
      () => document.querySelector("#tool-search").value === "Image Studio",
    );
    assert.equal(
      await page.locator("#tool-search").inputValue(),
      "Image Studio",
    );
    assert.equal(
      await page.locator("#tool-favorite-filter").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .locator('[data-filter-group="tools"] [data-filter="images"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#tool-search-clear").click();
    await page.locator("#recent-tool-links a").first().waitFor();

    await open("/projects/");
    assert.equal(
      await page
        .locator(".listing-projects > .featured")
        .getAttribute("data-project"),
      "kensei-studio",
    );
    await page
      .locator('[data-filter-group="projects"] [data-filter="web"]')
      .click();
    await page.locator(".project-card:visible .project-card-link").click();
    await page.locator(".workshop-project-toolbar .back-link").click();
    await page
      .locator('.listing-projects[data-project-category="web"]')
      .waitFor();
    assert.equal(
      await page
        .locator(".listing-projects")
        .getAttribute("data-project-category"),
      "web",
    );

    await open("/tools/text-compare/");
    const tabs = page.locator(".tool-tabs [role=tab]");
    await tabs.first().waitFor();
    await page.locator("#compare-left").fill("first");
    await tabs.nth(1).click();
    await page.locator("#compare-right").fill("second");
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator("#compare-left").waitFor();
    assert.equal(await page.locator("#compare-left").inputValue(), "first");
    assert.equal(await page.locator("#compare-right").inputValue(), "second");
    assert(await noOverflow());

    await open("/games/2048/");
    assert.equal(await layer.locator(".workshop-bubble").count(), 3);
    await page.locator("#game-start").click();
    await page
      .locator('[data-play-shell][data-shell-state="playing"]')
      .waitFor();
    assert(await layer.isHidden());

    for (const [width, height] of [
      [320, 640],
      [390, 844],
      [768, 1024],
      [1366, 768],
      [1440, 900],
      [844, 390],
      [683, 384],
    ]) {
      await page.setViewportSize({ width, height });
      for (const path of ["/tools/", "/zh-hant/games/", "/projects/"]) {
        await open(path);
        await motion.waitFor();
        for (const theme of ["dark", "light"]) {
          await page.evaluate((theme) => {
            document.documentElement.dataset.siteTheme = theme;
          }, theme);
          assert(await noOverflow(), path + " " + width + " " + theme);
        }
        assert.equal(
          await layer.locator(".workshop-bubble-anchor:visible").count(),
          width < 768 || height <= 540 ? 4 : 8,
        );
      }
    }
    console.log(
      "Workshop scenes, shared motion, directory return, mobile workspaces, and responsive catalog checks passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
