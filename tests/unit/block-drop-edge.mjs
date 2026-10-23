import assert from "node:assert/strict";
import { build } from "esbuild";
import { gameDatabase } from "../support/games-fixture.mjs";
import {
  create,
  apply,
  advanceDrop,
  INPUTS,
} from "../../src/games/block-drop-engine.js";
await build({
  entryPoints: ["supabase/functions/games-session/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "_qa/block-drop-edge.mjs",
});
const { makeHandler } = await import("../../_qa/block-drop-edge.mjs");
const {
  db,
  users: [a, b],
  admin,
} = await gameDatabase();
const handler = makeHandler(
  (k) =>
    ({
      SUPABASE_URL: "https://test.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-key",
    })[k],
  async (url, opts) => {
    if (url.endsWith("/auth/v1/user"))
      return Response.json({
        id: opts.headers.Authorization.includes("userB") ? b : a,
      });
    const args = JSON.parse(opts.body);
    try {
      return Response.json(await admin(args.action, args.owner, args.body));
    } catch (e) {
      return Response.json({ message: e.message }, { status: 400 });
    }
  },
);
async function call(action, body, user = "userA") {
  const response = await handler(
    new Request("https://test.invalid/functions/v1/games-session/" + action, {
      method: "POST",
      headers: {
        Origin: "https://kensei-workshop.vercel.app",
        Authorization: `Bearer aaa.${user}.ccc`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, data: await response.json() };
}
const session = (
  await call("start", { game: "block-drop", difficulty: "classic" })
).data;
const s = create("block-drop", "classic", Number(session.seed)),
  events = [];
for (let i = 0; s.status === "playing" && i < 50; i++) {
  const tick = i * 30;
  advanceDrop(s, tick);
  if (s.status !== "playing") break;
  apply(s, { type: "drop-input", input: "hard", tick });
  events.push([tick, INPUTS.indexOf("hard")]);
}
const body = {
  session_id: session.id,
  events,
  final_tick: s.ticks,
  events_format: "block-drop-v1",
  score: 9999999,
  lines: 9999,
};
await db.query(
  "update workshop_private.game_sessions set started_at=clock_timestamp()-interval '10 seconds' where id=$1",
  [session.id],
);
assert.equal((await call("finish", body, "userB")).status, 400);
assert.equal(
  (await call("finish", { ...body, events_format: "legacy" })).status,
  400,
);
const done = await call("finish", body);
assert.equal(done.status, 200);
assert.equal(done.data.score, s.score);
assert.equal(done.data.lines, s.lines);
assert.ok(
  done.data.new_achievements.some((x) => x.achievement_id === "public-first"),
);
assert.deepEqual(await call("finish", body), done);
assert.equal(
  (await call("start", { game: "pong", difficulty: "casual" })).status,
  400,
);
await db.close();
console.log(
  "PASS Block Drop Edge: canonical replay, ignored forged metrics, foreign-session denial, format checks, atomic achievement and idempotent response; Pong excluded from ranks.",
);
