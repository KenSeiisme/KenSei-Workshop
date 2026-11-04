// Explicit real-backend check. Fixture credentials arrive only on stdin; no admin endpoint.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const { chromium } = require("../tests/support/browser.cjs");
if (process.env.WORKSHOP_LIVE_XIANGQI !== "1") {
  console.error(
    "Set WORKSHOP_LIVE_XIANGQI=1 and provide disposable unranked fixtures on stdin.",
  );
  process.exit(2);
}
async function readHidden() {
  process.stdout.write(
    "Ready for disposable Xiangqi fixtures on hidden stdin.\n",
  );
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
async function main() {
  const line = await readHidden();
  let browser;
  const contexts = [],
    rooms = [],
    boards = [],
    pongs = [],
    durations = [],
    clients = [];
  let config,
    users,
    frames = 0;
  const check = (message) => console.log("PASS " + message);
  async function call(path, token, body) {
    const start = performance.now(),
      response = await fetch(config.supabaseUrl + path, {
        method: "POST",
        headers: {
          apikey: config.supabasePublishableKey,
          ...(token ? { Authorization: "Bearer " + token } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    durations.push(performance.now() - start);
    const data = await response.json();
    if (!response.ok || data.error)
      throw Object.assign(
        Error(
          data.error?.message ||
            data.error ||
            data.message ||
            "Backend request failed",
        ),
        { status: response.status, code: data.code },
      );
    return data;
  }
  const rpc = (i, name, body) =>
    call("/rest/v1/rpc/" + name, users[i].session.access_token, body);
  const board = (i, action, body = {}) =>
    call("/functions/v1/board-match/" + action, users[i].session.access_token, {
      game: "xiangqi",
      client_id: clients[i],
      ...body,
    });
  try {
    const input = JSON.parse(line);
    assert.equal(input.users.length, 3);

    const scope = { window: {} };
    vm.runInNewContext(await fs.readFile("src/config.js", "utf8"), scope);
    config = scope.window.KENSEI_CONFIG;
    users = [];
    for (const fixture of input.users) {
      const session = await call("/auth/v1/token?grant_type=password", null, {
        email: fixture.email,
        password: fixture.password,
      });
      assert.equal(session.user.id, fixture.id);
      users.push({ id: fixture.id, session });
      clients.push(crypto.randomUUID());
    }
    check(
      "three real disposable Auth sessions, no emails and no privileged test endpoint",
    );
    for (let i = 0; i < 3; i++)
      await rpc(i, "ensure_my_profile", { expected_user: users[i].id });
    if (!input.match_id) {
      const created = await board(0, "create", {
        config: {
          rule: "wxf2018",
          size: 9,
          width: 9,
          height: 10,
          clock: "10+5",
        },
        rules_version: 1,
        preferred_color: 1,
      });
      input.match_id = created.id;
      rooms.push(created.id);
      console.log("WAIT_UNRANKED " + created.id);
      const confirmation = await readHidden();
      if (confirmation !== "confirmed")
        throw Error("Unranked fixture confirmation required.");
      const prepared = await board(0, "get", { match_id: created.id });
      assert.equal(prepared.ranked, false);
      await board(1, "join", { code: created.code });
    }
    const fixture = await board(0, "get", { match_id: input.match_id });
    assert.equal(
      fixture.ranked,
      false,
      "Live fixtures must be unranked before testing",
    );
    if (!rooms.includes(input.match_id)) rooms.push(input.match_id);
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    });
    const errors = [];
    async function page(i, match = true) {
      const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
      });
      contexts.push(context);
      await context.addInitScript(
        (session) =>
          localStorage.setItem(
            "sb-psikamavostoyeuccxqr-auth-token",
            JSON.stringify(session),
          ),
        users[i].session,
      );
      const p = await context.newPage();
      p.on("dialog", (d) => d.accept());
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("request", (r) => {
        if (r.url().includes("/functions/v1/board-match/") && i < 2) {
          try {
            clients[i] = r.postDataJSON().client_id;
          } catch {}
        }
      });
      p.on("websocket", (socket) =>
        socket.on("framereceived", (frame) => {
          if (String(frame.payload).includes('"version"')) frames++;
        }),
      );
      await p.goto(
        (process.env.TEST_BASE_URL || "http://127.0.0.1:8769") +
          "/games/xiangqi/" +
          (match ? "?match=" + input.match_id : ""),
      );
      await p.waitForSelector("[data-xiangqi][data-ready=true]");
      await p.waitForFunction(() => KenseiWorkspace.user);
      return p;
    }
    const a = await page(0),
      b = await page(1);
    for (const p of [a, b]) {
      await p.waitForSelector("#xiangqi-takeover:not([hidden])");
      await p.click("#xiangqi-takeover");
      await p.waitForSelector("#xiangqi-takeover", { state: "hidden" });
      await p.waitForFunction(() =>
        KenseiWorkspace.client
          .getChannels()
          .some((channel) => channel.state === "joined"),
      );
      await p.evaluate(() => {
        window.__xiangqiLiveVersions = 0;
        for (const channel of KenseiWorkspace.client.getChannels())
          channel.on(
            "broadcast",
            { event: "version" },
            () => window.__xiangqiLiveVersions++,
          );
      });
    }
    await a.click("#xiangqi-ready");
    await b.waitForFunction(
      () => !document.querySelector("#xiangqi-ready").disabled,
    );
    await b.click("#xiangqi-ready");
    await Promise.all([
      a.waitForSelector("[data-xiangqi-phase=playing]"),
      b.waitForSelector("[data-xiangqi-phase=playing]"),
    ]);
    let snapshot = await board(0, "get", { match_id: input.match_id });
    const pages = snapshot.color === 1 ? [a, b] : [b, a],
      white = snapshot.color === 1 ? 0 : 1,
      black = 1 - white;
    await pages[0].click('[data-square="e3"]');
    await pages[0].click('[data-square="e4"]');
    await pages[1].waitForFunction(
      () => document.querySelector("#xiangqi-moves").children.length === 1,
    );
    await pages[1].click('[data-square="e6"]');
    await pages[1].click('[data-square="e5"]');
    await pages[0].waitForFunction(
      () => document.querySelector("#xiangqi-moves").children.length === 2,
    );
    snapshot = await board(white, "get", { match_id: input.match_id });
    assert.equal(snapshot.state.log.length, 2);
    assert.ok(snapshot.clock.remaining[1] > 590000);
    assert.ok(snapshot.clock.remaining[-1] > 590000);
    const first = snapshot.state.log[0],
      foreign = {
        match_id: snapshot.id,
        expected_version: snapshot.revision,
        request_id: crypto.randomUUID(),
        action: { type: "move", uci: "e6e5" },
      };
    await assert.rejects(board(black, "command", foreign), /turn/);
    await assert.rejects(
      board(2, "get", { match_id: snapshot.id }),
      /not available/,
    );
    await assert.rejects(
      board(white, "command", {
        ...foreign,
        request_id: crypto.randomUUID(),
        expected_version: 1,
        action: { type: "move", uci: "b0c2" },
      }),
      /board changed/,
    );
    check(
      "two real browsers Ready, move, receive authoritative updates, and reject foreign/stale/wrong-turn requests",
    );
    await a.reload();
    await a.waitForSelector("[data-xiangqi-phase=playing]");
    assert.equal(await a.locator("#xiangqi-moves span").count(), 2);
    const extra = await contexts[0].newPage();
    await extra.goto(
      (process.env.TEST_BASE_URL || "http://127.0.0.1:8769") +
        "/games/xiangqi/?match=" +
        snapshot.id,
    );
    await extra.waitForSelector("#xiangqi-takeover:not([hidden])");
    await extra.close();
    // Closing an extra readonly tab does not take over the controlling browser.
    const latest = await board(0, "get", { match_id: snapshot.id });
    assert.equal(latest.controller, true);
    check("refresh restores the server game; an extra tab stays read-only");
    const pong = await rpc(2, "pong_room", {
      action: "create",
      body: { client_id: clients[2] },
    });
    pongs.push(pong.id);
    const wb = await rpc(1, "whiteboard_room", {
      action: "create",
      body: {
        client_id: clients[1],
        client_version: 2,
        name: "Xiangqi acceptance capacity",
        elements: [],
      },
    });
    boards.push(wb.id);
    const blocked = await rpc(1, "whiteboard_room", {
      action: "activate",
      body: { room_id: wb.id, client_id: clients[1], client_version: 2 },
    });
    assert.equal(blocked.editing, false);
    await rpc(2, "pong_room", {
      action: "leave",
      body: { room_id: pong.id, client_id: clients[2] },
    });
    const editing = await rpc(1, "whiteboard_room", {
      action: "activate",
      body: { room_id: wb.id, client_id: clients[1], client_version: 2 },
    });
    assert.equal(editing.editing, true);
    await assert.rejects(
      board(2, "create", {
        game: "go",
        config: { rule: "chinese", size: 9, komi: 8.5 },
        rules_version: 1,
      }),
      /capacity|busy/,
    );
    await assert.rejects(
      board(2, "create", {
        game: "chess",
        config: { clock: "10+5" },
        rules_version: 1,
      }),
      /capacity|busy/,
    );
    await rpc(1, "whiteboard_room", {
      action: "release",
      body: { room_id: wb.id, client_id: clients[1], client_version: 2 },
    });
    check(
      "Xiangqi, Chess, Pong, Whiteboard and Go enforce the shared two-room budget",
    );
    await pages[0].click("#xiangqi-draw");
    await pages[0].click("#xiangqi-offer");
    await pages[1].waitForSelector("#xiangqi-draw-offer:not([hidden])");
    await pages[1].click("#xiangqi-accept");
    await Promise.all(
      pages.map((p) => p.waitForSelector("#xiangqi-result:not([hidden])")),
    );
    const ended = await board(0, "get", { match_id: snapshot.id });
    assert.equal(ended.state.result.reason, "agreement");
    assert.equal(ended.ranked, false);
    const publicProfile = await rpc(0, "ensure_my_profile", {
      expected_user: users[0].id,
    });
    const published = await rpc(0, "get_public_profile", {
      profile_id: publicProfile.public_id,
    });
    assert.equal(published.xiangqi_stats.length, 0);
    const received =
      (await a.evaluate(() => window.__xiangqiLiveVersions || 0)) +
      (await b.evaluate(() => window.__xiangqiLiveVersions || 0));
    assert.ok(received > 0, "Expected real private version broadcasts");
    assert.deepEqual(errors, []);
    check(
      "mutual draw settles once, real private broadcasts arrive and fixtures produce no public score",
    );
    await fs.mkdir("_qa/xiangqi", { recursive: true });
    await a.screenshot({ path: "_qa/xiangqi/live-draw.png", fullPage: true });
    const sorted = durations.toSorted((x, y) => x - y);
    const report = {
      at: new Date().toISOString(),
      checks: "passed",
      backend: "real Supabase Auth/Edge/RPC/Realtime",
      publicScoresCreated: 0,
      versionEvents: received,
      versionFrames: frames,
      requests: durations.length,
      p95RequestMs: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
      matchIds: rooms,
    };
    await fs.writeFile(
      "_qa/xiangqi/live-report.json",
      JSON.stringify(report, null, 2),
    );
    console.log("PASS live report saved without credentials");
  } catch (error) {
    console.error("Live Xiangqi check failed:", error.message);
    process.exitCode = 1;
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (users && config) {
      for (const id of boards)
        await rpc(1, "whiteboard_room", {
          action: "delete",
          body: { room_id: id, client_id: clients[1], client_version: 2 },
        }).catch(() => {});
      for (const id of pongs)
        await rpc(2, "pong_room", {
          action: "leave",
          body: { room_id: id, client_id: clients[2] },
        }).catch(() => {});
    }
    console.log(
      "Fixture account/room deletion must be verified by the provisioning controller.",
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
