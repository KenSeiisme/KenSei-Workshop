import assert from "node:assert/strict";
import { gameDatabase } from "../support/games-fixture.mjs";
import { create, validateSave } from "../../src/games/engine.js";
const {
  db,
  users: [a, b],
  as,
  value,
  rpc,
  admin,
} = await gameDatabase();
const payload = validateSave({
    game: "2048",
    difficulty: "classic",
    state: create("2048", "classic", 42),
    elapsed: 0,
  }),
  id = crypto.randomUUID();
const save = (
  user,
  record_id,
  data,
  base_revision,
  operation_id = crypto.randomUUID(),
  remove_record = false,
) =>
  rpc(
    "save_game_save",
    {
      kind: "game",
      record_id,
      payload: data,
      base_revision,
      operation_id,
      remove_record,
      expected_user: user,
    },
    "authenticated",
    user,
  );
let row = await save(a, id, payload, 0);
assert.equal(row.revision, 1);
assert.equal(
  (
    await rpc(
      "get_game_saves",
      {
        kind: "game",
        before_time: null,
        before_id: null,
        page_size: 25,
        expected_user: b,
      },
      "authenticated",
      b,
    )
  ).length,
  0,
);
assert.equal(
  await rpc(
    "get_game_save",
    { kind: "game", record_id: id, expected_user: b },
    "authenticated",
    b,
  ),
  null,
);
await assert.rejects(
  () =>
    rpc(
      "get_game_save",
      { kind: "game", record_id: id, expected_user: a },
      "authenticated",
      b,
    ),
  /Account changed/,
);
await assert.rejects(
  () => save(a, id, { ...payload, state: {} }, 1),
  /Invalid/,
);
await as("authenticated", a, () =>
  assert.rejects(
    () =>
      db.query(
        "insert into public.game_saves(user_id,id,data) values($1,$2,$3)",
        [a, crypto.randomUUID(), payload],
      ),
    /permission denied/,
  ),
);
const op = crypto.randomUUID(),
  changed = { ...payload, elapsed: 100 };
row = await save(a, id, changed, 1, op);
assert.equal(row.revision, 2);
let retry = await save(a, id, changed, 1, op);
assert.equal(retry.revision, 2);
const conflictOp = crypto.randomUUID(),
  copy = await save(a, id, { ...payload, elapsed: 200 }, 1, conflictOp);
