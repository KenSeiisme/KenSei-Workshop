import assert from "node:assert/strict";
import { gameDatabase } from "../support/games-fixture.mjs";
import { create } from "../../src/games/engine.js";
const {
  db,
  users: [a, b],
  rpc,
  admin,
  value,
  as,
} = await gameDatabase();
try {
  const old = (
    await db.query(
      "insert into workshop_private.game_sessions(user_id,game,difficulty,version,seed) values($1,'brick-breaker','classic',1,42) returning id",
      [a],
    )
  ).rows[0].id;
  await admin("finish", a, {
    session_id: old,
    metrics: { score: 400, moves: 50, max_tile: 0, won: false },
  });
  const current = await admin("start", a, {
    game: "brick-breaker",
    difficulty: "classic",
    seed: 42,
  });
  assert.equal(current.version, 2);
  const finished = await admin("finish", a, {
    session_id: current.id,
    metrics: { score: 800, moves: 70, max_tile: 0, won: false },
  });
  const again = await admin("finish", a, {
    session_id: current.id,
    metrics: { score: 999999, moves: 1, max_tile: 0, won: true },
  });
  assert.deepEqual(again.result, finished.result);
  let board = await rpc(
    "get_game_leaderboard",
    { game: "brick-breaker", difficulty: "classic" },
    "anon",
    null,
  );
  assert.equal(board.version, 2);
  assert.equal(board.top[0].score, 800);
  assert.equal(board.top.length, 1);
  board = await rpc(
    "get_game_leaderboard_history",
    { game: "brick-breaker", difficulty: "classic", rules_version: 1 },
    "anon",
    null,
  );
  assert.equal(board.version, 1);
  assert.equal(board.top[0].score, 400);
  assert(!/"(user_id|email|state|events|seed)":/.test(JSON.stringify(board)));
  await assert.rejects(() =>
    rpc(
      "get_game_leaderboard_history",
      { game: "snake", difficulty: "normal", rules_version: 2 },
      "anon",
      null,
    ),
  );
  await assert.rejects(() =>
    rpc(
      "get_game_leaderboard_history",
      { game: "brick-breaker", difficulty: "classic", rules_version: null },
      "anon",
      null,
    ),
  );
  const profileId = await value(
    "select public_id as value from public.typing_profiles where user_id=$1",
    [a],
  );
  const profile = await rpc(
    "get_public_profile",
    { profile_id: profileId },
    "anon",
    null,
  );
  assert.equal(profile.game_best_scores[0].score, 800);
  assert.equal(profile.game_best_scores[0].version, 2);
  assert.equal(profile.game_legacy_best_scores[0].score, 400);
  assert.equal(profile.game_legacy_best_scores[0].version, 1);
  const p = await rpc("get_my_game_progress", {}, "authenticated", a);
  assert.equal(p.result_count, 2);
  assert.equal(p.game_count, 1);
  assert.equal(
    p.unlocks.filter((x) => x.achievement_id === "brick-breaker-1").length,
    1,
  );
  assert.equal(
    p.unlocks.filter((x) => x.achievement_id === "brick-breaker-2").length,
    1,
  );
  assert.equal(
    (await rpc("get_my_game_progress", {}, "authenticated", b)).result_count,
    0,
  );
  for (const version of [1, 2]) {
    const data = {
      game: "brick-breaker",
      difficulty: "classic",
      state: create("brick-breaker", "classic", 2, version),
      elapsed: 0,
      name: `Brick v${version}`,
      best: null,
    };
    await rpc("save_game_save", {
      kind: "game",
      record_id: crypto.randomUUID(),
      payload: data,
      base_revision: 0,
      operation_id: crypto.randomUUID(),
      remove_record: false,
      expected_user: a,
    });
  }
  for (const version of [null, 3]) {
    const state = create("brick-breaker", "classic", 2);
    state.version = version;
    await assert.rejects(() =>
      rpc("save_game_save", {
        kind: "game",
        record_id: crypto.randomUUID(),
        payload: {
          game: "brick-breaker",
          difficulty: "classic",
          state,
          elapsed: 0,
          name: "Bad",
        },
        base_revision: 0,
        operation_id: crypto.randomUUID(),
        remove_record: false,
        expected_user: a,
      }),
    );
  }
  const state = create("snake", "normal", 1);
  state.version = 2;
  await assert.rejects(() =>
    rpc("save_game_save", {
      kind: "game",
      record_id: crypto.randomUUID(),
      payload: {
        game: "snake",
        difficulty: "normal",
        state,
        elapsed: 0,
        name: "Bad",
      },
      base_revision: 0,
      operation_id: crypto.randomUUID(),
      remove_record: false,
      expected_user: a,
    }),
  );
  await as("authenticated", a, async () => {
    await assert.rejects(() =>
      db.exec("update workshop_private.game_results set score=999999"),
    );
  });
  console.log(
    "PASS per-game versions, current/archive boards, additive Profile history, unchanged milestone history, idempotent settlement, v1/v2 saves and ownership/version denial.",
  );
} finally {
  await db.close();
}
