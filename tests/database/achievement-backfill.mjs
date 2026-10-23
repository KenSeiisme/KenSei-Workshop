import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { bootstrap } from "../support/db-fixture.cjs";
const db = new PGlite();
await db.exec(bootstrap);
const files = (await fs.readdir("supabase/migrations")).sort();
const current = files.find((file) =>
  file.endsWith("_workshop_arcade_achievements.sql"),
);
for (const file of files.filter((f) => f < current))
  await db.exec(await fs.readFile("supabase/migrations/" + file, "utf8"));
const user = "11111111-1111-4111-8111-111111111111";
await db.query("insert into auth.users values($1,'{}')", [user]);
const ids = [];
for (const [i, game] of ["2048", "brick-breaker"].entries()) {
  const {
    rows: [s],
  } = await db.query(
    "insert into workshop_private.game_sessions(user_id,game,difficulty,seed,status,result,started_at) values($1,$2,'classic',42,'completed',$3,'2026-10-20T01:00:00Z') returning id",
    [user, game, { won: true }],
  );
  ids.push(s.id);
  await db.query(
    "insert into workshop_private.game_results(session_id,user_id,game,difficulty,version,score,max_tile,moves,elapsed_ms,achieved_at) values($1,$2,$3,'classic',1,$4,$5,10,10000,$6)",
    [s.id, user, game, 1, i ? 980 : 1024, `2026-10-20T0${i + 1}:00:00Z`],
  );
}
await db.exec(await fs.readFile("supabase/migrations/" + current, "utf8"));
const unlocks = (
  await db.query(
    "select achievement_id,unlocked_at from workshop_private.game_achievement_unlocks where user_id=$1",
    [user],
  )
).rows;
assert.ok(unlocks.some((x) => x.achievement_id === "2048-2"));
assert.ok(unlocks.some((x) => x.achievement_id === "brick-breaker-3"));
assert.equal(
  new Date(
    unlocks.find((x) => x.achievement_id === "public-first").unlocked_at,
  ).toISOString(),
  "2026-10-20T01:00:00.000Z",
);
assert.equal(
  (
    await db.query(
      "select count(*)::int as n from workshop_private.game_results",
    )
  ).rows[0].n,
  2,
);
await db.exec("delete from workshop_private.game_achievement_unlocks");
await db.query("select workshop_private.grant_game_achievements($1)", [user]);
const second = (
  await db.query(
    "select achievement_id,unlocked_at from workshop_private.game_achievement_unlocks where user_id=$1",
    [user],
  )
).rows;
assert.deepEqual(
  new Set(second.map((x) => x.achievement_id)),
  new Set(unlocks.map((x) => x.achievement_id)),
);
await db.close();
console.log(
  "PASS historical Public backfill uses retained verified metrics and earliest dates, preserves old results, and never guesses unavailable metadata.",
);
