const assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const sdk = `export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){},signInWithOAuth:async()=>({error:null})},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async(n)=>({data:n==='get_xiangqi_leaderboard'?{top:[{rank:1,nickname:'Fixture player',public_id:'00000000-0000-4000-8000-000000000001',wins:10,played:12,losses:1,draws:1,win_rate:10/12}],me:null}:[],error:null}),functions:{invoke:async()=>({data:{error:'Unexpected online request'},error:null})}}}`;
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors = [],
    requests = [];
  await fs.mkdir("_qa/xiangqi", { recursive: true });
  await context.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (r) => r.fulfill({ contentType: "text/javascript", body: sdk }),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  page.on("dialog", (d) => d.accept());
  try {
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 800, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(base + "/games/xiangqi/");
      await page.waitForSelector("[data-xiangqi][data-ready=true]");
      const layout = await page.evaluate(() => ({
        background: getComputedStyle(document.querySelector("#game-board"))
          .backgroundImage,
        top: document.querySelector("#game-board").getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        start: document.querySelector("#xiangqi-start").getBoundingClientRect()
          .bottom,
        board: document
          .querySelector("#game-board")
          .getBoundingClientRect()
          .toJSON(),
      }));
      assert.match(
        layout.background,
        /xiangqi-board\.svg/,
        "The playable grid, river and palaces must remain visible.",
      );
      assert.equal(
        layout.overflow,
        false,
        JSON.stringify({ viewport, layout }),
      );
      assert.ok(
        layout.top <= (viewport.width < 600 ? 160 : 180),
        JSON.stringify({ viewport, layout }),
      );
      if (viewport.height > 500)
        assert.ok(
          layout.start < viewport.height,
          JSON.stringify({ viewport, layout }),
        );
      assert.equal(
        requests.some((url) => url.includes("fairy-stockfish/stockfish")),
        false,
        "No engine loads before Start",
      );
      if (viewport.width === 360 || viewport.width === 1440)
        await page.screenshot({
          path: `_qa/xiangqi/ready-${viewport.width}.png`,
          fullPage: true,
        });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.selectOption("#xiangqi-mode", "online");
    await page.click("#xiangqi-create");
    await page.waitForSelector("#auth-dialog[open]");
    assert.doesNotMatch(
      await page.locator("#xiangqi-entry-status").textContent(),
      /Preparing/,
    );
    await page.evaluate(() => document.querySelector("#auth-dialog").close());
    await page.selectOption("#xiangqi-mode", "local");
    await page.click("#xiangqi-start");
    await page.waitForSelector("[data-xiangqi-phase=playing]");
    assert.equal(
      await page
        .locator("body")
        .evaluate((n) => n.classList.contains("game-is-focused")),
      true,
    );
    await page.click('[data-square="e3"]');
    await page.click('[data-square="e4"]');
    assert.match(await page.locator("#xiangqi-turn").textContent(), /Black/);
    await page.click('[data-square="e6"]');
    await page.click('[data-square="e5"]');
    assert.match(await page.locator("#xiangqi-turn").textContent(), /Red/);
    await page.click("#xiangqi-undo");
    assert.match(await page.locator("#xiangqi-turn").textContent(), /Black/);
    const piece = page.locator('[data-square="e4"] svg');
    assert.equal(await piece.count(), 1);
    await page.click("[data-shell-focus]");
    assert.equal(await piece.count(), 1);
    await page.click("[data-shell-focus]");
    await page.evaluate(async () => {
      window.__xiangqiBoard = document.querySelector("#game-board");
      await KenseiI18n.setLocale("zh-Hant");
    });
    assert.equal(
      await page.evaluate(
        () => window.__xiangqiBoard === document.querySelector("#game-board"),
      ),
      true,
    );
    assert.match(page.url(), /zh-hant/);
    assert.equal(await piece.count(), 1);
    await page.evaluate(async () => KenseiI18n.setLocale("en"));
    await page.click("#xiangqi-pause");
    assert.equal(await page.locator("#xiangqi-paused").isVisible(), true);
    await page.click("#xiangqi-resume");
    await page.click("#xiangqi-draw");
    await page.click("#xiangqi-offer");
    assert.equal(await page.locator("#xiangqi-draw-offer").isVisible(), true);
    await page.click("#xiangqi-accept");
    assert.equal(await page.locator("#xiangqi-result").isVisible(), true);
    const download = page.waitForEvent("download");
    await page.click("#xiangqi-result-pgn");
    const d = await download;
    assert.match(d.suggestedFilename(), /\.txt$/);
    assert.match(await fs.readFile(await d.path(), "utf8"), /1\/2-1\/2/);
    await page.click("#xiangqi-review");
    await page.locator("#xiangqi-ply").fill("0");
    assert.equal(await page.locator('[data-square="e3"] svg').count(), 1);
    await page.click("#xiangqi-close-review");
    await page.click("#xiangqi-again");
    await page.selectOption("#xiangqi-mode", "ai");
    await page.click("#xiangqi-start");
    await page.click('[data-square="e3"]');
    await page.click('[data-square="e4"]');
    await page.waitForFunction(
      () => document.querySelector("#xiangqi-moves").children.length >= 2,
      { timeout: 30000 },
    );
    assert.match(await page.locator("#xiangqi-turn").textContent(), /Red/);
    assert.ok(
      requests.some((url) => url.includes("fairy-stockfish/stockfish.wasm")),
    );
    await page.screenshot({
      path: "_qa/xiangqi/ai-playing.png",
      fullPage: true,
    });
    await page.click("#xiangqi-pause");
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector("[data-xiangqi][data-ready=true]");
    await page.waitForSelector("#xiangqi-continue:not([hidden])");
    await page.click("#xiangqi-continue");
    assert.equal(await page.locator('[data-square="e4"] svg').count(), 1);
    await page.click("[data-shell-menu]");
    await page.click("#xiangqi-new-setup");
    await page.selectOption("#xiangqi-mode", "local");
    await page.click("#xiangqi-start");
    await page.click("[data-shell-menu]");
    await page
      .locator("[data-shell-menu-dialog] details")
      .first()
      .evaluate((n) => (n.open = true));
    await page.fill(
      "#xiangqi-import-text",
      "4k4/3R1R3/9/9/4P4/9/9/9/9/4K4 b - - 0 1",
    );
    await page.click("#xiangqi-import");
    assert.match(
      await page.locator("#xiangqi-result-detail").textContent(),
      /No legal move/,
    );
    assert.match(
      await page.locator("#xiangqi-result-title").textContent(),
      /Red/,
    );
    if (
      !process.env.WORKSHOP_BROWSER_ENGINE ||
      process.env.WORKSHOP_BROWSER_ENGINE === "chromium"
    ) {
      const touchContext = await browser.newContext({
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      });
      await touchContext.route(
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
        (r) => r.fulfill({ contentType: "text/javascript", body: sdk }),
      );
      const touchPage = await touchContext.newPage();
      touchPage.on("pageerror", (e) => errors.push(e.message));
      await touchPage.goto(base + "/games/xiangqi/");
      await touchPage.waitForSelector("[data-xiangqi][data-ready=true]");
      await touchPage.selectOption("#xiangqi-mode", "local");
      await touchPage.tap("#xiangqi-start");
      await touchPage.tap('[data-square="e3"]');
      await touchPage.tap('[data-square="e4"]');
      assert.equal(
        await touchPage.locator('[data-square="e3"] svg').count(),
        1,
      );
      assert.equal(
        await touchPage.locator("#xiangqi-confirm").isVisible(),
        true,
      );
      await touchPage.tap("#xiangqi-confirm");
      assert.equal(
        await touchPage.locator('[data-square="e4"] svg').count(),
        1,
      );
      await touchContext.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Xiangqi browser: six viewports, board-first layout, focus, moves, undo, locale preservation, draw, ICCS TXT, review, real Fairy-Stockfish and refresh recovery passed.",
    );
  } catch (e) {
    await page.screenshot({
      path: "_qa/xiangqi/browser-failure.png",
      fullPage: true,
    });
    console.error("Page errors", errors);
    throw e;
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
