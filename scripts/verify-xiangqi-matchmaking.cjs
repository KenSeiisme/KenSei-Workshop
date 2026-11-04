// Opt-in real backend test. Disposable credentials arrive on hidden stdin only.
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  vm = require("node:vm");
const { chromium } = require("../tests/support/browser.cjs");
if (process.env.WORKSHOP_LIVE_XIANGQI !== "1") process.exit(2);
async function readHidden() {
  console.log("Ready for hidden test input.");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    process.stdin.on("data", (chunk) => {
      value += chunk;
      if (/[\r\n]/.test(value)) {
        process.stdin.removeAllListeners("data");
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(value.trim());
      }
    });
    process.stdin.resume();
  });
}
(async () => {
  const input = JSON.parse(await readHidden()),
    scope = { window: {} };
  vm.runInNewContext(await fs.readFile("src/config.js", "utf8"), scope);
  const config = scope.window.KENSEI_CONFIG,
    sessions = [],
    clients = input.users.map(() => crypto.randomUUID());
  const call = async (path, token, body) => {
    const r = await fetch(config.supabaseUrl + path, {
      method: "POST",
      headers: {
        apikey: config.supabasePublishableKey,
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json();
    if (!r.ok || data.error)
      throw Error(
        data.error?.message || data.error || data.message || "Request failed",
      );
    return data;
  };
  for (const u of input.users) {
    const s = await call("/auth/v1/token?grant_type=password", null, {
      email: u.email,
      password: u.password,
    });
    assert.equal(s.user.id, u.id);
    sessions.push(s);
  }
  const board = (i, action, body = {}) =>
    call("/functions/v1/board-match/" + action, sessions[i].access_token, {
      game: "xiangqi",
      client_id: clients[i],
      ...body,
    });
  const settings = {
    config: { rule: "wxf2018", size: 9, width: 9, height: 10, clock: "5+3" },
    rules_version: 1,
  };
  let browser, room;
  try {
    const waiting = await board(0, "queue", settings);
    assert.equal(waiting.waiting, true);
    await board(0, "cancel");
    const again = await board(0, "queue", settings);
    assert.equal(again.waiting, true);
    room = await board(1, "queue", settings);
    assert.equal(room.origin, "random");
    assert.equal(room.status, "ready");
    console.log("WAIT_UNRANKED " + room.id);
    assert.equal(await readHidden(), "confirmed");
    const initial = await board(0, "get", { match_id: room.id });
    assert.equal(initial.ranked, false);
    assert.equal(initial.origin, "random");
    assert.ok([1, -1].includes(initial.color));
    await board(0, "ready", { match_id: room.id });
    await board(1, "ready", { match_id: room.id });
    room = await board(0, "get", { match_id: room.id });
    assert.equal(room.status, "playing");
    const red = room.color === 1 ? 0 : 1;
    const command = {
      match_id: room.id,
      expected_version: room.revision,
      request_id: crypto.randomUUID(),
      action: { type: "move", uci: "e3e4" },
    };
    const moved = await board(red, "command", command),
      retried = await board(red, "command", command);
    assert.equal(moved.state.log.length, 1);
    assert.equal(retried.state.log.length, 1);
    assert.deepEqual(moved.clock, retried.clock);
    console.log(
      "PASS random queue cancellation, matching, colors, Ready and idempotent move/increment",
    );
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    });
    const c = await browser.newContext();
    await c.addInitScript(
      (session) =>
        localStorage.setItem(
          "sb-psikamavostoyeuccxqr-auth-token",
          JSON.stringify(session),
        ),
      sessions[2],
    );
    const p = await c.newPage();
    await p.goto(
      (process.env.TEST_BASE_URL || "http://127.0.0.1:8769") +
        "/games/xiangqi/",
    );
    await p.waitForFunction(() => window.KenseiWorkspace?.user);
    const channelStatus = await p.evaluate(
      async (topic) => {
        const client = KenseiWorkspace.client,
          ch = client.channel(topic, { config: { private: true } });
        const status = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve("TIMEOUT"), 15000);
          ch.subscribe((status) => {
            if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
              clearTimeout(timer);
              resolve(status);
            }
          });
        });
        await client.removeChannel(ch);
        return status;
      },
      "board:" + room.id + ":" + room.channel_key,
    );
    assert.equal(
      channelStatus,
      "CHANNEL_ERROR",
      "A nonmember must not subscribe to the private match channel",
    );
    await browser.close();
    browser = null;
    console.log("PASS real nonmember private Realtime subscription denied");
    // Keep player 0 online; player 1 sends no more requests for the real 120-second window.
    const start = Date.now();
    let result;
    for (let elapsed = 0; elapsed < 145000; elapsed = Date.now() - start) {
      result = await board(0, "heartbeat", { match_id: room.id });
      if (result.status === "finished") break;
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
    assert.equal(result.status, "finished");
    assert.equal(result.state.result.reason, "disconnect");
    assert.equal(result.state.result.winner, room.color);
    assert.equal(result.ranked, false);
    const report = {
      at: new Date().toISOString(),
      matchId: room.id,
      checks: "passed",
      channelStatus,
      disconnectObservedMs: Date.now() - start,
      result: result.state.result,
      publicScoresCreated: 0,
    };
    await fs.writeFile(
      "_qa/xiangqi/live-matchmaking-report.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      "PASS real 120-second single-player disconnect, authoritative result and unranked isolation",
    );
  } finally {
    await browser?.close();
    if (room?.id)
      await board(0, "leave", { match_id: room.id }).catch(() => {});
    await Promise.all([0, 1].map((i) => board(i, "cancel").catch(() => {})));
  }
})().catch((e) => {
  console.error("Live Xiangqi matchmaking:", e.message);
  process.exitCode = 1;
});
