import assert from "node:assert/strict";
import { build } from "esbuild";
import { gameDatabase } from "../support/games-fixture.mjs";
import { create, advanceSnake, advanceBrick } from "../../src/games/engine.js";
await build({
  entryPoints: ["supabase/functions/games-session/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "_qa/game-experience-edge.mjs",
});
const { makeHandler } = await import("../../_qa/game-experience-edge.mjs");
const {
  db,
  users: [a, b],
  admin,
} = await gameDatabase();
const handler = makeHandler(
  (k) =>
    ({
      SUPABASE_URL: "https://backend.test",
      SUPABASE_SERVICE_ROLE_KEY: "fixture",
    })[k],
  async (url, opts) => {
    if (url.endsWith("/auth/v1/user"))
      return Response.json({
        id: opts.headers.Authorization.includes("userB") ? b : a,
      });
    const body = JSON.parse(opts.body);
    try {
      return Response.json(await admin(body.action, body.owner, body.body));
    } catch (e) {
      return Response.json({ message: e.message }, { status: 400 });
    }
  },
);
const call = async (action, body, who = "userA") => {
  const response = await handler(
    new Request(`https://edge.test/games-session/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer aaa.${who}.ccc`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, data: await response.json() };
};
try {
  assert.equal(
    (await call("start", { game: "brick-breaker", difficulty: "classic" }))
      .status,
    409,
  );
  assert.equal(
    (
      await call("start", {
        game: "brick-breaker",
        difficulty: "classic",
        rules_version: 1,
      })
    ).status,
    409,
  );
  const started = await call("start", {
    game: "brick-breaker",
    difficulty: "classic",
    rules_version: 2,
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.version, 2);
  await db.query(
    "update workshop_private.game_sessions set started_at=clock_timestamp()-interval '5 minutes' where id=$1",
    [started.data.id],
  );
  assert.equal(
    (
      await call("finish", {
        session_id: started.data.id,
        events: [],
        events_format: "paddle-v1",
        final_tick: 18000,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "finish",
        {
          session_id: started.data.id,
          events: [],
          events_format: "paddle-v2",
          final_tick: 18000,
        },
        "userB",
      )
    ).status,
    400,
  );
  const body = {
    session_id: started.data.id,
    events: [],
    events_format: "paddle-v2",
    final_tick: 18000,
    score: 999999,
    metrics: { score: 999999 },
  };
  const result = await call("finish", body);
  assert.equal(result.status, 200);
  assert.equal(result.data.score, 0);
  assert.equal(result.data.version, 2);
  assert.deepEqual((await call("finish", body)).data, result.data);
  const old = (
    await db.query(
      "insert into workshop_private.game_sessions(user_id,game,difficulty,version,seed,started_at) values($1,'brick-breaker','classic',1,42,clock_timestamp()-interval '5 minutes') returning id",
      [a],
    )
  ).rows[0].id;
  const legacy = await call("finish", {
    session_id: old,
    events: [],
    events_format: "paddle-v1",
    final_tick: 18000,
  });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.data.version, 1);
  assert.equal(
    (await call("start", { game: "snake", difficulty: "normal" })).data.version,
    1,
  );
  await db.query("select workshop_private.activate_arcade_upgrade()");
  assert.equal((await call("finish", body)).status, 409);
  for (const [game, difficulty, rules_version] of [
    ["snake", "normal", 2],
    ["brick-breaker", "classic", 3],
  ]) {
    const { status, data: session } = await call("start", {
      game,
      difficulty,
      rules_version,
    });
    assert.equal(status, 200);
    assert.equal(session.version, rules_version);
    const state = create(game, difficulty, Number(session.seed));
    if (game === "snake") advanceSnake(state, 300);
    else advanceBrick(state, 18000);
    await db.query(
      "update workshop_private.game_sessions set started_at=clock_timestamp()-interval '5 minutes' where id=$1",
      [session.id],
    );
    const finish = {
      session_id: session.id,
      events: [],
      events_format: game === "snake" ? "legacy" : "paddle-v3",
      final_tick: state.ticks,
      score: 999999,
    };
    const result = await call("finish", finish);
    assert.equal(result.status, 200);
    assert.equal(result.data.version, rules_version);
    assert.equal(result.data.score, state.score);
    assert.equal(result.data.qualified, true);
    assert.deepEqual((await call("finish", finish)).data, result.data);
  }
  console.log(
    "PASS bundled Edge: compatible legacy finishes before cutover, stale session rejection, Snake v2 and Brick v3 ranked replays, score forgery rejection and idempotency.",
  );
} finally {
  await db.close();
}
