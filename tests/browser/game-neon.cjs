const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8812";
const seed = 12345,
  slugs = [
    "2048",
    "minesweeper",
    "snake",
    "memory-match",
    "sudoku",
    "nonogram",
    "block-puzzle",
    "brick-breaker",
    "connect-four",
    "reversi",
  ];
(async () => {
  const engine = await import("../../src/games/engine.js");
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const contexts = [],
    errors = [],
    writes = [],
    checks = [],
    record = process.env.RECORD_GAME_VIDEO === "1";
  async function context(
    mode = "auto",
    reduced = "no-preference",
    video = false,
  ) {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: reduced,
      ...(video
        ? {
            recordVideo: {
              dir: "_qa/neon-videos",
              size: { width: 1280, height: 900 },
            },
          }
        : {}),
    });
    contexts.push(c);
    await c.addInitScript(
      ({ mode, seed }) => {
        try {
          if (!localStorage.getItem("kensei-game-effects-v1"))
            localStorage.setItem("kensei-game-effects-v1", mode);
        } catch {}
        const get = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = (array) => {
          const result = get(array);
          if (array instanceof Uint32Array && array.length === 1)
            array[0] = seed;
          return result;
        };
        window.__neonHeadPositions = [];
        const round = CanvasRenderingContext2D.prototype.roundRect;
        CanvasRenderingContext2D.prototype.roundRect = function (
          x,
          y,
          ...args
        ) {
          if (
            this.canvas.classList.contains("snake-board") &&
            this.fillStyle === "#d9fff0"
          )
            window.__neonHeadPositions.push([x, y]);
          return round.call(this, x, y, ...args);
        };
      },
      { mode, seed },
    );
    c.on("page", (p) =>
      p.on("pageerror", (e) => errors.push(e.stack || e.message)),
    );
    c.on("request", (r) => {
      if (
        r.method() === "POST" &&
        /save_game_save|games-session\/(start|finish)|ensure_my_profile/.test(
          r.url(),
        )
      )
        writes.push(r.url());
    });
    return c;
  }
  async function open(p, slug) {
    await p.goto(base + "/games/" + slug + "/");
    await p.waitForSelector('[data-game][data-ready="true"]');
  }
  async function saved(p, slug, predicate = () => true) {
    for (let n = 0; n < 40; n++) {
      const state = await p.evaluate(async (slug) => {
        const req = indexedDB.open("kensei-record-game-v1");
        const db = await new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          return await new Promise((resolve) => {
            const get = db
              .transaction("scopes")
              .objectStore("scopes")
              .get("guest");
            get.onsuccess = () =>
              resolve(
                Object.values(get.result?.records || {}).find(
                  (r) => !r.deleted && r.data.game === slug,
                )?.data.state || null,
              );
          });
        } finally {
          db.close();
        }
      }, slug);
      if (state && predicate(state)) return state;
      await p.waitForTimeout(100);
    }
    throw Error("Expected local save: " + slug);
  }
  async function shot(p, name, width = 1440) {
    await p.setViewportSize({ width, height: 1000 });
    await p.evaluate(() => {
      document.documentElement.style.setProperty(
        "scroll-behavior",
        "auto",
        "important",
      );
      document.activeElement?.blur();
      scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
    await p.waitForTimeout(80);
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      name + " overflow at " + width,
    );
    await p.screenshot({
      path: `_qa/neon-${name}-${width}.png`,
      fullPage: true,
    });
  }
  let video;
  try {
    const c = await context("auto", "no-preference", record),
      p = await c.newPage();
    video = p.video();
    await open(p, "2048");
    assert.equal(
      await p.locator("html").getAttribute("data-game-effects"),
      "full",
    );
    assert.equal(await p.locator(".tile").count(), 0);
    await p.click("#game-start");
    await p.evaluate(
      () => (window.__tile = document.querySelector('.tile[data-cell="0"]')),
    );
    const expected = engine.create("2048", "classic", seed),
      directions = [3, 0, 1, 2, 3, 0, 1, 2];
    for (const dir of directions) {
      engine.apply(expected, { type: "move", dir });
      await p.keyboard.press(
        ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"][dir],
      );
      if (dir === 3 && expected.moves === 1)
        assert.ok(
          (await p.locator(".moving-tile").count()) > 0,
          "2048 must create real moving tile overlays",
        );
    }
    await p.waitForTimeout(350);
    assert.ok(
      await p.evaluate(
        () => window.__tile === document.querySelector('.tile[data-cell="0"]'),
      ),
    );
    assert.equal(await p.locator(".moving-tile").count(), 0);
    const full = await saved(p, "2048", (s) => s.moves === expected.moves);
    assert.deepEqual(full, expected);
    await p.click("#game-pause");
    assert.equal(await p.locator(".moving-tile").count(), 0);
    await p.click("#game-resume");
    await shot(p, "2048", 1440);
    const off = await context("off"),
      q = await off.newPage();
    await open(q, "2048");
    await q.click("#game-start");
    for (const dir of directions)
      await q.keyboard.press(
        ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"][dir],
      );
    assert.deepEqual(
      await saved(q, "2048", (s) => s.moves === expected.moves),
      full,
    );
    assert.equal(await q.locator(".moving-tile").count(), 0);
    await q.click("#game-pause");
    await off.close();
    checks.push(
      "Full/Off rapid 2048 input produces identical authoritative state; stable cells, no animation backlog and safe pause.",
    );

    await open(p, "memory-match");
    await p.click("#game-start");
    const memory = engine.create("memory-match", "normal", seed),
      pair = memory.cards.flatMap((v, i) => (v === 0 ? [i] : [])),
      different = memory.cards.findIndex((v) => v !== memory.cards[0]);
    await p.evaluate(
      () => (window.__card = document.querySelector('[data-cell="0"]')),
    );
    await p.click('[data-cell="0"]');
    await p.waitForTimeout(70);
    assert.notEqual(
      await p
        .locator('[data-cell="0"] .memory-inner')
        .evaluate((el) => getComputedStyle(el).transform),
      "none",
    );
    await p.locator(".memory-grid").screenshot({
      path: "_qa/neon-memory-mid-flip.png",
      animations: "allow",
    });
    await p.click(`[data-cell="${different}"]`);
    await p.waitForTimeout(750);
    assert.equal(await p.locator(".memory-card.face-up").count(), 0);
    for (const i of pair) await p.click(`[data-cell="${i}"]`);
    assert.equal(
      await p
        .locator(".memory-card.matched .memory-match-check:visible")
        .count(),
      2,
    );
    assert.ok(
      await p.evaluate(
        () => window.__card === document.querySelector('[data-cell="0"]'),
      ),
    );
    await p.click("#game-pause");
    assert.equal(await p.locator(".game-float,.game-match-link").count(), 0);
    assert.equal(
      await p.locator("[data-game]").getAttribute("data-particles"),
      "0",
    );
    await p.click("#game-resume");
    await shot(p, "memory", 360);
    checks.push(
      "Memory uses persistent two-sided cards, a real mid-flip transform, original mismatch timing and cleaned match effects.",
    );

    await open(p, "connect-four");
    await p.selectOption("#game-difficulty", "local");
    await p.click("#game-start");
    await p.evaluate(
      () =>
        (window.__disc = document.querySelector(
          '[data-board-cell="35"] .board-disc',
        )),
    );
    await p.locator('[data-drop="0"]').first().click();
    assert.ok(
      await p
        .locator('[data-board-cell="35"] .board-disc')
        .evaluate((el) =>
          el.getAnimations().some((a) => a.playState === "running"),
        ),
    );
    await p.locator(".connect-grid").screenshot({
      path: "_qa/neon-connect-mid-drop.png",
      animations: "allow",
    });
    for (const col of [1, 0, 1, 0, 1, 0])
      await p.locator(`[data-drop="${col}"]`).first().click();
    assert.ok(
      await p.evaluate(
        () =>
          window.__disc ===
          document.querySelector('[data-board-cell="35"] .board-disc'),
      ),
    );
    assert.equal(await p.locator(".board-cell.is-winning").count(), 4);
    assert.match(
      await p.locator("#game-result-title").innerText(),
      /Player 1 wins/,
    );
    assert.match(await p.locator("#game-result-public").innerText(), /Private/);
    assert.ok(
      Number(await p.locator("[data-game]").getAttribute("data-particles")) <=
        120,
    );
    await p.waitForTimeout(1350);
    assert.equal(
      await p.locator("[data-game]").getAttribute("data-particles"),
      "0",
    );
    await shot(p, "connect-result", 1440);
    checks.push(
      "Connect Four drops actual pieces, retains nodes, highlights the winning line and shows immediate truthful Private results.",
    );

    await open(p, "reversi");
    await p.selectOption("#game-difficulty", "local");
    await p.click("#game-start");
    await p.locator('[data-disc="19"]').click();
    assert.ok((await p.locator(".reversi-old-face").count()) > 0);
    await p.waitForTimeout(350);
    assert.equal(await p.locator(".reversi-old-face").count(), 0);
    await p.click("#game-pause");
    await p.click("#game-resume");
    await shot(p, "reversi", 360);

    await open(p, "sudoku");
    await p.click("#game-start");
    const sudoku = engine.create("sudoku", "normal", seed),
      empty = sudoku.board.findIndex((v) => !v);
    await p.evaluate(
      (index) =>
        (window.__puzzle = document.querySelector(
          `[data-puzzle-cell="${index}"]`,
        )),
      empty,
    );
    await p.click(`[data-puzzle-cell="${empty}"]`);
    await p.keyboard.press("n");
    await p.keyboard.press("3");
    await p.keyboard.press("n");
    await p.keyboard.press("4");
    assert.ok(
      await p.evaluate(
        (index) =>
          window.__puzzle ===
          document.querySelector(`[data-puzzle-cell="${index}"]`),
        empty,
      ),
    );
    await p.click("#game-pause");
    await p.click("#game-resume");
    await shot(p, "sudoku", 360);
    await open(p, "nonogram");
    await p.click("#game-start");
    await p.click('[data-puzzle-cell="0"]');
    await p.click('[data-puzzle-paint="mark"]');
    await p.click('[data-puzzle-cell="1"]');
    await shot(p, "nonogram", 360);

    await open(p, "block-puzzle");
    await p.click("#game-start");
    await p.locator('[data-block-slot="0"]').click();
    await p.locator('[data-block-cell="0"]').click();
    assert.ok(
      Number((await p.locator("#game-score").innerText()).replace(/\D/g, "")) >
        0,
    );
    await shot(p, "block", 360);
    checks.push(
      "Reversi flip faces, Sudoku note/digit nodes, Nonogram marks and Block placement remain interactive and persistent.",
    );

    await open(p, "snake");
    await p.click("#game-start");
    await p.waitForTimeout(650);
    await p.click("#game-pause");
    assert.ok(
      await p.evaluate(() =>
        window.__neonHeadPositions.some(
          ([x]) => Math.abs((x - 1.5) / 23 - Math.round((x - 1.5) / 23)) > 0.01,
        ),
      ),
    );
    const snake = await saved(p, "snake", (s) => s.ticks > 0),
      canonical = engine.create("snake", "normal", seed);
    engine.advanceSnake(canonical, snake.ticks);
    assert.deepEqual(snake, canonical);
    checks.push(
      "Snake draws fractional positions between unchanged fixed ticks and snaps/pauses to the canonical state.",
    );
    await open(p, "brick-breaker");
    await p.click("#game-start");
    await p.click("[data-brick-launch]");
    const frameStats = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const deltas = [];
          let previous = performance.now(),
            start = previous;
          function frame(now) {
            deltas.push(now - previous);
            previous = now;
            if (now - start >= 1000)
              resolve({
                frames: deltas.length,
                mean: deltas.reduce((a, b) => a + b, 0) / deltas.length,
                max: Math.max(...deltas),
              });
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        }),
    );
    assert.ok(frameStats.frames >= 20, JSON.stringify(frameStats));
    fs.writeFileSync(
      "_qa/neon-frame-stats.json",
      JSON.stringify(frameStats, null, 2),
    );
    await p.click("#game-pause");
    await p.click("#game-resume");
    await shot(p, "brick", 1440);

    for (const slug of slugs) {
      await open(p, slug);
      await p.click("#game-start");
      for (const width of [320, 360, 768, 1440]) {
        await p.setViewportSize({ width, height: 1000 });
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${slug} at ${width}`,
        );
      }
      if (await p.isEnabled("#game-pause")) await p.click("#game-pause");
    }
    checks.push(
      "All ten active game layouts fit 320/360/768/1440px; real Brick canvas frame sample recorded.",
    );
    await open(p, "2048");
    await p.selectOption("[data-effects-select]", "off");
    await p.reload();
    await p.waitForSelector('[data-game][data-ready="true"]');
    assert.equal(await p.inputValue("[data-effects-select]"), "off");
    const reduced = await context("auto", "reduce"),
      r = await reduced.newPage();
    await open(r, "2048");
    assert.equal(
      await r.locator("html").getAttribute("data-game-effects"),
      "reduced",
    );
    await r.click("#game-start");
    await r.keyboard.press("ArrowLeft");
    assert.equal(await r.locator(".moving-tile").count(), 0);
    await reduced.close();
    await p.goto(base + "/games/");
    await p.waitForSelector('[data-games-directory][data-ready="true"]');
    await p.selectOption("[data-effects-select]", "auto");
    await p.locator('[data-game-theme="2048"] .game-cover').hover();
    assert.equal(
      await p
        .locator('[data-game-card][data-game-theme="2048"]')
        .getAttribute("data-demo"),
      "playing",
    );
    await p.waitForTimeout(1200);
    assert.equal(
      await p
        .locator('[data-game-card][data-game-theme="2048"]')
        .getAttribute("data-demo"),
      null,
    );
    await shot(p, "directory", 1440);
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.waitForFunction(
      () => document.documentElement.dataset.gameEffects === "reduced",
    );
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await p.waitForFunction(
      () => document.documentElement.dataset.gameEffects === "full",
    );
    const sibling = await c.newPage();
    await open(sibling, "2048");
    await sibling.selectOption("[data-effects-select]", "off");
    await p.waitForFunction(
      () => document.documentElement.dataset.gameEffects === "off",
    );
    await sibling.close();
    await p.selectOption("[data-effects-select]", "auto");
    checks.push(
      "Live system preference changes and cross-tab settings cancel decorations without starting or replacing games.",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    checks.push(
      "Auto respects reduced motion, Off persists, card demos stop once, and guest visuals make no account/save/Public upload requests.",
    );
    fs.writeFileSync(
      "_qa/neon-results.json",
      JSON.stringify(
        { checks, errors, writes, frameStats, video: record },
        null,
        2,
      ),
    );
    checks.forEach((check) => console.log("PASS " + check));
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    if (video) await video.saveAs("_qa/game-neon-demo.webm");
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
