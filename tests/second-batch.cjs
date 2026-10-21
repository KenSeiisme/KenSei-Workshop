const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  chromium,
} = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8793";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const sdk = `export function createClient(){const id=window.__testUser;return {auth:{getSession:async()=>({data:{session:id?{user:{id,email:'private@example.invalid'}}:null}}),onAuthStateChange(){},signOut:async()=>({})},from(table){return{select(){return this},eq(){return this},maybeSingle:async()=>({data:window.__nickname?{nickname:window.__nickname}:null}),order:async()=>({data:[],error:null})}},rpc:async(name,args)=>{const r=await fetch('/__qa/rpc/'+name,{method:'POST',body:JSON.stringify(args)});return r.json();}}}`;
(async () => {
  const { PGlite } = await import("@electric-sql/pglite"),
    db = new PGlite();
  await db.exec(require("./db-fixture.cjs").bootstrap);
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [A, B]);
  const browser = await chromium.launch({ channel: "msedge", headless: true }),
    errors = [],
    results = [],
    contexts = [];
  let fail = false,
    late = false,
    chain = Promise.resolve();
  async function context(user = null, options = {}) {
    const c = await browser.newContext({ reducedMotion: "reduce", ...options });
    contexts.push(c);
    await c.addInitScript((id) => (window.__testUser = id), user);
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) =>
        r.fulfill({
          contentType: "application/javascript",
          body: sdk,
          headers: { "access-control-allow-origin": "*" },
        }),
    );
    await c.route("**/__qa/rpc/*", async (route) => {
      if (fail) {
        await route.fulfill({
          json: { data: null, error: { message: "Offline" } },
        });
        return;
      }
      const name = route.request().url().split("/").at(-1),
        args = JSON.parse(route.request().postData());
      chain = chain.then(async () => {
        try {
          await db.exec(
            `set role ${user ? "authenticated" : "anon"};select set_config('request.jwt.claim.sub','${user || ""}',false)`,
          );
          const names = Object.keys(args);
          const query = `select public.${name}(${names.map((n, i) => '"' + n + '"=>$' + (i + 1)).join(",")}) value`;
          const data = (await db.query(query, Object.values(args))).rows[0]
            .value;
          await route.fulfill({ json: { data, error: null } });
        } catch (e) {
          await route.fulfill({
            json: { data: null, error: { message: e.message } },
          });
        } finally {
          await db.exec("reset role");
        }
      });
      await chain;
    });
    c.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    return c;
  }
  async function open(c, slug) {
    const p = await c.newPage();
    await p.bringToFront();
    await p.goto(base + "/tools/" + slug + "/", {
      waitUntil: "domcontentloaded",
    });
    await p.waitForSelector('[data-ready="true"]');
    return p;
  }
  async function check(label, fn) {
    await fn();
    results.push(label);
    console.log("PASS " + label);
  }
  try {
    const guest = await context();
    await check(
      "25 tools, filters, favorites and responsive layouts",
      async () => {
        const p = await guest.newPage();
        await p.goto(base + "/tools/", { waitUntil: "domcontentloaded" });
        assert.equal(await p.locator("[data-tool-card]").count(), 25);
        for (const [cat, count] of [
          ["utilities", 9],
          ["testing", 2],
          ["text", 6],
        ]) {
          await p.locator(`[data-filter="${cat}"]`).click();
          assert.equal(
            await p.locator("[data-tool-card]:visible").count(),
            count,
          );
        }
        await p.locator('[data-filter="all"]').click();
        await p.locator("#tool-search").fill("Typing");
        assert.equal(await p.locator("[data-tool-card]:visible").count(), 1);
        await p.locator('[data-favorite="typing-sprint"]').click();
        await p.goto(base + "/workspace/", { waitUntil: "domcontentloaded" });
        await p.waitForSelector(
          '#favorite-tools a[href="/tools/typing-sprint/"]',
        );
        for (const width of [360, 768, 1440])
          for (const slug of [
            "answer-book",
            "decision-studio",
            "typing-sprint",
            "device-check",
          ]) {
            const t = await open(guest, slug);
            await t.setViewportSize({ width, height: 900 });
            assert(
              await t.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              slug + " overflows " + width,
            );
            if (width === 360)
              await t.screenshot({
                path: "_qa/" + slug + "-mobile.png",
                fullPage: true,
              });
            await t.close();
          }
        await p.close();
      },
    );
    const book = await open(guest, "answer-book");
    await check(
      "bilingual answers, no saved questions, local reload and deletion",
      async () => {
        await book
          .locator("#answer-question")
          .fill("PRIVATE QUESTION NEVER SAVE");
        await book.locator("#answer-draw").click();
        await book.waitForFunction(
          () =>
            document.querySelectorAll("#answer-history .saved-row").length ===
            1,
        );
        const snapshot = await book.evaluate(() =>
          JSON.stringify(localStorage),
        );
        assert(!snapshot.includes("PRIVATE QUESTION"));
        assert(await book.locator("#answer-zh").textContent());
        await book.reload({ waitUntil: "domcontentloaded" });
        await book.waitForSelector("#answer-history .saved-row");
        assert.equal(await book.locator("#answer-question").inputValue(), "");
        await book.locator("#answer-language").selectOption("zh");
        await book.locator("#answer-draw").click();
        assert(await book.locator("#answer-en").isHidden());
        await book.locator("#answer-history [data-remove]").first().click();
        assert.equal(
          await book.locator("#answer-history .saved-row").count(),
          1,
        );
      },
    );
    const decision = await open(guest, "decision-studio");
    await check(
      "scheme debounce, no repeats, balanced complete groups and reopen",
      async () => {
        await decision.locator("#decision-name").fill("Study groups");
        await decision.locator("#decision-options").fill("A\nB\nC\nD\nE");
        await decision.locator("#decision-mode").selectOption("draw");
        await decision.locator("#decision-no-repeat").check();
        await decision.waitForTimeout(650);
        const id = new URL(decision.url()).searchParams.get("scheme");
        assert(id);
        const out = new Set();
        for (let i = 0; i < 5; i++) {
          await decision.locator("#decision-run").click();
          out.add(await decision.locator("#decision-result").textContent());
        }
        assert.equal(out.size, 5);
        await decision.locator("#decision-run").click();
        assert.match(
          await decision.locator("#decision-result").textContent(),
          /Every option/,
        );
        await decision.locator("#decision-mode").selectOption("groups");
        await decision.locator("#decision-group-count").fill("2");
        await decision.locator("#decision-run").click();
        const sizes = await decision
          .locator(".decision-group")
          .evaluateAll((nodes) =>
            nodes.map((n) => n.querySelectorAll("li").length),
          );
        assert.deepEqual(sizes, [3, 2]);
        assert.equal(
          new Set(
            await decision.locator(".decision-group li").allTextContents(),
          ).size,
          5,
        );
        assert.equal(new URL(decision.url()).searchParams.get("scheme"), id);
        await decision.reload({ waitUntil: "domcontentloaded" });
        await decision.waitForSelector('[data-ready="true"]');
        assert.equal(
          await decision.locator("#decision-name").inputValue(),
          "Study groups",
        );
        await decision.locator("#decision-mode").selectOption("wheel");
        await decision.locator("#decision-run").click();
        assert(
          ["A", "B", "C", "D", "E"].includes(
            await decision.locator("#decision-result").textContent(),
          ),
        );
      },
    );
    await check(
      "wheel animation agrees with predetermined result",
      async () => {
        await decision.evaluate(async () => {
          const { Wheel } = await import("/vendor/spin-wheel.js");
          const original = Wheel.prototype.spinToItem;
          Wheel.prototype.spinToItem = function (index, ...args) {
            const rest = this.onRest;
            this.onRest = (e) => {
              window.__wheelRest = {
                index: e.currentIndex,
                expected: index,
                label: this.items[e.currentIndex].label,
              };
              rest?.(e);
            };
            return original.call(this, index, ...args);
          };
        });
        await decision.emulateMedia({ reducedMotion: "no-preference" });
        await decision.locator("#decision-run").click();
        await decision.waitForFunction(
          () => !document.querySelector("#decision-run").disabled,
        );
        const rest = await decision.evaluate(() => window.__wheelRest);
        assert.equal(rest.index, rest.expected);
        assert.equal(
          await decision.locator("#decision-result").textContent(),
          rest.label,
        );
        await decision.emulateMedia({ reducedMotion: "reduce" });
      },
    );
    const signed = await context(A),
      signedBook = await open(signed, "answer-book");
    await check(
      "local-first failed sync, retry idempotency and guest isolation",
      async () => {
        fail = true;
        await signedBook.locator("#answer-draw").click();
        await signedBook.waitForFunction(() =>
          document
            .querySelector("#answer-status")
            .textContent.includes("Sync failed"),
        );
        assert.equal(
          (
            await db.query(
              "select * from public.answer_history where user_id=$1",
              [A],
            )
          ).rows.length,
          0,
        );
        const local = await signedBook.evaluate(
          (id) =>
            JSON.parse(
              localStorage.getItem("kensei-workshop:personal:v1:" + id),
            ),
          A,
        );
        assert.equal(local.queue.length, 1);
        fail = false;
        await signedBook.evaluate(() =>
          window.dispatchEvent(new Event("online")),
        );
        await signedBook.waitForFunction(() =>
          document
            .querySelector("#answer-status")
            .textContent.includes("Synced"),
        );
        assert.equal(
          (
            await db.query(
              "select * from public.answer_history where user_id=$1",
              [A],
            )
          ).rows.length,
          1,
        );
        await signedBook.locator("[data-history-retry]").click();
        assert.equal(
          (
            await db.query(
              "select * from public.answer_history where user_id=$1",
              [A],
            )
          ).rows.length,
          1,
        );
        assert.equal(
          await signedBook.locator("#answer-history .saved-row").count(),
          1,
        );
      },
    );
    await check(
      "two-device conflict copies and account-separated queues",
      async () => {
        const first = await open(signed, "decision-studio");
        await first.locator("#decision-name").fill("Shared");
        await first.waitForTimeout(800);
        await first.waitForFunction(() =>
          document
            .querySelector("#decision-save-state")
            .textContent.includes("Synced"),
        );
        const id = new URL(first.url()).searchParams.get("scheme");
        const other = await context(A),
          second = await open(other, "decision-studio");
        await second.goto(base + "/tools/decision-studio/?scheme=" + id, {
          waitUntil: "domcontentloaded",
        });
        await second.waitForSelector('[data-ready="true"]');
        await first.locator("#decision-name").fill("Device one");
        await first.waitForTimeout(800);
        await first.waitForFunction(() =>
          document
            .querySelector("#decision-save-state")
            .textContent.includes("Synced"),
        );
        await second.locator("#decision-name").fill("Device two");
        await second.waitForTimeout(800);
        await second.waitForFunction(() =>
          document
            .querySelector("#decision-save-state")
            .textContent.includes("Synced"),
        );
        assert.notEqual(new URL(second.url()).searchParams.get("scheme"), id);
        const rows = (
          await db.query(
            "select data from public.decision_schemes where user_id=$1 and not deleted",
            [A],
          )
        ).rows;
        assert(rows.some((x) => x.data.name === "Device one"));
        assert(rows.some((x) => x.data.name.includes("conflict copy")));
        const another = await context(B),
          p = await open(another, "answer-book");
        assert.equal(await p.locator("#answer-history .saved-row").count(), 0);
      },
    );
    const typing = await open(guest, "typing-sprint");
    await check(
      "Chinese IME, positional scoring, timed Practice and local history",
      async () => {
        await typing.clock.install();
        await typing.locator("#typing-mode").selectOption("practice");
        await typing.locator("#typing-language").selectOption("zh");
        await typing.locator("#typing-start").click();
        const text = "清晨的光";
        await typing.locator("#typing-input").evaluate((el, value) => {
          el.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true }),
          );
          el.value = value;
          el.dispatchEvent(
            new InputEvent("input", { bubbles: true, isComposing: true }),
          );
        }, text);
        assert.equal(
          await typing.locator("#typing-speed").textContent(),
          "0.0",
        );
        await typing
          .locator("#typing-input")
          .evaluate((el) =>
            el.dispatchEvent(
              new CompositionEvent("compositionend", { bubbles: true }),
            ),
          );
        assert.equal(
          await typing.locator("#typing-speed").textContent(),
          "4.0",
        );
        await typing.locator("#typing-input").fill(text + "错");
        assert.equal(await typing.locator(".typed-error").count(), 1);
        await typing.locator("#typing-input").evaluate((el) => {
          el.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true }),
          );
          el.value += "uncommitted";
          el.dispatchEvent(
            new InputEvent("input", { bubbles: true, isComposing: true }),
          );
        });
        await typing.clock.fastForward(60010);
        await typing.waitForFunction(() =>
          document
            .querySelector("#typing-status")
            .textContent.includes("Practice complete"),
        );
        assert.match(
          await typing.locator("#typing-result").textContent(),
          /4.0 CPM.*80.00%/,
        );
        assert.equal(
          await typing.locator("#typing-practice-history .saved-row").count(),
          1,
        );
        await typing.locator("#typing-start").click();
        await typing.locator("#typing-abort").click();
        assert.equal(
          await typing.locator("#typing-practice-history .saved-row").count(),
          1,
        );
      },
    );
    await check(
      "Ranked nickname, blocked paste, server score and public board",
      async () => {
        const p = await open(signed, "typing-sprint");
        await p.locator("#typing-mode").selectOption("ranked");
        await p.waitForFunction(() =>
          document
            .querySelector("#typing-player")
            .textContent.includes("Playing as"),
        );
        await p.clock.install();
        await p.locator("#typing-start").click();
        await p.waitForFunction(
          () => !document.querySelector("#typing-input").disabled,
        );
        const pasted = await p.locator("#typing-input").evaluate((el) => {
          const e = new Event("paste", { bubbles: true, cancelable: true });
          el.dispatchEvent(e);
          return e.defaultPrevented;
        });
        assert(pasted);
        await p
          .locator("#typing-input")
          .fill("Morning light settles on the workshop desk.");
        await chain;
        await db.exec(
          "update public.typing_test_sessions set started_at=clock_timestamp()-interval '61 seconds'",
        );
        await p.clock.fastForward(60010);
        await p.waitForFunction(() =>
          document
            .querySelector("#typing-status")
            .textContent.includes("Verified."),
        );
        await p.locator("#leaderboard-refresh").click();
        await p.waitForSelector("#leaderboard-rows tr");
        assert.match(
          await p.locator("#leaderboard-rows").textContent(),
          /Member_/,
        );
        assert(
          !(await p.locator("#leaderboard-rows").textContent()).includes("@"),
        );
      },
    );
    await check(
      "canvas fallback, offline queue clear and paginated history",
      async () => {
        const fallback = await context();
        await fallback.addInitScript(() => {
          HTMLCanvasElement.prototype.getContext = () => null;
        });
        const f = await open(fallback, "decision-studio");
        await f.locator("#decision-run").click();
        assert(
          ["Tea", "Coffee", "Water"].includes(
            await f.locator("#decision-result").textContent(),
          ),
        );
        const p = await open(signed, "answer-book");
        fail = true;
        await p.locator("#answer-draw").click();
        await p.waitForFunction(() =>
          document
            .querySelector("#answer-status")
            .textContent.includes("Sync failed"),
        );
        p.once("dialog", (d) => d.accept());
        await p.locator("[data-history-clear]").click();
        assert.equal(await p.locator("#answer-history .saved-row").count(), 0);
        fail = false;
        await p.evaluate(() => window.dispatchEvent(new Event("online")));
        await p.waitForFunction(() =>
          document
            .querySelector("#answer-status")
            .textContent.includes("Synced"),
        );
        assert.equal(await p.locator("#answer-history .saved-row").count(), 0);
        assert.equal(
          (
            await db.query(
              "select * from public.answer_history where user_id=$1 and not deleted",
              [A],
            )
          ).rows.length,
          0,
        );
        for (let i = 0; i < 53; i++)
          await db.query(
            "insert into public.answer_history(user_id,id,data) values($1,$2,$3)",
            [
              A,
              crypto.randomUUID(),
              {
                en: "Answer " + i,
                zh: "回答 " + i,
                drawnAt: new Date().toISOString(),
              },
            ],
          );
        await p.reload({ waitUntil: "domcontentloaded" });
        await p.waitForSelector('[data-ready="true"]');
        await p.waitForFunction(
          () =>
            document.querySelectorAll("#answer-history .saved-row").length ===
            20,
        );
        await p.locator("[data-history-more]").click();
        assert.equal(await p.locator("#answer-history .saved-row").count(), 40);
        await p.locator("[data-history-more]").click();
        assert.equal(await p.locator("#answer-history .saved-row").count(), 53);
      },
    );
    await check(
      "device tests start/stop, keyboard clearing, mouse counters and touch guidance",
      async () => {
        const p = await open(guest, "device-check");
        await p.locator('[data-device-tab="keyboard"]').click();
        await p.locator("#keyboard-surface").focus();
        await p.keyboard.press("A");
        assert.match(
          await p.locator("#keyboard-status").textContent(),
          /Not listening/,
        );
        await p.locator("#keyboard-start").click();
        await p.keyboard.down("a");
        assert.equal(await p.locator("#keyboard-keys kbd").count(), 1);
        await p.keyboard.up("a");
        await p.keyboard.press("Tab");
        assert.match(
          await p.locator("#keyboard-status").textContent(),
          /Not listening/,
        );
        assert.equal(await p.locator("#keyboard-keys kbd").count(), 0);
        await p.locator('[data-device-tab="mouse"]').click();
        await p.locator("#mouse-start").click();
        await p.locator("#mouse-surface").click({ button: "right" });
        assert.match(
          await p.locator("#mouse-clicks").textContent(),
          /Right: 1/,
        );
        await p.locator("#mouse-surface").hover();
        await p.mouse.wheel(0, 200);
        await p.waitForTimeout(400);
        assert.match(await p.locator("#mouse-wheel").textContent(), /Y: 200/);
        await p.locator('[data-device-tab="screen"]').click();
        await p.locator("#screen-start").click();
        assert(await p.locator("#screen-surface").isVisible());
        await p.locator("#screen-fullscreen").click();
        await p.waitForFunction(
          () =>
            document.fullscreenElement ||
            document
              .querySelector("#screen-status")
              .textContent.includes("Fullscreen unavailable"),
        );
        if (await p.evaluate(() => !!document.fullscreenElement)) {
          await p.keyboard.press("Escape");
          await p.waitForFunction(() => !document.fullscreenElement);
        } else await p.locator("#screen-exit").click();
        assert(await p.locator("#screen-surface").isHidden());
        const touch = await context(null, {
            isMobile: true,
            hasTouch: true,
            viewport: { width: 360, height: 800 },
          }),
          touchPage = await open(touch, "device-check");
        assert.match(
          await touchPage.locator("#device-touch-note").textContent(),
          /Touch device/,
        );
      },
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/second-batch-report.json",
      JSON.stringify({ base, passed: results, errors }, null, 2),
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await browser.close();
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
