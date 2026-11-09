import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gameDatabase } from "../support/games-fixture.mjs";
import { create } from "../../src/games/engine.js";

const {
  db,
  users: [a, b],
  rpc,
  admin,
  as,
  value,
} = await gameDatabase();
const settle = (game, difficulty, version, score = 600) =>
  (async () => {
    const run = await admin("start", a, {
      game,
      difficulty,
      rules_version: version,
      seed: 42,
    });
    await admin("finish", a, {
      session_id: run.id,
      metrics: { score, moves: 1, max_tile: 256, won: true },
    });
    return run;
  })();
try {
  await db.exec(
    "create or replace function workshop_private.hub_day() returns date language sql stable set search_path='' as $$select date '2026-01-01'$$",
  );
  const run = (game = "2048") => ({
    id: randomUUID(),
    segmentId: randomUUID(),
    game,
    activeMs: 1500,
    started: true,
    finished: true,
    score: 1001,
    mode: "classic",
  });
  const runs = Array.from({ length: 12 }, () => run());
  const sync = (values) =>
    rpc("sync_game_activity", { expected_user: a, runs: values });
  let progress = await sync(runs);
  assert.equal(progress.balance, 70);
  assert.deepEqual(progress.badges, ["first-finish", "score-1000"]);
  assert.equal((await sync(runs)).balance, 70);
  progress = await sync([
    { ...runs[0], segmentId: randomUUID(), started: false, activeMs: 2500 },
  ]);
  assert.deepEqual(progress.stats["2048"], { plays: 12, activeMs: 20500 });
  assert.equal(progress.balance, 70);
  assert.equal((await sync([run("snake")])).balance, 80);
  assert.equal(
    (await rpc("buy_game_skin", { expected_user: a, skin_id: "neon" })).balance,
    40,
  );
  assert.equal(
    (await rpc("buy_game_skin", { expected_user: a, skin_id: "neon" })).balance,
    40,
  );
  assert.equal(
    (await rpc("equip_game_skin", { expected_user: a, skin_id: "neon" })).skin,
    "neon",
  );
  await assert.rejects(
    rpc("buy_game_skin", { expected_user: a, skin_id: "ice" }),
    /Not enough coins/,
  );
  await assert.rejects(
    rpc("equip_game_skin", { expected_user: a, skin_id: "ice" }),
    /Skin is locked/,
  );
  await assert.rejects(
    rpc("sync_game_activity", { expected_user: a, runs }, "authenticated", b),
    /Account changed/,
  );
  await assert.rejects(
    rpc("game_hub_snapshot", {}, "anon", null),
    /permission denied/,
  );
  await assert.rejects(
    as("authenticated", b, () =>
      db.query("select * from workshop_private.hub_ledger"),
    ),
    /permission denied/,
  );
  assert.equal(
    (await rpc("game_hub_snapshot", {}, "authenticated", b)).balance,
    0,
  );
  await db.exec(
    "create or replace function workshop_private.hub_day() returns date language sql stable set search_path='' as $$select date '2026-01-02'$$",
  );
  assert.equal(
    (await sync(runs)).balance,
    40,
    "old receipts do not re-award on a later day",
  );
  const finishedOffline = run("minesweeper");
  progress = await sync([finishedOffline]);
  assert.equal(progress.day, "2026-01-02");
  assert.equal(progress.balance, 65);

  const snake = await settle("snake", "normal", 1);
  const brick = await settle("brick-breaker", "classic", 2);
  await settle("2048", "classic", 1);
  const v1 = await value(
    "insert into workshop_private.game_sessions(user_id,game,difficulty,version,seed) values($1,'brick-breaker','classic',1,42) returning id as value",
    [a],
  );
  await admin("finish", a, {
    session_id: v1,
    metrics: { score: 100, moves: 1, max_tile: 0, won: true },
  });
  assert.equal(
    (
      await admin("start", a, {
        game: "snake",
        difficulty: "normal",
        rules_version: 2,
        seed: 42,
      })
    ).code,
    "RULES_UPDATE_REQUIRED",
  );
  const unlocks = await value(
    "select count(*)::int value from workshop_private.game_achievement_unlocks",
  );
  const cutover = await value(
    "select workshop_private.activate_arcade_upgrade() value",
  );
  assert.equal(cutover.old_scores_deleted, 3);
  assert.equal(cutover.old_sessions_closed, 3);
  assert.equal(
    await value(
      "select count(*)::int value from workshop_private.game_results",
    ),
    1,
  );
  assert.equal(
    await value(
      "select count(*)::int value from workshop_private.game_sessions where id in ($1,$2,$3) and result is not null",
      [snake.id, brick.id, v1],
    ),
    0,
  );
  assert.equal(
    await value(
      "select count(*)::int value from workshop_private.game_achievement_unlocks",
    ),
    unlocks,
  );
  assert.equal(
    (await admin("read", a, { session_id: snake.id })).code,
    "RULES_UPDATE_REQUIRED",
  );
  for (const [game, difficulty, version] of [
    ["snake", "normal", 2],
    ["brick-breaker", "classic", 3],
  ]) {
    const board = await rpc(
      "get_game_leaderboard",
      { game, difficulty },
      "anon",
      null,
    );
    assert.equal(board.version, version);
    assert.deepEqual(board.top, []);
    const saved = {
      game,
      difficulty,
      state: create(game, difficulty, 42),
      name: game,
      elapsed: 0,
    };
    assert.equal(
      (
        await value(
          "select workshop_private.validate_game_save('game',$1) value",
          [saved],
        )
      ).state.version,
      version,
    );
    await settle(game, difficulty, version);
    assert.equal(
      (await rpc("get_game_leaderboard", { game, difficulty }, "anon", null))
        .top.length,
      1,
    );
  }
  assert.equal(
    (await value("select workshop_private.activate_arcade_upgrade() value"))
      .old_scores_deleted,
    0,
  );
  assert.equal(
    await value(
      "select count(*)::int value from workshop_private.game_results",
    ),
    3,
  );
  console.log(
    "PASS idempotent coins, resumed active time, scoped accounts, Malaysia day, and transactional arcade cutover",
  );
} finally {
  await db.close();
}
