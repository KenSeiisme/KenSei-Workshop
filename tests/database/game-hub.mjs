import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { featuredGame } from "../../src/games/hub-model.js";
import { randomUUID } from "node:crypto";
import { gameDatabase } from "../support/games-fixture.mjs";
import { advanceBrick, apply, create } from "../../src/games/engine.js";
import { makeHandler } from "../../supabase/functions/games-session/index.ts";

const {
  db,
  users: [a, b],
  rpc,
  admin,
  as,
  value,
} = await gameDatabase({ beforeDailyClaims: true });
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
const setDay = (day) =>
  db.exec(
    `create or replace function workshop_private.hub_day() returns date language sql stable set search_path='' as $$select date '${day}'$$`,
  );
try {
  await setDay("2026-01-01");
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
  const migrationDir = "supabase/migrations/";
  const migration = (await fs.readdir(migrationDir)).find((name) =>
    name.endsWith("_workshop_daily_claims.sql"),
  );
  await db.exec(await fs.readFile(migrationDir + migration, "utf8"));
  await setDay("2026-01-01");
  const claim = (day, id, role = "authenticated", user = a) =>
    rpc(
      "claim_game_hub_reward",
      { expected_user: a, task_day: day, task_id: id },
      role,
      user,
    );
  progress = await rpc("game_hub_snapshot", {});
  assert.equal(progress.manualClaims, true);
  assert.equal(progress.balance, 40);
  assert.equal(progress.resetAt, Date.parse("2026-01-01T16:00:00Z"));
  assert.deepEqual(progress.claimedTasks, ["explorer", "featured", "warm-up"]);
  assert.equal((await claim("2026-01-01", "explorer")).balance, 40);
  await setDay("2026-01-02");
  assert.equal(
    (await sync(runs)).balance,
    40,
    "old receipts do not re-award on a later day",
  );
  const finishedOffline = run("minesweeper");
  progress = await sync([finishedOffline]);
  assert.equal(progress.day, "2026-01-02");
  assert.equal(progress.balance, 45);
  assert.deepEqual(progress.claimedTasks, []);
  await assert.rejects(claim("2026-01-02", "explorer"), /Complete this task/);
  await assert.rejects(
    claim("2026-01-02", "warm-up", "authenticated", b),
    /Account changed/,
  );
  await assert.rejects(
    claim("2026-01-02", "warm-up", "anon", null),
    /permission denied/,
  );
  await assert.rejects(claim("2026-01-02", "unknown"), /Invalid daily reward/);
  progress = await claim("2026-01-02", "warm-up");
  assert.deepEqual(progress.claimedTasks, ["warm-up"]);
  assert.equal(progress.balance, 55);
  assert.equal((await claim("2026-01-02", "warm-up")).balance, 55);
  await setDay("2026-01-03");
  assert.equal((await claim("2026-01-02", "warm-up")).balance, 55);
  await assert.rejects(claim("2026-01-02", "explorer"), /expired/);
  await sync([run("pong"), run(featuredGame("2026-01-03"))]);
  for (let i = 4; i <= 9; i++) {
    const day = `2026-01-0${i}`;
    await setDay(day);
    progress = await sync([run("pong"), run(featuredGame(day))]);
  }
  assert(progress.badges.includes("seven-days"));
  assert.deepEqual(progress.claimedTasks, []);
  assert.equal(progress.balance, 125);

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
      state: create(game, difficulty, 42, version),
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
  const brickMigration = (await fs.readdir(migrationDir)).find((name) =>
    name.endsWith("_workshop_brick_v4.sql"),
  );
  await db.exec(await fs.readFile(migrationDir + brickMigration, "utf8"));
  const debut = run("2048");
  const otherSync = () =>
    rpc(
      "sync_game_activity",
      { expected_user: b, runs: [debut] },
      "authenticated",
      b,
    );
  assert.deepEqual((await otherSync()).newBadges, [
    "first-finish",
    "score-1000",
  ]);
  assert.deepEqual((await otherSync()).newBadges, []);
  const integrityMigration = (await fs.readdir(migrationDir)).find((name) =>
    name.endsWith("_game_hub_reward_integrity.sql"),
  );
  await db.exec(await fs.readFile(migrationDir + integrityMigration, "utf8"));
  const beforeInvalid = await rpc("game_hub_snapshot", {});
  const unstarted = {
    ...run("snake"),
    started: false,
    activeMs: 60000,
  };
  const tooShort = { ...run(), activeMs: 999 };
  const invalid = await sync([unstarted, tooShort]);
  assert.equal(invalid.balance, beforeInvalid.balance);
  assert.deepEqual(invalid.today, beforeInvalid.today);
  assert.deepEqual(invalid.newBadges, []);
  const resumable = { ...run("snake"), activeMs: 700, finished: false };
  await sync([resumable]);
  const resumed = {
    ...resumable,
    started: false,
    finished: true,
    segmentId: randomUUID(),
    activeMs: 300,
  };
  const earned = await sync([resumed]);
  assert.equal(earned.balance, beforeInvalid.balance + 5);
  assert.equal((await sync([resumed])).balance, earned.balance);
  assert.equal(
    await value(
      "select count(*)::int value from workshop_private.hub_runs where run_id=any($1::text[]) and finished_day is not null",
      [[unstarted.id, tooShort.id, resumed.id]],
    ),
    1,
  );
  const oldV3 = await settle("brick-breaker", "classic", 3, 1030);
  const oldActive = await admin("start", a, {
    game: "brick-breaker",
    difficulty: "classic",
    rules_version: 3,
    seed: 105,
  });
  const unlockBefore = await value(
    "select count(*)::int value from workshop_private.game_achievement_unlocks",
  );
  const nonBrickBefore = await value(
    "select count(*)::int value from workshop_private.game_results where game<>'brick-breaker'",
  );
  await assert.rejects(
    as("authenticated", a, () =>
      db.query("select workshop_private.activate_brick_v4()"),
    ),
    /permission denied/,
  );
  assert.equal(
    (
      await admin("start", a, {
        game: "brick-breaker",
        difficulty: "classic",
        rules_version: 4,
        seed: 105,
      })
    ).code,
    "RULES_UPDATE_REQUIRED",
  );
  for (const version of [1, 2, 3, 4]) {
    const state = create("brick-breaker", "classic", 105, version);
    const saved = await value(
      "select workshop_private.validate_game_save('game',$1) value",
      [
        {
          game: "brick-breaker",
          difficulty: "classic",
          elapsed: 0,
          name: "Brick",
          state,
        },
      ],
    );
    assert.equal(saved.state.version, version);
  }
  assert.deepEqual(
    await value("select workshop_private.activate_brick_v4() value"),
    {
      "brick-breaker": 4,
      old_scores_deleted: 2,
      old_sessions_closed: 3,
    },
  );
  for (const id of [oldV3.id, oldActive.id]) {
    assert.equal(
      (await admin("read", a, { session_id: id })).code,
      "RULES_UPDATE_REQUIRED",
    );
    assert.equal(
      (await admin("finish", a, { session_id: id, metrics: {} })).code,
      "RULES_UPDATE_REQUIRED",
    );
  }
  assert.equal(
    await value(
      "select count(*)::int value from workshop_private.game_achievement_unlocks",
    ),
    unlockBefore,
  );
  assert.equal(
    await value(
      "select count(*)::int value from workshop_private.game_results where game<>'brick-breaker'",
    ),
    nonBrickBefore,
  );
  const args = { game: "brick-breaker", difficulty: "classic" };
  const newBoard = await rpc("get_game_leaderboard", args, "anon", null);
  assert.deepEqual(newBoard, { version: 4, top: [], me: null });
  await assert.rejects(
    rpc(
      "get_game_leaderboard_history",
      { ...args, rules_version: 1 },
      "anon",
      null,
    ),
    /Invalid game/,
  );
  const ranked = await admin("start", a, {
    game: "brick-breaker",
    difficulty: "classic",
    rules_version: 4,
    seed: 105,
  });
  const state = create("brick-breaker", "classic", ranked.seed, ranked.version);
  const events = [];
  while (state.status === "playing") {
    if (
      !state.balls[0].launched &&
      apply(state, { type: "launch", tick: state.ticks })
    )
      events.push([state.ticks, -1]);
    advanceBrick(state, state.ticks + 1);
  }
  await db.query(
    "update workshop_private.game_sessions set started_at=clock_timestamp()-interval '5 minutes' where id=$1",
    [ranked.id],
  );
  const handler = makeHandler(
    () => "https://fixture.test",
    async (url, init) => {
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: a });
      const call = JSON.parse(init.body);
      return Response.json(await admin(call.action, call.owner, call.body));
    },
  );
  const finish = () =>
    handler(
      new Request("https://fixture.test/games-session/finish", {
        method: "POST",
        headers: { Authorization: "Bearer fixture.valid.jwt" },
        body: JSON.stringify({
          session_id: ranked.id,
          events,
          events_format: "paddle-v4",
          final_tick: state.ticks,
        }),
      }),
    );
  const response = await finish();
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.version, 4);
  assert.equal(receipt.score, state.score);
  assert.equal(receipt.qualified, true);
  assert.deepEqual(await (await finish()).json(), receipt);
  assert.equal(
    (await rpc("get_game_leaderboard", args, "anon", null)).top[0].score,
    state.score,
  );
  await settle("brick-breaker", "classic", 4, 800);
  assert.equal(
    (await rpc("get_game_leaderboard", args, "anon", null)).top[0].score,
    800,
  );
  assert.equal(
    (await value("select workshop_private.activate_brick_v4() value"))
      .old_scores_deleted,
    0,
  );
  console.log(
    "PASS idempotent coins, resumed active time, scoped accounts, daily claims, unclaimed streaks, and transactional arcade cutover",
  );
} finally {
  await db.close();
}
