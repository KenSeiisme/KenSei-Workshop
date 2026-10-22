import assert from "node:assert/strict";
import { build } from "esbuild";
import { gameDatabase } from "../support/games-fixture.mjs";
import { create, apply, GAMES } from "../../src/games/engine.js";
await build({
  entryPoints: ["supabase/functions/games-session/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "_qa/games-edge-test.mjs",
});
const { makeHandler } = await import("../../_qa/games-edge-test.mjs");
const {
  db,
  users: [a, b],
  admin,
} = await gameDatabase();
const tokens = new Map([
  ["aaa.userA.ccc", a],
  ["aaa.userB.ccc", b],
]);
const handler = makeHandler(
  (key) =>
    ({
      SUPABASE_URL: "https://backend.test",
      SUPABASE_SERVICE_ROLE_KEY: "server-test-key",
    })[key],
  async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      const id = tokens.get(
        options.headers.Authorization.replace("Bearer ", ""),
      );
      return Response.json(id ? { id } : { error: "invalid token" }, {
        status: id ? 200 : 401,
      });
    }
    assert.equal(options.headers.apikey, "server-test-key");
    const body = JSON.parse(options.body);
    try {
      return Response.json(await admin(body.action, body.owner, body.body));
    } catch (e) {
      return Response.json({ message: e.message }, { status: 400 });
    }
  },
);
const call = async (
  action,
  body,
  token = "aaa.userA.ccc",
  origin = "https://kensei-workshop.vercel.app",
) => {
  const response = await handler(
    new Request("https://backend.test/functions/v1/games-session/" + action, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, data: await response.json() };
};
assert.equal((await call("start", {}, "aaa.invalid.ccc")).status, 401);
assert.equal((await call("start", {}, "sb_publishable_example")).status, 401);
assert.equal(
  (await call("start", {}, "aaa.userA.ccc", "https://evil.example")).status,
  403,
);
assert.equal(
  (await call("start", { game: "snake", difficulty: "madeup" })).status,
  400,
);
let session = (
  await call("start", { game: "snake", difficulty: "normal", owner: b })
).data;
assert.equal(
  (
    await call("finish", {
      session_id: session.id,
      events: [],
      final_tick: 1000,
    })
  ).status,
  400,
);
assert.equal(
  (
    await call(
      "finish",
      { session_id: session.id, events: [], final_tick: 11 },
      "aaa.userB.ccc",
    )
  ).status,
  400,
);
await db.query(
  "update workshop_private.game_sessions set started_at=clock_timestamp()-interval '2 seconds' where id=$1",
  [session.id],
);
let result = await call("finish", {
  session_id: session.id,
  events: [{ type: "turn", dir: 0, tick: 0, t: 0 }],
  final_tick: 11,
  score: 999999,
});
assert.equal(result.status, 200);
assert.ok(result.data.score < 999999);
assert.equal(result.data.qualified, true);
assert.deepEqual(
  (await call("finish", { session_id: session.id, events: [], final_tick: 0 }))
    .data,
  result.data,
);
session = (await call("start", { game: "2048", difficulty: "classic" })).data;
assert.equal(
  (await call("finish", { session_id: session.id, events: [], score: 100000 }))
    .status,
  400,
);
await call("abandon", { session_id: session.id });
assert.equal(
  (await call("finish", { session_id: session.id, events: [] })).status,
  400,
);
for (const game of ["memory-match", "minesweeper"]) {
  const difficulty = GAMES[game].default;
  session = (await call("start", { game, difficulty })).data;
  const s = create(game, difficulty, Number(session.seed)),
    events = [];
  let t = 0;
  if (game === "memory-match") {
    for (let p = 0; p < 8; p++)
      for (let i = 0; i < s.cards.length; i++)
        if (s.cards[i] === p) {
          const e = { type: "flip", index: i, t: (t += 10) };
          apply(s, e);
          events.push(e);
        }
  } else {
    let e = { type: "reveal", index: 40, t: ++t };
    apply(s, e);
    events.push(e);
    for (let i = 0; i < s.board.length && s.status === "playing"; i++)
      if (s.board[i] !== -1 && !s.revealed.includes(i)) {
        e = { type: "reveal", index: i, t: ++t };
        apply(s, e);
        events.push(e);
      }
  }
  await db.query(
    "update workshop_private.game_sessions set started_at=clock_timestamp()-interval '2 seconds' where id=$1",
    [session.id],
  );
  result = await call("finish", {
    session_id: session.id,
    events,
    score: 999999,
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.qualified, true);
  assert.equal(result.data.moves, s.moves);
}
assert.equal(
  (await call("finish", { session_id: session.id, events: "x".repeat(530000) }))
    .status,
  413,
);
console.log(
  "PASS authenticated Edge handler, server replays, impossible speed, unfinished games, forged scores, foreign sessions, interruptions, idempotency and body limits",
);
await db.close();
