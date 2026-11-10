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
          auth:{getSession:async()=>({data:{session:localStorage.hubFixtureUser?{user:{id:localStorage.hubFixtureUser}}:null}}),onAuthStateChange(){}},
          from:()=>({select:()=>({order:async()=>({data:[]})})}),
          rpc:async(name,args)=>{
            const user=localStorage.hubFixtureUser;
            if(name.includes('leaderboard')) {
              const response=await fetch('https://fixture.supabase.co/rpc/'+name,{
                method:'POST',body:JSON.stringify(args)
              });
              return response.ok ? {data:await response.json()} : {error:{message:'Fixture unavailable'}};
            }
            if(name==='ensure_my_profile') return {data:{public_id:user,nickname:user==='a'?'Player A':'Player B',avatar_kind:'none'}};
            if(name==='game_hub_snapshot'||name==='claim_game_hub_reward') {
              const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur'}).format(new Date());
              if(name==='claim_game_hub_reward'){
                if(user!=='a'||args.expected_user!==user||args.task_day!==day||args.task_id!=='warm-up') return {error:{message:'Invalid fixture claim.'}};
                localStorage.hubFixtureClaimed=day;
              }
              const claimed=localStorage.hubFixtureClaimed===day;
              return {data:{generatedAt:Date.now()/1000,day,featured:'2048',balance:user==='a'?(claimed?15:5):15,owned:['classic'],skin:'classic',today:['snake'],badges:['score-1000'],stats:{snake:{plays:8,activeMs:2000}},
                ...(user==='a'?{manualClaims:true,claimedTasks:claimed?['warm-up']:[],resetAt:Date.parse(day)+16*3600000}:{})
              }};
            }
            if(name==='get_my_game_progress') return {data:{unlocks:[],progress:{},game_count:0,result_count:0}};
            if(name==='get_public_profile') return {data:{public_id:user,nickname:user==='a'?'Player A':'Player B',
              game_best_scores:user==='a'?[{game:'snake',version:1,difficulty:'normal',score:9999},{game:'snake',version:2,difficulty:'normal',score:720}]:[],
              xiangqi_stats:user==='a'?[{rules_version:1,time_control:'10+5',wins:3,played:5}]:[],
              game_achievements:user==='a'?[{achievement_id:'snake-3'},{achievement_id:'brick-breaker-2'}]:[]
            }};
            return {data:[],error:null};
          }
        }}`,
        }),
    );
    let failXiangqi = true;
    await context.route("https://fixture.supabase.co/**", (route) => {
      const args = route.request().postDataJSON();
      rankingRequests.push(args);
      const headers = { "Access-Control-Allow-Origin": "*" };
      if (args.time_control && failXiangqi)
        return route.fulfill({ headers, status: 503 });
      return route.fulfill({
        headers,
        json: {
          version:
            args.game === "snake" ? 2 : args.game === "brick-breaker" ? 3 : 1,
          top:
            args.game === "snake"
              ? Array.from({ length: 15 }, (_, i) => ({
                  rank: i + 1,
                  nickname: "Verified player " + (i + 1),
                  score: 900 - i * 10,
                }))
              : [],
          me: args.game === "snake" ? { rank: 11, score: 800 } : null,
        },
      });
    });
    const hub = await context.newPage();
    hub.on("pageerror", (error) => errors.push(error.message));
    await hub.setViewportSize({ width: 360, height: 640 });
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
    assert.equal(
      await hub.locator("[data-hub-rotate]").getAttribute("aria-label"),
      "Play slideshow",
    );
    await hub.locator("[data-hub-rotate]").focus();
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
    assert.equal(
      await hub.locator("[data-hub-theme]").getAttribute("aria-label"),
      "Switch to dark theme",
    );
    await hub.click("[data-hub-theme]");
    const snakePreview = hub.locator('[data-rank-preview="snake"]');
    const xiangqiPreview = hub.locator('[data-rank-preview="xiangqi"]');
    const preview = hub.getByRole("tabpanel", { name: "Snake" });
    await snakePreview.scrollIntoViewIfNeeded();
    await preview.locator("li").last().waitFor();
    assert.equal(await preview.locator("li").count(), 3);
    const beforeSelection = rankingRequests.length;
    await snakePreview.focus();
    await hub.keyboard.press("ArrowLeft");
    await hub.keyboard.press("ArrowLeft");
    assert(
      await xiangqiPreview.evaluate((tab) => document.activeElement === tab),
    );
    assert.equal(await xiangqiPreview.getAttribute("aria-selected"), "false");
    assert.equal(rankingRequests.length, beforeSelection);
    await hub.keyboard.press("Space");
    const panel = hub.locator("#hub-rank-panel");
    await panel.locator("[data-preview-retry]").waitFor();
    assert.equal(await xiangqiPreview.getAttribute("aria-selected"), "true");
    assert.equal(await panel.locator("[data-preview-icon]").count(), 0);
    failXiangqi = false;
    await panel.locator("[data-preview-retry]").click();
    await panel.getByText("No verified results yet.").waitFor();
    assert.match(
      await panel.locator("[data-preview-full]").getAttribute("href"),
      /game=xiangqi/,
    );
    assert.equal(await hub.locator(".hub-rank-overview select").count(), 0);

    const boards = await context.newPage();
    boards.on("pageerror", (error) => errors.push(error.message));
    await boards.setViewportSize({ width: 360, height: 800 });
    const countBeforeDirectory = rankingRequests.length;
    await boards.goto(base + "/games/leaderboards/");
    await boards.waitForSelector(
      '[data-games-leaderboards][data-ready="true"]',
    );
    assert.equal(await boards.locator("[data-rank-game]").count(), 15);
    assert.equal(rankingRequests.length, countBeforeDirectory);
    await boards.locator('[data-rank-game="snake"]').click();
    await boards.waitForSelector("[data-hub-rank-results] tbody tr");
    assert.match(boards.url(), /game=snake&mode=normal&board=verified/);
    assert.equal(
      await boards.locator("[data-hub-rank-results] tbody tr").count(),
      10,
    );
    await boards.click("[data-hub-rank-more]");
    assert.equal(
      await boards.locator("[data-hub-rank-results] tbody tr").count(),
      15,
    );
    assert.match(
      await boards.locator("[data-hub-rank-me]").textContent(),
      /#11/,
    );
    await boards.click('[data-board-kind="demo"]');
    await boards.waitForSelector("[data-hub-rank-results] tbody tr");
    assert.match(
      await boards.locator("[data-hub-rank-status]").textContent(),
      /Fictional/,
    );
    await boards.click('[data-board-kind="local"]');
    assert.equal(
      await boards.locator("[data-hub-rank-results] tbody tr").count(),
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
    await hub.waitForSelector("#game-saves .saved-game-row .hub-save-icon svg");
    assert.equal(
      await play.locator(".game-achievement-link").getAttribute("href"),
      "/games/achievements/",
    );
    assert.equal(await hub.locator("#game-save-management").isVisible(), false);
    await hub.click("#game-manage-saves");
    assert.equal(await hub.locator("#game-save-management").isVisible(), true);
    await hub.click("#game-manage-saves");
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
    await boards.waitForFunction(() =>
      document
        .querySelector("[data-hub-rank-results]")
        .textContent.includes("測試玩家"),
    );
    assert.match(
      await boards.locator("[data-hub-rank-stats]").textContent(),
      /1 starts/,
    );
    await hub.waitForFunction(
      () => document.querySelector("[data-hub-coins]").textContent === "5",
    );
    const warmUp = hub.locator('[data-daily-task="warm-up"]');
    await warmUp.getByRole("button", { name: "Claim +10 coins" }).click();
    await warmUp.getByText("Claimed").waitFor();
    assert.equal(await hub.locator("[data-hub-coins]").textContent(), "15");
    assert.match(
      await hub.locator("[data-hub-reset]").textContent(),
      /^\d{2}:\d{2}:\d{2}$/,
    );
    assert.equal(
      await hub.locator("[data-hub-lobby-progress]").getAttribute("value"),
      "1",
    );
    const achievements = await context.newPage();
    achievements.on("pageerror", (error) => errors.push(error.message));
    await achievements.goto(
      base + (await hub.locator(".hub-achievement-link").getAttribute("href")),
    );
    await achievements
      .locator("[data-hub-badges] article")
      .first()
      .getByText("Unlocked")
      .waitFor();
    await achievements
      .locator("[data-achievements-guest] [data-sign-in]")
      .waitFor();
    assert.equal(await hub.locator("#games-progress").count(), 0);
    await hub.waitForFunction(() =>
      document
        .querySelector('[data-hub-featured="snake"] [data-hub-best]')
        .textContent.endsWith("pts"),
    );
    assert.equal(
      await hub
        .locator('[data-hub-featured="snake"] [data-hub-plays]')
        .textContent(),
      "1",
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
          score: i === 0 ? 1001 : 0,
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
      await boards.locator("[data-hub-rank-results] tbody tr").count(),
      1,
      "sample rows never enter local board",
    );
    assert.equal(
      await hub.locator("[data-hub-highlight]").textContent(),
      "Score chaser",
    );

    await hub.evaluate(async () => {
      const { createRecordStore } =
        await import("/tool-scripts/record-store.js");
      const { create, validateSave } = await import("/game-scripts/engine.js");
      const saves = createRecordStore("game", validateSave);
      for (let i = 0; i < 4; i++)
        await saves.put(
          {
            game: "2048",
            difficulty: "classic",
            state: create("2048", "classic", i + 1),
            elapsed: 0,
          },
          crypto.randomUUID(),
          "guest",
        );
    });
    await hub.waitForSelector("#game-saves [data-save-extra]", {
      state: "attached",
    });
    assert.equal(
      await hub.locator("#game-saves .saved-game-row:visible").count(),
      3,
    );
    await hub.click("#game-manage-saves");
    assert.equal(
      await hub.locator("#game-saves .saved-game-row:visible").count(),
      4,
    );
    await hub.click("#game-manage-saves");

    await hub.goto(base + "/zh-hant/games/");
    await hub.waitForFunction(
      () => document.querySelector("[data-hub-coins]").textContent !== "—",
    );
    assert.match(await hub.locator("h1").textContent(), /遊戲大廳/);
    assert.match(
      await hub.locator("[data-hub-tasks]").textContent(),
      /完成兩款不同遊戲/,
    );
    assert.match(
      await hub.locator("[data-hub-theme]").getAttribute("aria-label"),
      /切換為淺色主題/,
    );
    assert.match(
      await hub
        .locator('[data-hub-featured="snake"] a')
        .last()
        .getAttribute("href"),
      /^\/zh-hant\/games\/leaderboards\//,
    );
    await boards.goto(
      base + "/zh-hant/games/leaderboards/?game=pong&board=verified",
    );
    await boards.waitForSelector(
      '[data-board-kind="local"][aria-pressed="true"]',
    );
    assert.equal(
      await boards.locator('[data-board-kind="verified"]').count(),
      0,
    );
    assert.equal(await boards.locator("[data-rank-game]").count(), 15);

    const midnight = await context.newPage();
    midnight.on("pageerror", (error) => errors.push(error.message));
    await midnight.clock.install({ time: new Date("2027-02-02T15:59:48Z") });
    await midnight.goto(base + "/games/");
    await midnight.evaluate(async () => {
      const { recordActivity } = await import("/game-scripts/hub-store.js");
      await recordActivity("guest", {
        id: crypto.randomUUID(),
        segmentId: crypto.randomUUID(),
        game: "snake",
        mode: "normal",
        activeMs: 1000,
        started: true,
        finished: true,
      });
    });
    await midnight.locator('[data-daily-claim="warm-up"]').waitFor();
    assert.match(
      await midnight.locator("[data-hub-reset]").textContent(),
      /^00:00:\d{2}$/,
    );
    const lateBalance = await midnight
      .locator("[data-hub-coins]")
      .textContent();
    await midnight.clock.fastForward(15000);
    await midnight.waitForFunction(() =>
      document
        .querySelector("[data-hub-day]")
        .textContent.includes("February 3"),
    );
    assert.equal(await midnight.locator("[data-daily-claim]").count(), 0);
    assert.equal(
      await midnight.locator("[data-hub-coins]").textContent(),
      lateBalance,
    );
    await midnight.close();

    await hub.evaluate(() => localStorage.setItem("hubFixtureUser", "a"));
    await hub.goto(base + "/games/");
    await hub.getByText("Player A", { exact: true }).last().waitFor();
    await hub.waitForFunction(
      () =>
        document.querySelector('[data-hub-featured="snake"] [data-hub-best]')
          .textContent === "720 pts",
    );
    assert.equal(
      await hub
        .locator('[data-hub-featured="xiangqi"] [data-hub-best]')
        .textContent(),
      "3 wins · 10+5",
    );
    assert.equal(
      await hub.locator("[data-hub-verified-count]").textContent(),
      "2 / 30",
    );
    assert.equal(
      await hub.locator("[data-hub-highlight]").textContent(),
      "Keep it bouncing",
    );
    assert.equal(
      await hub.locator("[data-hub-verified-progress]").getAttribute("value"),
      "2",
    );
    assert.equal(
      await hub.locator("[data-hub-profile-link]").getAttribute("href"),
      "/profile/?id=a",
    );
    const accountClaim = hub.locator('[data-daily-claim="warm-up"]');
    await accountClaim.waitFor();
    await hub.evaluate(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event("offline"));
    });
    assert(await accountClaim.isDisabled());
    assert.match(
      await hub.locator("[data-hub-claim-status]").textContent(),
      /Go online/,
    );
    await hub.evaluate(() => {
      delete navigator.onLine;
      window.dispatchEvent(new Event("online"));
    });
    await accountClaim.click();
    await warmUp.getByText("Claimed").waitFor();
    assert.equal(await hub.locator("[data-hub-coins]").textContent(), "15");
    await achievements.goto(base + "/zh-hant/games/achievements/");
    await achievements.locator("#games-progress").waitFor();
    assert.equal(await achievements.locator("h1").textContent(), "成就");
    assert.equal(
      await achievements.locator("#progress-all .milestone-card").count(),
      30,
    );
    await hub.evaluate(() => localStorage.setItem("hubFixtureUser", "b"));
    await hub.reload();
    await hub.waitForFunction(
      () =>
        document.querySelector('[data-hub-featured="snake"] [data-hub-best]')
          .textContent === "No verified record yet",
    );
    assert.equal(
      await hub.locator("[data-hub-highlight-detail]").textContent(),
      "No scoring badge unlocked yet.",
    );

    await warmUp.getByText("Claimed").waitFor();
    assert.equal(
      await hub.locator("[data-daily-claim]").count(),
      0,
      "legacy snapshot still shows auto-credited tasks",
    );

    const auto = await context.newPage();
    await auto.emulateMedia({ reducedMotion: "no-preference" });
    await auto.setViewportSize({ width: 1366, height: 768 });
    await auto.clock.install();
    await auto.goto(base + "/games/");
    await auto.waitForSelector('[data-games-directory][data-ready="true"]');
    await auto.waitForFunction(
      () =>
        document
          .querySelector("[data-hub-rotate]")
          .getAttribute("aria-label") === "Pause slideshow",
    );
    await auto.clock.fastForward(4400);
    assert(await auto.locator('[data-hub-featured="snake"]').isVisible());
    await auto.clock.fastForward(1100);
    await auto.waitForSelector('[data-hub-featured="brick-breaker"]:visible');
    await auto.focus("[data-hub-rotate]");
    await auto.clock.fastForward(8000);
    assert.equal(
      await auto.locator('[data-hub-featured="brick-breaker"]').isVisible(),
      true,
    );
    await auto.keyboard.press("Enter");
    await auto.clock.fastForward(8000);
    await auto.waitForSelector('[data-hub-featured="xiangqi"]:visible');
    await auto.locator(".hub-feature").dispatchEvent("mouseenter");
    await auto.clock.fastForward(8000);
    assert.equal(
      await auto.locator('[data-hub-featured="xiangqi"]').isVisible(),
      true,
    );
    await auto.locator(".hub-feature").dispatchEvent("mouseleave");
    await auto.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await auto.clock.fastForward(8000);
    assert.equal(
      await auto.locator('[data-hub-featured="xiangqi"]').isVisible(),
      true,
    );
    await auto.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await auto.evaluate(() => {
      const carousel = document.querySelector(".hub-feature");
      carousel.dispatchEvent(
        Object.assign(new Event("touchstart"), {
          touches: [{ clientX: 200, clientY: 80 }],
        }),
      );
      carousel.dispatchEvent(
        Object.assign(new Event("touchend"), {
          changedTouches: [{ clientX: 90, clientY: 81 }],
        }),
      );
    });
    await auto.waitForSelector('[data-hub-featured="2048"]:visible');
    assert.equal(
      await auto.locator("[data-hub-rotate]").getAttribute("aria-label"),
      "Play slideshow",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS lobby layouts and motion, verified and guest profiles, leaderboard previews and deep links, resume count, local scores and cross-tab skins",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
