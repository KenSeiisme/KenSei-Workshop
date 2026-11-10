const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
  });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  try {
    await context.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},rpc:async()=>({data:{top:[],version:4}})}}`,
        }),
    );
    await context.addInitScript(() => {
      if (!localStorage.getItem("kensei-game-hub-theme"))
        localStorage.setItem("kensei-game-hub-theme", "light");
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of [
      "/",
      "/tools/text-toolkit/",
      "/profile/",
      "/zh-hant/games/",
    ]) {
      await page.goto(base + route);
      assert.equal(
        await page.locator("html").getAttribute("data-site-theme"),
        "light",
      );
      for (const [width, height] of [
        [320, 640],
        [360, 800],
        [740, 360],
        [768, 1024],
        [1024, 768],
        [1440, 900],
      ]) {
        await page.setViewportSize({ width, height });
        assert(
          await page.locator(".header [data-site-theme-toggle]").isVisible(),
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          route + " at " + width,
        );
      }
    }
    await page.getByRole("button", { name: "切換為深色主題" }).click();
    assert.equal(
      await page.locator("html").getAttribute("data-site-theme"),
      "dark",
    );
    await page
      .locator(".toast[data-kind=setting]")
      .getByText("深色主題")
      .waitFor();
    await page.goto(base + "/tools/text-toolkit/");
    const input = page.locator("#text-input");
    await input.fill("Keep this draft");
    await page.locator("[data-site-theme-toggle]").click();
    assert.equal(await input.inputValue(), "Keep this draft");
    await page.goto(base + "/games/brick-breaker/");
    await page.waitForSelector('[data-game][data-ready="true"]');
    await page.click("#game-start");
    await page.locator("[data-shell-focus]:visible").click();
    const canvas = page.locator(".brick-canvas");
    const original = await canvas.elementHandle();
    await page.locator("[data-site-theme-toggle]").click();
    assert(
      await canvas.evaluate((node, previous) => node === previous, original),
    );
    await page.locator("[data-shell-settings]:visible").first().click();
    const dialog = page.locator("[data-shell-settings-dialog]:modal");
    await dialog.waitFor();
    const volume = dialog.locator("[data-audio-volume]");
    await volume.focus();
    await volume.evaluate((node) => {
      for (const val of [25, 41, 53]) {
        node.value = val;
        node.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    assert.equal(await page.getByText("Sound volume · 53%").count(), 0);
    await volume.dispatchEvent("change");
    await dialog.getByText("Sound volume · 53%").waitFor();
    assert(await volume.evaluate((node) => node === document.activeElement));
    await page.evaluate(() => {
      for (let i = 0; i < 4; i++)
        window.KenseiNotify("Notice " + i, {
          kind: "achievement",
          key: "fixture-" + i,
        });
    });
    assert.equal(await dialog.locator(".toast").count(), 3);
    await dialog.getByRole("button", { name: "Close settings" }).click();
    assert.equal(
      await page.locator("body > [data-site-notices] .toast").count(),
      3,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS shared theme across 4 routes and 6 widths, input/board retained, top-right modal notices, committed volume and queue cap",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
