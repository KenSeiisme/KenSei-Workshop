// Real anonymous checks only: no mocks, account session, or production writes.
const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = (
  process.env.TEST_BASE_URL || "https://kensei-workshop.vercel.app"
).replace(/\/$/, "");
const target = new URL(base);
assert.ok(
  target.origin === "https://kensei-workshop.vercel.app" ||
    (target.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(target.hostname)),
  "Live checks may target only the canonical site or a loopback preview.",
);
const slugs = [
  "sudoku",
  "nonogram",
  "block-puzzle",
  "brick-breaker",
  "connect-four",
  "reversi",
];

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage(),
    errors = [],
    writes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes(".supabase.co/"))
      return;
    // These two RPCs are publicly readable and do not change data.
    if (
      !/\/rest\/v1\/rpc\/(get_game_leaderboard|get_public_profile)(\?|$)/.test(
        request.url(),
      )
    )
      writes.push(request.url());
  });
  const open = async (slug) => {
    const response = await page.goto(`${base}/games/${slug}/`);
    assert.equal(response.status(), 200, slug);
    await page.waitForSelector('[data-game][data-ready="true"]');
  };
  const readSave = (slug, difficulty) =>
    page.evaluate(
      async ({ slug, difficulty }) => {
        const request = indexedDB.open("kensei-record-game-v1");
        const db = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          if (!db.objectStoreNames.contains("scopes")) return null;
          const scope = await new Promise((resolve, reject) => {
            const get = db
              .transaction("scopes")
              .objectStore("scopes")
              .get("guest");
            get.onsuccess = () => resolve(get.result);
            get.onerror = () => reject(get.error);
          });
          return (
            Object.values(scope?.records || {}).find(
              (row) =>
                !row.deleted &&
                row.data.game === slug &&
                (!difficulty || row.data.difficulty === difficulty),
            )?.data || null
          );
        } finally {
          db.close();
        }
      },
      { slug, difficulty },
    );
  const waitSave = async (slug, predicate = () => true, difficulty) => {
    for (let retry = 0; retry < 45; retry++) {
      const record = await readSave(slug, difficulty);
      if (record && predicate(record)) return record;
      await page.waitForTimeout(100);
    }
    throw Error(
      `Local ${slug} save did not reach the expected state: ${JSON.stringify(await readSave(slug, difficulty))}`,
    );
  };
  const pauseAndRestore = async (slug, record) => {
    await page.click("#game-pause");
    await page.waitForTimeout(700);
    const paused = await waitSave(
      slug,
      (row) => row.state.moves >= record.state.moves,
      record.difficulty,
    );
    await page.reload();
    await page.waitForSelector('[data-game][data-ready="true"]');
    assert.equal(
      await page
        .locator(
          ".sudoku-cell,.nonogram-cell,.block-cell,.brick-canvas,.board-cell",
        )
        .count(),
      0,
      `${slug}: restore is explicit`,
    );
    await page.selectOption("#game-difficulty", record.difficulty);
    await page.waitForSelector("#game-restore:not([hidden])");
    await page.click("#game-restore");
    assert.equal(await page.inputValue("#game-mode"), "private");
    return paused;
  };
  try {
    await page.goto(base + "/games/");
    await page.waitForSelector('[data-games-directory][data-ready="true"]');
    assert.equal(await page.locator("[data-game-card]").count(), 10);
    await page.click('[data-game-filter="board"]');
    assert.equal(await page.locator("[data-game-card]:visible").count(), 2);
    for (const slug of slugs) {
      await open(slug);
      assert.equal(await page.inputValue("#game-mode"), "private");
      assert.equal(
        await page
          .locator(
            ".sudoku-cell,.nonogram-cell,.block-cell,.brick-canvas,.board-cell",
          )
          .count(),
        0,
      );
      assert.equal(await page.locator("#game-clock").innerText(), "00:00");
      assert.equal(await page.isDisabled("#game-pause"), true);
      if (["connect-four", "reversi"].includes(slug))
        assert.equal(
          await page.locator('#game-mode option[value="public"]').count(),
          0,
        );
    }
    console.log(
      "PASS live ten-game catalog and six anonymous pages: Private defaults, no automatic game or computer start.",
    );

    await open("sudoku");
    await page.click("#game-start");
    let record = await waitSave("sudoku");
    const editable = record.state.givens.findIndex((digit) => !digit);
    await page.click(`[data-puzzle-cell="${editable}"]`);
    await page.keyboard.press("n");
    await page.keyboard.press("3");
    await waitSave("sudoku", (row) => row.state.notes[editable].includes(3));
    await page.keyboard.press("n");
    await page.keyboard.press("4");
    record = await waitSave("sudoku", (row) => row.state.board[editable] === 4);
    await pauseAndRestore("sudoku", record);
    assert.match(
      await page
        .locator(`[data-puzzle-cell="${editable}"]`)
        .getAttribute("aria-label"),
      /digit 4/,
    );

    await open("nonogram");
    await page.click("#game-start");
    await page.waitForSelector(".nonogram-cell");
    await page.click('[data-puzzle-cell="0"]');
    record = await waitSave("nonogram", (row) => row.state.board[0] === 1);
    await pauseAndRestore("nonogram", record);
    assert.equal(
      await page.locator('[data-puzzle-cell="0"].is-filled').count(),
      1,
    );

    await open("block-puzzle");
    await page.click("#game-start");
    await page.waitForSelector(".block-cell");
    await page.click('[data-block-slot="0"]');
    await page.waitForTimeout(360);
    await page.click('[data-block-cell="0"]');
    record = await waitSave(
      "block-puzzle",
      (row) => row.state.moves === 1 && row.state.score > 0,
    );
    const filled = record.state.board.filter(Boolean).length;
    await pauseAndRestore("block-puzzle", record);
    assert.equal(await page.locator(".block-cell.is-filled").count(), filled);
    assert.equal(
      Number(
        (await page.locator("#game-score").innerText()).replace(/[^\d]/g, ""),
      ),
      record.state.score,
    );

    await open("brick-breaker");
    await page.click("#game-start");
    await page.waitForSelector(".brick-canvas:not([hidden])");
    await page.click("[data-brick-launch]");
    await page.locator(".brick-paddle-slider").evaluate((slider) => {
      slider.value = "160";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    record = await waitSave(
      "brick-breaker",
      (row) =>
        row.state.ticks > 30 &&
        row.state.paddle === 160 &&
        row.state.ball.launched,
    );
    const pausedBrick = await pauseAndRestore("brick-breaker", record);
    record = await waitSave(
      "brick-breaker",
      (row) =>
        row.state.ticks >= pausedBrick.state.ticks && row.state.paddle === 160,
    );
    assert.equal(
      await page.locator(".brick-canvas").getAttribute("width"),
      "640",
    );
    assert.equal(
      await page.locator(".brick-canvas").getAttribute("height"),
      "480",
    );
    assert.equal(await page.inputValue(".brick-paddle-slider"), "160");
    await page.click("#game-pause");
    console.log(
      "PASS live guest Sudoku notes/digits, Nonogram fill, Block placement/scoring and Brick launch/paddle/ticks; all four restore local progress after reload.",
    );

    await open("connect-four");
    await page.selectOption("#game-difficulty", "ai-easy");
    await page.selectOption("#game-human-side", "2");
    await page.click("#game-start");
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.board-cell[data-piece="1"]').length === 1,
    );
    await page.locator('[data-drop="3"]').first().click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.board-cell[data-piece="1"]').length === 2,
    );
    record = await waitSave(
      "connect-four",
      (row) => row.state.moves === 3,
      "ai-easy",
    );
    await pauseAndRestore("connect-four", record);
    assert.equal(await page.locator('.board-cell[data-piece="1"]').count(), 2);
    assert.equal(await page.locator('.board-cell[data-piece="2"]').count(), 1);
    assert.equal(await page.inputValue("#game-human-side"), "2");
    await open("connect-four");
    await page.selectOption("#game-difficulty", "local");
    await page.click("#game-start");
    for (const column of [0, 1, 0, 1, 0, 1, 0])
      await page.locator(`[data-drop="${column}"]`).first().click();
    assert.match(
      await page.locator(".board-turn").innerText(),
      /Player 1 wins/,
    );

    await open("reversi");
    await page.selectOption("#game-difficulty", "ai-easy");
    await page.click("#game-start");
    await page.locator(".board-cell.is-legal").first().click();
    record = await waitSave(
      "reversi",
      (row) => row.state.moves === 2,
      "ai-easy",
    );
    const discs = [...record.state.counts];
    await pauseAndRestore("reversi", record);
    assert.equal(
      await page.locator('.board-cell[data-piece="1"]').count(),
      discs[0],
    );
    assert.equal(
      await page.locator('.board-cell[data-piece="2"]').count(),
      discs[1],
    );
    await open("reversi");
    await page.selectOption("#game-difficulty", "local");
    await page.click("#game-start");
    await page.locator('[data-disc="19"]').focus();
    await page.keyboard.press("Enter");
    record = await waitSave("reversi", (row) => row.state.moves === 1, "local");
    assert.deepEqual(record.state.counts, [4, 1]);
    await pauseAndRestore("reversi", record);
    assert.equal(await page.locator('.board-cell[data-piece="1"]').count(), 4);
    assert.equal(await page.locator('.board-cell[data-piece="2"]').count(), 1);
    await page.click("#game-pause");
    console.log(
      "PASS live Connect Four and Reversi: real computer Worker, selected human side, same-device play, keyboard move, win/flip output and restored Private matches.",
    );

    const config = await page.evaluate(() => window.KENSEI_CONFIG);
    const key =
      config.supabaseAnonKey ||
      config.supabaseKey ||
      config.supabasePublishableKey;
    assert.ok(config.supabaseUrl && key);
    let publicId = process.env.LIVE_PUBLIC_PROFILE_ID || null;
    for (const [game, difficulty] of [
      ["sudoku", "normal"],
      ["nonogram", "normal"],
      ["block-puzzle", "classic"],
      ["brick-breaker", "classic"],
      ["2048", "classic"],
      ["minesweeper", "beginner"],
      ["snake", "normal"],
      ["memory-match", "normal"],
    ]) {
      const response = await context.request.post(
        config.supabaseUrl + "/rest/v1/rpc/get_game_leaderboard",
        { headers: { apikey: key }, data: { game, difficulty } },
      );
      assert.equal(response.status(), 200, `${game}: real public leaderboard`);
      const board = await response.json();
      assert.ok(Array.isArray(board.top));
      assert.equal(board.version, 1);
      assert.equal(board.me, null);
      assert.ok(
        !JSON.stringify(board).match(/"(user_id|state|seed|events|email)":/),
      );
      publicId ||= board.top[0]?.public_id || null;
    }
    for (const game of ["connect-four", "reversi"]) {
      const response = await context.request.post(
        config.supabaseUrl + "/rest/v1/rpc/get_game_leaderboard",
        { headers: { apikey: key }, data: { game, difficulty: "ai-normal" } },
      );
      assert.equal(
        response.status(),
        400,
        `${game}: private board rejects public leaderboard`,
      );
      assert.match(
        (await response.json()).message,
        /Invalid game or difficulty/,
      );
    }
    console.log(
      "PASS live read-only RPCs: four new and four legacy public boards; private chess-style boards rejected; no private fields returned.",
    );

    if (publicId) {
      assert.match(publicId, /^[0-9a-f-]{36}$/i);
      await page.goto(`${base}/profile/?id=${encodeURIComponent(publicId)}`);
      await page.waitForSelector("#public-profile:not([hidden])");
      assert.equal(await page.locator(".profile-game-card").count(), 8);
      for (const slug of slugs.slice(0, 4))
        assert.equal(
          await page
            .locator(
              `.profile-game-card[data-game-theme="${slug}"] a[href="/games/${slug}/"]`,
            )
            .count(),
          1,
        );
      assert.equal(
        await page
          .locator(
            '.profile-game-card[data-game-theme="connect-four"],.profile-game-card[data-game-theme="reversi"]',
          )
          .count(),
        0,
      );
      assert.match(
        await page.locator("#public-game-count").innerText(),
        /\/ 8$/,
      );
      console.log(
        "PASS live existing public Profile: eight ranked-game cards, four new game links, no private board matches.",
      );
    } else
      console.log(
        "SKIP live public Profile: no existing game leaderboard public ID available; no production account or score created.",
      );

    await page.setViewportSize({ width: 360, height: 1000 });
    await page.goto(base + "/games/");
    await page.waitForSelector(".saved-game-row");
    assert.ok((await page.locator(".saved-game-row").count()) >= 6);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(
      writes,
      [],
      "Anonymous play must never upload private progress or submit Public sessions.",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS live guest Continue playing, mobile layout and zero production mutations or uncaught page errors.",
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
