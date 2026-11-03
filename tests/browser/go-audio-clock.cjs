const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";
(async () => {
  const { createGo } = await import("../../src/games/go-engine.js");
  const board = createGo({ rule: "chinese", size: 9 }),
    id = "11111111-1111-4111-8111-111111111111";
  const sdk = `export function createClient(){const board=${JSON.stringify(board)},id='${id}';window.__clockFixture={controller:true,turn:1};const anchor=Date.now()-13000;const room=()=>({id:'22222222-2222-4222-8222-222222222222',revision:1,server_now:Date.now(),config:board.config,status:'playing',controller:window.__clockFixture.controller,color:1,channel_key:'fixture',state:{...board,turn:window.__clockFixture.turn},members:[],clock:{preset:9,remaining:{1:0,'-1':0},periods:{1:3,'-1':3},anchor}});return{auth:{getSession:async()=>({data:{session:{user:{id,user_metadata:{full_name:'Clock fixture'}},access_token:'fixture'}}}),onAuthStateChange(){}},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async(n)=>({data:n==='get_board_game_leaderboard'?{top:[],me:null}:n==='ensure_my_profile'?{public_id:id,nickname:'Clock fixture',avatar_kind:'none'}:[],error:null}),functions:{invoke:async()=>({data:room(),error:null})},channel(){const ch={on(){return ch},subscribe(fn){setTimeout(()=>fn('SUBSCRIBED'),0);return ch}};return ch},removeChannel:async()=>{}}}`;
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const c = await browser.newContext(),
      p = await c.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) => r.fulfill({ contentType: "text/javascript", body: sdk }),
    );
    await p.goto(base + "/games/go/");
    await p.waitForSelector("[data-go-phase=playing]");
    await p.evaluate(async () => {
      window.clockAudio = await import("/game-scripts/audio.js");
    });
    if (
      !(await p.evaluate(
        () =>
          typeof AudioContext === "function" ||
          typeof webkitAudioContext === "function",
      ))
    ) {
      console.log(
        "SKIP actual Go clock audio: Web Audio unavailable in this browser build",
      );
      return;
    }
    await p.locator("#game-board").focus();
    await p.keyboard.press("ArrowRight");
    await p.waitForFunction(
      () => window.clockAudio.getAudioDiagnostics().armed,
    );
    await p.waitForFunction(
      () =>
        (window.clockAudio.getAudioDiagnostics().cueCounts.countdown || 0) >= 1,
      null,
      { timeout: 10000 },
    );
    const count = await p.evaluate(
      () => window.clockAudio.getAudioDiagnostics().cueCounts.countdown || 0,
    );
    await p.evaluate(() => {
      window.__clockFixture.controller = false;
      window.dispatchEvent(new Event("online"));
    });
    await p.waitForTimeout(1400);
    assert.equal(
      await p.evaluate(
        () => window.clockAudio.getAudioDiagnostics().cueCounts.countdown || 0,
      ),
      count,
      "read-only room cannot tick",
    );
    await p.evaluate(() => {
      window.__clockFixture.controller = true;
      window.__clockFixture.turn = -1;
      window.dispatchEvent(new Event("online"));
    });
    await p.waitForTimeout(1200);
    assert.equal(
      await p.evaluate(
        () => window.clockAudio.getAudioDiagnostics().cueCounts.countdown || 0,
      ),
      count,
      "opponent turn cannot tick",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS Go real Web Audio + mocked server clock: own last-five-second cue, no read-only / opponent cue; no new timer or backend writes.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
