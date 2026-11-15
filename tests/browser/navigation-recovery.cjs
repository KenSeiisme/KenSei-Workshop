const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const { saveBrowserFailure } = require("../support/browser-artifacts.cjs");

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const sdkPath = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const fixtureUser = "00000000-0000-4000-8000-000000000011";
const secondUser = "00000000-0000-4000-8000-000000000022";
const olderId = "00000000-0000-4000-8000-000000000031";
const latestId = "00000000-0000-4000-8000-000000000032";
const roomId = "00000000-0000-4000-8000-000000000033";
const sdk = `
export function createClient() {
  const id = localStorage.fixtureUser || null;
  return {
    auth: {
      getSession: async () => ({data: {session: id ? { user: { id } } : null}}),
      onAuthStateChange() {}
    },
    from: () => ({select() { return this; }, order: async () => ({data: []})}),
    rpc: async (name, body) => {
      if (name === "sync_game_activity" || name === "game_hub_snapshot")
        return {data: {generatedAt: Date.now(), stats: {}, balance: 0, owned: ["classic"], skin: "classic", today: [], badges: []}};
      if (name === "ensure_my_profile")
        return {data: {public_id: id, nickname: "Test player", avatar_kind: "none"}};
      try {
        const response = await fetch("/_fixture/rpc/" + name, {
          method: "POST", body: JSON.stringify({ id, body })
        });
        return {data: await response.json(), error: null};
      } catch (error) {
        return {data: null, error};
      }
    },
    functions: {
      async invoke(name, {body}) {
        try {
          const response = await fetch("/_fixture/" + name, {
            method: "POST", body: JSON.stringify({ id, body })
          });
          if (!response.ok)
            return {error: {status: response.status, context: response}};
          return {data: await response.json()};
        } catch (error) { return {error}; }
      }
    },
    channel() {
      return {
        on() { return this; },
        send: async () => "ok",
        subscribe(callback) { setTimeout(() => callback("SUBSCRIBED"), 0); return this; }
      };
    },
    async removeChannel() {}
  };
}
`;

async function activeUser(page, user) {
  await page.evaluate((id) => {
    if (id) localStorage.fixtureUser = id;
    else localStorage.removeItem("fixtureUser");
  }, user);
}

async function visitTool(page, slug, locale = "") {
  await page.goto(base + locale + "/tools/" + slug + "/");
  await page.locator("[data-tool][data-ready=true]").waitFor();
  await page.waitForFunction(() => window.KenseiWorkspace.ready);
}

const recent = (page) =>
  page
    .locator("[data-recent-tool]")
    .evaluateAll((items) => items.map((item) => item.dataset.recentTool));

async function verifyRecents(page) {
  await visitTool(page, "text-toolkit");
  await visitTool(page, "focus-timer");
  await visitTool(page, "unit-converter");
  await visitTool(page, "color-studio");
  await visitTool(page, "text-toolkit", "/zh-hant");
  await visitTool(page, "qr-studio");
  await page.goto(base + "/zh-hant/tools/");
  await page.locator("#recent-tools:visible").waitFor();
  assert.equal(
    await page.locator("#recent-tools-title").textContent(),
    "最近開啟",
  );
  assert.deepEqual(await recent(page), [
    "qr-studio",
    "text-toolkit",
    "color-studio",
    "unit-converter",
  ]);
  assert.match(
    await page.locator("[data-recent-tool]").first().getAttribute("href"),
    /\/zh-hant\/tools\/qr-studio\/$/,
  );
  const search = page.locator("#tool-search");
  await search.fill("timer");
  await page.locator("#recent-tools").waitFor({ state: "hidden" });
  await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.equal(
    await search.evaluate((node) => document.activeElement === node),
    true,
  );
  await search.press("Enter");
  assert.match(
    await page.locator(":focus").getAttribute("href"),
    /focus-timer/,
  );
  await page.click("#tool-search-clear");
  await page.click("[data-filter=images]");
  await page.locator("#recent-tools").waitFor({ state: "hidden" });

  await activeUser(page, fixtureUser);
  await visitTool(page, "image-studio");
  await page.goto(base + "/tools/");
  await page.locator("#recent-tools:visible").waitFor();
  assert.deepEqual(await recent(page), ["image-studio"]);
  await page.click("#recent-tools-clear");
  await page.locator("#recent-tools").waitFor({ state: "hidden" });
  assert.equal(
    await search.evaluate((node) => document.activeElement === node),
    true,
  );

  await activeUser(page, null);
  await page.reload();
  await page.locator("#recent-tools:visible").waitFor();
  assert.deepEqual(await recent(page), [
    "qr-studio",
    "text-toolkit",
    "color-studio",
    "unit-converter",
  ]);
  console.log(
    "PASS bilingual recent tools, deduplication, keyboard search, guest/account isolation and clearing",
  );
}

