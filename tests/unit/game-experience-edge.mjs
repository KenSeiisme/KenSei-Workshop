import assert from "node:assert/strict";
import { build } from "esbuild";
import { gameDatabase } from "../support/games-fixture.mjs";
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
  console.log(
    "PASS real bundled Edge: stale clients rejected before start, v2 canonical score, wrong format/owner denial, idempotency and in-flight v1 finish; other games stay v1.",
  );
} finally {
  await db.close();
}
