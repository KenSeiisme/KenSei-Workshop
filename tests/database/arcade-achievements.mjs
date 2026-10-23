import assert from "node:assert/strict";
import { gameDatabase } from "../support/games-fixture.mjs";
import { ACHIEVEMENTS } from "../../src/games/achievement-catalog.js";
const {
  db,
  users: [a, b],
  rpc,
  admin,
  as,
  value,
} = await gameDatabase();
assert.equal(ACHIEVEMENTS.length, 30);
assert.equal(
  await value(
    "select count(*)::integer as value from workshop_private.game_achievement_rules",
  ),
  30,
);
for (const d of ACHIEVEMENTS) {
  const r = (
    await db.query(
      "select id,game,field,target,mode from workshop_private.game_achievement_rules where id=$1",
      [d.id],
    )
  ).rows[0];
  assert.deepEqual(r, {
    id: d.id,
    game: d.game,
    field: d.field,
    target: d.target,
    mode: d.mode || null,
  });
}
await assert.rejects(() => rpc("get_my_game_progress", {}, "anon", null));
await as("authenticated", a, async () => {
  await assert.rejects(() =>
    db.exec(
      "insert into workshop_private.game_achievement_unlocks values(auth.uid(),'public-first',now())",
    ),
  );
  await assert.rejects(() =>
    db.exec("select * from workshop_private.game_results"),
  );
});
async function finish(game, difficulty, metrics, user = a) {
  const s = await admin("start", user, { game, difficulty, seed: 42 });
  const result = await admin("finish", user, {
    session_id: s.id,
    metrics: { score: 0, max_tile: 0, moves: 10, won: false, ...metrics },
  });
  return { s, result: result.result };
}
let p = await rpc("get_my_game_progress", {});
assert.equal(p.result_count, 0);
const first = await finish("2048", "classic", { score: 1000, max_tile: 256 });
assert.equal(first.result.new_achievements.length, 2);
const again = await admin("finish", a, {
  session_id: first.s.id,
  metrics: { score: 999999, max_tile: 2048, moves: 1, won: false },
});
assert.deepEqual(
  again.result,
  first.result,
  "Repeated finish is identical and cannot replace the verified score.",
);
assert.equal((await rpc("get_my_game_progress", {})).result_count, 1);
await finish("2048", "classic", { score: 2000, max_tile: 255 });
assert.equal((await rpc("get_my_game_progress", {})).progress["2048-1"], 256);
const failed = await finish("minesweeper", "beginner", { won: false });
assert.equal(failed.result.qualified, false);
assert.equal((await rpc("get_my_game_progress", {})).result_count, 2);
await finish("minesweeper", "beginner", { won: true });
await finish("snake", "normal", { score: 600 });
assert.ok(
  (await rpc("get_my_game_progress", {})).unlocks.some(
    (x) => x.achievement_id === "public-three-games",
  ),
);
await finish("brick-breaker", "classic", { score: 1200, won: true });
await finish("block-drop", "classic", { score: 900, lines: 9 });
assert.equal(
  (await rpc("get_my_game_progress", {})).progress["block-drop-1"],
  9,
);
await finish("block-drop", "classic", { score: 900, lines: 40 });
await finish("block-drop", "sprint", { score: 3000, lines: 40, won: true });
await finish("block-drop", "sprint", { score: 9000, lines: 12, won: false });
p = await rpc("get_my_game_progress", {});
assert.equal(p.result_count, 8);
assert.ok(p.unlocks.some((x) => x.achievement_id === "brick-breaker-3"));
assert.ok(p.unlocks.some((x) => x.achievement_id === "block-drop-3"));
assert.equal(p.progress["block-drop-2"], 40);
assert.equal(
  (await rpc("get_my_game_progress", {}, "authenticated", b)).result_count,
  0,
);
const board = await rpc(
  "get_game_leaderboard",
  { game: "block-drop", difficulty: "classic" },
  "anon",
  null,
);
assert.equal(board.top.length, 1);
assert.equal(
  board.top[0].lines,
  40,
  "Classic equal-score ties use the greater line count.",
);
const sprint = await rpc(
  "get_game_leaderboard",
  { game: "block-drop", difficulty: "sprint" },
  "anon",
  null,
);
assert.equal(sprint.top.length, 1);
assert.equal(sprint.top[0].score, 3000);
const profileId = (await rpc("ensure_my_profile", { expected_user: a }))
  .public_id;
const profile = await rpc(
  "get_public_profile",
  { profile_id: profileId },
  "anon",
  null,
);
assert.ok(profile.game_achievements.length > 0);
assert.ok(profile.game_best_scores.some((x) => x.game === "block-drop"));
assert.equal(JSON.stringify(profile).includes(a), false);
assert.equal("progress" in profile, false);
for (let i = 0; i < 2; i++)
  await finish("2048", "classic", { score: 50, max_tile: 2 });
p = await rpc("get_my_game_progress", {});
assert.equal(p.result_count, 10);
assert.ok(p.unlocks.some((x) => x.achievement_id === "public-ten"));
await db.close();
console.log(
  "PASS 30 matching definitions, verified-only thresholds, same-transaction unlocks, idempotency, current-user isolation, nine-game boards and anonymous-safe Profile.",
);
