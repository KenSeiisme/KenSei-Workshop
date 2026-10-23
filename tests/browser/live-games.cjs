const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  crypto = require("node:crypto"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "https://kensei-workshop.vercel.app";
(async () => {
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    p = await context.newPage(),
    errors = [],
    writes = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    if (/save_game_save|games-session\/(start|finish)/.test(r.url()))
      writes.push(r.url());
  });
  try {
    for (const path of [
      "/games/",
      "/games/2048/",
      "/games/minesweeper/",
      "/games/snake/",
      "/games/memory-match/",
      "/games/sudoku/",
      "/games/nonogram/",
      "/games/block-puzzle/",
      "/games/brick-breaker/",
      "/games/connect-four/",
      "/games/reversi/",
      "/tools/",
      "/profile/",
      "/workspace/",
      "/projects/",
    ]) {
      const response = await p.goto(base + path);
      assert.equal(response.status(), 200, path);
    }
    console.log(
      "PASS live Games routes, tools, profile, workspace and projects",
    );
    await p.goto(base + "/games/2048/");
    await p.waitForSelector('[data-game][data-ready="true"]');
    assert.equal(await p.inputValue("#game-mode"), "private");
    assert.equal(await p.locator(".tile").count(), 0);
    await p.waitForFunction(() =>
      document
        .querySelector("#game-leaderboard-status")
        .textContent.includes("Top 50"),
    );
    await p.click("#game-start");
    await p.waitForTimeout(700);
    assert.equal(await p.locator(".tile").count(), 16);
    await p.focus("#game-board");
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight"]) {
      await p.keyboard.press(key);
      if (await p.isEnabled("#game-undo")) break;
    }
    assert.equal(await p.isEnabled("#game-undo"), true);
    await p.click("#game-undo");
    await p.click("#game-pause");
    await p.reload();
    await p.waitForSelector("#game-restore:not([hidden])");
    await p.click("#game-restore");
    assert.equal(await p.inputValue("#game-mode"), "private");
    await p.goto(base + "/games/");
    await p.waitForSelector(".saved-game-row");
    await p.fill("#game-search", "snake");
    assert.equal(await p.locator("[data-game-card]:visible").count(), 1);
    await p.goto(base + "/games/memory-match/");
    await p.waitForSelector('[data-game][data-ready="true"]');
    await p.click("#game-start");
    await p.waitForTimeout(750);
    const cards = await p.evaluate(async () => {
      const r = indexedDB.open("kensei-record-game-v1");
      const db = await new Promise(
        (resolve) => (r.onsuccess = () => resolve(r.result)),
      );
      return new Promise((resolve) => {
        const g = db.transaction("scopes").objectStore("scopes").get("guest");
        g.onsuccess = () =>
          resolve(
            Object.values(g.result.records).find(
              (x) => x.data.game === "memory-match",
            ).data.state.cards,
          );
      });
    });
    for (let pair = 0; pair < 8; pair++)
      for (let i = 0; i < cards.length; i++)
        if (cards[i] === pair) await p.click(`[data-cell="${i}"]`);
    await p.waitForFunction(() =>
      document.querySelector("#game-status").textContent.includes("Complete"),
    );
    assert.equal(await p.locator("#game-score").innerText(), "8");
    await p.goto(base + "/games/minesweeper/");
    await p.waitForSelector('[data-game][data-ready="true"]');
    await p.click("#game-start");
    await p.click('[data-mine-mode="flag"]');
    await p.click('[data-cell="0"]');
    assert.match(await p.locator("#mine-count").innerText(), /1 flags/);
    await p.click('[data-cell="0"]');
    await p.click('[data-mine-mode="reveal"]');
    await p.click('[data-cell="40"]');
    assert.match(
      await p.locator('[data-cell="40"]').getAttribute("aria-label"),
      /0 neighboring mines/,
    );
    await p.click("#game-pause");
    await p.goto(base + "/games/snake/");
    await p.waitForSelector('[data-game][data-ready="true"]');
    await p.click("#game-start");
    await p.waitForTimeout(300);
    await p.click("#game-pause");
    assert.equal(await p.locator("#game-overlay").isVisible(), true);
    assert.deepEqual(writes, []);
    console.log(
      "PASS live four-game play, actual local progress, reload recovery, undo, matching completion, mine safety and no guest save uploads",
    );
    const config = await p.evaluate(() => window.KENSEI_CONFIG),
      key =
        config.supabaseAnonKey ||
        config.supabaseKey ||
        config.supabasePublishableKey;
    for (const [game, difficulty] of [
      ["2048", "classic"],
      ["minesweeper", "beginner"],
      ["snake", "normal"],
      ["memory-match", "normal"],
    ]) {
      const r = await context.request.post(
        config.supabaseUrl + "/rest/v1/rpc/get_game_leaderboard",
        { headers: { apikey: key }, data: { game, difficulty } },
      );
      assert.equal(r.status(), 200);
      assert.ok(Array.isArray((await r.json()).top));
    }
    const denied = await context.request.post(
      config.supabaseUrl + "/functions/v1/games-session/start",
      {
        headers: { apikey: key },
        data: { game: "snake", difficulty: "normal" },
      },
    );
    assert.equal(denied.status(), 401);
    console.log(
      "PASS live anonymous public boards and unauthorized Public start denial",
    );
    for (const path of [
      "app.js",
      "games.css",
      "game-neon.css",
      "puzzle-games.css",
      "arcade-games.css",
      "board-games.css",
      "profile.css",
      "game-scripts/engine.js",
      "game-scripts/dom.js",
      "game-scripts/effects.js",
      "game-scripts/motion.js",
      "game-scripts/motion-state.js",
      "game-scripts/presentation.js",
      "game-scripts/puzzle-engine.js",
      "game-scripts/puzzle-bank.js",
      "game-scripts/puzzle-ui.js",
      "game-scripts/arcade-engine.js",
      "game-scripts/arcade-ui.js",
      "game-scripts/arcade-paint.js",
      "game-scripts/board-engine.js",
      "game-scripts/board-ui.js",
      "game-scripts/board-ai-worker.js",
      "game-scripts/new-game-ui.js",
      "game-scripts/games.js",
      "game-scripts/session-client.js",
      "tool-scripts/record-store.js",
      "tool-scripts/profile.js",
      "vendor/licenses/2048.txt",
    ]) {
      const r = await context.request.get(base + "/" + path);
      assert.equal(r.status(), 200, path);
      assert.equal(
        crypto
          .createHash("sha256")
          .update(await r.body())
          .digest("hex"),
        crypto
          .createHash("sha256")
          .update(fs.readFileSync("dist/" + path))
          .digest("hex"),
        path,
      );
    }
    await p.goto(base + "/tools/");
    assert.equal(await p.locator("[data-tool-card]").count(), 28);
    await p.fill("#tool-search", "2048");
    assert.equal(await p.locator("[data-tool-card]:visible").count(), 0);
    await p.goto(base + "/");
    assert.equal(await p.locator("[data-tool-card]").count(), 28);
    assert.equal(await p.locator(".game-card").count(), 0);
    assert.deepEqual(await p.locator("#navigation a").allTextContents(), [
      "Home",
      "Tools",
      "Games",
      "Projects",
      "About Me ↗",
    ]);
    await p.setViewportSize({ width: 360, height: 900 });
    await p.goto(base + "/games/");
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({
      path: "_qa/games-production-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS live release asset hashes, independent catalogs, tools-first homepage, navigation and mobile layout",
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