assert.equal(copy.conflict, true);
assert.equal(copy.id, conflictOp);
assert.equal(
  (await save(a, id, { ...payload, elapsed: 200 }, 1, conflictOp)).id,
  copy.id,
);
assert.equal(
  (await save(a, id, {}, 2, crypto.randomUUID(), true)).deleted,
  true,
);
await as("anon", null, () =>
  assert.rejects(
    () =>
      value("select public.get_game_saves('game',null,null,25,$1) value", [a]),
    /permission denied/,
  ),
);
await assert.rejects(
  () =>
    rpc("games_admin", {
      action: "start",
      owner: a,
      body: { game: "snake", difficulty: "normal", seed: 1 },
    }),
  /permission denied/,
);
await as("authenticated", a, () =>
  assert.rejects(
    () => db.query("select * from workshop_private.game_results"),
    /permission denied/,
  ),
);
let first = await admin("start", a, {
  game: "snake",
  difficulty: "normal",
  seed: 4,
});
let second = await admin("start", a, {
  game: "snake",
  difficulty: "normal",
  seed: 5,
});
await assert.rejects(
  () => admin("read", a, { session_id: first.id }),
  /interrupted/,
);
await assert.rejects(
  () => admin("read", b, { session_id: second.id }),
  /not found/,
);
const complete = async (
  user,
  game,
  difficulty,
  score,
  moves,
  duration,
  max_tile = 0,
) => {
  const session = await admin("start", user, { game, difficulty, seed: 8 });
  await db.query(
    "update workshop_private.game_sessions set started_at=clock_timestamp()-($1::integer*interval '1 millisecond') where id=$2",
    [duration, session.id],
  );
  return admin("finish", user, {
    session_id: session.id,
    metrics: { score, moves, max_tile, won: true },
  });
};
const finished = await complete(a, "snake", "normal", 80, 15, 3000);
const repeat = await admin("finish", a, {
  session_id: finished.id,
  metrics: { score: 999, moves: 2, max_tile: 0, won: true },
});
assert.deepEqual(repeat.result, finished.result);
await complete(a, "snake", "normal", 60, 10, 2000);
await complete(b, "snake", "normal", 90, 12, 2000);
let board = await rpc(
  "get_game_leaderboard",
  { game: "snake", difficulty: "normal" },
  "authenticated",
  a,
);
assert.equal(board.top.length, 2);
assert.equal(board.me.rank, 2);
assert.equal(board.me.score, 80);
await complete(a, "memory-match", "normal", 0, 8, 5000);
await complete(b, "memory-match", "normal", 0, 9, 1000);
board = await rpc(
  "get_game_leaderboard",
  { game: "memory-match", difficulty: "normal" },
  "anon",
  null,
);
assert.equal(board.top[0].moves, 8);
await complete(a, "minesweeper", "beginner", 0, 30, 5000);
await complete(b, "minesweeper", "beginner", 0, 50, 1000);
board = await rpc(
  "get_game_leaderboard",
  { game: "minesweeper", difficulty: "beginner" },
  "anon",
  null,
);
assert.ok(board.top[0].elapsed_ms < 2000);
const lost = await admin("start", a, {
  game: "minesweeper",
  difficulty: "expert",
  seed: 12,
});
const declined = await admin("finish", a, {
  session_id: lost.id,
  metrics: { score: 0, moves: 2, max_tile: 0, won: false },
});
assert.equal(declined.result.qualified, false);
await rpc(
  "update_my_profile",
  {
    patch: { nickname: "最新 Game Name", bio: "", avatar_kind: "none" },
    expected_user: a,
  },
  "authenticated",
  a,
);
board = await rpc(
  "get_game_leaderboard",
  { game: "snake", difficulty: "normal" },
  "anon",
  null,
);
assert.equal(board.top[1].nickname, "最新 Game Name");
const profile = await rpc(
  "get_public_profile",
  { profile_id: board.top[1].public_id },
  "anon",
  null,
);
assert.equal(profile.game_best_scores.length, 3);
assert.ok(Array.isArray(profile.best_scores));
for (const data of [profile, board])
  assert.ok(!JSON.stringify(data).match(/user_id|@|replay|seed|state|email/));
await complete(a, "2048", "classic", 100, 20, 4000, 16);
await complete(b, "2048", "classic", 100, 20, 5000, 32);
board = await rpc(
  "get_game_leaderboard",
  { game: "2048", difficulty: "classic" },
  "anon",
  null,
);
assert.equal(board.top[0].max_tile, 32);
await complete(b, "memory-match", "normal", 0, 8, 1000);
board = await rpc(
  "get_game_leaderboard",
  { game: "memory-match", difficulty: "normal" },
  "anon",
  null,
);
assert.ok(board.top[0].elapsed_ms < 2000);
await db.exec(
  "with members as (insert into auth.users(id) select gen_random_uuid() from generate_series(1,55) returning id) insert into public.typing_profiles(user_id,nickname) select id,'Board_'||left(id::text,24) from members;",
);
await db.exec(
  "with sessions as (insert into workshop_private.game_sessions(user_id,game,difficulty,seed,status) select user_id,'snake','normal',1,'completed' from public.typing_profiles where nickname like 'Board_%' returning id,user_id) insert into workshop_private.game_results(session_id,user_id,game,difficulty,version,score,max_tile,moves,elapsed_ms) select id,user_id,'snake','normal',1,100+row_number() over(),0,10,2000 from sessions;",
);
board = await rpc(
  "get_game_leaderboard",
  { game: "snake", difficulty: "normal" },
  "authenticated",
  a,
);
assert.equal(board.top.length, 50);
assert.equal(board.me.rank, 57);
const expired = await admin("start", b, {
  game: "snake",
  difficulty: "slow",
  seed: 8,
});
await db.query(
  "update workshop_private.game_sessions set expires_at=clock_timestamp()-interval '1 minute' where id=$1",
  [expired.id],
);
await assert.rejects(
  () => admin("read", b, { session_id: expired.id }),
  /expired/,
);
console.log(
  "PASS game migrations, private saves, conflicts, idempotent retries, session ownership, ranking order, latest profiles and public privacy",
);
await db.close();
