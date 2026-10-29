const fs = require("node:fs"),
  assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
const sdk = `export function createClient(){const channels=[];return{auth:{getSession:async()=>({data:{session:{user:{id:window.__actor}}}}),onAuthStateChange(){}},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async(name,args)=>{const r=await fetch('/__qa/rpc/'+name,{method:'POST',headers:{'x-test-user':window.__actor},body:JSON.stringify(args)});return r.json()},channel(topic,opts){const handlers=[];const c={topic,on(type,filter,fn){handlers.push({type,event:filter.event,fn});return c},subscribe(fn){c.callback=fn;window.__sub(topic).then(ok=>fn(ok?'SUBSCRIBED':'CHANNEL_ERROR'));return c},send(msg){return window.__send({topic,...msg})},track(){return Promise.resolve('ok')},presenceState(){return{fixture:[{}]}},receive(type,event,payload){handlers.filter(x=>x.type===type&&x.event===event).forEach(x=>x.fn({payload}))}};channels.push(c);window.__channels=channels;return c},removeChannel:async c=>{const i=channels.indexOf(c);if(i>=0)channels.splice(i,1);c.callback?.('CLOSED')},getChannels:()=>channels}}`;
(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(require("../support/db-fixture.cjs").bootstrap);
  for (const f of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + f, "utf8"));
  const users = Array.from({ length: 5 }, () => crypto.randomUUID());
  for (let i = 0; i < users.length; i++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [users[i], { full_name: "Drawer " + i }],
    );
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const pages = [],
    contexts = [],
    errors = [];
  let chain = Promise.resolve(),
    messages = 0,
    failSave = false;
  const queue = (fn) => {
    const out = chain.then(fn);
    chain = out.catch(() => {});
    return out;
  };
  async function as(user, fn) {
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`,
    );
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }
  async function page(i) {
    const c = await browser.newContext({
      viewport: { width: 1280, height: 950 },
      reducedMotion: "reduce",
    });
    contexts.push(c);
    await c.addInitScript((id) => (window.__actor = id), users[i]);
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) => r.fulfill({ contentType: "application/javascript", body: sdk }),
    );
    await c.route("**/vendor/whiteboard/test-engine.js", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: fs.readFileSync("src/vendor/whiteboard/engine.js", "utf8"),
      }),
    );
    await c.route("**/vendor/whiteboard/engine.js", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: `import*as E from '/vendor/whiteboard/test-engine.js';export*from '/vendor/whiteboard/test-engine.js';export const Excalidraw=p=>E.createElement(E.Excalidraw,{...p,excalidrawAPI:a=>{window.__drawing=a;p.excalidrawAPI?.(a)}});`,
      }),
    );
    await c.exposeBinding("__sub", async ({ page }, topic) =>
      queue(() =>
        as(
          users[i],
          async () =>
            (
              await db.query(
                "select workshop_private.shared_board_channel($1,false) ok",
                [topic],
              )
            ).rows[0].ok,
        ),
      ),
    );
    await c.exposeBinding("__send", async ({ page: sender }, msg) => {
      messages++;
      for (const p of pages)
        if (p !== sender && !p.isClosed())
          await p
            .evaluate((m) => {
              for (const c of window.__channels || [])
                if (c.topic === m.topic)
                  c.receive("broadcast", m.event, m.payload);
            }, msg)
            .catch(() => {});
      return "ok";
    });
    await c.route("**/__qa/rpc/**", async (r) =>
      queue(async () => {
        try {
          const name = r.request().url().split("/").pop(),
            args = JSON.parse(r.request().postData());
          let oldKey;
          if (name === "whiteboard_room" && args.body.room_id)
            oldKey = (
              await db.query(
                "select channel_key from workshop_private.shared_whiteboards where id=$1",
                [args.body.room_id],
              )
            ).rows[0]?.channel_key;
          if (failSave && name === "whiteboard_room" && args.action === "save")
            throw Error("Simulated save failure");
          const data = await as(
            users[i],
            async () =>
              (
                await db.query(
                  `select public.${name}(${Object.keys(args)
                    .map((k, n) => '"' + k + '"=>$' + (n + 1))
                    .join(",")}) value`,
                  Object.values(args),
                )
              ).rows[0].value,
          );
          await r.fulfill({ json: { data, error: null } });
          if (
            name === "whiteboard_room" &&
            ["join", "remove", "save", "leave"].includes(args.action) &&
            !data.error
          ) {
            const id = args.body.room_id || data.id,
              key = oldKey || data.channel_key;
            for (const p of pages)
              if (!p.isClosed())
                p.evaluate(
                  ({ id, key }) => {
                    for (const c of window.__channels || [])
                      if (
                        c.topic ===
                        "whiteboard:" + id + ":" + key + ":control"
                      )
                        c.receive("broadcast", "changed", { changed: true });
                  },
                  { id, key },
                ).catch(() => {});
          }
        } catch (e) {
          await db.exec("reset role");
          await r.fulfill({
            json: { data: null, error: { message: e.message } },
          });
        }
      }),
    );
    const p = await c.newPage();
    pages.push(p);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.accept());
    await p.goto(base + "/tools/whiteboard/", {
      waitUntil: "domcontentloaded",
    });
    await p.waitForSelector('[data-ui-ready="true"]');
    await p.locator("#board-boards").click();
    await p.locator("#board-shared-tab").click();
    return p;
  }
  async function count(n) {
    await new Promise((r) => setTimeout(r, 200));
    const rows = await queue(() =>
      db.query("select data from workshop_private.shared_whiteboard_elements"),
    );
    assert.equal(rows.rows.filter((x) => !x.data.isDeleted).length, n);
  }
  async function snapshot(p) {
    return p.evaluate(() =>
      window.__drawing
        .getSceneElementsIncludingDeleted()
        .filter((x) => !x.isDeleted),
    );
  }
  async function add(p, x) {
    await p.evaluate(async (x) => {
      const E = await import("/vendor/whiteboard/engine.js");
      const old = window.__drawing.getSceneElementsIncludingDeleted();
      const items = E.convertToExcalidrawElements([
        { type: "rectangle", x, y: 100, width: 90, height: 60 },
      ]);
      window.__drawing.updateScene({
        elements: E.restoreElements([...old, ...items], null),
        captureUpdate: E.CaptureUpdateAction.IMMEDIATELY,
      });
    }, x);
  }
  try {
    const a = await page(0);
    await a.locator("#shared-new").click();
    await a.waitForFunction(
      () =>
        document.querySelector("#shared-live-status").textContent ===
        "Connected",
    );
    const roomId = new URL(a.url()).searchParams.get("room");
    const invitation = await queue(() =>
      db.query(
        "select code from workshop_private.shared_whiteboards where id=$1",
        [roomId],
      ),
    );
    const code = invitation.rows[0].code;
    for (let i = 1; i < 4; i++) {
      const p = await page(i);
      await p.locator("#shared-code").fill(code);
      await p.locator("#shared-join").click();
      await p.waitForFunction(
        () =>
          document.querySelector("#shared-live-status").textContent ===
          "Connected",
      );
    }
    console.log("PASS four signed-in editors join a durable room");
    for (let i = 0; i < 4; i++) await add(pages[i], i * 120 + 100);
    await a.waitForTimeout(4500);
    await count(4);
    for (const p of pages) assert.equal((await snapshot(p)).length, 4);
    console.log(
      "PASS four native Excalidraw clients converge without whole-scene overwrites",
    );
    const before = messages;
    await a.waitForTimeout(1500);
    assert(
      messages - before < 8,
      "remote updates must not bounce indefinitely",
    );
    await a.bringToFront();
    await a
      .locator("#board-canvas canvas")
      .last()
      .click({ position: { x: 800, y: 500 } });
    await a.keyboard.press("Control+z");
    await a.waitForTimeout(2800);
    await count(3);
    for (const p of pages) assert.equal((await snapshot(p)).length, 3);
    console.log("PASS remote changes stay out of local Undo and do not echo");
    await a.locator("#board-background").click();
    await a.selectOption("#board-paper-type", "graph");
    await a.selectOption("#board-paper-spacing", "40");
    await a.locator("#board-background-panel").evaluate((n) => n.close());
    await a.waitForTimeout(3200);
    for (const p of pages)
      assert.deepEqual(
        await p.evaluate(
          () =>
            window.KenseiAdvancedContexts.whiteboard.currentData().appState
              .paper,
        ),
        { version: 1, type: "graph", spacing: 40 },
      );
    await a.evaluate(async () => {
      const c = window.KenseiAdvancedContexts.whiteboard,
        n = c.drawing.getSceneElements().find((e) => e.type === "rectangle"),
        E = c.engine;
      const arrow = E.convertToExcalidrawElements([
        {
          type: "arrow",
          x: 0,
          y: 0,
          points: [
            [0, 0],
            [200, 0],
          ],
        },
      ])[0];
      arrow.startBinding = { elementId: n.id, focus: 0, gap: 1 };
      arrow.customData = { kenseiPorts: { version: 1, start: 3, end: null } };
      c.drawing.updateScene({
        elements: [...c.drawing.getSceneElementsIncludingDeleted(), arrow],
        captureUpdate: E.CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await a.waitForTimeout(3200);
    await count(4);
    for (const p of pages)
      assert(
        (await snapshot(p)).some((e) => e.customData?.kenseiPorts?.start === 3),
      );
    const second = pages[1];
    await second.evaluate(() => {
      const c = window.KenseiAdvancedContexts.whiteboard,
        a = c.drawing.getSceneElements().find((e) => e.customData?.kenseiPorts),
        id = a.startBinding.elementId;
      c.drawing.updateScene({
        elements: c.drawing.getSceneElementsIncludingDeleted().map((e) =>
          e.id === id
            ? c.engine.newElementWith(e, {
                x: e.x + 60,
                y: e.y + 30,
                angle: Math.PI / 4,
              })
            : e,
        ),
        captureUpdate: c.engine.CaptureUpdateAction.IMMEDIATELY,
      });
    });
    await a.waitForTimeout(3200);
    for (const p of pages)
      assert(
        await p.evaluate(async () => {
          const { nodePorts, arrowPoints } =
              await import("/tool-scripts/whiteboard-geometry.js"),
            c = window.KenseiAdvancedContexts.whiteboard,
            es = c.currentData().elements,
            a = es.find((e) => e.customData?.kenseiPorts),
            n = es.find((e) => e.id === a.startBinding.elementId),
            v = nodePorts(n)[3],
            q = arrowPoints(a)[0];
          return Math.hypot(v.x - q.x, v.y - q.y) < 0.01;
        }),
      );
    const quiet = messages;
    await a.waitForTimeout(1500);
    assert(messages - quiet < 8, "derived port positions must not echo");
    console.log(
      "PASS shared paper, arrow metadata, transformed port convergence and no derived broadcast loops (local RPC/WebSocket fixtures)",
    );

    await a.locator("#board-boards").click();
    await a.locator("#shared-member-panel").evaluate((n) => (n.open = true));
    await a.locator("#shared-members button").last().click();
    await pages[3].waitForFunction(
      () =>
        document
          .querySelector("#shared-status")
          .textContent.includes("unavailable") ||
        document
          .querySelector("#shared-status")
          .textContent.includes("removed"),
    );
    assert(
      (
        await queue(() =>
          db.query(
            "select count(*)::int n from workshop_private.shared_whiteboard_members where room_id=$1",
            [roomId],
          ),
        )
      ).rows[0].n === 3,
    );
    console.log(
      "PASS member removal rotates channels and stops removed editor",
    );
    for (const width of [320, 360, 768, 1440]) {
      await a.setViewportSize({ width, height: 900 });
      assert(
        await a.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
    }
    await a.screenshot({ path: "_qa/shared-board.png", fullPage: false });
    assert.deepEqual(errors, []);
    console.log("PASS shared layout and no browser exceptions");
  } catch (e) {
    for (const p of pages)
      try {
        console.error(
          await p.evaluate(() => ({
            live: document.querySelector("#shared-live-status")?.textContent,
            status: document.querySelector("#shared-status")?.textContent,
            save: document.querySelector("#shared-save-status")?.textContent,
            api: !!window.__drawing,
            url: location.href,
          })),
        );
      } catch {}
    throw e;
  } finally {
    await browser.close();
    await db.close();
  }
})().catch((e) => {
  console.error(
    e.message,
    e.stack
      ?.split("\n")
      .filter((x) => x.includes("shared-whiteboards.cjs"))
      .join("\n"),
  );
  process.exitCode = 1;
});
