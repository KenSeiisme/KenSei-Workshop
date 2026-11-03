// Opt-in real-backend acceptance. Four previously approved disposable users only.
// The short-lived provisioning capability arrives on hidden stdin; never save sessions.
const fs = require("node:fs/promises"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const { chromium } = require("../tests/support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";
let config,
  control,
  users = [],
  browser,
  contexts = [],
  activePages = [],
  profiles = [],
  matches = [],
  whiteboards = [],
  pong = [],
  clients = Array.from({ length: 4 }, () => crypto.randomUUID()),
  durations = [],
  events = 0;
function check(name) {
  console.log("PASS " + name);
}
async function call(path, token, body, extra = {}) {
  const at = performance.now(),
    r = await fetch(config.supabaseUrl + path, {
      method: "POST",
      headers: {
        apikey: config.supabasePublishableKey,
        ...(token ? { Authorization: "Bearer " + token } : {}),
        "Content-Type": "application/json",
        ...extra,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  durations.push(performance.now() - at);
  const data = await r.json();
  if (!r.ok || data.error)
    throw Error(
      data.error?.message || data.error || data.message || "HTTP " + r.status,
    );
  return data;
}
const rpc = (i, name, args) =>
  call("/rest/v1/rpc/" + name, users[i].session.access_token, args);
const go = (i, action, body = {}) =>
  call("/functions/v1/board-match/" + action, users[i].session.access_token, {
    client_id: clients[i],
    ...body,
  });
async function signedPage(i) {
  const c = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  contexts.push(c);
  await c.addInitScript(
    ({ session }) =>
      localStorage.setItem(
        "sb-psikamavostoyeuccxqr-auth-token",
        JSON.stringify(session),
      ),
    { session: users[i].session },
  );
  const p = await c.newPage();
  const pageErrors = [],
    failedResources = [];
  p.on("pageerror", (e) => pageErrors.push(e.message));
  p.on("requestfailed", (r) => {
    const u = new URL(r.url());
    failedResources.push({
      path: u.origin + u.pathname,
      error: r.failure()?.errorText,
    });
  });
  activePages[i] = p;
  p.on("dialog", (d) => d.accept());
  p.on("request", (r) => {
    if (r.url().includes("/functions/v1/board-match/")) {
      try {
        const b = r.postDataJSON();
        if (b?.client_id && activePages[i] === p) clients[i] = b.client_id;
      } catch {}
    }
  });
  p.on("websocket", (socket) => socket.on("framereceived", () => events++));
  await p.goto(base + "/games/go/");
  try {
    await p.waitForSelector("[data-go][data-ready=true]");
  } catch (e) {
    await p.screenshot({
      path: "_qa/go/live-load-failure.png",
      fullPage: true,
    });
    const state = await p.evaluate(() => ({
      path: location.pathname,
      api: !!window.KenseiWorkspace,
      ready: window.KenseiWorkspace?.ready,
      signed: !!window.KenseiWorkspace?.user,
      toast: document.querySelector(".toast")?.textContent,
    }));
    await fs.writeFile(
      "_qa/go/live-load-failure.json",
      JSON.stringify({ state, pageErrors, failedResources }, null, 2),
    );
    throw Error(
      "Live page could not initialize; diagnostics saved without credentials.",
    );
  }
  await p.waitForFunction(() => window.KenseiWorkspace?.user);
  return p;
}
async function main() {
  const scope = { window: {} };
  vm.runInNewContext(await fs.readFile("src/config.js", "utf8"), scope);
  config = scope.window.KENSEI_CONFIG;
  const provision = await call(
    "/functions/v1/board-match/qa-provision",
    control.anon,
    {},
    { "x-workshop-qa": control.secret },
  );
  users = provision.users;
  assert.equal(users.length, 4);
  for (let i = 0; i < 4; i++)
    profiles.push(
      await rpc(i, "ensure_my_profile", { expected_user: users[i].id }),
    );
  check("four disposable real Auth sessions, no email sent");
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const a = await signedPage(0),
    b = await signedPage(1);
  await a.selectOption("#go-mode", "online");
  await a.locator("#go-advanced summary").click();
  await a.fill("#go-komi", "8.5");
  await a.click("#go-create");
  await a.waitForSelector("#go-room-panel:not([hidden])");
  const code = (await a.locator("#go-invite-code").textContent()).trim();
  await b.selectOption("#go-mode", "online");
  await b.fill("#go-code", code);
  await b.click("#go-join");
  await a.waitForFunction(() => !document.querySelector("#go-ready").disabled);
  await a.click("#go-ready");
  await b.waitForFunction(() => !document.querySelector("#go-ready").disabled);
  await b.click("#go-ready");
  await Promise.all([
    a.waitForSelector("[data-go-phase=playing]"),
    b.waitForSelector("[data-go-phase=playing]"),
  ]);
  let snapshot = await go(0, "get");
  matches.push(snapshot.id);
  assert.equal(snapshot.ranked, false);
  assert.equal(snapshot.members.length, 2);
  let black = snapshot.color === 1 ? 0 : 1,
    white = 1 - black,
    pages = [a, b];
  await pages[black].locator("#game-board").focus();
  await pages[black].keyboard.press("Enter");
  await pages[white].waitForFunction(() =>
    document.querySelector("#go-turn").textContent.includes("White"),
  );
  await pages[white].locator("#game-board").focus();
  await pages[white].keyboard.press("Enter");
  await pages[white].waitForFunction(() =>
    document.querySelector("#go-status").textContent.includes("occupied"),
  );
  assert.equal(await pages[white].locator("#go-retry").isVisible(), false);
  await pages[white].keyboard.press("ArrowRight");
  await pages[white].keyboard.press("Enter");
  for (let retry = 0; retry < 30; retry++) {
    snapshot = await go(0, "get", { match_id: snapshot.id });
    if (snapshot.state.ply === 2) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(snapshot.state.ply, 2);
  check("two real browser accounts create / join / Ready / place stones");
  const request = {
    match_id: snapshot.id,
    expected_version: snapshot.revision,
    request_id: crypto.randomUUID(),
    action: { type: "move", index: 42 },
  };
  const result = await go(black, "command", request),
    again = await go(black, "command", request);
  assert.equal(again.state.ply, result.state.ply);
  assert.equal(again.revision, result.revision);
  await assert.rejects(
    go(white, "command", { ...request, request_id: crypto.randomUUID() }),
    /changed|turn/,
  );
  check(
    "canonical replay, duplicate request, stale version and wrong-turn rejection",
  );
  await b.reload();
  await b.waitForSelector("[data-go-phase=playing]");
  assert.equal(await b.locator("#go-takeover").isHidden(), true);
  check("refresh restores the same controlling tab and match");
  const oldClient = clients[0],
    extra = await signedPage(0);
  await extra.waitForSelector("#go-takeover:not([hidden])");
  await extra.click("#go-takeover");
  await extra.waitForSelector("#go-takeover", { state: "hidden" });
  const savedClient = clients[0];
  clients[0] = oldClient;
  await assert.rejects(
    go(0, "command", {
      match_id: snapshot.id,
      expected_version: again.revision,
      request_id: crypto.randomUUID(),
      action: { type: "pass" },
    }),
    /Another tab/,
  );
  clients[0] = savedClient;
  check("extra tab is read-only; explicit takeover revokes old tab control");
  await assert.rejects(
    go(2, "get", { match_id: snapshot.id }),
    /not available/,
  );
  check("non-member state access rejected");
  const p = await rpc(2, "pong_room", {
    action: "create",
    body: { client_id: clients[2] },
  });
  if (p.error) throw Error(p.error);
  pong.push(p.id);
  const w = await rpc(3, "whiteboard_room", {
    action: "create",
    body: {
      client_id: clients[3],
      client_version: 2,
      name: "Go QA capacity",
      elements: [],
    },
  });
  whiteboards.push(w.id);
  const blockedBoard = await rpc(3, "whiteboard_room", {
    action: "activate",
    body: { room_id: w.id, client_id: clients[3], client_version: 2 },
  });
  assert.equal(
    blockedBoard.editing,
    false,
    "A capacity-limited shared board must remain read-only",
  );
  await rpc(2, "pong_room", {
    action: "leave",
    body: { room_id: p.id, client_id: clients[2] },
  });
  const editingBoard = await rpc(3, "whiteboard_room", {
    action: "activate",
    body: { room_id: w.id, client_id: clients[3], client_version: 2 },
  });
  assert.equal(
    editingBoard.editing,
    true,
    "Releasing Pong must free the second slot for Whiteboard",
  );
  await assert.rejects(
    go(2, "create", {
      config: { rule: "chinese", size: 9, komi: 8.5 },
      rules_version: 1,
    }),
    /capacity|busy/,
  );
  await rpc(3, "whiteboard_room", {
    action: "release",
    body: { room_id: w.id, client_id: clients[3], client_version: 2 },
  });
  check("Go + Pong + shared Whiteboard enforce the combined two-room budget");
  await extra.click("#go-resign");
  await extra.waitForSelector("#go-result:not([hidden])");
  const ended = await go(0, "get", { match_id: snapshot.id });
  assert.equal(ended.state.result.reason, "resignation");
  const profile = await rpc(0, "ensure_my_profile", {
      expected_user: users[0].id,
    }),
    publicProfile = await rpc(0, "get_public_profile", {
      profile_id: profile.public_id,
    });
  assert.deepEqual(publicProfile.board_game_stats, []);
  check("custom match completion does not create public scores");
  // Match unstarted standard games only, so this real queue test publishes no result.
  let q = await go(0, "queue", {
    config: { rule: "aga", size: 19, komi: 7.5 },
    rules_version: 1,
  });
  assert.equal(q.waiting, true);
  q = await go(1, "queue", {
    config: { rule: "aga", size: 19, komi: 7.5 },
    rules_version: 1,
  });
  assert.equal(q.status, "ready");
  assert.ok(
    q.members.every((m) =>
      [profiles[0].public_id, profiles[1].public_id].includes(m.public_id),
    ),
    "Queue test must pair only the two fixture accounts",
  );
  matches.push(q.id);
  await go(0, "cancel");
  assert.equal((await go(1, "get", { match_id: q.id })).status, "closed");
  check(
    "real random queue pairs two accounts; cancellation after matching closes Ready without a result",
  );
  // Natural 120-second expiry: no forged timestamps and no public result.
  const custom = { rule: "chinese", size: 9, komi: 8.5 };
  let room = await go(2, "create", { config: custom, rules_version: 1 });
  matches.push(room.id);
  await go(3, "join", { code: room.code });
  await go(2, "ready", { match_id: room.id });
  await go(3, "ready", { match_id: room.id });
  const begin = Date.now();
  let final;
  for (let step = 0; step < 29; step++) {
    await new Promise((r) => setTimeout(r, 5000));
    final = await go(3, "get", { match_id: room.id });
    if (final.status === "finished") break;
    if (step % 6 === 5)
      console.log(
        "Waiting for the real disconnect deadline: " +
          Math.floor((Date.now() - begin) / 1000) +
          "s",
      );
  }
  assert.equal(final.state.result.reason, "disconnect");
  assert.equal(final.state.result.winner, final.color);
  assert.ok(Date.now() - begin >= 119000);
  check(
    "real 120-second one-sided disconnect forfeits; server/Cron agrees with the deadline",
  );
  assert.ok(events > 0);
  check("private Realtime version notifications received");
  await a.screenshot({ path: "_qa/go/online-browser.png", fullPage: true });
  durations.sort((x, y) => x - y);
  const report = {
    environment: "live Supabase / real Auth sessions / desktop Chromium",
    checks:
      "invite, Ready, legal turns, idempotency, stale version, refresh, takeover, private access, mixed capacity, unstarted queue, 120-second disconnect",
    publicScoresCreated: 0,
    websocketFramesReceived: events,
    httpRequests: durations.length,
    p95HttpMs: Math.round(durations[Math.floor(durations.length * 0.95)]),
    maxHttpMs: Math.round(durations.at(-1)),
    physicalAndroid: "pending",
    oauthGoogleUI: "not exercised by disposable email fixtures",
  };
  await fs.writeFile(
    "_qa/go/online-report.json",
    JSON.stringify(report, null, 2),
  );
}
async function cleanup() {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close().catch(() => {});
  for (let i = 0; i < users.length; i++) {
    await go(i, "cancel").catch(() => {});
    const active = await go(i, "get").catch(() => null);
    if (active?.id && !matches.includes(active.id)) matches.push(active.id);
    if (active?.id)
      await go(i, "takeover", { match_id: active.id })
        .then(() => go(i, "leave", { match_id: active.id }))
        .catch(() => {});
  }
  for (const id of whiteboards)
    await rpc(3, "whiteboard_room", {
      action: "delete",
      body: { room_id: id, client_id: clients[3], client_version: 2 },
    }).catch(() => {});
  for (const id of pong)
    await rpc(2, "pong_room", {
      action: "leave",
      body: { room_id: id, client_id: clients[2] },
    }).catch(() => {});
  await fs.writeFile(
    "_qa/go/live-owned.json",
    JSON.stringify({ run: control.run, matches, whiteboards, pong }, null, 2),
  );
  if (users.length) {
    const r = await call(
      "/functions/v1/board-match/qa-cleanup",
      control.anon,
      { ids: users.map((u) => u.id) },
      { "x-workshop-qa": control.secret },
    );
    assert.equal(r.deleted, users.length);
    console.log("CLEANED " + r.deleted + " temporary Auth users.");
  }
}
async function input() {
  process.stdout.write("Ready for Go QA JSON on stdin (input is hidden).\n");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  let text = "";
  return new Promise((resolve) => {
    process.stdin.on("data", (chunk) => {
      text += chunk;
      if (/[\r\n]/.test(text)) {
        process.stdin.removeAllListeners("data");
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(JSON.parse(text.trim()));
      }
    });
    process.stdin.resume();
  });
}
(async () => {
  control = await input();
  try {
    await main();
  } finally {
    await cleanup();
  }
})().catch((e) => {
  console.error("FAILED " + e.message);
  process.exitCode = 1;
});
