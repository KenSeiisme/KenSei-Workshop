// Real Supabase validation. Four approved disposable users arrive on hidden stdin.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { chromium } = require("../tests/support/browser.cjs");
const scope = { window: {} };
vm.runInNewContext(fs.readFileSync("src/config.js", "utf8"), scope);
const config = scope.window.KENSEI_CONFIG;
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
const pages = [],
  contexts = [],
  rooms = [],
  sessions = [],
  clients = [];
let browser,
  counting = false,
  sent = 0,
  received = 0;
const frames = [];
function check(s) {
  console.log("PASS " + s);
}
async function request(path, token, body) {
  const r = await fetch(config.supabaseUrl + path, {
    method: "POST",
    headers: {
      apikey: config.supabasePublishableKey,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let d = await r.json();
  if (!r.ok || d.error)
    throw Error(
      "Backend " +
        path.split("?")[0] +
        " failed: " +
        (d.error?.message || d.error || r.status),
    );
  return d;
}
const rpc = (i, action, body = {}) =>
  request("/rest/v1/rpc/whiteboard_room", sessions[i].access_token, {
    action,
    body: { client_id: clients[i], ...body },
  });
async function scene(i, id) {
  return rpc(i, "get", { room_id: id });
}
async function snapshot(p) {
  return p.evaluate(() =>
    window.__drawing
      .getSceneElementsIncludingDeleted()
      .filter((x) => !x.isDeleted),
  );
}
async function waitCount(p, n) {
  await p.waitForFunction(
    (n) =>
      window.__drawing
        ?.getSceneElementsIncludingDeleted()
        .filter((x) => !x.isDeleted).length === n,
    n,
  );
}
async function add(p, x) {
  await p.evaluate(async (x) => {
    const E = await import("/vendor/whiteboard/engine.js");
    const old = window.__drawing.getSceneElementsIncludingDeleted();
    const item = E.convertToExcalidrawElements([
      { type: "rectangle", x, y: 100, width: 75, height: 50 },
    ]);
    window.__drawing.updateScene({
      elements: E.restoreElements([...old, ...item], null),
      captureUpdate: E.CaptureUpdateAction.IMMEDIATELY,
    });
  }, x);
}
async function boardPage(i, path = "/tools/whiteboard/") {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  contexts.push(c);
  await c.addInitScript(
    ({ session, project }) => {
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
      Object.defineProperty(document, "hidden", { get: () => false });
      Object.defineProperty(document, "visibilityState", {
        get: () => "visible",
      });
    },
    {
      session: sessions[i],
      project: new URL(config.supabaseUrl).hostname.split(".")[0],
    },
  );
  await c.route("**/vendor/whiteboard/qa-engine.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: fs.readFileSync("src/vendor/whiteboard/engine.js", "utf8"),
    }),
  );
  await c.route("**/vendor/whiteboard/engine.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: `import*as E from '/vendor/whiteboard/qa-engine.js';export*from '/vendor/whiteboard/qa-engine.js';export const Excalidraw=p=>E.createElement(E.Excalidraw,{...p,excalidrawAPI:a=>{window.__drawing=a;p.excalidrawAPI?.(a)}});`,
    }),
  );
  const p = await c.newPage();
  pages.push(p);
  p.on("dialog", (d) => d.accept());
  p.on("pageerror", (e) =>
    console.error("PAGE ERROR " + e.message.slice(0, 150)),
  );
  p.on("websocket", (s) => {
    for (const event of ["framesent", "framereceived"])
      s.on(event, () => {
        if (counting) {
          event === "framesent" ? sent++ : received++;
          frames.push(Date.now());
        }
      });
  });
  await p.goto(base + path, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(
    (id) =>
      window.KenseiWorkspace?.ready && window.KenseiWorkspace?.user?.id === id,
    sessions[i].user.id,
  );
  return p;
}
async function connected(p) {
  await p.waitForFunction(
    () =>
      document.querySelector("#shared-live-status").textContent === "Connected",
    null,
    { timeout: 25000 },
  );
}
async function deniedSub(p, topic) {
  return p.evaluate(async (topic) => {
    const app = window.KenseiWorkspace;
    const ch = app.client.channel(topic, { config: { private: true } });
    const s = await new Promise((r) => {
      let t = setTimeout(() => r("timeout"), 12000);
      ch.subscribe((s) => {
        if (
          ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)
        ) {
          clearTimeout(t);
          r(s);
        }
      });
    });
    await app.client.removeChannel(ch);
    return s;
  }, topic);
}
async function main() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  console.log("Ready for temporary credentials on hidden stdin");
  const raw = await new Promise((resolve, reject) => {
    let s = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      s += c;
      if (/[\r\n]/.test(s)) {
        process.stdin.pause();
        resolve(s.trim());
      }
    });
    process.stdin.on("end", () => resolve(s));
    process.stdin.on("error", reject);
  });
  const users = JSON.parse(raw);
  assert.equal(users.length, 4);
  for (const u of users) {
    sessions.push(
      await request("/auth/v1/token?grant_type=password", null, {
        email: u.email,
        password: u.password,
      }),
    );
    clients.push(crypto.randomUUID());
  }
  check(
    "Four actual temporary Auth accounts; no mail and no credentials logged",
  );
  browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const a = await boardPage(0);
    await a.locator("#board-shared-tab").click();
    await a.locator("#shared-new").click();
    await connected(a);
    const id = new URL(a.url()).searchParams.get("room");
    rooms.push({ id, owner: 0 });
    let initial = await scene(0, id);
    const firstKey = initial.channel_key,
      invite = await rpc(0, "invite", { room_id: id });
    const b = await boardPage(1);
    const refused = await deniedSub(
      b,
      `whiteboard:${id}:${firstKey}:${users[0].id}`,
    );
    assert(!["SUBSCRIBED", "timeout"].includes(refused));
    check("An authenticated nonmember cannot subscribe to a private room");
    await b.locator("#board-shared-tab").click();
    await b.locator("#shared-code").fill(invite.code);
    await b.locator("#shared-join").click();
    await connected(b);
    for (let i = 2; i < 4; i++) {
      const p = await boardPage(
        i,
        `/tools/whiteboard/?room=${id}#invite=${invite.token}`,
      );
      await p.locator("#shared-join").click();
      await connected(p);
      assert(!p.url().includes("#invite"));
    }
    for (let i = 0; i < 4; i++) await add(pages[i], 100 + i * 110);
    for (const p of pages.slice(0, 4)) await waitCount(p, 4);
    await a.waitForTimeout(5000);
    assert.equal(
      (await scene(0, id)).elements.filter((e) => !e.isDeleted).length,
      4,
    );
    check("Four native editors converge and checkpoints are durably saved");
    await a.bringToFront();
    await a
      .locator("#board-canvas canvas")
      .last()
      .click({ position: { x: 800, y: 500 } });
    await a.keyboard.press("Control+z");
    for (const p of pages.slice(0, 4)) await waitCount(p, 3);
    await a.keyboard.press("Control+Shift+z");
    for (const p of pages.slice(0, 4)) await waitCount(p, 4);
    check("Local Undo/Redo preserves the other three members’ drawings");
    // No scene/root replacement when switching the interface language.
    const beforeLocale = await snapshot(a);
    await a.evaluate(() => window.KenseiI18n.setLocale("zh-Hant"));
    assert.deepEqual(await snapshot(a), beforeLocale);
    assert.equal(await a.locator("html").getAttribute("lang"), "zh-Hant");
    await a.evaluate(() => window.KenseiI18n.setLocale("en"));
    for (const format of ["json", "svg", "png"]) {
      const waiting = a.waitForEvent("download");
      await a.locator("#shared-" + format).click();
      const dl = await waiting;
      const stream = await dl.createReadStream();
      let chunks = [];
      for await (const c of stream) chunks.push(c);
      const data = Buffer.concat(chunks);
      assert(data.length > 50);
      if (format === "json")
        assert.equal(
          JSON.parse(data).elements.filter((x) => !x.isDeleted).length,
          4,
        );
      if (format === "png") assert.equal(data.subarray(1, 4).toString(), "PNG");
      if (format === "svg") assert(data.toString().includes("<svg"));
    }
    check(
      "Shared PNG/SVG/editable exports and live bilingual switching preserve the drawing",
    );
    if (process.env.QA_SMOKE === "1") return;
    // Another tab of the same account cannot acquire the active editing lease.
    const duplicate = await boardPage(0, `/tools/whiteboard/?room=${id}`);
    await duplicate.waitForFunction(() =>
      document
        .querySelector("#shared-live-status")
        .textContent.includes("Read only"),
    );
    check("Same-account second tab is read only");
    await duplicate.close();
    // Public protocol sends only self-owned broadcast channels.
    await a.evaluate(() => {
      window.__qaProbes = [];
      for (const ch of window.KenseiWorkspace.client.getChannels())
        ch.on("broadcast", { event: "qa-permission" }, ({ payload }) =>
          window.__qaProbes.push(payload.speaker),
        );
    });
    for (const speaker of [users[0].id, users[1].id])
      await b.evaluate(async (speaker) => {
        const ch = window.KenseiWorkspace.client
          .getChannels()
          .find((c) => c.topic.endsWith(":" + speaker));
        if (!ch) throw Error("Missing direction channel");
        await ch.send({
          type: "broadcast",
          event: "qa-permission",
          payload: { speaker },
        });
      }, speaker);
    await a.waitForFunction(
      (id) => window.__qaProbes.includes(id),
      users[1].id,
    );
    assert(!(await a.evaluate(() => window.__qaProbes)).includes(users[0].id));
    check("A member cannot publish to another member’s direction channel");
    // Save failure keeps edits; a later heartbeat retries the same operation.
    let denySave = true;
    await a.route("**/rest/v1/rpc/whiteboard_room", (r) => {
      let args = JSON.parse(r.request().postData());
      if (denySave && args.action === "save")
        return r.fulfill({
          status: 503,
          json: { message: "QA temporary unavailable" },
        });
      return r.continue();
    });
    await add(a, 650);
    await a.waitForFunction(
      () =>
        document.querySelector("#shared-save-status").textContent ===
        "Save failed",
    );
    denySave = false;
    await a.locator("#shared-reconnect").click();
    await a.waitForFunction(
      () =>
        document.querySelector("#shared-save-status").textContent === "Saved",
    );
    await a.unroute("**/rest/v1/rpc/whiteboard_room");
    assert.equal(
      (await scene(0, id)).elements.filter((e) => !e.isDeleted).length,
      5,
    );
    check(
      "Failed checkpoint retains edits and retries without duplicate elements",
    );
    // Offline freezes editing; reconnect restores the durable merged scene.
    await contexts[1].setOffline(true);
    await b.evaluate(() => dispatchEvent(new Event("offline")));
    await b.waitForFunction(
      () =>
        document.querySelector("#shared-live-status").textContent ===
        "Reconnecting",
    );
    await contexts[1].setOffline(false);
    await b.evaluate(() => dispatchEvent(new Event("online")));
    await connected(b);
    await waitCount(b, 5);
    check("Offline view is retained; reconnect merges before resuming editing");
    // Open one Pong room concurrently with the active whiteboard.
    const pong = await boardPage(0, "/games/pong/");
    await pong.locator("#pong-create").click();
    await pong.waitForFunction(
      () =>
        document.querySelector("#pong-invite-code").textContent.length === 8,
    );
    const pongCode = await pong.locator("#pong-invite-code").textContent();
    const pongGuest = await boardPage(1, "/games/pong/");
    await pongGuest.locator("[data-pong-join-open]").click();
    await pongGuest.locator("#pong-code").fill(pongCode);
    await pongGuest.locator("#pong-join").click();
    await pongGuest.waitForFunction(() =>
      document
        .querySelector("#pong-connection-status")
        .textContent.includes("connected"),
    );
    const full = await request(
      "/rest/v1/rpc/pong_room",
      sessions[2].access_token,
      { action: "create", body: { client_id: clients[2] } },
    ).catch(() => ({ error: true }));
    assert(full.error, "Third live room must be rejected");
    check(
      "One whiteboard plus one Pong room fills the shared two-room capacity",
    );
    await Promise.all(
      [pong, pongGuest].map((p) => p.locator("#pong-ready").click()),
    );
    await pong.waitForFunction(() =>
      document
        .querySelector("#pong-room-state")
        .textContent.includes("Playing"),
    );
    counting = true;
    const started = Date.now();
    while (Date.now() - started < 10000) {
      for (let i = 0; i < 4; i++)
        await pages[i].evaluate((i) => {
          const a = window.__drawing,
            items = a.getSceneElementsIncludingDeleted(),
            target = items.find((x) => !x.isDeleted);
          if (target)
            a.updateScene({
              elements: items.map((e) =>
                e.id === target.id
                  ? {
                      ...e,
                      x: e.x + 1,
                      version: e.version + 1,
                      versionNonce: Math.floor(Math.random() * 2e9),
                    }
                  : e,
              ),
            });
          a.updateScene({ appState: { scrollX: 10 + i } });
        }, i);
      await a.waitForTimeout(450);
    }
    counting = false;
    let peak = 0;
    for (const t of frames)
      peak = Math.max(
        peak,
        frames.filter((x) => x >= t && x < t + 1000).length,
      );
    console.log(
      "MEASURE " +
        JSON.stringify({
          seconds: 10,
          sent,
          received,
          peakOneSecondWireFrames: peak,
        }),
    );
    assert(
      peak < 100,
      "Combined traffic must stay below 100 events/s, even counting wire control frames",
    );
    check(
      "Four board editors plus live two-player Pong leave Realtime control margin",
    );
    for (const p of [pong, pongGuest]) {
      await p.locator("#pong-leave").evaluate((n) => n.click());
      await p.close();
    }
    // A refresh obtains a released lease and reloads the shared saved canvas.
    await a.waitForTimeout(3500);
    await b.reload({ waitUntil: "domcontentloaded" });
    await connected(b);
    check("Refresh restores the saved room and editing connection");
    await a.locator("#shared-member-panel").evaluate((n) => (n.open = true));
    await a.locator("#shared-members button").last().click();
    await pages[3].waitForFunction(() =>
      /unavailable|removed/.test(
        document.querySelector("#shared-status").textContent,
      ),
    );
    await assert.rejects(() => rpc(3, "get", { room_id: id }));
    await assert.rejects(() => rpc(3, "join", { code: invite.code }));
    const fresh = await scene(0, id);
    assert.notEqual(fresh.channel_key, firstKey);
    const old = await deniedSub(
      pages[3],
      `whiteboard:${id}:${fresh.channel_key}:${users[0].id}`,
    );
    assert.notEqual(old, "SUBSCRIBED");
    check(
      "Removal rotates channels and invitation; former member loses read, join and publish access",
    );
    for (const width of [320, 360, 768, 1440]) {
      await a.setViewportSize({ width, height: 900 });
      assert(
        await a.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
    }
    await a.screenshot({ path: "_qa/shared-live.png", fullPage: false });
    check("Actual shared screen fits 320–1440px");
  } finally {
    if (browser) await browser.close();
    for (const r of rooms)
      try {
        await rpc(r.owner, "delete", { room_id: r.id });
      } catch {}
    // Every test-owned Pong room is closed via its owner; Auth cleanup is done by the caller.
  }
}
main().catch((e) => {
  console.error(
    String(e.message).replace(
      /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g,
      "[redacted]",
    ),
  );
  process.exitCode = 1;
});
