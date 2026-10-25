const { gameSelect, gameClick } = require("../support/game-shell.cjs");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8812";
const games = JSON.parse(fs.readFileSync("data/games.json", "utf8"));
(async () => {
  const engine = await import("../../src/games/engine.js");
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...(process.env.RECORD_GAME_VIDEO === "1"
      ? {
          recordVideo: {
            dir: "_qa/game-experience-videos",
            size: { width: 1280, height: 900 },
          },
        }
      : {}),
  });
  const page = await context.newPage(),
    errors = [],
    writes = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("supabase.co"))
      writes.push(new URL(r.url()).pathname);
  });
  await context.addInitScript(() => {
    window.__audioCreated = 0;
    window.__audioRunning = 0;
    window.__maxVoices = 0;
    window.__voices = 0;
    const Native = window.AudioContext;
    if (Native)
      window.AudioContext = class extends Native {
        constructor() {
          super();
          window.__audioCreated++;
          this.addEventListener("statechange", () => {
            if (this.state === "running") window.__audioRunning++;
          });
        }
        createOscillator() {
          const o = super.createOscillator();
          window.__voices++;
          window.__maxVoices = Math.max(window.__maxVoices, window.__voices);
          o.addEventListener("ended", () => window.__voices--);
          return o;
        }
      };
  });
  const profile = {
    public_id: "11111111-1111-4111-8111-111111111111",
    nickname: "Player",
    bio: "Verified test record",
    avatar_kind: "none",
    best_scores: [],
    game_achievements: [],
    game_best_scores: [
      {
        game: "brick-breaker",
        difficulty: "classic",
        version: 2,
        score: 800,
        max_tile: 0,
        moves: 100,
        elapsed_ms: 60000,
        achieved_at: "2026-10-23T12:00:00Z",
      },
    ],
    game_legacy_best_scores: [
      {
        game: "brick-breaker",
        difficulty: "classic",
        version: 1,
        score: 400,
        max_tile: 0,
        moves: 90,
        elapsed_ms: 55000,
        achieved_at: "2026-10-22T12:00:00Z",
      },
    ],
  };
  await context.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},rpc:async(name,args)=>({data:name==='get_public_profile'?${JSON.stringify(profile)}:{version:name==='get_game_leaderboard_history'?1:(args.game==='brick-breaker'?2:1),top:[],me:null},error:null})}}`,
      }),
  );
  const open = async (slug) => {
    await page.goto(base + "/games/" + slug + "/");
    await page.waitForSelector("[data-ready=true]");
  };
  const current = () =>
    page.evaluate(async () => {
      const request = indexedDB.open("kensei-record-game-v1");
      const db = await new Promise(
        (r) => (request.onsuccess = () => r(request.result)),
      );
      try {
        return await new Promise((r) => {
          const q = db.transaction("scopes").objectStore("scopes").get("guest");
          q.onsuccess = () =>
            r(
              Object.values(q.result?.records || {}).find(
                (x) =>
                  x.data.game === "brick-breaker" && x.data.state.version === 2,
              )?.data.state,
            );
        });
      } finally {
        db.close();
      }
    });
  async function replaceSaved(state, legacy = false) {
    await page.evaluate(
      async ({ state, legacy }) => {
        const request = indexedDB.open("kensei-record-game-v1");
        const db = await new Promise(
          (r) => (request.onsuccess = () => r(request.result)),
        );
        try {
          await new Promise((resolve, reject) => {
            const tx = db.transaction("scopes", "readwrite"),
              store = tx.objectStore("scopes"),
              q = store.get("guest");
            q.onsuccess = () => {
              const scope = q.result,
                row = Object.values(scope.records).find(
                  (x) =>
                    x.data.game === "brick-breaker" &&
                    x.data.state.version === 2,
                );
              const copy = structuredClone(row);
              copy.data.state = state;
              copy.data.elapsed = (state.ticks * 1000) / 60;
              copy.data.best = null;
              copy.data.name = legacy ? "Legacy Brick" : "Brick v2";
              if (legacy) {
                copy.id = "99999999-1111-4111-8111-111111111111";
                copy.updated_at = "2026-10-23T23:59:59Z";
              }
              scope.records[copy.id] = copy;
              store.put(scope, "guest");
            };
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      },
      { state, legacy },
    );
  }
  try {
    await open("brick-breaker");
    assert.equal(
      await page.evaluate(() => window.__audioCreated),
      0,
      "Loading must be silent without an AudioContext",
    );
    assert.equal(await page.locator(".brick-paddle-slider").count(), 0);
    assert.equal(
      await page.locator("[data-audio-toggle]").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page.locator("#game-rank-panel").evaluate((n) => n.open),
      false,
    );
    await gameClick(page, "#game-start");
    await page.waitForSelector(".brick-canvas");
    await page.waitForTimeout(550);
    assert.equal((await current()).version, 2);
    assert.equal(await page.locator(".brick-paddle-slider").count(), 0);
    assert.equal(
      await page
        .locator("#game-start")
        .evaluate((n) => n.classList.contains("primary")),
      false,
    );
    assert.match(await page.locator(".brick-rules").innerText(), /v2/);
    await page.locator(".brick-canvas").press("Space");
    await page.waitForTimeout(200);
    assert.equal(await page.locator(".brick-launch").isVisible(), false);
    assert((await page.evaluate(() => window.__audioCreated)) > 0);
    assert((await page.evaluate(() => window.__audioRunning)) > 0);
    await page.evaluate(async () => {
      const a = await import("/game-scripts/audio.js");
      for (let i = 0; i < 100; i++) a.playCue("brick");
    });
    assert((await page.evaluate(() => window.__maxVoices)) <= 8);
    await page.click("#game-pause");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__voices), 0);
    const seeded = engine.create("brick-breaker", "classic", 42);
    Object.assign(seeded.balls[0], {
      launched: true,
      x: 320 * 1024,
      y: 300 * 1024,
      vx: 2048,
      vy: 0,
    });
    seeded.drops = [1, 2, 3].map((kind, i) => ({
      id: i + 1,
      kind,
      x: 320 * 1024,
      y: 436 * 1024 - 1,
    }));
    seeded.nextDropId = 4;
    await replaceSaved(seeded);
    await page.reload();
    await page.waitForSelector("#game-restore:not([hidden])");
    await page.click("#game-restore");
    await page.waitForFunction(() =>
      document
        .querySelector(".brick-ball-count")
        ?.textContent.includes("3 / 3"),
    );
    assert.match(
      await page.locator(".brick-buffs").innerText(),
      /Wide paddle.*Slow ball/,
    );
    await page.click("#game-pause");
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.activeElement?.blur();
      scrollTo(0, 0);
    });
    await page.screenshot({
      path: "_qa/experience-brick-desktop.png",
      fullPage: true,
    });
    await page.click("[data-audio-toggle]");
    await page.goto(base + "/games/snake/");
    await page.waitForSelector("[data-ready=true]");
    assert.equal(
      await page.locator("[data-audio-toggle]").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(await page.evaluate(() => window.__audioCreated), 0);
    await open("brick-breaker");
    await page.waitForSelector("#game-restore:not([hidden])");
    await replaceSaved(engine.create("brick-breaker", "classic", 5, 1), true);
    await page.goto(base + "/games/");
    await page.waitForSelector(".saved-game-row");
    assert.match(await page.locator("#game-saves").innerText(), /Legacy rules/);
    await page.goto(
      base + "/games/brick-breaker/?save=99999999-1111-4111-8111-111111111111",
    );
    await page.waitForSelector("#game-restore:not([hidden])");
    await page.click("#game-restore");
    await page.waitForSelector(".brick-rules");
    assert.match(await page.locator(".brick-rules").innerText(), /Legacy/);
    await page.click("#game-pause");
    await gameClick(page, "#game-rank-panel>summary");
    await gameSelect(page, "#game-board-version", "1");
    await page.waitForFunction(() =>
      document
        .querySelector("#game-leaderboard-status")
        .textContent.includes("archived"),
    );
    await page.goto(base + "/profile/?id=" + profile.public_id);
    await page.waitForSelector("#public-profile:not([hidden])");
    assert.equal(await page.locator(".profile-game-card").count(), 9);
    assert.match(
      await page.locator(".profile-legacy-scores").innerText(),
      /Previous rules/,
    );
    assert.match(
      await page.locator("#public-game-count").innerText(),
      /1 \/ 9/,
    );
    for (const width of [320, 360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const { slug } of games) {
        await open(slug);
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " overflow " + width,
        );
        if (slug !== "pong") {
          await gameClick(page, "#game-start");
          await page.waitForTimeout(40);
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            slug + " active overflow " + width,
          );
        }
        if (slug === "brick-breaker") {
          assert.equal(await page.locator(".brick-paddle-slider").count(), 0);
          if (width === 360) {
            for (const b of await page.locator("[data-brick-move]").all()) {
              const box = await b.boundingBox();
              assert(box.width >= 44 && box.height >= 44);
            }
          }
          await page.evaluate(() => {
            document.activeElement?.blur();
            scrollTo(0, 0);
          });
          await page.screenshot({
            path: `_qa/experience-brick-${width}.png`,
            fullPage: true,
          });
        }
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log(
      "PASS all12 ready/active layouts at320/360/768/1440, no sliders, direct launch, actual bounded audio/default/mute persistence, 3-ball pickup/buffs, pause silence, Legacy restore/archive/Profile and no guest writes.",
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
