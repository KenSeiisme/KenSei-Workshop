const assert = require("node:assert/strict"),
  { chromium } = require("../support/browser.cjs");
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext(),
    p = await c.newPage();
  await c.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: `export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},rpc:async()=>({data:{public_id:'11111111-1111-4111-8111-111111111111',nickname:'Start game',bio:'points',avatar_kind:'none',best_scores:[],game_achievements:[],game_best_scores:[{game:'2048',difficulty:'classic',version:1,score:2048,max_tile:256,moves:100,elapsed_ms:10000,achieved_at:'2026-10-26T00:00:00Z'}]}})}}`,
      }),
  );
  await p.goto(
    (process.env.TEST_BASE_URL || "http://127.0.0.1:8771") +
      "/profile/?id=11111111-1111-4111-8111-111111111111",
  );
  await p.waitForSelector(".profile-game-card.has-score");
  await p.evaluate(() => KenseiI18n.setLocale("zh-Hant"));
  assert.equal(await p.locator("#public-name").textContent(), "Start game");
  assert.equal(await p.locator("#public-bio").textContent(), "points");
  assert.equal(
    await p
      .locator(".profile-game-card.has-score .profile-score-value span")
      .textContent(),
    "分",
  );
  assert(
    !(
      await p.locator(".profile-game-card.has-score footer").textContent()
    ).includes("mode"),
  );
  console.log(
    "PASS public profile translated score units/modes; matching English nickname and bio stay raw",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
