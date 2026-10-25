const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const { gameClick, gameSelect } = require("../support/game-shell.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
const games = JSON.parse(fs.readFileSync("data/games.json", "utf8"));
const ranked = games.filter(
  (g) => !["connect-four", "reversi", "pong"].includes(g.slug),
);
const sdk = `export function createClient(){const id=window.__signed?'11111111-1111-4111-8111-111111111111':null;window.__calls=[];window.__rpcCalls=[];return{auth:{getSession:async()=>({data:{session:id?{user:{id}}:null}}),onAuthStateChange(){}},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async(name,args={})=>{window.__rpcCalls.push({name,args});if(name==='ensure_my_profile')return{data:{public_id:id,nickname:'Test Player',avatar_kind:'none'}};const remoteKey='qa-remote-games:'+id;const remote=JSON.parse(localStorage.getItem(remoteKey)||'{}');if(name==='save_game_save'||name==='save_private_record'){const row={id:args.record_id,data:args.payload,revision:(args.base_revision||0)+1,ack_revision:(args.base_revision||0)+1,updated_at:new Date().toISOString(),created_at:new Date().toISOString(),deleted:!!args.remove_record};remote[row.id]=row;localStorage.setItem(remoteKey,JSON.stringify(remote));return{data:row};}if(name==='get_game_save')return{data:remote[args.record_id]||null};if(name==='get_game_saves')return{data:Object.values(remote)};if(name==='get_my_game_progress')return{data:{unlocks:[],progress:{},verified_results:0,games_ranked:0}};if(name.startsWith('get_game_leaderboard')){const delay=window.__delays?.[args.difficulty]||0;if(delay)await new Promise(r=>setTimeout(r,delay));if(window.__boardFail)return{error:{message:'board unavailable'}};const top=window.__boardEmpty?[]:Array.from({length:50},(_,i)=>({rank:i+1,public_id:'22222222-2222-4222-8222-'+String(i+1).padStart(12,'0'),nickname:args.difficulty+' Player '+(i+1),score:1000-i,elapsed_ms:60000,moves:12,achieved_at:'2026-10-25T00:00:00Z',profile:{avatar_kind:'none'}}));return{data:{version:args.rules_version||(args.game==='brick-breaker'?2:1),top,me:id&&top.length?{...top[41],rank:42}:null}};}return{data:[],error:null}},functions:{invoke:async(name,{body})=>{window.__calls.push({name,body});if(window.__failStart&&name.endsWith('/start'))return{error:{message:'Temporary session failure'},data:{error:'Temporary session failure'}};return{data:{id:'33333333-3333-4333-8333-'+String(window.__calls.length).padStart(12,'0'),seed:12345,version:body.game==='brick-breaker'?2:1},error:null}}}}}`;
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const contexts = [];
  const errors = [];
  const sizes = [];
  async function context(signed = false) {
    const c = await browser.newContext();
    contexts.push(c);
    await c.addInitScript((value) => (window.__signed = value), signed);
    // Functional checks do not depend on an external font service.
    await c.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({ contentType: "text/css", body: "" }),
    );
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) => r.fulfill({ contentType: "text/javascript", body: sdk }),
    );
    c.on("page", (p) => {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("dialog", (d) => d.accept());
    });
    return c;
  }
  async function open(page, slug) {
    await page.goto("about:blank");
    await page.goto(`${base}/games/${slug}/`);
    await page
      .waitForSelector("[data-play-shell][data-ready=true]")
      .catch(async (error) => {
        console.error({
          slug,
          viewport: page.viewportSize(),
          errors,
          status: await page
            .locator("#game-status")
            .textContent()
            .catch(() => ""),
          toast: await page.locator(".toast").allTextContents(),
          module: await page.evaluate(
            async (slug) => ({
              ready: window.KenseiWorkspace?.ready,
              loaded: await Promise.race([
                import(
                  "/game-scripts/" + (slug === "pong" ? "pong.js" : "games.js")
                ).then(
                  () => "loaded",
                  (e) => String(e.stack),
                ),
                new Promise((resolve) =>
                  setTimeout(() => resolve("pending"), 1500),
                ),
              ]),
            }),
            slug,
          ),
        });
        throw error;
      });
  }
  const attr = (p, name) => p.locator("[data-game]").getAttribute(name);
  try {
    const guest = await context();
    const p = await guest.newPage();
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1100, height: 768 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await p.setViewportSize(viewport);
      for (const { slug } of games) {
        await open(p, slug);
        const stage = await p.locator(".game-board-shell").boundingBox();
        assert(
          stage.y <= (viewport.width < 761 ? 160 : 180),
          slug + " first-screen position",
        );
        assert(
          stage.y + stage.height <= viewport.height - 6,
          slug + " preview fits",
        );
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          slug + " horizontal overflow",
        );
        if (slug !== "pong") {
          assert.equal(await p.locator("#game-mode").count(), 0);
          assert.equal(await p.locator(".game-save-panel").count(), 0);
          assert.equal(
            await p
              .locator("[data-shell-entry] #game-start.primary")
              .isVisible(),
            true,
          );
          assert.equal(
            await p.locator("[data-shell-entry] #game-difficulty").count(),
            1,
          );
          assert.equal(
            await p.evaluate(() => window.__calls.length),
            0,
            "no session on load or selection",
          );
          if (ranked.some((g) => g.slug === slug)) {
            await p.waitForSelector("#game-leaderboard tbody tr");
            assert.equal(
              await p.locator("#game-leaderboard tbody tr:visible").count(),
              10,
            );
            const rail = await p.locator("#game-rank-panel").boundingBox();
            if (viewport.width >= 1100) {
              assert(Math.abs(rail.width - 300) < 2);
              assert(rail.x >= stage.x + stage.width);
              assert(
                rail.y + rail.height <= viewport.height - 3,
                "ranking controls fit viewport",
              );
            } else
              assert(
                rail.y >= stage.y + stage.height,
                "rank follows the board",
              );
          } else assert.equal(await p.locator("#game-rank-panel").count(), 0);
        }
        sizes.push({
          slug,
          ...viewport,
          top: stage.y,
          bottom: stage.y + stage.height,
        });
      }
    }
    console.log(
      "PASS 12 games at six widths: inline Start/setup, no modes or progress panel, 300px desktop rankings and mobile placement.",
    );
    const signed = await context(true);
    const q = await signed.newPage();
    await q.setViewportSize({ width: 1366, height: 768 });
    await open(q, "2048");
    await q.waitForSelector("#game-leaderboard tbody tr");
    assert.equal(await attr(q, "data-run-eligibility"), "ranked");
    assert.match(await q.locator("#game-my-rank").innerText(), /#42/);
    await q.click("#game-start");
    await q.waitForSelector("[data-run-state=playing]");
    assert.equal(await attr(q, "data-focus"), "true");
    await q.evaluate(
      () => (window.__boardNode = document.querySelector("#game-board")),
    );
    const before = await q.locator(".tile").allTextContents();
    await q.focus("#game-leaderboard");
    await q.keyboard.press("ArrowRight");
    assert.deepEqual(await q.locator(".tile").allTextContents(), before);
    await q.click("#game-board-more");
    assert.equal(
      await q.locator("#game-leaderboard tbody tr:visible").count(),
      50,
    );
    await q.click("#game-board-more");
    assert.equal(
      await q.locator("#game-leaderboard tbody tr:visible").count(),
      10,
    );
    await q.click("#game-board-collapse");
    assert.equal(await q.locator("#game-my-rank").isVisible(), true);
    await q.click("#game-board-collapse");
    await q.click("#game-board-refresh");
    await q.waitForFunction(
      () => !document.querySelector("#game-board-refresh").disabled,
    );
    assert.equal(await attr(q, "data-run-eligibility"), "ranked");
    assert.equal(await attr(q, "data-run-state"), "playing");
    assert.equal(
      await q.evaluate(
        () => window.__boardNode === document.querySelector("#game-board"),
      ),
      true,
    );
    assert.equal(
      await q.evaluate(
        () => window.__calls.filter((c) => c.name.endsWith("/abandon")).length,
      ),
      0,
    );
    await q.screenshot({ path: "_qa/game-ranking-desktop.png" });
    await q.click("#game-pause");
    assert.equal(await attr(q, "data-run-eligibility"), "local");
    await q.click("#game-resume");
    await q.waitForTimeout(700);
    await q.reload();
    await q.waitForSelector("[data-ready=true]");
    await q.waitForSelector("#game-restore:not([hidden])");
    assert.equal(await q.locator("#game-start.primary").isVisible(), true);
    assert.equal(await q.locator("#game-restore.secondary").isVisible(), true);
    assert.match(
      await q.locator("#game-save-detail").innerText(),
      /Local only/,
    );
    await q.click("#game-restore");
    await q.waitForSelector("[data-run-state=playing]");
    assert.equal(await attr(q, "data-run-eligibility"), "local");
    await gameClick(q, "#game-settings-change");
    await q.click("#game-start");
    await q.waitForSelector("[data-run-state=playing]");
    assert.equal(await attr(q, "data-run-eligibility"), "ranked");
    assert.equal(
      await q.evaluate(
        () => window.__calls.filter((c) => c.name.endsWith("/start")).length,
      ),
      1,
      "reload reset call counter; new run still ranks",
    );
    console.log(
      "PASS Top 10/50, own rank, keyboard isolation, refresh/focus do not pause, saved Continue is secondary, and a new game ranks after local restoration.",
    );
    await open(q, "memory-match");
    await q.evaluate(() => (window.__failStart = true));
    await q.click("#game-start");
    await q.waitForSelector("#game-start-local:not([hidden])");
    assert.match(
      await q.locator("#game-status").innerText(),
      /Temporary session failure/,
    );
    assert.equal(await attr(q, "data-shell-state"), "ready");
    await q.click("#game-start-local");
    await q.waitForSelector("[data-run-state=playing]");
    assert.equal(await attr(q, "data-run-eligibility"), "local");
    await q.evaluate(() => (window.__failStart = false));
    await gameClick(q, "#game-settings-change");
    await q.click("#game-start");
    await q.waitForSelector("[data-run-state=playing]");
    assert.equal(await attr(q, "data-run-eligibility"), "ranked");
    console.log(
      "PASS explicit local fallback after start failure; subsequent new games retry ranking automatically.",
    );
    await open(q, "minesweeper");
    await q.waitForSelector("#game-leaderboard tbody tr");
    await q.evaluate(
      () => (window.__delays = { intermediate: 450, expert: 25 }),
    );
    await q.selectOption("#game-difficulty", "intermediate");
    await q.selectOption("#game-difficulty", "expert");
    await q.selectOption("#game-difficulty", "beginner");
    await q.waitForTimeout(600);
    assert.match(
      await q.locator("#game-leaderboard").innerText(),
      /beginner Player/,
    );
    assert.doesNotMatch(
      await q.locator("#game-leaderboard").innerText(),
      /intermediate Player|expert Player/,
    );
    assert.equal(await q.evaluate(() => window.__calls.length), 0);
    await q.evaluate(() => (window.__boardFail = true));
    await q.click("#game-board-refresh");
    await q.waitForFunction(() =>
      document
        .querySelector("#game-leaderboard-status")
        .textContent.includes("unavailable"),
    );
    assert.equal(
      await q.locator("#game-leaderboard tbody tr:visible").count(),
      10,
      "last loaded board survives failed refresh",
    );
    await q.evaluate(() => {
      window.__boardFail = false;
      window.__boardEmpty = true;
    });
    await q.click("#game-board-refresh");
    await q.waitForFunction(() =>
      document
        .querySelector("#game-leaderboard")
        .textContent.includes("No verified results"),
    );
    console.log(
      "PASS stale leaderboard responses ignored, failures retry without clearing valid data, and truthful empty state.",
    );
    await open(q, "brick-breaker");
    await q.waitForSelector("#game-leaderboard tbody tr");
    await gameSelect(q, "#game-board-version", "1");
    await q.waitForFunction(() =>
      document
        .querySelector("#game-leaderboard caption")
        .textContent.includes("v1"),
    );
    assert.equal(await q.evaluate(() => window.__calls.length), 0);
    await gameSelect(q, "#game-board-version", "current");
    await q.waitForFunction(() =>
      document
        .querySelector("#game-leaderboard caption")
        .textContent.includes("v2"),
    );
    await p.setViewportSize({ width: 360, height: 800 });
    await open(p, "minesweeper");
    await p.screenshot({ path: "_qa/game-ranking-mobile.png" });
    for (const value of ["reduced", "off"]) {
      await gameSelect(p, "[data-effects-select]", value);
      await p.click("#game-start");
      assert.equal(await attr(p, "data-run-eligibility"), "local");
      await gameClick(p, "#game-settings-change");
    }
    await p.setViewportSize({ width: 844, height: 390 });
    await open(p, "block-drop");
    assert.equal(await p.locator("#game-start").isVisible(), true);
    assert.equal(await p.locator("#game-difficulty").isVisible(), true);
    await p.screenshot({ path: "_qa/game-ranking-landscape.png" });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/game-ranking-report.json",
      JSON.stringify({ sizes, errors }, null, 2),
    );
    console.log(
      "PASS previous rules, reduced/off effects, short landscape and no browser errors.",
    );
  } finally {
    for (const c of contexts) await c.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
