const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
  });
  const context = await browser.newContext({
    reducedMotion: "reduce",
    hasTouch: true,
  });
  try {
    const errors = [],
      rankingRequests = [];
    await context.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: `export function createClient(){return {
          auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},
          rpc:async(name,args)=>name==='get_game_leaderboard'
            ? (await fetch('https://fixture.supabase.co/rpc/'+name,{
                method:'POST',body:JSON.stringify(args)
              })).json().then(data=>({data,error:null}))
            : {data:[],error:null}
        }}`,
        }),
    );
    await context.route("https://*.supabase.co/**", (route) => {
      if (route.request().url().endsWith("/rpc/get_game_leaderboard")) {
        rankingRequests.push(route.request().postDataJSON());
        return route.fulfill({
          headers: { "Access-Control-Allow-Origin": "*" },
          json: { version: 2, top: [], me: null },
        });
      }
      return route.abort();
    });
    const hub = await context.newPage();
    hub.on("pageerror", (error) => errors.push(error.message));
    await hub.goto(base + "/games/");
    await hub.waitForSelector("#game-saves .game-empty-state");
    await hub.waitForFunction(
      () => document.querySelector("[data-hub-coins]").textContent === "0",
    );
    assert.equal(rankingRequests.length, 0);
    for (const [width, height] of [
      [320, 640],
      [360, 800],
      [768, 1024],
      [1440, 900],
      [740, 360],
    ]) {
      await hub.setViewportSize({ width, height });
      const layout = await hub.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        outside: [...document.querySelectorAll("main *")]
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return (
              rect.width &&
              rect.right > innerWidth + 1 &&
              getComputedStyle(node).position !== "absolute"
            );
          })
          .slice(0, 10)
          .map((node) => node.className || node.tagName),
      }));
      assert(
        layout.width <= width + 1,
        `no overflow at ${width}×${height}: ${JSON.stringify(layout)}`,
      );
    }
    assert.equal(
      await hub
        .locator("[data-hub-featured]:visible")
        .getAttribute("data-hub-featured"),
      "snake",
    );
    await hub.click('[data-hub-slide="1"]');
    assert.equal(
      await hub
        .locator("[data-hub-featured]:visible")
        .getAttribute("data-hub-featured"),
      "brick-breaker",
    );
    await hub.locator(".hub-feature").focus();
    await hub.keyboard.press("ArrowRight");
    assert.equal(
      await hub
        .locator("[data-hub-featured]:visible")
        .getAttribute("data-hub-featured"),
      "xiangqi",
    );
    await hub.click('[data-game-filter="board"]');
    assert.equal(await hub.locator("[data-game-card]:visible").count(), 5);
    await hub.fill("#game-search", "中國象棋");
    assert.equal(await hub.locator("[data-game-card]:visible").count(), 1);
    await hub.fill("#game-search", "");
    await hub.click('[data-game-filter="all"]');
    assert.equal(await hub.locator("[data-game-card]:visible").count(), 15);
    await hub.click("[data-hub-theme]");
    await hub.reload();
    await hub.waitForSelector("body.hub-light");
    await hub.click("[data-hub-theme]");
    await hub.selectOption("[data-hub-rank-game]", "snake");
    await hub.waitForFunction(
      () =>
        document.querySelector("[data-hub-rank-status]").textContent ===
        "No verified results yet.",
    );
    assert.deepEqual(rankingRequests, [
      { game: "snake", difficulty: "normal" },
    ]);
    await hub.selectOption("[data-hub-rank-kind]", "demo");
    await hub.waitForSelector("[data-hub-rank-results] tbody tr");
    assert.match(
      await hub.locator("[data-hub-rank-status]").textContent(),
      /Fictional/,
    );
    await hub.selectOption("[data-hub-rank-kind]", "local");
    assert.equal(
      await hub.locator("[data-hub-rank-results] tbody tr").count(),
      0,
    );

    const play = await context.newPage();
    play.on("pageerror", (error) => errors.push(error.message));
    await play.setViewportSize({ width: 360, height: 800 });
    await play.goto(base + "/games/snake/");
    await play.waitForSelector('[data-game][data-ready="true"]');
    assert.equal(await play.locator("#game-difficulty option").count(), 1);
    await play.click("#game-start");
    await play.click("#game-pause");
    await play.waitForSelector("#game-resume:visible");
    await play.waitForTimeout(700);
    await play.reload();
    await play.waitForSelector("#game-restore:visible");
    await play.click("#game-restore");
    await play.waitForSelector("#game-result:visible");
    await play.fill(".hub-local-score input", "測試玩家");
    await play.click(".hub-local-score button");
    await play.waitForFunction(() =>
      document
        .querySelector(".hub-local-score [role=status]")
        .textContent.includes("Saved"),
    );
    await hub.waitForFunction(() =>
      document
        .querySelector("[data-hub-rank-results]")
        .textContent.includes("測試玩家"),
    );
    assert.match(
      await hub.locator("[data-hub-rank-stats]").textContent(),
      /1 starts/,
    );
    assert(Number(await hub.locator("[data-hub-coins]").textContent()) >= 15);
    assert.match(
      await hub.locator("[data-hub-badges] article").first().textContent(),
      /Unlocked/,
    );

    await hub.evaluate(async () => {
      const { recordActivity } = await import("/game-scripts/hub-store.js");
      for (let i = 0; i < 7; i++)
        await recordActivity("guest", {
          id: crypto.randomUUID(),
          segmentId: crypto.randomUUID(),
          game: "2048",
          mode: "classic",
          activeMs: 1000,
          started: true,
          finished: true,
          score: 0,
        });
    });
    const neon = hub.locator('[data-hub-skins] [data-skin="neon"] button');
    await neon.waitFor();
    const startingBalance = await hub.evaluate(async () => {
      const { readHub } = await import("/game-scripts/hub-store.js");
      return (await readHub()).balance;
    });
    const purchase = (page) =>
      page.evaluate(async () => {
        const { changeSkin } = await import("/game-scripts/hub-store.js");
        await changeSkin("guest", "neon", true);
      });
    await Promise.all([purchase(hub), purchase(play)]);
    await hub.waitForFunction(
      () =>
        document.querySelector('[data-skin="neon"] button').dataset
          .skinAction === "equip",
    );
    assert.equal(
      Number(await hub.locator("[data-hub-coins]").textContent()),
      startingBalance - 40,
    );
    await play.waitForSelector('[data-game][data-snake-skin="classic"]');
    await neon.click();
    await hub.waitForFunction(
      () =>
        document.querySelector('[data-skin="neon"] button').textContent ===
        "Equipped",
    );
    await play.waitForSelector('[data-game][data-snake-skin="neon"]');
    assert.equal(
      await hub.locator("[data-hub-rank-results] tbody tr").count(),
      1,
      "sample rows never enter local board",
    );

    await hub.goto(base + "/zh-hant/games/");
    await hub.waitForFunction(
      () => document.querySelector("[data-hub-coins]").textContent !== "—",
    );
    assert.match(await hub.locator("h1").textContent(), /遊戲大廳/);
    assert.match(
      await hub.locator("[data-hub-tasks]").textContent(),
      /完成兩款不同遊戲/,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS game lobby layouts, bilingual catalog, carousel, lazy rankings, resume count, local scores and cross-tab skin selection",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
