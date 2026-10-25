const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const {
  openSettings,
  gameSelect,
  gameClick,
  closePanels,
} = require("../support/game-shell.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8812";
const games = JSON.parse(fs.readFileSync("data/games.json", "utf8"));
const sdk = `export function createClient(){const id=window.__shellSigned?'11111111-1111-4111-8111-111111111111':null;window.__shellCalls=[];return {auth:{getSession:async()=>({data:{session:id?{user:{id}}:null}}),onAuthStateChange(){},signInWithOAuth:async()=>({error:null})},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async(name,args)=>({data:name==='ensure_my_profile'?{public_id:id,nickname:'Shell Player',avatar_kind:'none'}:name==='get_game_leaderboard'?{version:1,top:[],me:null}:name==='get_my_game_progress'?{unlocks:[],progress:{},verified_results:0,games_ranked:0}:[],error:null}),functions:{invoke:async(name,{body})=>{window.__shellCalls.push({name,body});if(window.__shellFailStart&&name.endsWith('/start'))return{data:{error:'Temporary session failure'},error:{message:'Temporary session failure'}};return{data:{id:'22222222-2222-4222-8222-222222222222',seed:12345,version:body.game==='brick-breaker'?2:1},error:null}}}}}`;
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext(),
    errors = [],
    sizes = [];
  await context.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (route) => route.fulfill({ contentType: "text/javascript", body: sdk }),
  );
  context.on("page", (page) => {
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
  });
  let p = await context.newPage();
  const open = async (slug) => {
    if (p.url() !== "about:blank") {
      const viewport = p.viewportSize();
      await p.close();
      p = await context.newPage();
      await p.setViewportSize(viewport);
    }
    await p.goto(`${base}/games/${slug}/`);
    await p.waitForSelector("[data-ready=true]").catch(async (error) => {
      const detail = await p.evaluate(async () => ({
        ready: window.KenseiWorkspace?.ready,
        toast: document.querySelector(".toast")?.textContent,
        status: document.querySelector("#game-status")?.textContent,
        module: await Promise.race([
          import("/game-scripts/games.js").then(
            () => "loaded",
            (error) => error.stack,
          ),
          new Promise((resolve) =>
            setTimeout(() => resolve("pending module evaluation"), 500),
          ),
        ]),
      }));
      throw Error(
        `${slug}: ${JSON.stringify(detail)} ${errors.join(" | ")} ${error.message}`,
      );
    });
    await p.waitForTimeout(40);
  };
  try {
    await context.route("**/game-scripts/games.js", (route) => route.abort(), {
      times: 1,
    });
    await Promise.all([
      p.waitForEvent("requestfailed", {
        predicate: (request) =>
          request.url().endsWith("/game-scripts/games.js"),
      }),
      p.goto(base + "/games/2048/"),
    ]);
    assert.equal(await p.locator("[data-shell-load-retry]").isVisible(), true);
    assert.equal(await p.locator("#game-start").isDisabled(), true);
    await p.locator("[data-shell-load-retry]").click();
    await p.waitForSelector("[data-ready=true]");
    assert.equal(await p.locator("[data-shell-load-retry]").isVisible(), false);
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await p.setViewportSize(viewport);
      for (const { slug } of games) {
        await open(slug);
        const position = await p.locator(".game-board-shell").boundingBox();
        assert(
          position.y <= (viewport.width <= 760 ? 160 : 180),
          `${slug} starts too low: ${position.y}`,
        );
        assert(
          position.y + position.height <= viewport.height - 8,
          `${slug} preview outside first screen`,
        );
        assert.equal(
          await p.locator("[data-play-shell]").getAttribute("data-shell-state"),
          "ready",
        );
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          slug + " page overflow",
        );
        assert.equal(
          await p.evaluate(() => window.__shellCalls.length),
          0,
          "No session on load",
        );
        assert.equal(await p.locator(".header").isVisible(), true);
        if (slug !== "pong") {
          assert.equal(await p.locator(".game-idle-art").count(), 1);
          assert.equal(await p.locator("#game-start").isVisible(), true);
          await p.evaluate(
            () =>
              (window.__originalBoard = document.querySelector("#game-board")),
          );
          await gameClick(p, "#game-start");
          await p.waitForSelector(
            '[data-shell-state="playing"][data-focus="true"]',
          );
          assert.equal(await p.locator(".header").isVisible(), false);
          assert.equal(await p.locator(".footer").isVisible(), false);
          await p.locator("[data-shell-focus]").click();
          assert.equal(await p.locator(".header").isVisible(), true);
          assert.equal(
            await p.evaluate(
              () =>
                window.__originalBoard ===
                document.querySelector("#game-board"),
            ),
            true,
          );
          assert.equal(
            await p.locator("[data-play-shell]").getAttribute("data-run-state"),
            "playing",
          );
          await p.locator("[data-shell-focus]").click();
          const live = await p.locator(".game-board-shell").boundingBox();
          assert(
            live.y + live.height <= viewport.height - 45,
            `${slug} active board leaves no room for actions: ${JSON.stringify(live)}`,
          );
          await p.click("#game-pause");
        }
        sizes.push({
          slug,
          ...viewport,
          top: position.y,
          bottom: position.y + position.height,
        });
      }
    }
    console.log(
      "PASS 12 ready screens at five viewports; explicit start, complete preview, no sessions on load, focus exit retains board and running state.",
    );
    await p.setViewportSize({ width: 360, height: 800 });
    await open("2048");
    assert.equal(await p.locator("#game-restore").isVisible(), true);
    assert.match(await p.locator("#game-start").textContent(), /New game/);
    await p.click("#game-restore");
    await p.waitForSelector('[data-focus="true"][data-run-state="playing"]');
    await p.click("#game-pause");
    await p.reload();
    await p.waitForSelector("[data-ready=true]");
    await p.click("#game-restore");
    await p.waitForSelector('[data-focus="true"]');
    await openSettings(p);
    await p.keyboard.press("Escape");
    assert.equal(
      await p.locator("[data-play-shell]").getAttribute("data-run-state"),
      "playing",
    );
    assert.equal(
      await p.locator("[data-shell-settings-dialog][open]").count(),
      0,
    );
    await p.click("#game-pause");
    await p.click("#game-resume");
    await p.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      );
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    await p.setViewportSize({ width: 320, height: 640 });
    await p.waitForTimeout(80);
    assert.equal(
      await p.locator("[data-play-shell]").getAttribute("data-run-state"),
      "paused",
    );
    assert.equal(
      await p.evaluate(() =>
        document.body.classList.contains("game-is-focused"),
      ),
      true,
    );
    assert(
      parseFloat(
        await p
          .locator("[data-play-shell]")
          .evaluate((node) =>
            node.style.getPropertyValue("--shell-stage-space"),
          ),
      ) < 640,
    );
    console.log(
      "PASS saved Continue is primary; restoration remains Private; Escape closes settings before game pause.",
    );
    for (const slug of ["2048", "brick-breaker", "block-drop"]) {
      await p.setViewportSize({ width: 844, height: 390 });
      await open(slug);
      await gameClick(p, "#game-start");
      await p.waitForSelector('[data-focus="true"]');
      await p.waitForTimeout(50);
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        slug + " landscape overflow",
      );
      const box = await p.locator(".game-board-shell").boundingBox();
      assert(box.y + box.height <= 390, slug + " landscape board cropped");
      await p.click("#game-pause");
    }
    const signed = await browser.newContext({
      viewport: { width: 1366, height: 768 },
    });
    await signed.addInitScript(() => (window.__shellSigned = true));
    await signed.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (route) => route.fulfill({ contentType: "text/javascript", body: sdk }),
    );
    const q = await signed.newPage();
    q.on("pageerror", (e) => errors.push(e.message));
    await q.goto(base + "/games/2048/");
    await q.waitForSelector("[data-ready=true]");
    assert.equal(await q.inputValue("#game-mode"), "public");
    await q.evaluate(() => (window.__shellFailStart = true));
    await q.click("#game-start");
    await q.waitForFunction(() =>
      document
        .querySelector("#game-status")
        .textContent.includes("Temporary session failure"),
    );
    assert.equal(
      await q.locator("[data-play-shell]").getAttribute("data-shell-state"),
      "ready",
    );
    assert.equal(await q.locator("#game-start").isEnabled(), true);
    await q.evaluate(() => (window.__shellFailStart = false));
    await q.click("#game-start");
    await q.waitForSelector('[data-focus="true"]');
    await q.locator("[data-shell-focus]").click();
    await q.setViewportSize({ width: 360, height: 800 });
    await q.waitForTimeout(150);
    assert.equal(await q.inputValue("#game-mode"), "public");
    assert.equal(
      await q.evaluate(
        () =>
          window.__shellCalls.filter((x) => x.name.endsWith("/abandon")).length,
      ),
      0,
    );
    await q.locator("[data-shell-focus]").click();
    await q.keyboard.press("Escape");
    await q.waitForSelector('[data-run-state="paused"]');
    assert.equal(await q.inputValue("#game-mode"), "private");
    assert.equal(
      await q.evaluate(
        () =>
          window.__shellCalls.filter((x) => x.name.endsWith("/abandon")).length,
      ),
      1,
    );
    await signed.close();
    await p.setViewportSize({ width: 360, height: 800 });
    for (const effects of ["reduced", "off"]) {
      await open("2048");
      await openSettings(p);
      await p.selectOption("[data-effects-select]", effects);
      await p
        .locator("[data-shell-settings-dialog] [data-shell-close]")
        .last()
        .click();
      await gameClick(p, "#game-start");
      assert.equal(
        await p.locator("html").getAttribute("data-game-effects"),
        effects,
      );
      assert.equal(
        await p.locator("[data-play-shell]").getAttribute("data-focus"),
        "true",
      );
      await p.click("#game-pause");
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/game-play-shell-report.json",
      JSON.stringify({ sizes, errors }, null, 2),
    );
    console.log(
      "PASS short landscape; Public start failure/retry, resizing and focus keep eligibility; actual Escape pause downgrades once.",
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
