const assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";
const sdk = `export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){},signInWithOAuth:async()=>({error:null})},from(){return {select(){return this},order:async()=>({data:[]})}},rpc:async(n)=>({data:n==='get_board_game_leaderboard'?{top:[],me:null}:[],error:null}),functions:{invoke:async()=>({data:{error:'Unexpected online request'},error:null})}}}`;
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext(),
    errors = [];
  await context.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (r) => r.fulfill({ contentType: "text/javascript", body: sdk }),
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  try {
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(base + "/games/go/");
      await page.waitForSelector("[data-go][data-ready=true]");
      const layout = await page.evaluate(() => ({
        board: document.querySelector("#game-board").getBoundingClientRect()
          .top,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      if (layout.board > (viewport.width < 600 ? 160 : 180)) {
        await page.screenshot({
          path: "_qa/go/layout-failure.png",
          fullPage: true,
        });
        console.log(
          await page.evaluate(() =>
            [".header", ".game-shell-toolbar", ".go-hud", ".go-stage"].map(
              (s) => ({
                s,
                rect: JSON.stringify(
                  document.querySelector(s).getBoundingClientRect(),
                ),
              }),
            ),
          ),
        );
      }
      assert.ok(
        layout.board <= (viewport.width < 600 ? 160 : 180),
        JSON.stringify({ viewport, ...layout }),
      );
      assert.equal(layout.overflow, false);
      assert.equal(await page.locator("#go-start").isVisible(), true);
      if (viewport.width === 360 || viewport.width === 1440)
        await page.screenshot({
          path: `_qa/go/ready-${viewport.width}.png`,
          fullPage: true,
        });
    }
    await page.selectOption("#go-mode", "local");
    await page.click("#go-start");
    await page.waitForSelector("[data-go-phase=playing]");
    assert.equal(
      await page
        .locator("body")
        .evaluate((n) => n.classList.contains("game-is-focused")),
      true,
    );
    const board = page.locator("#game-board");
    await board.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
    assert.match(await page.locator("#go-turn").textContent(), /White/);
    await page.click("#go-undo");
    assert.match(await page.locator("#go-turn").textContent(), /Black/);
    await page.click("#go-pass");
    await page.click("#go-pass");
    await page.waitForSelector("#go-scoring:not([hidden])");
    await page.click("#go-score-confirm");
    await page.click("#go-score-confirm");
    await page.waitForSelector("#go-result:not([hidden])");
    const download = page.waitForEvent("download");
    await page.click("#go-export-result");
    const sgf = await download;
    assert.match(sgf.suggestedFilename(), /\.sgf$/);
    await page.click("#go-review");
    await page.locator("#go-review-ply").fill("1");
    await page.click("#go-review-close");
    await page.click("#go-again");
    await page.selectOption("#go-mode", "ai");
    await page.locator("#go-advanced summary").click();
    await page.selectOption("#go-human", "-1");
    await page.click("#go-start");
    await page.waitForTimeout(3000);
    assert.match(await page.locator("#go-turn").textContent(), /White/);
    await page.click("#go-pause");
    const pausedTime = await page.locator("#go-white-clock").textContent();
    await page.waitForTimeout(650);
    assert.equal(
      await page.locator("#go-white-clock").textContent(),
      pausedTime,
    );
    assert.notEqual(pausedTime, "—");
    await page.reload();
    await page.waitForSelector("[data-go][data-ready=true]");
    await page.waitForSelector("#go-continue:not([hidden])");
    await page.click("#go-continue");
    assert.equal(
      await page.locator("[data-go]").getAttribute("data-go-phase"),
      "playing",
    );
    await page.goto(base + "/zh-hant/games/go/");
    await page.waitForSelector("[data-ready=true]");
    assert.match(await page.locator("h1").textContent(), /圍棋/);
    await page.selectOption("#go-mode", "local");
    await page.check("#go-training");
    await page.click("#go-start");
    await board.focus();
    await page.keyboard.press("Enter");
    assert.doesNotMatch(
      await board.getAttribute("aria-label"),
      /Black|White|黑|白/,
    );
    assert.equal(await page.locator("#go-peek").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      "PASS Go responsive first screen, local play/undo/scoring, SGF download, AI worker, restore, bilingual and memory privacy (mocked account API).",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
