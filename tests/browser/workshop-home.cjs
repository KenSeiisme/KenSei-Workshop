const assert = require("node:assert/strict");
const { chromium, firefox, webkit } = require("../support/browser.cjs");

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const ranking = {
  tools: {
    source: "analytics",
    slugs: ["qr-studio", "color-studio", "audio-studio", "decision-studio"],
  },
  games: {
    source: "analytics",
    slugs: ["go", "reversi", "nonogram", "snake"],
  },
};
const routes = ["/", "/zh-hant/"];
const sizes = [
  [320, 640],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1200, 900],
  [1366, 900],
  [1920, 1080],
  [2560, 1440],
  [844, 390],
  [683, 450],
];

function floatingSlugs(page, section) {
  return page
    .locator(section + " [data-float-slug]")
    .evaluateAll((items) => items.map((item) => item.dataset.floatSlug));
}

function floatingClips(page) {
  return page.locator("[data-float-slug]").evaluateAll((items) => {
    return items
      .filter((item) => {
        for (const child of item.querySelectorAll(
          "i, b, .mini-extra > span, .mini-drop > span, .mini-memory > span",
        )) {
          const art = child.getBoundingClientRect();
          if (!art.width || !art.height) continue;
          const frame = item.getBoundingClientRect();
          if (
            art.left < frame.left - 1 ||
            art.top < frame.top - 1 ||
            art.right > frame.right + 1 ||
            art.bottom > frame.bottom + 1
          )
            return true;
        }
        return false;
      })
      .map((item) => item.dataset.floatSlug);
  });
}

async function checkLayout(engine, name) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext();
    await context.route("**/api/home-popular", (route) =>
      route.fulfill({ json: ranking }),
    );
    await context.route("https://cdn.jsdelivr.net/**", (route) =>
      route.abort(),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const url of routes) {
      for (const theme of ["dark", "light"]) {
        await page.addInitScript(
          (theme) => localStorage.setItem("kensei-game-hub-theme", theme),
          theme,
        );
        for (const [width, height] of sizes) {
          await page.setViewportSize({ width, height });
          assert.equal(
            (
              await page.goto(base + url, { waitUntil: "domcontentloaded" })
            ).status(),
            200,
          );
          const links = page.locator(".home-portal");
          assert.equal(await links.count(), 3);
          if (height >= 640)
            for (const link of await links.all()) {
              const box = await link.boundingBox();
              assert(
                box && box.y + box.height <= height,
                `${name} ${url} ${width}x${height} ${theme}`,
              );
            }
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          assert.equal(
            await page.locator(".home-cards [data-home-card]").count(),
            12,
          );
          const backdrop = await page
            .locator(".home-intro .home-atmosphere")
            .boundingBox();
          assert(backdrop && backdrop.x === 0 && backdrop.width === width);
        }
      }
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.locator("#toolbox a[data-home-card='qr-studio']").waitFor();
    assert.deepEqual(await floatingSlugs(page, "#toolbox"), [
      "data-studio",
      "study-planner",
    ]);
    await page.waitForFunction(() =>
      document.querySelector("#games [data-home-popular]:not([hidden])"),
    );
    assert.deepEqual(await floatingSlugs(page, "#games"), [
      "memory-match",
      "block-drop",
    ]);
    assert.equal(
      await page
        .locator("#toolbox a[data-home-card]")
        .first()
        .getAttribute("data-home-card"),
      "qr-studio",
    );
    await page.locator(".home-portal[href='#toolbox']").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        location.hash === "#toolbox" &&
        document.querySelector("#toolbox").getBoundingClientRect().top < 120,
    );
    assert(await page.locator("#toolbox [data-home-popular]").isVisible());
    assert.equal(
      await page
        .locator("#games [data-home-card]")
        .first()
        .getAttribute("data-home-card"),
      "go",
    );
    await page.evaluate(() => window.KenseiI18n.setLocale("zh-Hant"));
    assert.match(page.url(), /\/zh-hant\/#toolbox$/);
    const newLink = page.locator("#toolbox [data-home-card='qr-studio']");
    assert.equal(
      await newLink.getAttribute("href"),
      "/zh-hant/tools/qr-studio/",
    );
    assert.equal(
      await page.locator("#toolbox [data-home-popular]").innerText(),
      "近 30 天最多瀏覽",
    );
    const search = page.locator(".site-search-button");
    assert.equal(await search.innerText(), "搜尋全站");
    await search.focus();
    await page.keyboard.press("Enter");
    await page.locator("#site-search-dialog[open] input").fill("白板");
    await page.locator("#site-search-results a").first().waitFor();
    assert.equal(
      await page.locator("#site-search-results a").first().getAttribute("href"),
      "/zh-hant/tools/whiteboard/",
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      document.activeElement.matches(".site-search-button"),
    );
    await page.keyboard.press("Control+k");
    await page.locator("#site-search-dialog[open]").waitFor();
    const searchInput = page.locator("#site-search-dialog input");
    const results = page.locator("#site-search-results a");
    await searchInput.fill("studio");
    await results.first().waitFor();
    await searchInput.press("ArrowUp");
    assert.equal(
      await page.locator(".site-search-result.selected").getAttribute("href"),
      await results.last().getAttribute("href"),
    );
    await results.first().focus();
    await page.keyboard.press("ArrowDown");
    assert(
      await results.nth(1).evaluate((node) => node === document.activeElement),
    );
    const destination = await results.nth(1).getAttribute("href");
    await page.keyboard.press("Enter");
    await page.waitForURL(base + destination);
    await page.goto(base + "/zh-hant/");
    await search.waitFor();
    await page.setViewportSize({ width: 1024, height: 768 });
    assert.equal(await search.innerText(), "搜尋…");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await search.innerText(), "");
    await page.locator(".menu-toggle").click();
    assert(await page.locator(".site-drawer #account-controls").isVisible());
    assert(
      await page.locator(".site-drawer [data-language-select]").isVisible(),
    );
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1366, height: 900 });

    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.notEqual(
      await page
        .locator("#toolbox .home-card:first-child .tool-card-preview")
        .evaluate((node) => getComputedStyle(node).position),
      "sticky",
    );
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".home-section")
          .style.getPropertyValue("--home-parallax"),
    );
    assert.deepEqual(await floatingClips(page), []);
    assert.equal(
      await page.locator("#projects [data-float-art$='-preview']").count(),
      2,
    );
    await page.setViewportSize({ width: 320, height: 640 });
    assert.deepEqual(await floatingClips(page), []);
    assert.deepEqual(errors, []);
    console.log(
      "PASS",
      name,
      "bilingual viewports, anchor, dynamic localization and reduced motion",
    );
    await context.close();

    const staticContext = await browser.newContext({
      javaScriptEnabled: false,
      reducedMotion: "reduce",
      viewport: { width: 320, height: 640 },
    });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(base + "/zh-hant/");
    await staticPage.locator(".home-portal[href='#projects']").click();
    assert.match(staticPage.url(), /#projects$/);
    await staticPage.waitForFunction(
      () =>
        document.querySelector("#projects").getBoundingClientRect().top < 120,
    );
    assert.equal(
      await staticPage.locator("#projects [data-home-card]").count(),
      4,
    );
    const card = staticPage.locator(
      "#projects [data-home-card='kensei-studio']",
    );
    assert.equal(
      await card.getAttribute("href"),
      "/zh-hant/projects/kensei-studio/",
    );
    await card.focus();
    await staticPage.keyboard.press("Enter");
    await staticPage.waitForURL("**/zh-hant/projects/kensei-studio/");
    assert.match(staticPage.url(), /\/zh-hant\/projects\/kensei-studio\/$/);
    await staticContext.close();
  } finally {
    await browser.close();
  }
}

