// Anonymous production acceptance: no mocks, production accounts or ranked results.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  crypto = require("node:crypto");
const { chromium } = require("../support/browser.cjs");
const base = (
  process.env.TEST_BASE_URL || "https://kensei-workshop.vercel.app"
).replace(/\/$/, "");
assert(
  ["https://kensei-workshop.vercel.app", "http://127.0.0.1:8812"].includes(
    base,
  ),
);
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
(async () => {
  const games = JSON.parse(fs.readFileSync("data/games.json", "utf8"));
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const c = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    p = await c.newPage();
  const errors = [],
    writes = [];
  p.on("pageerror", (e) => errors.push(e.message));
  c.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().includes(".supabase.co/") &&
      !/\/rpc\/(get_game_leaderboard|get_public_profile)(\?|$)/.test(r.url())
    )
      writes.push(new URL(r.url()).pathname);
  });
  try {
    await p.goto(base + "/games/");
    await p.waitForSelector("[data-games-directory][data-ready=true]");
    assert.equal(await p.locator("[data-game-card]").count(), 12);
    await p.fill("#game-search", "Pong");
    assert.equal(await p.locator("[data-game-card]:visible").count(), 1);
    await p.fill("#game-search", "");
    for (const game of games) {
      const response = await p.goto(`${base}/games/${game.slug}/`);
      assert.equal(response.status(), 200, game.slug);
      await p.waitForSelector("[data-ready=true]");
      if (game.slug === "pong") {
        assert.match(
          await p.locator("#pong-room-state").innerText(),
          /Not connected/,
        );
        assert.equal(await p.locator("#game-milestones").count(), 0);
        await p.click("#pong-create");
        await p.waitForSelector("#auth-dialog[open]");
        await p.click(".dialog-close");
      } else {
        assert.match(
          await p.locator("#game-status").innerText(),
          /Ready|saved|Continue/i,
        );
      }
    }
    await p.goto(base + "/games/block-drop/");
    await p.waitForSelector("[data-ready=true]");
    assert.equal(await p.inputValue("#game-mode"), "private");
    await p.click("#game-start");
    await p.locator("#game-board").press("Space");
    await p.click("#game-pause");
    await p.waitForTimeout(700);
    await p.reload();
    await p.waitForSelector("#game-restore:not([hidden])");
    await p.click("#game-restore");
    await p.waitForSelector(".drop-canvas");
    await p.click("#game-pause");
    const config = await p.evaluate(() => window.KENSEI_CONFIG);
    const rpc = async (name, body) => {
      const r = await c.request.post(
        config.supabaseUrl + "/rest/v1/rpc/" + name,
        { headers: { apikey: config.supabasePublishableKey }, data: body },
      );
      return { status: r.status(), body: await r.json() };
    };
    let publicId;
    for (const [game, difficulty] of [
      ["block-drop", "classic"],
      ["block-drop", "sprint"],
      ["2048", "classic"],
    ]) {
      const board = await rpc("get_game_leaderboard", { game, difficulty });
      assert.equal(board.status, 200);
      assert(Array.isArray(board.body.top));
      assert(
        !/"(?:user_id|events|seed|email|state)":/.test(
          JSON.stringify(board.body),
        ),
      );
      publicId ||= board.body.top[0]?.public_id;
    }
    const mine = await rpc("get_my_game_progress", {});
    assert(mine.status >= 400, "Anonymous progress must be denied");
    const room = await rpc("pong_room", { action: "create", body: {} });
    assert(room.status >= 400, "Anonymous room creation must be denied");
    assert(
      publicId,
      "An existing verified score must provide a public Profile",
    );
    const profile = await rpc("get_public_profile", { profile_id: publicId });
    assert.equal(profile.status, 200);
    assert(Array.isArray(profile.body.game_achievements));
    assert(
      !/"(?:user_id|email|state|progress|room_id)":/.test(
        JSON.stringify(profile.body),
      ),
    );
    await p.goto(base + "/profile/?id=" + publicId);
    await p.waitForSelector("#public-profile:not([hidden])");
    assert.equal(await p.locator(".profile-game-card").count(), 9);
    assert.match(await p.locator("#public-game-count").innerText(), /\/ 9$/);
    assert.equal(
      await p.locator("#public-game-achievements [data-achievement]").count(),
      profile.body.game_achievements.length,
    );
    for (const width of [320, 360, 768, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
    }
    await p.locator(".public-achievements").evaluate((node) => {
      node.open = true;
    });
    await p.evaluate(() => {
      document.activeElement?.blur();
      scrollTo(0, 0);
    });
    await p.screenshot({ path: "_qa/arcade-profile-live.png", fullPage: true });
    for (const asset of [
      "app.js",
      "game-next.css",
      "tool-scripts/profile.js",
      ...fs
        .readdirSync("src/games")
        .filter((x) => /\.js$/.test(x))
        .map((x) => "game-scripts/" + x),
    ]) {
      const response = await c.request.get(base + "/" + asset);
      assert.equal(response.status(), 200, asset);
      assert.equal(
        digest(await response.body()),
        digest(fs.readFileSync("dist/" + asset)),
        "Live source mismatch: " + asset,
      );
    }
    // request.post above belongs to APIRequestContext, not browser upload traffic.
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log(
      "PASS live 12-game catalog and routes; guest Block Drop play/Private restore; Pong sign-in guard; nine-game Profile and actual public badges; anonymous RPC isolation; deployed script hashes; responsive layouts; no guest mutations.",
    );
  } finally {
    await c.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