async function verifySavedGames(page) {
  await activeUser(page, fixtureUser);
  await page.goto(base + "/games/");
  await page.locator("#game-saves .saved-game-row").first().waitFor();
  const old = page.locator('a[href$="' + olderId + '"]');
  assert.match(
    await old.locator("xpath=../..").textContent(),
    /Local two-player.*5\+3.*Unranked.*Synced/s,
  );
  const newer = page.locator('a[href$="' + latestId + '"]');
  assert.match(await newer.locator("xpath=../..").textContent(), /10\+5/);
  await old.click();
  await page.locator('[data-square="e4"] .chess-piece img').waitFor();
  assert.equal(
    await page.locator('[data-square="e2"] .chess-piece img').count(),
    0,
  );
  assert.match(await page.locator("#chess-turn").textContent(), /Black/);
  await page.goto(base + "/zh-hant/games/xiangqi/?save=" + olderId);
  await page.locator("[data-missing-game-save]:visible").waitFor();
  assert.match(
    await page.locator("[data-missing-game-save]").textContent(),
    /無法開啟/,
  );
  assert.equal(await page.locator("#xiangqi-start").isEnabled(), true);
  assert.match(
    await page.locator("[data-missing-game-save] a").getAttribute("href"),
    /\/zh-hant\/games\/#continue-title$/,
  );
  await activeUser(page, secondUser);
  await page.goto(base + "/games/chess/?save=" + olderId);
  await page.locator("[data-missing-game-save]:visible").waitFor();
  assert.equal(await page.locator("#chess-continue").isVisible(), false);
  await activeUser(page, fixtureUser);
  console.log(
    "PASS precise game save, bilingual missing/wrong-game fallback, and cross-account link isolation",
  );
}

