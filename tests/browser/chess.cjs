const assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const sdk = `export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){},signInWithOAuth:async()=>({error:null})},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async(n)=>({data:n==='get_chess_leaderboard'?{top:[{rank:1,nickname:'Fixture player',public_id:'00000000-0000-4000-8000-000000000001',wins:10,played:12,losses:1,draws:1,win_rate:10/12}],me:null}:[],error:null}),functions:{invoke:async()=>({data:{error:'Unexpected online request'},error:null})}}}`;
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors = [],
    requests = [];
  await fs.mkdir("_qa/chess", { recursive: true });
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
      await page.goto(base + "/games/chess/");
      await page.waitForSelector("[data-chess][data-ready=true]");
      const layout = await page.evaluate(() => ({
        top: document.querySelector("#game-board").getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        start: document.querySelector("#chess-start").getBoundingClientRect()
          .bottom,
        board: document
          .querySelector("#game-board")
          .getBoundingClientRect()
          .toJSON(),
      }));
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
        requests.some((url) => url.includes("stockfish-19")),
        false,
        "No engine loads before Start",
      );
      if (viewport.width === 360 || viewport.width === 1440)
        await page.screenshot({
          path: `_qa/chess/ready-${viewport.width}.png`,
          fullPage: true,
        });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.selectOption("#chess-mode", "online");
    await page.click("#chess-create");
    await page.waitForSelector("#auth-dialog[open]");
    assert.doesNotMatch(
      await page.locator("#chess-entry-status").textContent(),
      /Preparing/,
    );
    await page.evaluate(() => document.querySelector("#auth-dialog").close());
    await page.selectOption("#chess-mode", "local");
    await page.click("#chess-start");
    await page.waitForSelector("[data-chess-phase=playing]");
    assert.equal(
      await page
        .locator("body")
        .evaluate((n) => n.classList.contains("game-is-focused")),
      true,
    );
    await page.click('[data-square="e2"]');
    await page.click('[data-square="e4"]');
    assert.match(await page.locator("#chess-turn").textContent(), /Black/);
    await page.click('[data-square="e7"]');
    await page.click('[data-square="e5"]');
    assert.match(await page.locator("#chess-turn").textContent(), /White/);
    await page.click("#chess-undo");
    assert.match(await page.locator("#chess-turn").textContent(), /Black/);
    const piece = page.locator('[data-square="e4"] .chess-piece img');
    assert.equal(await piece.count(), 1);
    assert.match(await piece.getAttribute("src"), /\/assets\/chess\/wp\.svg$/);
    await piece.evaluate((img) => img.decode());
    await page.click("[data-shell-focus]");
    assert.equal(await piece.count(), 1);
    await page.click("[data-shell-focus]");
    await page.evaluate(async () => {
      window.__chessBoard = document.querySelector("#game-board");
      await KenseiI18n.setLocale("zh-Hant");
    });
    assert.equal(
      await page.evaluate(
        () => window.__chessBoard === document.querySelector("#game-board"),
      ),
      true,
    );
    assert.match(page.url(), /zh-hant/);
    assert.equal(await piece.count(), 1);
    await page.evaluate(async () => KenseiI18n.setLocale("en"));
    await page.click("#chess-pause");
    assert.equal(await page.locator("#chess-paused").isVisible(), true);
    await page.click("#chess-resume");
    await page.click("#chess-draw");
    await page.click("#chess-claim");
    assert.match(
      await page.locator("#chess-draw-status").textContent(),
      /not valid/,
    );
    await page.click("#chess-offer");
    assert.equal(await page.locator("#chess-draw-offer").isVisible(), true);
    await page.click("#chess-accept");
    assert.equal(await page.locator("#chess-result").isVisible(), true);
    const download = page.waitForEvent("download");
    await page.click("#chess-result-pgn");
    const d = await download;
    assert.match(d.suggestedFilename(), /\.pgn$/);
    assert.match(await fs.readFile(await d.path(), "utf8"), /1\/2-1\/2/);
    await page.click("#chess-review");
    await page.locator("#chess-ply").fill("0");
    assert.equal(
      await page.locator('[data-square="e2"] .chess-piece img').count(),
      1,
    );
    await page.click("#chess-close-review");
    await page.click("#chess-again");
    await page.selectOption("#chess-mode", "ai");
    await page.click("#chess-start");
    await page.click('[data-square="e2"]');
    await page.click('[data-square="e4"]');
    await page.waitForFunction(
      () => document.querySelector("#chess-moves").children.length >= 2,
      { timeout: 30000 },
    );
    assert.match(await page.locator("#chess-turn").textContent(), /White/);
    assert.ok(
      requests.some((url) => url.includes("stockfish-19-lite-single.wasm")),
    );
    await page.screenshot({ path: "_qa/chess/ai-playing.png", fullPage: true });
    await page.click("#chess-pause");
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector("[data-chess][data-ready=true]");
    await page.waitForSelector("#chess-continue:not([hidden])");
    await page.click("#chess-continue");
    assert.equal(
      await page.locator('[data-square="e4"] .chess-piece img').count(),
      1,
    );
    await page.click("[data-shell-menu]");
    await page.click("#chess-new-setup");
    await page.selectOption("#chess-mode", "local");
    await page.click("#chess-start");
    await page.click("[data-shell-menu]");
    await page
      .locator("[data-shell-menu-dialog] details")
      .first()
      .evaluate((n) => (n.open = true));
    await page.fill("#chess-import-text", "7k/P7/8/8/8/8/8/7K w - - 0 1");
    await page.click("#chess-import");
    await page.click('[data-square="a7"]');
    await page.click('[data-square="a8"]');
    await page.waitForSelector("#chess-promotion[open]");
    await page.click('[data-promote="q"]');
    assert.match(
      await page.locator('[data-square="a8"]').getAttribute("aria-label"),
      /Queen/,
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
      await touchPage.goto(base + "/games/chess/");
      await touchPage.waitForSelector("[data-chess][data-ready=true]");
      await touchPage.selectOption("#chess-mode", "local");
      await touchPage.tap("#chess-start");
      await touchPage.tap('[data-square="e2"]');
      await touchPage.tap('[data-square="e4"]');
      assert.equal(
        await touchPage.locator('[data-square="e2"] .chess-piece img').count(),
        1,
      );
      assert.equal(await touchPage.locator("#chess-confirm").isVisible(), true);
      await touchPage.tap("#chess-confirm");
      assert.equal(
        await touchPage.locator('[data-square="e4"] .chess-piece img').count(),
        1,
      );
      await touchContext.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      "Chess browser: six viewports, board-first layout, focus, moves, undo, locale preservation, draw, PGN, review, real Stockfish and refresh recovery passed.",
    );
  } catch (e) {
    await page.screenshot({
      path: "_qa/chess/browser-failure.png",
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
