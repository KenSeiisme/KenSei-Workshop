const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8811";
(async () => {
  const { gameDatabase } = await import("../support/games-fixture.mjs"),
    { create, apply } = await import("../../src/games/engine.js"),
    { build } = await import("esbuild");
  await build({
    entryPoints: ["supabase/functions/games-session/index.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: "_qa/games-browser-edge.mjs",
  });
  const { makeHandler } = await import("../../_qa/games-browser-edge.mjs"),
    {
      db,
      users: [A, B],
      rpc,
      admin,
    } = await gameDatabase();
  let chain = Promise.resolve(),
    failSync = false,
    loseAck = false,
    loseFinishAck = false,
    lastSession = null;
  const serial = (fn) => {
    const task = chain.catch(() => {}).then(fn);
    chain = task;
    return task;
  };
  const handler = makeHandler(
    (key) =>
      ({
        SUPABASE_URL: "https://backend.test",
        SUPABASE_SERVICE_ROLE_KEY: "test-server-key",
      })[key],
    async (url, o) => {
      if (url.endsWith("/auth/v1/user")) {
        const id = o.headers.Authorization.includes("userB") ? B : A;
        return Response.json({ id });
      }
      const p = JSON.parse(o.body);
      try {
        return Response.json(
          await serial(() => admin(p.action, p.owner, p.body)),
        );
      } catch (e) {
        return Response.json({ message: e.message }, { status: 400 });
      }
    },
  );
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    contexts = [],
    errors = [],
    calls = [];
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
          body: `export function createClient(){const id=sessionStorage.getItem("qa-account")||window.__qaUser;return{auth:{getSession:async()=>({data:{session:id?{user:{id},access_token:"aaa.userA.ccc"}:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async(name,args)=>{const r=await fetch("/__qa/games/rpc/"+name,{method:"POST",headers:{"x-user":id||""},body:JSON.stringify(args)});return r.json()},functions:{invoke:async(name,{body})=>{const r=await fetch("/__qa/games/functions/"+name.split("/").at(-1),{method:"POST",headers:{"x-user":id||""},body:JSON.stringify(body)});const data=await r.json();return r.ok?{data}:{error:{message:data.error,context:{json:async()=>data}},data:null}}}}}`,
        }),
    );
    await c.route("**/__qa/games/rpc/*", async (r) => {
      const name = r.request().url().split("/").at(-1),
        user = r.request().headers()["x-user"] || null,
        args = r.request().postDataJSON();
      calls.push({ name, args, user });
      if (failSync && name === "save_game_save")
        return r.fulfill({ json: { error: { message: "offline" } } });
      try {
        const data = await serial(() =>
          rpc(name, args, user ? "authenticated" : "anon", user),
        );
        if (loseAck && name === "save_game_save") {
          loseAck = false;
          return r.abort();
        }
        await r.fulfill({ json: { data, error: null } });
      } catch (e) {
        await r.fulfill({ json: { error: { message: e.message } } });
      }
    });
    await c.route("**/__qa/games/functions/*", async (r) => {
      const action = r.request().url().split("/").at(-1),
        user = r.request().headers()["x-user"],
        request = new Request(
          "https://backend.test/functions/v1/games-session/" + action,
          {
            method: "POST",
            headers: {
              Authorization: user
                ? `Bearer aaa.${user === B ? "userB" : "userA"}.ccc`
                : "",
              Origin: base,
              "Content-Type": "application/json",
            },
            body: r.request().postData(),
          },
        );
      calls.push({ name: "function:" + action, user });
      const response = await handler(request),
        data = await response.json();
      if (action === "start" && response.ok) lastSession = data;
      if (action === "finish" && loseFinishAck) {
        loseFinishAck = false;
        return r.abort();
      }
      await r.fulfill({ status: response.status, json: data });
    });
    c.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    return c;
  }
  const guest = await context(),
    p = await guest.newPage();
  const open = async (page, slug) => {
    await page.goto(base + "/games/" + slug + "/");
    await page.waitForSelector("[data-game][data-ready=true]");
  };
  try {
    await p.goto(base + "/games/");
    await p.waitForSelector("[data-game-card]");
    assert.equal(await p.locator("[data-game-card]").count(), 12);
    await p.fill("#game-search", "snake");
    assert.equal(await p.locator("[data-game-card]:visible").count(), 1);
    await p.fill("#game-search", "");
    await p.click('[data-game-filter="puzzle"]');
    assert.equal(await p.locator("[data-game-card]:visible").count(), 6);
    await open(p, "2048");
    assert.equal(await p.inputValue("#game-mode"), "private");
    assert.equal(await p.locator(".tile").count(), 0);
    assert.equal(calls.filter((c) => c.name === "function:start").length, 0);
    await p.click("#game-start");
    await p.waitForTimeout(700);
    assert.equal(await p.locator(".tile").count(), 16);
    let saved = await p.evaluate(async () => {
      const r = indexedDB.open("kensei-record-game-v1");
      const db = await new Promise(
        (resolve) => (r.onsuccess = () => resolve(r.result)),
      );
      return new Promise((resolve) => {
        const g = db.transaction("scopes").objectStore("scopes").get("guest");
        g.onsuccess = () => resolve(g.result);
      });
    });
    let row = Object.values(saved.records)[0];
    assert.equal(row.data.game, "2048");
    const before = row.data.state.board;
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
      await p.focus("#game-board");
      await p.keyboard.press(key);
      if (await p.isEnabled("#game-undo")) break;
    }
    await p.click("#game-undo");
    assert.deepEqual(
      await p.locator(".tile").allTextContents(),
      before.map((n) => (n ? String(n) : "")),
    );
    await p.click("#game-pause");
    assert.equal(await p.locator("#game-overlay").isVisible(), true);
    await p.reload();
    await p.waitForSelector("[data-game][data-ready=true]");
    await p.waitForSelector("#game-restore:not([hidden])");
    await p.click("#game-restore");
    assert.equal(await p.inputValue("#game-mode"), "private");
    await p.goto(base + "/games/");
    await p.waitForSelector(".saved-game-row");
    assert.match(await p.locator("#game-saves").innerText(), /2048/);
    console.log(
      "PASS game directory search, no autoplay, guest local save, undo, pause and explicit restore",
    );
    const account = await context(A),
      q = await account.newPage();
    await open(q, "memory-match");
    assert.equal(await q.inputValue("#game-mode"), "public");
    await q.click("#game-start");
    await q.waitForSelector(".memory-card");
    let s = create("memory-match", "normal", Number(lastSession.seed));
    for (let pair = 0; pair < 8; pair++)
      for (let i = 0; i < s.cards.length; i++)
        if (s.cards[i] === pair) await q.click(`[data-cell="${i}"]`);
    await q.waitForFunction(() =>
      document
        .querySelector("#game-status")
        .textContent.includes("Public result verified"),
    );
    await q.waitForFunction(() =>
      document.querySelector("#game-my-rank").textContent.includes("rank: #1"),
    );
    assert.match(await q.locator("#game-score").innerText(), /^8$/);
    assert.equal(
      await q.locator("#game-result-public").getAttribute("data-submission"),
      "verified",
    );
    await q.goto(
      base +
        "/profile/?id=" +
        (await serial(() => rpc("ensure_my_profile", { expected_user: A })))
          .public_id,
    );
    await q.waitForSelector("#public-profile:not([hidden])");
    await q.waitForFunction(() =>
      document.body.textContent.includes("Personal bests"),
    );
    console.log(
      "PASS logged-in Public default, complete matching game, actual server replay, automatic score and Profile game best",
    );
    await open(q, "minesweeper");
    await q.click("#game-start");
    await q.waitForSelector(".mines-grid");
    s = create("minesweeper", "beginner", Number(lastSession.seed));
    apply(s, { type: "reveal", index: 40 });
    await q.click('[data-cell="40"]');
    for (let i = 0; i < s.board.length && s.status === "playing"; i++)
      if (s.board[i] !== -1 && !s.revealed.includes(i)) {
        apply(s, { type: "reveal", index: i });
        await q.click(`[data-cell="${i}"]`);
      }
    await q.waitForFunction(() =>
      document
        .querySelector("#game-status")
        .textContent.includes("Public result verified"),
    );
    await q.waitForFunction(() =>
      document.querySelector("#game-my-rank").textContent.includes("rank: #1"),
    );
    console.log(
      "PASS first-safe reveal, complete minefield and server-timed winning result",
    );
    await open(q, "snake");
    await q.click("#game-start");
    await q.waitForSelector("canvas");
    await q.click("#game-pause");
    assert.equal(await q.inputValue("#game-mode"), "private");
    assert.match(await q.locator("#game-status").innerText(), /Private/);
    assert.ok(calls.some((x) => x.name === "function:abandon"));
    await q.click("#game-resume");
    await q.waitForTimeout(500);
    assert.equal(await q.locator("#game-overlay").isVisible(), false);
    await q.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await q.locator("#game-overlay").isVisible(), true);
    await q.evaluate(() =>
      Object.defineProperty(document, "hidden", {
        value: false,
        configurable: true,
      }),
    );
    console.log("PASS Public pause downgrade, abandonment and background stop");
    await open(q, "2048");
    failSync = true;
    await q.selectOption("#game-mode", "private");
    await q.click("#game-start");
    await q.waitForTimeout(1400);
    assert.match(
      await q.locator("#game-save-status").innerText(),
      /Sync failed/,
    );
    failSync = false;
    loseAck = true;
    await q.click("#game-save-retry");
    await q.waitForTimeout(700);
    await q.click("#game-save-retry");
    await q.waitForFunction(() =>
      document
        .querySelector("#game-save-status")
        .textContent.includes("Synced"),
    );
    const second = await account.newPage();
    await second.goto(base + "/games/");
    await second.waitForSelector(".saved-game-row");
    assert.match(await second.locator("#game-saves").innerText(), /2048/);
    const other = await context(B),
      bpage = await other.newPage();
    await bpage.goto(base + "/games/");
    await bpage.waitForFunction(() =>
      document
        .querySelector("#game-save-status")
        .textContent.includes("Synced"),
    );
    assert.equal(await bpage.locator(".saved-game-row").count(), 0);
    console.log(
      "PASS offline persistence, lost acknowledgment, idempotent retry, second tab and account isolation",
    );
    const device = await context(A),
      dpage = await device.newPage();
    await open(dpage, "2048");
    await dpage.waitForSelector("#game-restore:not([hidden])");
    await dpage.click("#game-restore");
    await dpage.click("#game-pause");
    await dpage.waitForFunction(() =>
      document
        .querySelector("#game-save-status")
        .textContent.includes("Synced"),
    );
    await q.focus("#game-board");
    await q.keyboard.press("ArrowLeft");
    await q.click("#game-save-retry");
    await q.waitForFunction(() =>
      document
        .querySelector("#game-status")
        .textContent.includes("conflict copy"),
    );
    const saves = await serial(() =>
      rpc(
        "get_game_saves",
        {
          kind: "game",
          before_time: null,
          before_id: null,
          page_size: 25,
          expected_user: A,
        },
        "authenticated",
        A,
      ),
    );
    assert.ok(saves.filter((x) => x.data.game === "2048").length >= 2);
    console.log("PASS independent device edits preserve a conflict copy");
    await open(bpage, "memory-match");
    loseFinishAck = true;
    await bpage.click("#game-start");
    await bpage.waitForSelector(".memory-card");
    s = create("memory-match", "normal", Number(lastSession.seed));
    for (let pair = 0; pair < 8; pair++)
      for (let i = 0; i < s.cards.length; i++)
        if (s.cards[i] === pair) await bpage.click(`[data-cell="${i}"]`);
    await bpage.waitForSelector("#game-submit-retry:not([hidden])");
    assert.equal(
      await bpage
        .locator("#game-result-public")
        .getAttribute("data-submission"),
      "failed",
    );
    await bpage.reload();
    await bpage.waitForSelector("[data-game][data-ready=true]");
    await bpage.waitForSelector("#game-submit-retry:not([hidden])");
    await bpage.click("#game-submit-retry");
    await bpage.waitForFunction(() =>
      document
        .querySelector("#game-status")
        .textContent.includes("Public result verified"),
    );
    assert.equal(
      (
        await serial(() =>
          db.query(
            "select count(*)::integer n from workshop_private.game_results where user_id=$1 and game='memory-match'",
            [B],
          ),
        )
      ).rows[0].n,
      1,
    );
    console.log(
      "PASS completed Public outbox survives refresh and retries without duplicate scores",
    );
    for (const width of [320, 360, 768, 1440]) {
      await p.setViewportSize({ width, height: 950 });
      for (const slug of ["2048", "minesweeper", "snake", "memory-match"]) {
        await open(p, slug);
        if (slug === "minesweeper")
          await p.selectOption("#game-difficulty", "expert");
        await p.click("#game-start");
        await p.waitForTimeout(80);
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${slug} overflow at ${width}`,
        );
        await p.click("#game-pause");
      }
    }
    await p.setViewportSize({ width: 1440, height: 1100 });
    await open(p, "2048");
    await p.click("#game-start");
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({ path: "_qa/games-2048-desktop.png", fullPage: true });
    await p.goto(base + "/games/");
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({
      path: "_qa/games-directory-desktop.png",
      fullPage: true,
    });
    await p.setViewportSize({ width: 360, height: 900 });
    await open(p, "memory-match");
    await p.selectOption("#game-difficulty", "hard");
    await p.click("#game-start");
    assert.ok(
      (await p.locator(".memory-card").first().boundingBox()).width >= 44,
    );
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({ path: "_qa/games-memory-mobile.png", fullPage: true });
    assert.ok((await p.locator("#game-start").boundingBox()).width >= 200);
    await p.click("#game-settings-change");
    assert.equal(await p.isEnabled("#game-difficulty"), true);
    await p.selectOption("#game-difficulty", "easy");
    await p.click("#game-start");
    assert.equal(await p.locator(".memory-card").count(), 12);
    await open(p, "minesweeper");
    await p.click("#game-start");
    await p.click('[data-mine-mode="flag"]');
    await p.click('[data-cell="0"]');
    assert.match(
      await p.locator('[data-cell="0"]').getAttribute("aria-label"),
      /flagged/,
    );
    assert.match(await p.locator("#mine-count").innerText(), /1 flags/);
    await p.focus("#game-board");
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("#game-overlay").isVisible(), true);
    await p.goto(base + "/games/");
    await p.waitForSelector(".saved-game-row");
    const countBefore = (
      await serial(() =>
        rpc(
          "get_game_saves",
          {
            kind: "game",
            before_time: null,
            before_id: null,
            page_size: 25,
            expected_user: A,
          },
          "authenticated",
          A,
        ),
      )
    ).length;
    await p.evaluate((id) => sessionStorage.setItem("qa-account", id), A);
    await p.reload();
    await p.waitForSelector("#games-copy-guest:not([hidden])");
    await p.waitForFunction(() =>
      document
        .querySelector("#game-save-status")
        .textContent.includes("Synced"),
    );
    assert.equal(
      (
        await serial(() =>
          rpc(
            "get_game_saves",
            {
              kind: "game",
              before_time: null,
              before_id: null,
              page_size: 25,
              expected_user: A,
            },
            "authenticated",
            A,
          ),
        )
      ).length,
      countBefore,
    );
    p.once("dialog", (d) => d.accept());
    await p.click("#games-copy-guest");
    await p.waitForFunction(() =>
      document
        .querySelector("#game-save-status")
        .textContent.includes("Synced"),
    );
    assert.ok(
      (
        await serial(() =>
          rpc(
            "get_game_saves",
            {
              kind: "game",
              before_time: null,
              before_id: null,
              page_size: 25,
              expected_user: A,
            },
            "authenticated",
            A,
          ),
        )
      ).length > countBefore,
    );
    await p.evaluate(() => sessionStorage.removeItem("qa-account"));
    await p.reload();
    await p.waitForSelector(".saved-game-row");
    p.once("dialog", (d) => d.accept());
    await p.click("#games-clear");
    await p.waitForFunction(() => !document.querySelector(".saved-game-row"));
    console.log(
      "PASS touch flagging, Escape pause, no automatic guest import, explicit account copy and scoped clear",
    );
    const blocked = await context();
    await blocked.addInitScript(() =>
      Object.defineProperty(window, "indexedDB", {
        value: {
          open() {
            throw Error("Storage blocked");
          },
        },
      }),
    );
    const blockedPage = await blocked.newPage();
    await open(blockedPage, "2048");
    await blockedPage.click("#game-start");
    await blockedPage.waitForTimeout(600);
    assert.equal(await blockedPage.locator(".tile").count(), 16);
    assert.match(
      await blockedPage.locator("#game-save-status").innerText(),
      /Save failed/,
    );
    await blockedPage.goto(base + "/games/");
    await blockedPage.waitForSelector(
      '[data-games-directory][data-ready="true"]',
    );
    await blockedPage.fill("#game-search", "snake");
    assert.equal(
      await blockedPage.locator("[data-game-card]:visible").count(),
      1,
    );
    console.log(
      "PASS blocked IndexedDB preserves play and independent catalog search",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS four games at 320/360/768/1440px, no page overflow and no uncaught browser errors",
    );
  } finally {
    for (const c of contexts) await c.close();
    await browser.close();
    await db.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
