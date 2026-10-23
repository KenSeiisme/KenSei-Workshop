const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8812";

(async () => {
  const { gameDatabase } = await import("../support/games-fixture.mjs");
  const engine = await import("../../src/games/engine.js");
  const puzzles = await import("../../src/games/puzzle-engine.js");
  const boards = await import("../../src/games/board-engine.js");
  const arcade = await import("../../src/games/arcade-engine.js");
  const { build } = await import("esbuild");
  await build({
    entryPoints: ["supabase/functions/games-session/index.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: "_qa/games-expansion-edge.mjs",
  });
  const { makeHandler } = await import("../../_qa/games-expansion-edge.mjs");
  const {
    db,
    users: [A, B],
    rpc,
    admin,
  } = await gameDatabase();
  let chain = Promise.resolve();
  const serial = (fn) => {
    const task = chain.catch(() => {}).then(fn);
    chain = task;
    return task;
  };
  const calls = [],
    errors = [],
    sessions = [],
    contexts = [];
  const handler = makeHandler(
    (key) =>
      ({
        SUPABASE_URL: "https://backend.test",
        SUPABASE_SERVICE_ROLE_KEY: "test-server-key",
      })[key],
    async (url, options) => {
      if (url.endsWith("/auth/v1/user"))
        return Response.json({
          id: options.headers.Authorization.includes("userB") ? B : A,
        });
      const body = JSON.parse(options.body);
      try {
        return Response.json(
          await serial(() => admin(body.action, body.owner, body.body)),
        );
      } catch (error) {
        return Response.json({ message: error.message }, { status: 400 });
      }
    },
  );
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  async function context(user = null) {
    const c = await browser.newContext();
    contexts.push(c);
    await c.addInitScript(
      ({ id }) => {
        window.__qaUser = id;
      },
      { id: user },
    );
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: `export function createClient(){const id=window.__qaUser;return{auth:{getSession:async()=>({data:{session:id?{user:{id},access_token:"aaa.userA.ccc"}:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async(name,args)=>{const r=await fetch("/__qa/expansion/rpc/"+name,{method:"POST",headers:{"x-user":id||""},body:JSON.stringify(args)});return r.json()},functions:{invoke:async(name,{body})=>{const r=await fetch("/__qa/expansion/functions/"+name.split("/").at(-1),{method:"POST",headers:{"x-user":id||""},body:JSON.stringify(body)});const data=await r.json();return r.ok?{data}:{error:{message:data.error,context:{json:async()=>data}},data:null}}}}}`,
        }),
    );
    await c.route("**/__qa/expansion/rpc/*", async (r) => {
      const name = r.request().url().split("/").at(-1),
        user = r.request().headers()["x-user"] || null,
        args = r.request().postDataJSON();
      calls.push({ name, args, user });
      try {
        const data = await serial(() =>
          rpc(name, args, user ? "authenticated" : "anon", user),
        );
        await r.fulfill({ json: { data, error: null } });
      } catch (error) {
        await r.fulfill({ json: { error: { message: error.message } } });
      }
    });
    await c.route("**/__qa/expansion/functions/*", async (r) => {
      const action = r.request().url().split("/").at(-1),
        user = r.request().headers()["x-user"],
        body = r.request().postDataJSON();
      calls.push({ name: `function:${action}`, body, user });
      const response = await handler(
        new Request(
          `https://backend.test/functions/v1/games-session/${action}`,
          {
            method: "POST",
            headers: {
              Authorization: user
                ? `Bearer aaa.${user === B ? "userB" : "userA"}.ccc`
                : "",
              Origin: base,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          },
        ),
      );
      const data = await response.json();
      if (action === "start" && response.ok)
        sessions.push({
          ...data,
          game: body.game,
          difficulty: body.difficulty,
        });
      await r.fulfill({ status: response.status, json: data });
    });
    c.on("page", (p) => {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("dialog", (d) => d.accept());
    });
    return c;
  }
  async function open(page, slug) {
    await page.goto(`${base}/games/${slug}/`);
    await page.waitForSelector("[data-game][data-ready=true]");
  }
  async function save(page, slug, owner = "guest") {
    return page.evaluate(
      async ({ slug, owner }) => {
        const request = indexedDB.open("kensei-record-game-v1");
        const database = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const scope = await new Promise((resolve, reject) => {
            const get = database
              .transaction("scopes")
              .objectStore("scopes")
              .get(owner);
            get.onsuccess = () => resolve(get.result);
            get.onerror = () => reject(get.error);
          });
          return (
            Object.values(scope?.records || {}).find(
              (r) => r.data.game === slug,
            )?.data || null
          );
        } finally {
          database.close();
        }
      },
      { slug, owner },
    );
  }
  async function waitSave(page, slug, predicate, owner = "guest") {
    for (let i = 0; i < 30; i++) {
      const record = await save(page, slug, owner);
      if (record && predicate(record)) return record;
      await page.waitForTimeout(100);
    }
    throw Error(
      `Timed out waiting for ${slug} save: ${JSON.stringify(await save(page, slug, owner))}`,
    );
  }
  const finishVerified = (page) =>
    page.waitForFunction(() =>
      document
        .querySelector("#game-status")
        .textContent.includes("Public result verified"),
    );
  const pieces = (page, player) =>
    page.locator(`.board-cell[data-piece="${player}"]`).count();
  const guest = await context(),
    p = await guest.newPage();
  try {
    await p.goto(`${base}/games/`);
    await p.waitForSelector("[data-game-card]");
    assert.equal(await p.locator("[data-game-card]").count(), 10);
    for (const [filter, count] of [
      ["puzzle", 6],
      ["arcade", 2],
      ["board", 2],
    ]) {
      await p.click(`[data-game-filter="${filter}"]`);
      assert.equal(await p.locator("[data-game-card]:visible").count(), count);
    }
    await p.click('[data-game-filter="all"]');
    await p.fill("#game-search", "sudoku");
    assert.equal(await p.locator("[data-game-card]:visible").count(), 1);
    for (const slug of [
      "sudoku",
      "nonogram",
      "block-puzzle",
      "brick-breaker",
      "connect-four",
      "reversi",
    ]) {
      await open(p, slug);
      assert.equal(await p.inputValue("#game-mode"), "private");
      assert.equal(
        await p
          .locator(
            ".sudoku-cell,.nonogram-cell,.block-cell,.brick-canvas,.board-cell",
          )
          .count(),
        0,
      );
    }
    assert.equal(calls.filter((c) => c.name === "function:start").length, 0);
    // An original game save remains readable after installing the expanded registry.
    await open(p, "2048");
    await p.click("#game-start");
    const oldSave = await waitSave(p, "2048", () => true);
    assert.equal(oldSave.state.board.length, 16);
    await open(p, "sudoku");
    await p.selectOption("#game-difficulty", "easy");
    await p.click("#game-start");
    let record = await waitSave(p, "sudoku", () => true),
      editable = record.state.givens.findIndex((v) => !v);
    await p.click(`[data-puzzle-cell="${editable}"]`);
    await p.keyboard.press("n");
    await p.keyboard.press("3");
    await waitSave(p, "sudoku", (r) => r.state.notes[editable].includes(3));
    await p.keyboard.press("n");
    await p.keyboard.press("4");
    await p.click("#game-undo");
    assert.match(
      await p
        .locator(`[data-puzzle-cell="${editable}"]`)
        .getAttribute("aria-label"),
      /empty/,
    );
    await p.click("#game-hint");
    assert.equal(await p.isEnabled("#game-undo"), true);
    await p.click("#game-undo");
    await p.click("#game-pause");
    await p.reload();
    await p.waitForSelector("[data-game][data-ready=true]");
    await p.selectOption("#game-difficulty", "easy");
    await p.waitForSelector("#game-restore:not([hidden])");
    await p.click("#game-restore");
    assert.equal(await p.inputValue("#game-mode"), "private");
    assert.ok(await p.locator(".sudoku-notes").count());
    console.log(
      "PASS ten-game catalog, six guest idle pages, legacy save compatibility and Sudoku notes/hint/undo/explicit Private restore",
    );

    const account = await context(A),
      q = await account.newPage();
    for (const slug of [
      "sudoku",
      "nonogram",
      "block-puzzle",
      "brick-breaker",
    ]) {
      await open(q, slug);
      assert.equal(await q.inputValue("#game-mode"), "public");
    }
    await open(q, "sudoku");
    await q.selectOption("#game-difficulty", "easy");
    await q.click("#game-start");
    await q.waitForSelector(".sudoku-cell");
    let session = sessions.at(-1),
      puzzle = engine.create("sudoku", "easy", Number(session.seed));
    const answer = puzzles.solution(puzzle);
    editable = puzzle.givens.findIndex((v) => !v);
    assert.equal(await q.isDisabled("#game-hint"), true);
    assert.equal(await q.isDisabled("#game-undo"), true);
    await q.click(`[data-puzzle-cell="${editable}"]`);
    await q.keyboard.press("n");
    await q.keyboard.press("2");
    await q.keyboard.press("n");
    for (let index = 0; index < 81; index++)
      if (!puzzle.givens[index]) {
        await q.click(`[data-puzzle-cell="${index}"]`);
        await q.keyboard.press(String(answer[index]));
      }
    await finishVerified(q);
    await q.waitForFunction(() =>
      document.querySelector("#game-my-rank").textContent.includes("rank: #1"),
    );
    const submittedSudoku = calls
      .filter((c) => c.name === "function:finish")
      .at(-1).body;
    assert.equal(
      submittedSudoku.events.length,
      puzzle.givens.filter((v) => !v).length,
      "notes do not enter a Public replay",
    );
    assert.ok(submittedSudoku.events.every((e) => e.type === "digit"));
    console.log(
      "PASS Public Sudoku completion through UI, hints/undo disabled, note-free replay verified by real Edge and database",
    );

    await open(q, "nonogram");
    await q.selectOption("#game-difficulty", "easy");
    await q.click("#game-start");
    await q.waitForSelector(".nonogram-cell");
    session = sessions.at(-1);
    puzzle = engine.create("nonogram", "easy", Number(session.seed));
    const picture = puzzles.solution(puzzle);
    for (let index = 0; index < picture.length; index++)
      if (picture[index]) await q.click(`[data-puzzle-cell="${index}"]`);
    await finishVerified(q);
    await q.waitForFunction(() =>
      document.querySelector("#game-my-rank").textContent.includes("rank: #1"),
    );
    const publicProfile = await serial(() =>
      rpc("ensure_my_profile", { expected_user: A }),
    );
    await q.goto(`${base}/profile/?id=${publicProfile.public_id}`);
    await q.waitForSelector("#public-profile:not([hidden])");
    assert.equal(await q.locator(".profile-game-card").count(), 8);
    assert.equal(
      await q
        .locator('.profile-game-card[data-game-theme="sudoku"].has-score')
        .count(),
      1,
    );
    assert.equal(
      await q
        .locator('.profile-game-card[data-game-theme="nonogram"].has-score')
        .count(),
      1,
    );
    assert.equal(
      await q
        .locator(
          '.profile-game-card[data-game-theme="connect-four"],.profile-game-card[data-game-theme="reversi"]',
        )
        .count(),
      0,
    );
    assert.equal(
      await q.locator('.profile-game-card a[href="/games/sudoku/"]').count(),
      1,
    );
    await q.screenshot({
      path: "_qa/games-expansion-profile.png",
      fullPage: true,
    });
    console.log(
      "PASS Public Nonogram server replay, rank, and eight ranked-only Profile cards with new result links",
    );

    await open(p, "nonogram");
    await p.selectOption("#game-difficulty", "hard");
    await p.click("#game-start");
    await p.waitForSelector(".nonogram-cell");
    await p.click('[data-puzzle-cell="0"]');
    await p.keyboard.press("x");
    await p.keyboard.press("ArrowRight");
    assert.equal(
      await p.evaluate(() => document.activeElement.dataset.puzzleCell),
      "1",
    );
    // Paint a fresh row quickly, including cells skipped between native pointer events.
    const dragA = await p.locator('[data-puzzle-cell="15"]').boundingBox(),
      dragB = await p.locator('[data-puzzle-cell="19"]').boundingBox();
    await p.mouse.move(dragA.x + dragA.width / 2, dragA.y + dragA.height / 2);
    await p.mouse.down();
    const documentScrollBeforeDrag = await p.evaluate(() => scrollY);
    await p.mouse.move(dragB.x + dragB.width / 2, dragB.y + dragB.height / 2, {
      steps: 1,
    });
    await p.mouse.up();
    assert.equal(await p.evaluate(() => scrollY), documentScrollBeforeDrag);
    record = await waitSave(p, "nonogram", (r) =>
      r.state.board.slice(15, 20).every((v) => v === 1),
    );
    assert.equal(record.state.moves >= 5, true);
    await p.setViewportSize({ width: 360, height: 1000 });
    await p.locator(".nonogram-viewport").evaluate((el) => {
      el.scrollLeft = 100;
    });
    await p.click('[data-puzzle-paint="mark"]');
    assert.ok(
      (await p.locator(".nonogram-viewport").evaluate((el) => el.scrollLeft)) >
        50,
    );
    await p.click("#game-pause");
    await p.setViewportSize({ width: 1280, height: 900 });
    console.log(
      "PASS Nonogram keyboard, fast continuous pointer painting and scroll preservation",
    );

    await open(p, "block-puzzle");
    await p.click("#game-start");
    record = await waitSave(p, "block-puzzle", () => true);
    let block = record.state;
    const placement = (s) => {
      for (let slot = 0; slot < 3; slot++)
        for (let index = 0; index < 64; index++)
          if (arcade.canPlace(s, slot, index)) return { slot, index };
      throw Error("No legal test placement.");
    };
    let put = placement(block);
    await p.click(`[data-block-slot="${put.slot}"]`);
    await p.waitForTimeout(360);
    await p.click(`[data-block-cell="${put.index}"]`);
    record = await waitSave(p, "block-puzzle", (r) => r.state.moves === 1);
    assert.ok(record.state.score > 0);
    block = record.state;
    put = placement(block);
    const from = await p
        .locator(`[data-block-slot="${put.slot}"]`)
        .boundingBox(),
      to = await p.locator(`[data-block-cell="${put.index}"]`).boundingBox();
    await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await p.mouse.down();
    await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await p.mouse.up();
    record = await waitSave(p, "block-puzzle", (r) => r.state.moves === 2);
    block = record.state;
    let invalid;
    for (let slot = 0; slot < 3 && !invalid; slot++)
      if (block.hand[slot] !== null)
        for (let index = 0; index < 64; index++)
          if (!block.board[index] && !arcade.canPlace(block, slot, index)) {
            invalid = { slot, index };
            break;
          }
    if (!invalid) {
      const slot = block.hand.findIndex((v) => v !== null);
      invalid = { slot, index: block.board.findIndex(Boolean), keyboard: true };
    }
    await p.waitForTimeout(360);
    await p.click(`[data-block-slot="${invalid.slot}"]`);
    await p.waitForTimeout(360);
    if (invalid.keyboard) {
      await p.locator(`[data-block-cell="${invalid.index}"]`).focus();
      await p.keyboard.press("Enter");
    } else await p.click(`[data-block-cell="${invalid.index}"]`);
    assert.match(await p.locator("#game-status").innerText(), /does not fit/);
    await p.waitForTimeout(600);
    assert.equal((await save(p, "block-puzzle")).state.moves, 2);
    await p.reload();
    await p.waitForSelector("[data-game][data-ready=true]");
    await p.waitForSelector("#game-restore:not([hidden])");
    await p.click("#game-restore");
    assert.equal(
      await p.locator(".block-cell.is-filled").count(),
      block.board.filter(Boolean).length,
    );
    console.log(
      "PASS Block Puzzle tap, actual pointer drag, invalid placement feedback, scoring and persisted restore",
    );

    await open(p, "brick-breaker");
    await p.click("#game-start");
    await p.waitForSelector(".brick-canvas");
    assert.equal(await p.locator(".brick-launch").isEnabled(), true);
    assert.ok(
      await p.locator(".brick-canvas").evaluate((canvas) => {
        const data = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data,
          colors = new Set();
        for (let i = 0; i < data.length; i += 400)
          colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        return colors.size > 4;
      }),
      "actual canvas contains painted game content",
    );
    await p.click(".brick-launch");
    await p.locator(".brick-paddle-slider").evaluate((el) => {
      el.value = "160";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    record = await waitSave(
      p,
      "brick-breaker",
      (r) => r.state.ticks > 30 && r.state.paddle === 160,
    );
    assert.equal(record.state.ball.launched, true);
    await p.waitForTimeout(1100);
    assert.notEqual(await p.locator("#game-clock").innerText(), "00:00");
    await p.click("#game-pause");
    const clockPaused = await p.locator("#game-clock").innerText();
    await p.waitForTimeout(500);
    assert.equal(await p.locator("#game-clock").innerText(), clockPaused);
    await p.click("#game-resume");
    await p.waitForTimeout(400);
    assert.equal(await p.inputValue("#game-mode"), "private");
    await p.screenshot({
      path: "_qa/games-expansion-brick.png",
      fullPage: true,
    });
    console.log(
      "PASS Brick Breaker painted canvas, launch, quantized slider control, advancing clock, pause and resume",
    );

    const beforeBoardSessions = calls.filter(
      (c) => c.name === "function:start",
    ).length;
    await open(q, "connect-four");
    assert.equal(await q.inputValue("#game-mode"), "private");
    assert.equal(
      await q.locator('#game-mode option[value="public"]').count(),
      0,
    );
    await q.selectOption("#game-human-side", "2");
    await q.selectOption("#game-difficulty", "ai-easy");
    await q.click("#game-start");
    await q.waitForFunction(
      () =>
        document.querySelectorAll('.board-cell[data-piece="1"]').length === 1,
    );
    const moveButton = q.locator(".board-cell.is-legal").first();
    await moveButton.click();
    await q.waitForFunction(
      () =>
        document.querySelectorAll('.board-cell[data-piece="1"]').length === 2,
    );
    await q.click("#game-undo");
    await q.waitForTimeout(150);
    assert.equal(await pieces(q, 1), 1);
    assert.equal(await pieces(q, 2), 0);
    await q.click("#game-pause");
    await q.click("#game-settings-change");
    await q.selectOption("#game-difficulty", "local");
    await q.click("#game-start");
    for (const column of [0, 1, 0, 1, 0, 1, 0])
      await q.locator(`[data-drop="${column}"]`).first().click();
    assert.match(await q.locator(".board-turn").innerText(), /Player 1 wins/);
    assert.equal(await pieces(q, 1), 4);
    await q.locator("#game-setup > summary").click();
    await q.selectOption("#game-difficulty", "ai-easy");
    await q.selectOption("#game-human-side", "1");
    await q.click("#game-start");
    assert.equal(await pieces(q, 1), 0);
    assert.equal(await pieces(q, 2), 0);
    await q.locator('[data-drop="3"]').first().click();
    await q.waitForFunction(
      () =>
        document.querySelectorAll('.board-cell[data-piece="2"]').length === 1,
    );
    await open(q, "reversi");
    assert.equal(await q.inputValue("#game-mode"), "private");
    await q.selectOption("#game-difficulty", "local");
    await q.click("#game-start");
    assert.equal(await q.locator(".board-cell.is-legal").count(), 4);
    let reversi = boards.create("reversi", "local", 1),
      sawPass = false,
      first = true;
    while (reversi.status === "playing") {
      const index = boards.legalMoves(reversi)[0];
      if (first) {
        await q.locator(`[data-disc="${index}"]`).focus();
        await q.keyboard.press("Enter");
        first = false;
      } else await q.click(`[data-disc="${index}"]`);
      boards.apply(reversi, { type: "disc", index });
      if (reversi.passCount === 1) {
        sawPass = true;
        assert.match(
          await q.locator(".board-pass-notice").innerText(),
          /no legal move/,
        );
      }
    }
    assert.equal(
      sawPass,
      true,
      "legal full-game sequence exercises automatic pass",
    );
    assert.equal(await pieces(q, 1), reversi.counts[0]);
    assert.equal(await pieces(q, 2), reversi.counts[1]);
    assert.equal(
      calls.filter((c) => c.name === "function:start").length,
      beforeBoardSessions,
      "Board games never request Public sessions",
    );
    console.log(
      "PASS Private-only AI first/second player starts, human-turn undo, same-device Connect Four win and complete keyboard-enabled Reversi with automatic pass",
    );

    // Delay dispatch into the real native Worker so pause deterministically interrupts a pending task.
    // Worker search, message delivery and termination remain the actual browser implementation.
    const cancellation = await context(A);
    await cancellation.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(...args) {
          setTimeout(() => super.postMessage(...args), 1400);
        }
      };
    });
    const z = await cancellation.newPage();
    await open(z, "connect-four");
    await z.selectOption("#game-human-side", "2");
    await z.click("#game-start");
    await z.click("#game-pause");
    await z.waitForTimeout(1800);
    assert.equal(await pieces(z, 1), 0);
    await z.click("#game-resume");
    await z.waitForFunction(
      () =>
        document.querySelectorAll('.board-cell[data-piece="1"]').length === 1,
    );
    await z.click("#game-pause");
    await z.click("#game-settings-change");
    await z.selectOption("#game-human-side", "2");
    await z.click("#game-start");
    await z.click("#game-pause");
    await z.click("#game-settings-change");
    await z.selectOption("#game-human-side", "1");
    await z.click("#game-start");
    await z.waitForTimeout(1800);
    assert.equal(await pieces(z, 1), 0);
    assert.equal(await pieces(z, 2), 0);
    console.log(
      "PASS cancelled computer Worker cannot alter a paused or replacement game",
    );

    for (const width of [320, 360, 768, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      for (const slug of [
        "sudoku",
        "nonogram",
        "block-puzzle",
        "brick-breaker",
        "connect-four",
        "reversi",
      ]) {
        await open(p, slug);
        if (slug === "nonogram")
          await p.selectOption("#game-difficulty", "hard");
        if (["connect-four", "reversi"].includes(slug))
          await p.selectOption("#game-difficulty", "local");
        await p.click("#game-start");
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${slug} ${width} must not overflow the page`,
        );
        if (
          width === 360 ||
          (width === 1440 && ["sudoku", "connect-four"].includes(slug))
        ) {
          await p.evaluate(() => scrollTo(0, 0));
          await p.screenshot({
            path: `_qa/games-expansion-${slug}-${width}.png`,
            fullPage: true,
          });
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS six integrated game pages at 320/360/768/1440px without horizontal page overflow or uncaught browser errors",
    );
  } finally {
    for (const c of contexts) await c.close();
    await browser.close();
    await db.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
