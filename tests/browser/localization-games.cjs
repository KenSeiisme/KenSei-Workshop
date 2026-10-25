const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
const sdk = `export function createClient(){const id='11111111-1111-4111-8111-111111111111';window.__calls=[];return {auth:{getSession:async()=>({data:{session:{user:{id}}}}),onAuthStateChange(){}},from(){return {select(){return this},order:async()=>({data:[]})}},rpc:async(name,args={})=>({data:name==='ensure_my_profile'?{public_id:id,nickname:'Start game',avatar_kind:'none'}:name.startsWith('get_game_leaderboard')?{version:args.game==='brick-breaker'?2:1,top:[],me:null}:name==='get_my_game_progress'?{unlocks:[],progress:{},verified_results:0,games_ranked:0}:name.startsWith('save_')?{id:args.record_id,data:args.payload,revision:1,ack_revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}:[],error:null}),functions:{invoke:async(name,{body})=>{__calls.push({name,body});return{data:{id:'22222222-2222-4222-8222-222222222222',seed:12345,version:body.game==='brick-breaker'?2:1}}}}}}`;
(async () => {
  const b = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await b.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: "reduce",
  });
  await context.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (r) => r.fulfill({ contentType: "application/javascript", body: sdk }),
  );
  const errors = [];
  try {
    for (const { slug } of JSON.parse(fs.readFileSync("data/games.json"))) {
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(slug + ": " + e.message));
      await p.goto(base + "/games/" + slug + "/");
      await p
        .waitForSelector("[data-play-shell][data-ready=true]")
        .catch(async (e) => {
          console.error(
            slug,
            errors,
            await p.locator(".toast").allTextContents(),
            await p.evaluate(() =>
              import("/game-scripts/games.js").then(
                () => null,
                (e) => String(e.stack),
              ),
            ),
          );
          throw e;
        });
      await p.waitForFunction(() => Array.isArray(window.__calls));
      assert.equal(await p.evaluate(() => __calls.length), 0);
      if (slug === "pong") {
        await p.evaluate(() => KenseiI18n.setLocale("zh-Hant"));
        assert.equal(await p.evaluate(() => __calls.length), 0);
        console.log("PASS Pong locale: no room/Ready/autostart");
        await p.close();
        continue;
      }
      await p.click("#game-start");
      await p.waitForSelector("[data-run-state=playing]");
      const ranked = !["connect-four", "reversi"].includes(slug);
      assert.equal(
        await p.locator("[data-game]").getAttribute("data-run-eligibility"),
        ranked ? "ranked" : "local",
      );
      await p.evaluate(
        () => (window.__board = document.querySelector("#game-board")),
      );
      const score = await p
        .locator("#game-score")
        .evaluate((n) => KenseiI18n.canonical(n));
      const calls = await p.evaluate(() => JSON.stringify(__calls));
      await p.evaluate(() => KenseiI18n.setLocale("zh-Hant"));
      assert.equal(
        await p.evaluate(
          () => __board === document.querySelector("#game-board"),
        ),
        true,
      );
      assert.equal(
        await p.locator("[data-game]").getAttribute("data-run-state"),
        "playing",
      );
      assert.equal(
        await p.locator("[data-game]").getAttribute("data-run-eligibility"),
        ranked ? "ranked" : "local",
      );
      assert.equal(
        await p.locator("#game-score").evaluate((n) => KenseiI18n.canonical(n)),
        score,
      );
      assert.equal(await p.evaluate(() => JSON.stringify(__calls)), calls);
      await p.evaluate(() => KenseiI18n.setLocale("en"));
      assert.equal(await p.evaluate(() => JSON.stringify(__calls)), calls);
      console.log(
        "PASS " +
          slug +
          ": same board, score, session and eligibility across locale switch",
      );
      await p.close();
    }
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
