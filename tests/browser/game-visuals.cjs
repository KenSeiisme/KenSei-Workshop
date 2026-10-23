const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8812";
const id = "55555555-5555-4555-8555-555555555555";
const date = "2026-10-22T03:00:00Z";
const record = (game, difficulty, extra) => ({
  game,
  difficulty,
  version: 1,
  score: 0,
  max_tile: 0,
  moves: 0,
  elapsed_ms: 42000,
  achieved_at: date,
  ...extra,
});
// Only fixture data is exposed to the mocked public API; no real accounts are edited.
const profile = {
  public_id: id,
  nickname: "Workshop Player 王明",
  bio: "A little curiosity. A few personal bests.\nHere for the next small challenge.",
  avatar_kind: "none",
  best_scores: [
    {
      language: "en",
      speed: 82.4,
      accuracy: 98.75,
      achieved_at: date,
      version: 1,
    },
    {
      language: "zh",
      speed: 136,
      accuracy: 99.1,
      achieved_at: date,
      version: 1,
    },
  ],
  game_best_scores: [
    record("2048", "classic", { score: 18432, max_tile: 2048 }),
    record("minesweeper", "beginner", { elapsed_ms: 18750 }),
    record("minesweeper", "intermediate", { elapsed_ms: 76120 }),
    record("snake", "normal", { score: 250 }),
    record("snake", "fast", { score: 180 }),
    record("memory-match", "normal", { moves: 12 }),
    record("memory-match", "hard", { moves: 19, elapsed_ms: 65050 }),
  ],
};
const sdk = `export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},from(){return{select(){return this},order:async()=>({data:[],error:null})}},rpc:async(name,args)=>{if(name==='get_public_profile')return{data:window.__publicFixture,error:null};if(name==='get_game_leaderboard')return{data:{version:1,me:null,top:[1,2,3].map(n=>({rank:n,public_id:'${id}',nickname:n===1?'Workshop Player 王明':'Player '+n,profile:{nickname:'Player '+n,avatar_kind:'none'},score:2400-n*100,moves:12+n,elapsed_ms:21000+n*1000,achieved_at:'${date}'}))},error:null};return{data:[],error:null}}}}`;
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [],
    checks = [],
    writes = [];
  try {
    fs.mkdirSync("_qa", { recursive: true });
    await context.addInitScript((p) => {
      window.__publicFixture = p;
    }, profile);
    await context.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) =>
        r.fulfill({
          contentType: "application/javascript",
          body: sdk,
          headers: { "access-control-allow-origin": "*" },
        }),
    );
    context.on("page", (p) => {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("request", (r) => {
        if (/games-session\/(start|finish)|save_game_save/.test(r.url()))
          writes.push(r.url());
      });
    });
    const p = await context.newPage();
    async function fit(width, label) {
      await p.setViewportSize({ width, height: 1000 });
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${label}: overflow at ${width}`,
      );
    }
    async function shot(name, width) {
      await fit(width, name);
      await p.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await p.screenshot({ path: `_qa/${name}-${width}.png`, fullPage: true });
    }
    await p.goto(base + "/games/");
    await p.waitForSelector("#game-saves .game-empty-state");
    for (const width of [320, 360, 768, 1440]) {
      await fit(width, "directory");
      assert(
        await p.evaluate(() => {
          const caption = document
            .querySelector(".games-art-caption")
            .getBoundingClientRect();
          return [...document.querySelectorAll(".games-hero-tile")].every(
            (el) => el.getBoundingClientRect().bottom < caption.top,
          );
        }),
        `hero art overlaps caption at ${width}`,
      );
    }
    await p.click('a[href="#games-library"]');
    await p.waitForTimeout(250);
    assert(
      await p
        .locator("#games-library-heading")
        .evaluate((el) => el.getBoundingClientRect().top >= 72),
    );
    await p.fill("#game-search", "snake");
    assert.equal(await p.locator("[data-game-card]:visible").count(), 1);
    await p.fill("#game-search", "");
    await p.click('[data-game-filter="puzzle"]');
    assert.equal(await p.locator("[data-game-card]:visible").count(), 6);
    await p.click('[data-game-filter="all"]');
    await shot("games-visual-directory", 1440);
    checks.push("directory search, filters, anchor and four responsive sizes");
    for (const game of ["2048", "minesweeper", "snake", "memory-match"]) {
      await p.goto(base + `/games/${game}/`);
      await p.waitForSelector('[data-game][data-ready="true"]');
      await p.waitForSelector("#game-leaderboard tbody tr");
      assert.equal(
        await p.locator("#game-run-label").innerText(),
        "Ready to play",
      );
      for (const width of [320, 360, 768, 1440])
        await fit(width, game + " ready");
      if (game === "minesweeper")
        await p.selectOption("#game-difficulty", "expert");
      await p.click("#game-start");
      assert.match(
        await p.locator("#game-run-label").innerText(),
        /Private · Playing/,
      );
      if (game === "snake") {
        await p
          .locator(".snake-board")
          .screenshot({ path: "_qa/games-visual-snake-canvas.png" });
        await p.click("#game-pause");
      }
      if (game === "memory-match") {
        await p.waitForTimeout(650);
        const cards = await p.evaluate(async () => {
          const request = indexedDB.open("kensei-record-game-v1");
          const db = await new Promise(
            (resolve) => (request.onsuccess = () => resolve(request.result)),
          );
          const state = await new Promise((resolve) => {
            const get = db
              .transaction("scopes")
              .objectStore("scopes")
              .get("guest");
            get.onsuccess = () =>
              resolve(
                Object.values(get.result.records).find(
                  (r) => r.data.game === "memory-match",
                ).data.state,
              );
          });
          db.close();
          return state.cards;
        });
        const pair = cards.flatMap((n, i) => (n === 0 ? [i] : []));
        for (const i of pair) await p.click(`[data-cell="${i}"]`);
        await p.click(`[data-cell="${cards.findIndex((n) => n === 1)}"]`);
        assert.equal(await p.locator(".memory-match-check").count(), 2);
        assert.equal(await p.locator(".memory-card.face-up").count(), 1);
      }
      if (game === "minesweeper") {
        await p.click('[data-mine-mode="flag"]');
        await p.click('[data-cell="0"]');
        assert.match(
          await p.locator('[data-cell="0"]').getAttribute("class"),
          /flagged/,
        );
      }
      for (const width of [320, 360, 768, 1440])
        await fit(width, game + " active");
      if (game === "2048") {
        await p.focus("#game-board");
        await p.keyboard.press("ArrowLeft");
        assert.equal(await p.locator(".tile").count(), 16);
        assert.equal(
          await p
            .locator(".tile.is-new")
            .first()
            .evaluate((el) => getComputedStyle(el).animationName),
          "none",
        );
      }
      await shot("games-visual-" + game, game === "memory-match" ? 360 : 1440);
      if (game !== "snake") await p.click("#game-pause");
      assert.match(await p.locator("#game-run-label").innerText(), /Paused/);
      await p.click("#game-settings-change");
      await p.waitForFunction(
        () =>
          document.querySelector("#game-run-label").textContent ===
          "Ready to play",
      );
      assert.equal(
        await p.locator("#game-run-label").innerText(),
        "Ready to play",
      );
    }
    checks.push(
      "all game boards: ready, playing, paused, settings, responsive layout and reduced motion",
    );
    await p.goto(base + "/profile/?id=" + id);
    await p.waitForSelector('#profile-page[data-ready="true"]');
    assert.equal(await p.locator("#public-game-count").innerText(), "4 / 8");
    assert.equal(await p.locator("#public-typing-count").innerText(), "2 / 2");
    assert.equal(await p.locator(".profile-game-card.has-score").count(), 4);
    assert.equal(await p.locator(".profile-game-extra").count(), 3);
    assert.match(
      await p.locator('[data-game-theme="2048"]').innerText(),
      /Largest tile · 2,048/,
    );
    assert.match(
      await p
        .locator('[data-game-theme="memory-match"] .profile-featured-score')
        .innerText(),
      /Normal · 8 pairs/,
    );
    assert.match(
      await p.locator('[data-game-theme="minesweeper"]').innerText(),
      /18.75/,
    );
    assert.equal(
      await p.locator("#public-best-scores .profile-typing-card").count(),
      2,
    );
    assert.equal(await p.locator("h1:visible").count(), 1);
    for (const width of [320, 360, 768, 1440])
      await shot("profile-games-populated", width);
    // The existing retry control re-renders into the same stable containers.
    await p.evaluate(() => {
      document.querySelector("#profile-retry").hidden = false;
    });
    await p.click("#profile-retry");
    await p.waitForFunction(
      () => document.querySelector("#profile-status").textContent === "",
    );
    assert.equal(await p.locator(".profile-game-card").count(), 8);
    await p.evaluate(() => {
      window.__publicFixture = {
        ...window.__publicFixture,
        nickname: "王明的公开资料支持中文长名字与空格测试",
        bio: "<img src=x onerror=alert(1)>".repeat(8),
        game_best_scores: [],
        best_scores: [],
      };
      document.querySelector("#profile-retry").hidden = false;
    });
    await p.click("#profile-retry");
    await p.waitForFunction(
      () =>
        document.querySelector("#public-game-count").textContent === "0 / 8",
    );
    assert.equal(await p.locator(".profile-game-card.no-score").count(), 8);
    assert.equal(await p.locator("#public-bio img").count(), 0);
    for (const width of [320, 360, 768, 1440])
      await fit(width, "empty and long-name profile");
    await shot("profile-games-empty", 360);
    checks.push(
      "public game cards: all difficulties, accurate units, empty states, long Chinese names, safe text and idempotent rendering",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    fs.writeFileSync(
      "_qa/game-visuals-results.json",
      JSON.stringify(
        {
          base,
          checks,
          errors,
          writes,
          fixture:
            "Synthetic public profile and leaderboard; actual native browser game play",
        },
        null,
        2,
      ),
    );
    checks.forEach((c) => console.log("PASS " + c));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
