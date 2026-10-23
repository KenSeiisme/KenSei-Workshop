const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8812";
(async () => {
  const { gameDatabase } = await import("../support/games-fixture.mjs");
  const { build } = await import("esbuild");
  await build({
    entryPoints: ["supabase/functions/games-session/index.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: "_qa/arcade-next-edge.mjs",
  });
  const { makeHandler } = await import("../../_qa/arcade-next-edge.mjs");
  const {
    db,
    users: [A, B],
    rpc,
    admin,
    as,
    value,
  } = await gameDatabase();
  const C = "33333333-3333-4333-8333-333333333333",
    D = "44444444-4444-4444-4444-444444444444";
  for (const id of [C, D]) {
    await db.query("insert into auth.users values($1,$2)", [
      id,
      { full_name: "Room Player" },
    ]);
    await rpc("ensure_my_profile", { expected_user: id }, "authenticated", id);
  }
  let chain = Promise.resolve();
  const serial = (fn) => {
    const p = chain.catch(() => {}).then(fn);
    chain = p;
    return p;
  };
  const handler = makeHandler(
    (k) =>
      ({
        SUPABASE_URL: "https://backend.test",
        SUPABASE_SERVICE_ROLE_KEY: "fixture-key",
      })[k],
    async (url, opts) => {
      if (url.endsWith("/auth/v1/user"))
        return Response.json({
          id: opts.headers.Authorization.includes("userB") ? B : A,
        });
      const body = JSON.parse(opts.body);
      try {
        return Response.json(
          await serial(() => admin(body.action, body.owner, body.body)),
        );
      } catch (e) {
        return Response.json({ message: e.message }, { status: 400 });
      }
    },
  );
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const pages = [],
    contexts = [],
    errors = [],
    published = [],
    subscriptions = new Map();
  let failFinishOnce = false;
  async function context(id) {
    const c = await browser.newContext();
    contexts.push(c);
    await c.addInitScript(
      ({ id }) => {
        window.__qaUser = id;
        window.__qaDeliver = ({ topic, payload }) =>
          window.__qaListeners?.get(topic)?.({ payload });
      },
      { id },
    );
    await c.exposeBinding("__qaBroadcast", async ({ page }, message) => {
      published.push({ at: Date.now(), topic: message.topic });
      for (const [other, topics] of subscriptions)
        if (other !== page && topics.has(message.topic))
          await other.evaluate((m) => window.__qaDeliver(m), message);
    });
    await c.exposeBinding("__qaChannel", async ({ page }, { topic, join }) => {
      if (!subscriptions.has(page)) subscriptions.set(page, new Set());
      if (join) {
        const allowed = await serial(() =>
          as("authenticated", id, () =>
            value(
              "select workshop_private.pong_channel_access($1,false) as value",
              [topic],
            ),
          ),
        );
        if (!allowed) throw Error("Private topic denied");
        subscriptions.get(page).add(topic);
      } else subscriptions.get(page).delete(topic);
    });
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: `export function createClient(){const id=window.__qaUser;window.__qaListeners=new Map();return{auth:{getSession:async()=>({data:{session:id?{user:{id},access_token:'aaa.userA.ccc'}:null}}),onAuthStateChange(){}},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async(name,args)=>{const r=await fetch('/__qa/next/rpc/'+name,{method:'POST',headers:{'x-user':id||''},body:JSON.stringify(args)});return r.json()},functions:{invoke:async(name,{body})=>{const r=await fetch('/__qa/next/function/'+name.split('/').at(-1),{method:'POST',headers:{'x-user':id||''},body:JSON.stringify(body)});const data=await r.json();return r.ok?{data}:{error:{message:data.error,context:{json:async()=>data}}}}},channel(topic){const ch={topic,on(type,opt,fn){window.__qaListeners.set(topic,fn);return ch},subscribe(fn){window.__qaChannel({topic,join:true}).then(()=>fn('SUBSCRIBED'),()=>fn('CHANNEL_ERROR'));return ch},send(message){return window.__qaBroadcast({topic,payload:message.payload})}};return ch},removeChannel(ch){window.__qaListeners.delete(ch.topic);return window.__qaChannel({topic:ch.topic,join:false})}}}`,
        }),
    );
    await c.route("**/__qa/next/rpc/*", async (r) => {
      const name = r.request().url().split("/").at(-1),
        user = r.request().headers()["x-user"] || null,
        args = r.request().postDataJSON();
      try {
        const data = await serial(() =>
          rpc(name, args, user ? "authenticated" : "anon", user),
        );
        await r.fulfill({ json: { data, error: null } });
      } catch (e) {
        await r.fulfill({ json: { error: { message: e.message } } });
      }
    });
    await c.route("**/__qa/next/function/*", async (r) => {
      const action = r.request().url().split("/").at(-1),
        body = r.request().postDataJSON(),
        user = r.request().headers()["x-user"];
      const response = await handler(
        new Request(
          "https://backend.test/functions/v1/games-session/" + action,
          {
            method: "POST",
            headers: {
              Origin: base,
              Authorization: `Bearer aaa.${user === B ? "userB" : "userA"}.ccc`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          },
        ),
      );
      const data = await response.json();
      if (action === "finish" && failFinishOnce) {
        failFinishOnce = false;
        return r.abort();
      }
      await r.fulfill({ status: response.status, json: data });
    });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    pages.push(p);
    return p;
  }
  try {
    const p = await context(A);
    await p.goto(base + "/games/block-drop/");
    await p.waitForSelector("[data-game][data-ready=true]");
    assert.equal(await p.inputValue("#game-mode"), "public");
    await p.click("#game-start");
    await p.waitForSelector(".drop-canvas");
    assert.match(await p.innerText("#game-status"), /Public game/);
    failFinishOnce = true;
    for (let i = 0; i < 35; i++) {
      if (
        await p
          .locator("#game-start")
          .textContent()
          .then((t) => t.includes("Play again"))
      )
        break;
      await p.locator("#game-board").press("Space");
    }
    await p.waitForFunction(
      () => !document.querySelector("#game-submit-retry").hidden,
    );
    assert.match(await p.innerText("#game-result-public"), /failed/i);
    const countBefore = await serial(() =>
      value("select count(*)::int as value from workshop_private.game_results"),
    );
    await p.click("#game-submit-retry");
    await p.waitForFunction(() =>
      document
        .querySelector("#game-result-public")
        .textContent.includes("Verified"),
    );
    assert.equal(
      await serial(() =>
        value(
          "select count(*)::int as value from workshop_private.game_results",
        ),
      ),
      countBefore,
    );
    await p.locator("#game-milestones").evaluate((n) => (n.open = true));
    assert.match(await p.innerText("#game-milestones"), /First verified/);
    await p.goto(base + "/games/");
    await p.waitForFunction(
      () => document.querySelector("#progress-results").textContent === "1",
    );
    assert.equal(await p.locator("[data-game-card]").count(), 12);
    assert.equal(
      await p.locator("#progress-all [data-achievement]").count(),
      30,
    );
    const host = await context(A),
      guest = await context(B);
    for (const page of [host, guest]) {
      await page.goto(base + "/games/pong/");
      await page.waitForSelector("[data-pong][data-ready=true]");
      await page.waitForFunction(() => window.KenseiWorkspace?.user);
    }
    await host.click("#pong-create");
    await host.waitForFunction(
      () => !document.querySelector("#pong-invite").hidden,
    );
    const code = await host.innerText("#pong-invite-code");
    await guest.fill("#pong-code", code);
    await guest.click("#pong-join");
    await guest.waitForFunction(() =>
      document
        .querySelector("#pong-room-state")
        .textContent.includes("Waiting"),
    );
    await host.waitForFunction(
      () => !document.querySelector("#pong-ready").disabled,
    );
    await guest.waitForFunction(
      () => !document.querySelector("#pong-ready").disabled,
    );
    await host.click("#pong-ready");
    await guest.click("#pong-ready");
    for (const page of [host, guest])
      await page.waitForFunction(() =>
        document
          .querySelector("#pong-room-state")
          .textContent.includes("Playing"),
      );
    await host.locator(".pong-canvas").focus();
    await host.keyboard.down("ArrowDown");
    await host.waitForTimeout(450);
    await host.keyboard.up("ArrowDown");
    await guest.locator(".pong-canvas").focus();
    await guest.keyboard.down("ArrowUp");
    await guest.waitForTimeout(450);
    await guest.keyboard.up("ArrowUp");
    await host.click("#pong-pause");
    for (const page of [host, guest])
      await page.waitForFunction(() =>
        document
          .querySelector("#pong-room-state")
          .textContent.includes("Paused"),
      );
    await host.evaluate(() => {
      window.__qaPongClock = performance.now.bind(performance);
      Object.defineProperty(performance, "now", {
        configurable: true,
        value: () => window.__qaPongClock() + 32,
      });
    });
    await host.click("#pong-ready");
    await guest.click("#pong-ready");
    await host.waitForTimeout(200);
    await host.evaluate(() => {
      delete performance.now;
      delete window.__qaPongClock;
    });
    await host.waitForFunction(() =>
      document
        .querySelector("#pong-room-state")
        .textContent.includes("Playing"),
    );
    for (const page of [host, guest])
      await page.locator(".pong-canvas").evaluate((node) => {
        const r = node.getBoundingClientRect();
        node.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerType: "mouse",
            clientX: r.left + 20,
            clientY: r.top + 1,
          }),
        );
      });
    await host.waitForFunction(
      () =>
        document
          .querySelector("#pong-room-state")
          .textContent.includes("Finished"),
      {},
      { timeout: 60000 },
    );
    await guest.waitForFunction(() =>
      document
        .querySelector("#pong-room-state")
        .textContent.includes("Finished"),
    );
    assert.ok(
      [
        await host.innerText("#pong-left-score"),
        await host.innerText("#pong-right-score"),
      ].includes("7"),
    );
    assert.equal(
      await host.innerText(".pong-score"),
      await guest.innerText(".pong-score"),
    );
    await host.click("#pong-ready");
    await guest.click("#pong-ready");
    await host.waitForFunction(() =>
      document
        .querySelector("#pong-room-state")
        .textContent.includes("Playing"),
    );
    assert.equal(await host.innerText("#pong-left-score"), "0");
    // Keep the rematch paused while another browser pair is being prepared.
    await host.click("#pong-pause");
    for (const page of [host, guest]) {
      await page.waitForFunction(() =>
        document
          .querySelector("#pong-room-state")
          .textContent.includes("Paused"),
      );
      await page.locator(".pong-canvas").evaluate((node) => {
        const r = node.getBoundingClientRect();
        node.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerType: "mouse",
            clientX: r.left + 20,
            clientY: r.top + r.height / 2,
          }),
        );
      });
    }
    const host2 = await context(C),
      guest2 = await context(D);
    for (const page of [host2, guest2]) {
      await page.goto(base + "/games/pong/");
      await page.waitForSelector("[data-pong][data-ready=true]");
      await page.waitForFunction(() => window.KenseiWorkspace?.user);
    }
    await host2.click("#pong-create");
    await host2.waitForFunction(
      () => !document.querySelector("#pong-invite").hidden,
    );
    const code2 = await host2.innerText("#pong-invite-code");
    await guest2.fill("#pong-code", code2);
    await guest2.click("#pong-join");
    await host2.waitForFunction(
      () => !document.querySelector("#pong-ready").disabled,
    );
    await guest2.waitForFunction(
      () => !document.querySelector("#pong-ready").disabled,
    );
    await host2.click("#pong-ready");
    await guest2.click("#pong-ready");
    await host2.waitForFunction(() =>
      document
        .querySelector("#pong-room-state")
        .textContent.includes("Playing"),
    );
    await host.click("#pong-ready");
    await guest.click("#pong-ready");
    for (const page of [host, guest])
      await page.waitForFunction(() =>
        document
          .querySelector("#pong-room-state")
          .textContent.includes("Playing"),
      );
    const start = Date.now();
    await host.waitForTimeout(3500);
    const emitted = published.filter((x) => x.at >= start).length;
    assert.ok(
      emitted / 3.5 <= 43,
      `Two-room send rate ${emitted / 3.5}/s must leave headroom below 100 bidirectional events/s.`,
    );
    await host.screenshot({ path: "_qa/pong-online-host.png", fullPage: true });
    await guest.screenshot({
      path: "_qa/pong-online-guest.png",
      fullPage: true,
    });
    await guest.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await host.waitForFunction(() =>
      document.querySelector("#pong-room-state").textContent.includes("Paused"),
    );
    await guest.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await guest.waitForTimeout(200);
    assert.match(await guest.innerText("#pong-room-state"), /Paused/);
    await host.click("#pong-ready");
    await guest.click("#pong-ready");
    await host.waitForFunction(() =>
      document
        .querySelector("#pong-room-state")
        .textContent.includes("Playing"),
    );
    await guest.evaluate(() => dispatchEvent(new Event("offline")));
    await host.waitForFunction(() =>
      document.querySelector("#pong-room-state").textContent.includes("Paused"),
    );
    await guest.click("#pong-retry");
    await guest.waitForFunction(() =>
      document
        .querySelector("#pong-connection-status")
        .textContent.includes("connected"),
    );
    assert.match(await guest.innerText("#pong-room-state"), /Paused/);
    host.on("dialog", (d) => d.accept());
    await host.click("#pong-leave");
    await guest.waitForFunction(() =>
      document.querySelector("#pong-room-state").textContent.includes("Closed"),
    );
    const resultsAfter = await serial(() =>
      value("select count(*)::int as value from workshop_private.game_results"),
    );
    assert.equal(resultsAfter, countBefore);
    for (const page of [host2, guest2]) {
      page.on("dialog", (d) => d.accept());
    }
    await host2.click("#pong-leave");
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        status: "PASS",
        coverage:
          "Block Drop real Public finish/lost acknowledgment/achievement/12-game progress; two independent browser Pong rooms, private topic checks, readiness, controls, pause/resume, close and no ranked writes",
        twoRoomPublishPerSecond: emitted / 3.5,
        estimatedRealtimeEventsPerSecond: (emitted * 2) / 3.5,
      }),
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        errors,
        pages: await Promise.all(
          pages
            .filter((p) => !p.isClosed())
            .map(async (p) => ({
              url: p.url(),
              status: await p
                .locator(
                  "#pong-status,#game-status,.game-progress-status,#pong-room-state",
                )
                .allTextContents(),
            })),
        ),
      }),
    );
    throw e;
  } finally {
    for (const c of contexts) await c.close();
    await browser.close();
    await chain.catch(() => {});
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
