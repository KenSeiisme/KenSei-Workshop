// Requires explicitly approved disposable Auth users. Credentials arrive on stdin only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { chromium } = require("../tests/support/browser.cjs");
const scope = { window: {} };
vm.runInNewContext(fs.readFileSync("src/config.js", "utf8"), scope);
const config = scope.window.KENSEI_CONFIG;
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8812";
const proof = { checks: [], frames: {}, errors: [] };
const check = (label) => {
  proof.checks.push(label);
  console.log("PASS " + label);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
const pages = [],
  contexts = [];
async function api(path, token, body) {
  const r = await fetch(config.supabaseUrl + path, {
    method: "POST",
    headers: {
      apikey: config.supabasePublishableKey,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  assert(r.ok, `Backend request failed (${r.status}, ${path.split("?")[0]})`);
  assert(!data.error, `Backend rejected ${path.split("?")[0]}`);
  return data;
}
async function roomInfo(page) {
  return page.evaluate(async () => {
    const app = window.KenseiWorkspace;
    const channels = app.client.getChannels();
    const topic = channels.map((c) => c.topic).find((x) => x.includes("pong:"));
    if (!topic) return null;
    const [, id, key] = topic.replace(/^realtime:/, "").split(":");
    const body = {
      room_id: id,
      client_id: sessionStorage.getItem("kensei-pong-tab-v1"),
    };
    const { data, error } = await app.client.rpc("pong_room", {
      action: "get",
      body,
    });
    if (error || data?.error) throw Error("Room read failed");
    return { ...data, channel_key: key };
  });
}
async function join(host, guest) {
  await host.click("#pong-create");
  await host.waitForFunction(
    () => document.querySelector("#pong-invite-code").textContent.length === 8,
  );
  const code = await host.locator("#pong-invite-code").textContent();
  await guest.fill("#pong-code", code);
  await guest.click("#pong-join");
  for (const page of [host, guest])
    await page.waitForFunction(() =>
      document
        .querySelector("#pong-connection-status")
        .textContent.includes("connected"),
    );
  return roomInfo(host);
}
async function ready(pair) {
  for (const p of pair)
    await p.locator("#pong-ready").waitFor({ state: "visible" });
  await Promise.all(pair.map((p) => p.click("#pong-ready")));
  for (const p of pair)
    await p.waitForFunction(() =>
      document
        .querySelector("#pong-room-state")
        .textContent.includes("Playing"),
    );
}
async function main() {
  const raw = await new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
  const users = JSON.parse(raw);
  assert(
    Array.isArray(users) && users.length === 4,
    "Provide exactly four approved disposable users",
  );
  const sessions = [];
  for (const user of users) {
    const session = await api("/auth/v1/token?grant_type=password", null, {
      email: user.email,
      password: user.password,
    });
    assert.equal(session.user.id, user.id);
    sessions.push(session);
  }
  check("Four actual temporary Auth sessions; credentials held in memory");
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  let counting = false,
    sent = 0,
    received = 0;
  const timestamps = [];
  for (let i = 0; i < sessions.length; i++) {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    contexts.push(c);
    await c.addInitScript(
      ({ session, project }) => {
        localStorage.setItem(
          `sb-${project}-auth-token`,
          JSON.stringify(session),
        );
      },
      {
        session: sessions[i],
        project: new URL(config.supabaseUrl).hostname.split(".")[0],
      },
    );
    const p = await c.newPage();
    pages.push(p);
    p.on("dialog", (dialog) => dialog.accept());
    p.on("pageerror", (error) =>
      proof.errors.push(
        String(error.message)
          .replace(
            /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g,
            "[redacted]",
          )
          .slice(0, 300),
      ),
    );
    p.on("websocket", (socket) => {
      for (const direction of ["framesent", "framereceived"])
        socket.on(direction, (frame) => {
          if (!counting) return;
          // Count every wire frame for a conservative upper bound, including control.
          // Never decode/record payloads: auth frames can contain JWTs.
          if (direction === "framesent") sent++;
          else received++;
          timestamps.push(Date.now());
        });
    });
    await p.goto(base + "/games/pong/");
    await p.waitForFunction(
      (id) =>
        window.KenseiWorkspace?.ready &&
        window.KenseiWorkspace?.user?.id === id,
      users[i].id,
    );
  }
  const first = await join(pages[0], pages[1]);
  check("Actual private WebSocket subscriptions and two-player room");
  // A third authenticated account cannot subscribe to the room's private topic.
  const denied = await pages[2].evaluate(async (topic) => {
    const client = window.KenseiWorkspace.client;
    const ch = client.channel(topic, { config: { private: true } });
    const status = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 12000);
      ch.subscribe((s) => {
        if (
          ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)
        ) {
          clearTimeout(timer);
          resolve(s);
        }
      });
    });
    await client.removeChannel(ch);
    return status;
  }, `pong:${first.id}:${first.channel_key}:host`);
  assert.notEqual(denied, "SUBSCRIBED");
  assert.notEqual(denied, "timeout", "Private denial must be explicit");
  check("Nonmember cannot subscribe to a private room topic");
  // Probe existing channels without changing gameplay state or persisting payloads.
  await pages[0].evaluate(() => {
    window.__pongProbe = [];
    for (const ch of window.KenseiWorkspace.client.getChannels())
      ch.on("broadcast", { event: "qa-access" }, ({ payload }) =>
        window.__pongProbe.push(payload.role),
      );
  });
  const publish = (role) =>
    pages[1].evaluate(async (role) => {
      const ch = window.KenseiWorkspace.client
        .getChannels()
        .find((x) => x.topic.endsWith(":" + role));
      assertChannel(ch);
      await ch.send({
        type: "broadcast",
        event: "qa-access",
        payload: { role },
      });
      function assertChannel(value) {
        if (!value) throw Error("Missing room topic");
      }
    }, role);
  await publish("host");
  await wait(800);
  assert(!(await pages[0].evaluate(() => window.__pongProbe)).includes("host"));
  await publish("guest");
  await pages[0].waitForFunction(() => window.__pongProbe.includes("guest"));
  check(
    "Role RLS rejects publishing the other player's topic; own topic delivered",
  );
  await ready(pages.slice(0, 2));
  const second = await join(pages[2], pages[3]);
  await ready(pages.slice(2));
  assert.notEqual(first.id, second.id);
  for (const p of pages) await p.locator(".pong-canvas").focus();
  counting = true;
  const start = Date.now();
  await wait(6000);
  counting = false;
  const seconds = (Date.now() - start) / 1000;
  const eventRate = (sent + received) / seconds;
  proof.frames = {
    seconds,
    sent,
    received,
    measuredEventsPerSecond: eventRate,
  };
  console.log("Measured WebSocket counts", proof.frames);
  assert(
    sent > 80 && received > 80,
    "Both real rooms must exchange gameplay frames",
  );
  assert(
    eventRate < 100,
    "Two-room traffic must leave headroom below 100 events/s",
  );
  check(
    "Two simultaneously active real rooms stay below Realtime message limit",
  );
  await pages[0].click("#pong-pause");
  for (const p of pages.slice(0, 2))
    await p.waitForFunction(() =>
      document.querySelector("#pong-room-state").textContent.includes("Paused"),
    );
  await ready(pages.slice(0, 2));
  check("Pause and mutual Ready resume over actual channels");
  for (const p of [pages[0], pages[2]]) await p.click("#pong-leave");
  // Verify the deployed JWT gateway + bundled Block Drop engine without creating a score.
  const run = await api(
    "/functions/v1/games-session/start",
    sessions[0].access_token,
    { game: "block-drop", difficulty: "classic" },
  );
  assert(run.session_id || run.id, "Public start must return a session");
  await api("/functions/v1/games-session/abandon", sessions[0].access_token, {
    session_id: run.session_id || run.id,
  });
  check(
    "Production Edge starts and abandons Block Drop without recording a score",
  );
  for (const p of pages) {
    await p.evaluate(() => {
      document.activeElement?.blur();
      scrollTo(0, 0);
    });
  }
  assert.deepEqual(proof.errors, []);
}
main()
  .then(() => {
    proof.completedAt = new Date().toISOString();
    fs.mkdirSync("_qa", { recursive: true });
    fs.writeFileSync(
      "_qa/pong-real-acceptance.json",
      JSON.stringify(proof, null, 2),
    );
    console.log(JSON.stringify(proof, null, 2));
  })
  .catch(async (error) => {
    // No SDK responses, credentials, tokens or websocket payloads in failure logs.
    console.error(
      "Real Pong acceptance failed:",
      String(error.message).slice(0, 300),
    );
    for (const p of pages) {
      try {
        console.error(
          await p.evaluate(() => ({
            ready: !!window.KenseiWorkspace?.ready,
            signedIn: !!window.KenseiWorkspace?.user,
            auth: document.querySelector("#auth-note")?.textContent,
            room: document.querySelector("#pong-status")?.textContent,
            connection: document.querySelector("#pong-connection-status")
              ?.textContent,
            channels: window.KenseiWorkspace?.client
              ?.getChannels()
              .map((c) => ({ state: c.state, private: c.private })),
          })),
        );
      } catch {}
    }
    console.error(
      String(error.stack)
        .split("\n")
        .filter((line) => line.includes("verify-pong-online.cjs"))
        .join("\n"),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const p of pages) {
      try {
        if (await p.locator("#pong-leave").isEnabled())
          await p.click("#pong-leave");
      } catch {}
    }
    await Promise.allSettled(contexts.map((c) => c.close()));
    await browser?.close();
  });