async function main() {
  const chess = await import("../../src/games/chess-engine.js");
  const go = await import("../../src/games/go-engine.js");
  const xiangqi = await import("../../src/games/xiangqi-engine.js");
  const { createClock, chargeClock } =
    await import("../../src/games/go-clock.js");
  const cases = {
    chess: {
      create: () => chess.createChess({ clock: "10+5" }),
      apply: chess.applyChess,
      clock: () => chess.createChessClock("10+5", Date.now()),
      charge: chess.chargeChessClock,
      first: ["e2", "e4"],
      increment: 5000,
    },
    xiangqi: {
      create: () => xiangqi.createXiangqi({ clock: "10+5" }),
      apply: xiangqi.applyXiangqi,
      clock: () => xiangqi.createXiangqiClock("10+5", Date.now()),
      charge: xiangqi.chargeXiangqiClock,
      first: ["e3", "e4"],
      increment: 5000,
    },
    go: {
      create: () => go.createGo({ size: 9 }),
      apply: go.applyGo,
      clock: () => createClock(9, Date.now()),
      charge: chargeClock,
      increment: 0,
    },
  };
  const pack = (id, clock, state, time) => ({
    id,
    revision: 1,
    updated_at: time,
    created_at: time,
    data: {
      game: "chess",
      name: "Chess test save",
      difficulty: clock,
      level: 2,
      human: 1,
      mode: "local",
      state: chess.compactChess(state),
      elapsed: 0,
      best: null,
    },
  });
  const saved = [
    pack(
      olderId,
      "5+3",
      chess.applyChess(
        chess.createChess({ clock: "5+3" }),
        { type: "move", uci: "e2e4" },
        1,
      ),
      "2026-01-01T00:00:00.000Z",
    ),
    pack(
      latestId,
      "10+5",
      chess.createChess({ clock: "10+5" }),
      "2026-01-02T00:00:00.000Z",
    ),
  ];
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let active = null;
  let blocked = false;
  let stale = null;
  let requests = [];
  let receipt = null;
  let pongRoom = null;
  await context.route(sdkPath, (route) =>
    route.fulfill({ contentType: "application/javascript", body: sdk }),
  );
  await context.route("**/_fixture/**", async (route) => {
    const { id, body } = route.request().postDataJSON();
    const endpoint = new URL(route.request().url()).pathname.split("/").at(-1);
    if (route.request().url().includes("/_fixture/rpc/")) {
      if (endpoint === "pong_room")
        return route.fulfill({ json: pongRoom || {} });
      const map = id === fixtureUser ? saved : [];
      const json =
        endpoint === "get_game_saves"
          ? map
          : endpoint === "get_game_save"
            ? map.find((row) => row.id === body.record_id) || null
            : null;
      return route.fulfill({
        body: JSON.stringify(json),
        contentType: "application/json",
      });
    }
    if (!active || id !== fixtureUser) return route.fulfill({ json: {} });
    if (endpoint === "get") {
      if (blocked) return route.abort();
      if (stale) {
        const old = stale;
        stale = null;
        return route.fulfill({ json: old });
      }
    }
    if (endpoint === "command") {
      requests.push(body);
      if (!receipt) {
        receipt = body;
        active.state = cases[active.game].apply(active.state, body.action, 1);
        active.clock = cases[active.game].charge(
          active.clock,
          1,
          active.clock.anchor,
          true,
        );
        active.revision++;
        blocked = true;
        return route.abort();
      }
      if (
        body.request_id !== receipt.request_id ||
        body.expected_version !== receipt.expected_version
      )
        return route.fulfill({
          status: 409,
          json: {
            error: "Fixture conflict",
            code: "VERSION_CONFLICT",
            snapshot: active,
          },
        });
    }
    return route.fulfill({ json: { ...active, server_now: Date.now() } });
  });
  try {
    await verifyRecents(page);
    await verifySavedGames(page);
    for (const [game, sample] of Object.entries(cases)) {
      active = {
        game,
        id: roomId,
        revision: 1,
        status: "playing",
        rules_version: 1,
        controller: true,
        color: 1,
        channel_key: "fixture",
        ranked: true,
        clock: sample.clock(),
        state: sample.create(),
        members: [
          { color: 1, nickname: "Fixture player" },
          { color: -1, nickname: "Fixture opponent" },
        ],
      };
      active.config = active.state.config;
      receipt = null;
      requests = [];
      blocked = false;
      const beforeMove = structuredClone({ ...active, server_now: Date.now() });
      const readyTurn =
        game === "go" ? "Black" : game === "chess" ? "White" : "Red";
      const nextTurn = game === "go" ? "White" : "Black";
      await page.goto(base + "/games/" + game + "/");
      const turn = page.locator("#" + game + "-turn");
      await page.waitForFunction(
        ({ game, readyTurn }) =>
          document
            .querySelector("#" + game + "-turn")
            .textContent.includes(readyTurn + " to move"),
        { game, readyTurn },
      );
      if (sample.first) {
        for (const square of sample.first)
          await page.click('[data-square="' + square + '"]');
      } else {
        await page.locator("#game-board").focus();
        await page.keyboard.press("Enter");
      }
      const reconnect = page.locator("#" + game + "-retry");
      const retry = page.locator("#" + game + "-retry-move");
      const status = page.locator("[data-board-connection]");
      await reconnect.waitFor({ state: "visible" });
      assert.equal(await retry.isDisabled(), true);
      assert.match(await status.textContent(), /Reconnecting/);
      assert.match(await turn.textContent(), new RegExp(readyTurn));
      blocked = false;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.waitForFunction(
        () =>
          document.querySelector("[data-board-retry-move]").disabled === false,
      );
      assert.equal(await reconnect.isVisible(), false);
      assert.match(await status.textContent(), /Move awaiting confirmation/);
      assert.equal(requests.length, 1);
      await retry.click();
      await retry.waitFor({ state: "hidden" });
      assert.deepEqual(requests[0], requests[1]);
      assert.equal(active.state.log.length, 1);
      assert.equal(
        active.clock.remaining[1],
        beforeMove.clock.remaining[1] + sample.increment,
      );
      assert.match(await turn.textContent(), new RegExp(nextTurn));
      stale = beforeMove;
      const staleResponse = page.waitForResponse((response) =>
        response.url().endsWith("/_fixture/board-match/get"),
      );
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await staleResponse;
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.match(await turn.textContent(), new RegExp(nextTurn));
      console.log(
        "PASS " +
          game +
          " lost reply, reconnect, same request and clock, stale snapshot",
      );
      stale = null;
    }
    pongRoom = {
      id: roomId,
      round: 1,
      seed: 7,
      code: "XY123456",
      status: "paused",
      role: "host",
      channel_key: "fixture",
      players: [
        { role: "host", ready: false, profile: { nickname: "Host" } },
        { role: "guest", ready: false, profile: { nickname: "Guest" } },
      ],
    };
    await page.goto(base + "/games/pong/");
    await page.locator("[data-pong][data-ready=true]").waitFor();
    await page.waitForFunction(() => window.KenseiWorkspace.ready);
    await page.click("#pong-create");
    const pongStatus = page.locator("#pong-connection-status");
    await page.waitForFunction(() =>
      document
        .querySelector("#pong-connection-status")
        .textContent.includes("must press Ready"),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    assert.match(await pongStatus.textContent(), /Reconnecting/);
    assert.equal(await page.locator("#pong-ready").isDisabled(), true);
    await page.click("#pong-retry");
    await page.waitForFunction(() =>
      document
        .querySelector("#pong-connection-status")
        .textContent.includes("must press Ready"),
    );
    assert.equal(await page.locator("#pong-ready").isEnabled(), true);
    pongRoom.status = "interrupted";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() =>
      document
        .querySelector("#pong-connection-status")
        .textContent.includes("Match interrupted"),
    );
    assert.equal(await page.locator("#pong-ready").isDisabled(), true);
    console.log(
      "PASS Pong reconnect, both players Ready prompt, and interrupted room",
    );
    assert.deepEqual(errors, []);
  } catch (error) {
    await saveBrowserFailure(context, "navigation-recovery");
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
