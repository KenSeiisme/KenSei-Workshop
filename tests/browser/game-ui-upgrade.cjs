const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const games = require("../../data/games.json");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || "msedge",
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 320, height: 640 },
    });
    await context.route("**/config.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.KENSEI_CONFIG={}",
      }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const open = (route) => page.goto(base + route);
    const noOverflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      );
    for (const route of ["/games/", "/zh-hant/games/"]) {
      await open(route);
      await page.locator('[data-games-directory][data-ready="true"]').waitFor();
      for (const selector of [
        ".hub-library-jump",
        ".hub-slide:not([hidden]) .hub-feature-actions a.primary",
      ]) {
        const box = await page.locator(selector).boundingBox();
        assert(
          box && box.y >= 0 && box.y + box.height <= 640,
          route + " " + selector + " below fold",
        );
      }
      assert(await noOverflow());
    }
    const carousel = page.locator(".hub-feature");
    const first = page.locator("[data-hub-featured]:not([hidden])");
    await carousel.hover();
    const nowShowing = await first.getAttribute("data-hub-featured");
    await page.clock.install();
    await page.clock.fastForward(6000);
    assert.equal(await first.getAttribute("data-hub-featured"), nowShowing);
    const select = page.locator('[data-hub-goto="2"]');
    await select.click();
    assert.equal(await first.getAttribute("data-hub-featured"), "xiangqi");
    assert.equal(await select.getAttribute("aria-pressed"), "true");
    await page.clock.fastForward(6000);
    assert.equal(await first.getAttribute("data-hub-featured"), "xiangqi");

    await page.locator(".hub-library-jump").click();
    await page.waitForFunction(
      () => document.activeElement.id === "game-search",
    );
    await page.locator('[data-game-filter="board"]').click();
    await page.locator("#game-play-filter").selectOption("online");
    assert.equal(
      await page.locator("[data-game-card]:not([hidden])").count(),
      3,
    );
    await page.locator("#game-search").fill("西洋棋");
    const card = page.locator("[data-game-card]:not([hidden]) .game-card-link");
    assert.equal(await card.count(), 1);
    await card.click();
    await page.locator('[data-chess][data-ready="true"]').waitFor();

    const button = page.locator("[data-shell-options]");
    const drawer = page.locator("[data-shell-options-dialog]");
    assert(await drawer.isHidden());
    await page.evaluate(() => {
      window.initialBoard = document.querySelector("#game-board");
    });
    await button.click();
    await drawer.waitFor();
    await page.locator("#chess-clock").selectOption("5+3");
    await page.locator("#chess-level").selectOption("3");
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      document.activeElement.hasAttribute("data-shell-options"),
    );
    assert.match(
      await page.locator("#chess-setup-summary").textContent(),
      /5\+3/,
    );
    assert.match(
      await page.locator("[data-shell-options-summary]").textContent(),
      /3/,
    );
    assert(
      await page.evaluate(
        () => window.initialBoard === document.querySelector("#game-board"),
      ),
    );
    await page.locator(".game-shell-toolbar .back-link").click();
    await page.locator('[data-games-directory][data-ready="true"]').waitFor();
    assert.equal(await page.locator("#game-search").inputValue(), "西洋棋");
    assert.equal(
      await page.locator("#game-play-filter").inputValue(),
      "online",
    );
    assert.equal(
      await page
        .locator('[data-game-filter="board"]')
        .getAttribute("aria-pressed"),
      "true",
    );

    for (const { slug } of games) {
      await open("/games/" + slug + "/");
      await page.locator('[data-play-shell][data-ready="true"]').waitFor();
      const start = page.locator(
        "#game-start, #go-start, #chess-start, #xiangqi-start, #pong-create",
      );
      await start.waitFor();
      const bounds = await start.boundingBox();
      assert(
        bounds && bounds.height >= 44 && bounds.y + bounds.height <= 640,
        slug + " launch layout",
      );
      assert(await noOverflow(), slug + " overflows the viewport");
    }
    for (const game of ["go", "chess", "xiangqi"]) {
      await open("/games/" + game + "/?code=ABCD1234");
      await page.locator('[data-play-shell][data-ready="true"]').waitFor();
      assert.equal(
        await page.locator("#" + game + "-code").inputValue(),
        "ABCD1234",
      );
      assert(
        await page
          .locator("[data-online-launch] button.primary#" + game + "-join")
          .isVisible(),
      );
      await page.locator("[data-shell-invite]").click();
      await page.locator("[data-shell-invite-dialog]").waitFor();
      assert(await page.locator("#" + game + "-create").isVisible());
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(errors, []);
    console.log(
      "Games UI: 15 launch panels, directory return, paused carousel, setup focus, direct invitations and mobile overflow checks passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
