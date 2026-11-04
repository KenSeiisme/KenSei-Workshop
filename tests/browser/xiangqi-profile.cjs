const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 360, height: 800 },
    });
    await page.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) =>
        r.fulfill({
          contentType: "application/javascript",
          body: `export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},rpc:async()=>({data:{public_id:'11111111-1111-4111-8111-111111111111',nickname:'Xiangqi fixture',bio:'Private content is absent',avatar_kind:'none',best_scores:[],game_achievements:[],game_best_scores:[],chess_stats:[],board_game_stats:[],xiangqi_stats:[{rules_version:1,time_control:'10+5',played:12,wins:8,losses:3,draws:1,win_rate:8/12}]}})}}`,
        }),
    );
    await page.goto(
      (process.env.TEST_BASE_URL || "http://127.0.0.1:8769") +
        "/profile/?id=11111111-1111-4111-8111-111111111111",
    );
    await page.waitForSelector("#public-xiangqi-records");
    assert.match(
      await page.locator("#public-xiangqi-records").textContent(),
      /12 games.*8 wins.*3 losses.*1 draws.*66.7%/s,
    );
    assert.equal(
      await page.locator("#public-xiangqi-records a").getAttribute("href"),
      "/games/xiangqi/",
    );
    await page.evaluate(() => KenseiI18n.setLocale("zh-Hant"));
    assert.match(
      await page.locator("#public-xiangqi-records").textContent(),
      /中國象棋/,
    );
    assert.equal(
      await page.locator("#public-xiangqi-records a").getAttribute("href"),
      "/zh-hant/games/xiangqi/",
    );
    assert.equal(
      await page.locator("#public-name").textContent(),
      "Xiangqi fixture",
    );
    assert.equal(await page.locator("#public-chess-records").count(), 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    console.log(
      "PASS public Xiangqi stats, current Chess compatibility, bilingual links, unchanged user content and narrow profile layout (mock account API).",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