async function checkLate() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    });
    let release;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    await context.route("**/api/home-popular", async (route) => {
      await wait;
      await route.fulfill({
        json: {
          ...ranking,
          games: {
            source: "analytics",
            slugs: ["go", "chess", "minesweeper", "snake"],
          },
        },
      });
    });
    const page = await context.newPage();
    const response = page.waitForResponse("**/api/home-popular");
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.locator(".home-portal[href='#toolbox']").tap();
    await page.waitForFunction(
      () =>
        document.querySelector("#toolbox").getBoundingClientRect().top < 120,
    );
    release();
    await response;
    assert.equal(
      await page
        .locator("#toolbox [data-home-card]")
        .first()
        .getAttribute("data-home-card"),
      "image-studio",
    );
    assert(await page.locator("#toolbox [data-home-featured]").isVisible());
    assert.deepEqual(await floatingSlugs(page, "#toolbox"), [
      "color-studio",
      "audio-studio",
    ]);
    await page
      .locator("#games [data-home-card='go']")
      .waitFor({ state: "attached" });
    await page.goBack();
    assert.equal(new URL(page.url()).hash, "");
    await page.locator(".home-portal[href='#games']").tap();
    await page.locator("#games [data-home-card='go']").tap();
    await page.waitForURL("**/games/go/");
    console.log(
      "PASS touch, late data guard, independent sections and browser back",
    );
  } finally {
    await browser.close();
  }
}

(async () => {
  const engines = { chromium, firefox, webkit };
  for (const [name, engine] of Object.entries(engines)) {
    if (!process.argv[2] || process.argv[2] === name)
      await checkLayout(engine, name);
  }
  if (!process.argv[2] || process.argv[2] === "chromium") await checkLate();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
