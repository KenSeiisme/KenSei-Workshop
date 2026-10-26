const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
const A = "11111111-1111-4111-8111-111111111111";
const sdk = `export function createClient(){let listener;return {auth:{getSession:async()=>({data:{session:window.__qaUser?{user:{id:window.__qaUser}}:null}}),onAuthStateChange:fn=>listener=fn,signInWithOAuth:async opts=>{window.__oauth=opts;return{error:null}},signOut:async()=>{window.__qaUser=null;listener?.('SIGNED_OUT',null);return{error:null}}},from(){return{select(){return this},order:async()=>({data:[],error:null})}},rpc:async(name,args)=>{const r=await fetch('/__qa/rpc/'+name,{method:'POST',headers:{'x-test-user':window.__qaUser||''},body:JSON.stringify(args)});return r.json()}}}`;
(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(require("../support/db-fixture.cjs").bootstrap);
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [A, { full_name: "Test 玩家" }],
  );
  for (let i = 0; i < 12; i++) {
    const user = crypto.randomUUID(),
      session = crypto.randomUUID();
    await db.query("insert into auth.users(id) values($1)", [user]);
    await db.query(
      "insert into public.typing_profiles(user_id,nickname) values($1,$2)",
      [user, "Player " + i],
    );
    await db.query(
      "insert into public.typing_test_sessions(id,user_id,language,version) values($1,$2,'en',1)",
      [session, user],
    );
    await db.query(
      "insert into public.typing_results values($1,$2,'en',1,$3,100,clock_timestamp())",
      [session, user, 10 + i],
    );
  }
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const errors = [],
    checks = [];
  let requests = [],
    loseReceipt = false,
    chain = Promise.resolve();
  async function context(user) {
    const c = await browser.newContext({ reducedMotion: "reduce" });
    await c.addInitScript((u) => (window.__qaUser = u), user || null);
    c.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) => r.fulfill({ contentType: "application/javascript", body: sdk }),
    );
    await c.route("**/__qa/rpc/**", async (r) => {
      chain = chain.then(async () => {
        try {
          const name = r.request().url().split("/").pop(),
            args = JSON.parse(r.request().postData()),
            id = r.request().headers()["x-test-user"];
          requests.push(name);
          if (name === "start_typing_test")
            await db.query(
              "update public.typing_test_sessions set started_at=clock_timestamp()-interval '66 seconds' where user_id=$1",
              [id],
            );
          if (name === "finish_typing_test")
            await db.query(
              "update public.typing_test_sessions set started_at=clock_timestamp()-interval '61 seconds' where id=$1",
              [args.sessionId],
            );
          await db.exec(
            `set role ${id ? "authenticated" : "anon"};select set_config('request.jwt.claim.sub','${id || ""}',false)`,
          );
          let data;
          try {
            data = (
              await db.query(
                `select public.${name}(${Object.keys(args)
                  .map((k, i) => '"' + k + '"=>$' + (i + 1))
                  .join(",")}) value`,
                Object.values(args),
              )
            ).rows[0].value;
          } finally {
            await db.exec("reset role");
          }
          if (name === "finish_typing_test" && loseReceipt) {
            loseReceipt = false;
            return r.abort("connectionfailed");
          }
          await r.fulfill({ json: { data, error: null } });
        } catch (e) {
          await db.exec("reset role");
          await r.fulfill({
            json: { data: null, error: { message: e.message } },
          });
        }
      });
      await chain;
    });
    return c;
  }
  async function open(c, path) {
    const p = await c.newPage();
    await p.goto(base + path);
    return p;
  }
  async function ready(p) {
    await p.waitForFunction(
      () => document.querySelector("[data-tool]")?.dataset.uiReady === "true",
    );
  }
  const check = (x) => {
    checks.push(x);
    console.log("PASS " + x);
  };
  try {
    const guest = await context();
    let p = await open(guest, "/tools/");
    await p.waitForSelector("[data-tool-card]");
    const popupReady = guest.waitForEvent("page");
    await p
      .locator("[data-tool-card] .card-primary-link")
      .first()
      .click({ modifiers: ["Control"] });
    const popup = await popupReady;
    await popup.waitForLoadState();
    assert(popup.url().includes("/tools/"));
    assert(p.url().endsWith("/tools/"));
    await popup.close();
    const card = p.locator("[data-tool-card]").first();
    const url = await card.locator(".card-primary-link").getAttribute("href");
    assert.equal(await card.locator("a").count(), 1);
    await card.locator("[data-favorite]").click();
    assert(p.url().endsWith("/tools/"));
    await card.click({ position: { x: 12, y: 110 } });
    await p.waitForURL(base + url);
    check("whole tool card navigates; favorite remains independent");
    await p.goto(base + "/workspace/");
    await p.waitForSelector("#favorite-tools .card-primary-link");
    await p.locator("#favorite-tools [data-delete]").click();
    assert(p.url().endsWith("/workspace/"));
    check("Workspace favorite remove does not navigate");
    await p.goto(base + "/games/");
    const game = p.locator("[data-game-card]").first();
    assert.equal(await game.locator("a").count(), 1);
    const gameUrl = await game.locator("a").getAttribute("href");
    await game.click({ position: { x: 12, y: 75 } });
    await p.waitForURL(base + gameUrl);
    check("game cover and blank area use the native card link");
    await p.goto(base + "/zh-hant/tools/");
    const link = p.locator("[data-tool-card] .card-primary-link").first();
    assert((await link.getAttribute("href")).startsWith("/zh-hant/tools/"));
    await link.focus();
    await p.keyboard.press("Enter");
    await p.waitForURL(/\/zh-hant\/tools\/.+\//);
    check("localized links and keyboard Enter");
    p = await open(guest, "/tools/decision-studio/");
    await ready(p);
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await p.evaluate(async () => {
      const { Wheel } = await import("/vendor/spin-wheel.js");
      const original = Wheel.prototype.spinTo;
      Wheel.prototype.spinTo = function (rotation, duration, ease) {
        window.__target = { rotation, duration };
        window.__wheel = this;
        return original.call(this, rotation, duration, ease);
      };
    });
    await p.locator("#decision-run").click();
    await p.waitForFunction(
      () => !document.querySelector("#decision-run").disabled,
    );
    const wheel = await p.evaluate(() => ({
      target: window.__target,
      label: window.__wheel.items[window.__wheel.getCurrentIndex()].label,
      rotation: window.__wheel.rotation,
    }));
    assert.equal(
      await p.locator("#decision-result").textContent(),
      wheel.label,
    );
    assert.equal(wheel.rotation, wheel.target.rotation);
    assert(wheel.target.duration >= 2600 && wheel.target.duration <= 3400);
    check("animated wheel agrees with random final angle");
    await p.locator("#decision-run").click();
    await p.locator("#decision-options").fill("Only option");
    await p.waitForTimeout(3500);
    assert(!(await p.locator("#decision-run").isDisabled()));
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.locator("#decision-run").click();
    assert.equal(
      await p.locator("#decision-result").textContent(),
      "Only option",
    );
    await p
      .locator("#decision-options")
      .fill(Array.from({ length: 200 }, (_, i) => "Option " + i).join("\n"));
    await p.locator("#decision-run").click();
    assert.match(await p.locator("#decision-result").textContent(), /^Option /);
    check(
      "wheel editing cancels old callbacks; reduced motion, 1 and 200 options",
    );
    p = await open(guest, "/tools/typing-sprint/");
    await ready(p);
    await p.waitForSelector("#leaderboard-rows tr");
    assert.equal(await p.locator("#leaderboard-rows tr:visible").count(), 10);
    await p.locator("#leaderboard-expand").click();
    assert.equal(await p.locator("#leaderboard-rows tr:visible").count(), 12);
    await p.locator("#leaderboard-expand").click();
    assert.equal(await p.locator("#typing-mode").inputValue(), "ranked");
    assert(!requests.includes("start_typing_test"));
    await p.locator("#typing-language").selectOption("zh");
    await p.locator("#typing-start").click();
    assert(await p.locator("#auth-dialog").evaluate((n) => n.open));
    await p.locator("#google-login").click();
    assert(await p.evaluate(() => !!window.__oauth));
    await p.evaluate(() => document.querySelector("#auth-dialog").close());
    assert.equal(await p.locator("#typing-time").textContent(), "60");
    check("Public default; guest login does not auto-start");
    await p.locator("#typing-mode").selectOption("practice");
    await p.clock.install();
    await p.locator("#typing-start").click();
    await p.waitForFunction(
      () => !document.querySelector("#typing-input").disabled,
    );
    const first = await p.locator("#typing-passage").textContent();
    assert(
      await p
        .locator("body")
        .evaluate((n) => n.classList.contains("typing-is-focused")),
    );
    await p.evaluate(() => {
      window.__input = document.querySelector("#typing-input");
      const n = window.__input;
      n.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      n.value = "未確認";
      n.dispatchEvent(
        new InputEvent("input", { bubbles: true, isComposing: true }),
      );
    });
    assert.equal(await p.locator("#typing-speed").textContent(), "0.0");
    await p.evaluate(() => {
      const n = window.__input;
      n.value = "中文";
      n.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });
    await p.locator("#typing-focus").click();
    await p.locator("#typing-settings-open").click();
    await p
      .locator("#typing-settings [data-language-select]")
      .selectOption("zh-Hant");
    await p.waitForFunction(() => document.documentElement.lang === "zh-Hant");
    await p.locator("#typing-settings-close").click();
    assert(
      await p.evaluate(
        () => window.__input === document.querySelector("#typing-input"),
      ),
    );
    assert.equal(await p.locator("#typing-input").inputValue(), "中文");
    await p.clock.fastForward(60000);
    await p.waitForFunction(
      () => document.querySelector("#typing-input").disabled,
    );
    assert(await p.locator("#typing-result").isVisible());
    await p.locator("#typing-start").click();
    await p.waitForFunction(
      () => !document.querySelector("#typing-input").disabled,
    );
    assert.notEqual(await p.locator("#typing-passage").textContent(), first);
    check(
      "Practice uses fresh text; IME, locale, focus and timer preserve input node",
    );
    await p.close();
    const signed = await context(A);
    p = await open(signed, "/tools/typing-sprint/");
    await ready(p);
    await p.clock.install();
    await p.locator("#typing-start").click();
    await p.waitForFunction(
      () => !document.querySelector("#typing-input").disabled,
    );
    const prefix = (await p.locator("#typing-passage").textContent()).slice(
      0,
      100,
    );
    await p.locator("#typing-input").fill(prefix);
    loseReceipt = true;
    await p.clock.fastForward(60000);
    await p.waitForFunction(
      () => !document.querySelector("#typing-submit-retry").hidden,
    );
    assert(await p.locator("#typing-start").isDisabled());
    await p.locator("#typing-submit-retry").click();
    await p.waitForFunction(
      () =>
        document.querySelector("#typing-run-label").textContent === "Verified",
    );
    const count = (
      await db.query(
        "select count(*)::int n from public.typing_results where user_id=$1",
        [A],
      )
    ).rows[0].n;
    assert.equal(count, 1);
    check(
      "lost server receipt retries idempotently; only confirmed result is Verified",
    );
    for (const width of [320, 360, 768, 1100, 1440])
      for (const prefix of ["", "/zh-hant"]) {
        const layout = await open(guest, prefix + "/tools/typing-sprint/");
        await ready(layout);
        await layout.setViewportSize({ width, height: 800 });
        const size = await layout.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          passage: document
            .querySelector("#typing-passage")
            .getBoundingClientRect().top,
          start: document.querySelector("#typing-start").getBoundingClientRect()
            .bottom,
          board: document.querySelector(".typing-board").getBoundingClientRect()
            .left,
          stage: document.querySelector(".typing-stage").getBoundingClientRect()
            .right,
        }));
        assert(!size.overflow, JSON.stringify({ width, prefix, ...size }));
        assert(size.start < 800, JSON.stringify(size));
        if (width >= 1100) assert(size.board >= size.stage);
        if (width === 360 || width === 1440)
          await layout.screenshot({
            path: `_qa/typing-${width}${prefix ? "-zh" : ""}.png`,
            fullPage: false,
          });
        await layout.close();
      }
    check(
      "320–1440 layouts, both languages, visible Start and desktop sidebar",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/typing-experience.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
  } finally {
    await browser.close();
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
