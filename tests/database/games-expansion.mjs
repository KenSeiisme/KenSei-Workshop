import assert from "node:assert/strict";
import { gameDatabase } from "../support/games-fixture.mjs";
import {
  create,
  validateSave,
  GAMES,
  isRanked,
} from "../../src/games/engine.js";

const {
  db,
  users: [a, b],
  as,
  value,
  rpc,
  admin,
} = await gameDatabase();
const newGames = [
  "sudoku",
  "nonogram",
  "block-puzzle",
  "brick-breaker",
  "connect-four",
  "reversi",
];
const saved = new Map();
const save = (
  user,
  record_id,
  payload,
  base_revision = 0,
  operation_id = crypto.randomUUID(),
) =>
  rpc(
    "save_game_save",
    {
      kind: "game",
      record_id,
      payload,
      base_revision,
      operation_id,
      remove_record: false,
      expected_user: user,
    },
    "authenticated",
    user,
  );

for (const game of newGames) {
  const difficulty = GAMES[game].default;
  const data = validateSave({
    game,
    difficulty,
    state: create(game, difficulty, 12),
    elapsed: 0,
  });
  const id = crypto.randomUUID(),
    operation = crypto.randomUUID();
  const record = await save(a, id, data, 0, operation);
  assert.equal(record.revision, 1);
  assert.equal(record.data.game, game);
  assert.equal(
    (await save(a, id, data, 0, operation)).revision,
    1,
    "Same mutation is idempotent.",
  );
  saved.set(game, { id, data });
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
  await as("authenticated", b, async () =>
    assert.equal(
      await value("select count(*)::integer as value from public.game_saves"),
      0,
    ),
  );
}
assert.equal(
  (
    await rpc(
      "get_game_saves",
      {
        kind: "game",
        before_time: null,
        before_id: null,
        page_size: 25,
        expected_user: a,
      },
      "authenticated",
      a,
    )
  ).length,
  6,
);
await assert.rejects(
  () =>
    rpc(
      "get_game_saves",
      {
        kind: "game",
        before_time: null,
        before_id: null,
        page_size: 25,
        expected_user: a,
      },
      "anon",
      null,
    ),
  /permission denied/,
);
await as("authenticated", a, () =>
  assert.rejects(
    () =>
      db.query(
        "insert into public.game_saves(user_id,id,data) values($1,$2,$3)",
        [b, crypto.randomUUID(), saved.get("sudoku").data],
      ),
    /permission denied/,
  ),
);
const source = saved.get("reversi"),
  changeOp = crypto.randomUUID();
const updated = await save(a, source.id, { ...source.data, elapsed: 700 }, 1);
const conflict = await save(
  a,
  source.id,
  { ...source.data, elapsed: 400 },
  1,
  changeOp,
);
assert.equal(updated.revision, 2);
assert.equal(conflict.conflict, true);
assert.equal(conflict.id, changeOp);
assert.equal(
  (await save(a, source.id, { ...source.data, elapsed: 400 }, 1, changeOp)).id,
  conflict.id,
);
const sameIdOtherAccount = await save(b, source.id, source.data);
assert.equal(sameIdOtherAccount.revision, 1);
assert.equal(
  (
    await rpc(
      "get_game_save",
      { kind: "game", record_id: source.id, expected_user: a },
      "authenticated",
      a,
    )
  ).data.elapsed,
  700,
);
await rpc(
  "clear_game_saves",
  { kind: "game", operation_id: crypto.randomUUID(), expected_user: b },
  "authenticated",
  b,
);
assert.equal(
  (
    await rpc(
      "get_game_save",
      { kind: "game", record_id: source.id, expected_user: a },
      "authenticated",
      a,
    )
  ).deleted,
  false,
);

for (const game of ["connect-four", "reversi"]) {
  assert.equal(isRanked(game), false);
  for (const difficulty of Object.keys(GAMES[game].modes)) {
    await assert.rejects(
      () => admin("start", a, { game, difficulty, seed: 1 }),
      /Invalid game/,
    );
    await assert.rejects(
      () => rpc("get_game_leaderboard", { game, difficulty }, "anon", null),
      /Invalid game or difficulty/,
    );
  }
}
assert.equal(Object.keys(GAMES).length, 11);
assert.equal(Object.keys(GAMES).filter(isRanked).length, 9);
await as("authenticated", a, () =>
  assert.rejects(
    () => db.query("select * from workshop_private.game_results"),
    /permission denied/,
  ),
);
await assert.rejects(
  () =>
    rpc("games_admin", {
      action: "start",
      owner: a,
      body: { game: "sudoku", difficulty: "easy", seed: 1 },
    }),
  /permission denied/,
);

const complete = async (
  user,
  game,
  difficulty,
  {
    score = 0,
    moves = 1,
    duration = 10000,
    max_tile = 0,
    won = true,
    lines = 0,
  } = {},
) => {
  // Move completed fixture sessions outside the per-minute start window.
  await db.query(
    "update workshop_private.game_sessions set started_at=clock_timestamp()-interval '2 minutes' where status='completed'",
  );
  const session = await admin("start", user, { game, difficulty, seed: 8 });
  await db.query(
    "update workshop_private.game_sessions set started_at=clock_timestamp()-($1::integer*interval '1 millisecond') where id=$2",
    [duration, session.id],
  );
  return admin("finish", user, {
    session_id: session.id,
    metrics: {
      score,
      moves,
      max_tile,
      won,
      ...(game === "block-drop" ? { lines } : {}),
    },
  });
};
const leaderboard = (game, difficulty, user = a) =>
  rpc(
    "get_game_leaderboard",
    { game, difficulty },
    user ? "authenticated" : "anon",
    user,
  );

for (const game of ["sudoku", "nonogram"]) {
  const declined = await complete(a, game, "hard", { won: false });
  assert.equal(declined.result.qualified, false);
  assert.match(declined.result.reason, /completed wins/);
  assert.equal((await leaderboard(game, "hard")).top.length, 0);
  await complete(a, game, "easy", { duration: 7000 });
  await complete(b, game, "easy", { duration: 3000 });
  let board = await leaderboard(game, "easy");
  assert.equal(board.top.length, 2);
  assert.equal(board.me.rank, 2);
  assert.ok(board.top[0].elapsed_ms < board.top[1].elapsed_ms);
  await complete(a, game, "easy", { duration: 2000 });
  board = await leaderboard(game, "easy");
  assert.equal(board.top.length, 2);
  assert.equal(board.me.rank, 1);
  assert.ok(board.me.elapsed_ms < 3000);
}
await complete(a, "block-puzzle", "classic", { score: 80, moves: 10 });
await complete(b, "block-puzzle", "classic", { score: 100, moves: 12 });
await complete(a, "block-puzzle", "classic", { score: 70, moves: 8 });
let board = await leaderboard("block-puzzle", "classic");
assert.equal(board.top.length, 2);
assert.equal(board.me.score, 80);
assert.equal(board.me.rank, 2);
assert.equal(board.top[0].score, 100);
const firstBrick = await complete(a, "brick-breaker", "classic", {
  score: 100,
  duration: 9000,
});
await complete(b, "brick-breaker", "classic", { score: 100, duration: 4000 });
board = await leaderboard("brick-breaker", "classic");
assert.equal(board.me.rank, 2);
assert.ok(board.top[0].elapsed_ms < board.top[1].elapsed_ms);
await complete(a, "brick-breaker", "classic", { score: 110, duration: 15000 });
board = await leaderboard("brick-breaker", "classic");
assert.equal(board.me.rank, 1);
assert.equal(board.me.score, 110);
const idempotent = await admin("finish", a, {
  session_id: firstBrick.id,
  metrics: { score: 9999, moves: 1, max_tile: 0, won: true },
});
assert.deepEqual(idempotent.result, firstBrick.result);

// Existing version-1 game scores and typing fields survive the expansion.
for (const game of ["2048", "minesweeper", "snake", "memory-match"])
  await complete(a, game, GAMES[game].default, {
    score: ["2048", "snake"].includes(game) ? 100 : 0,
    max_tile: game === "2048" ? 32 : 0,
  });
await complete(a, "block-drop", "classic", { score: 500, lines: 10 });
for (const game of Object.keys(GAMES).filter(isRanked)) {
  const difficulty = ["sudoku", "nonogram"].includes(game)
    ? "easy"
    : GAMES[game].default;
  const data = await leaderboard(game, difficulty);
  assert.ok(data.me);
  assert.equal(data.version, 1);
}
const profileId = (await leaderboard("2048", "classic")).me.public_id;
const profile = await rpc(
  "get_public_profile",
  { profile_id: profileId },
  "anon",
  null,
);
assert.equal(profile.game_best_scores.length, 9);
assert.deepEqual(
  new Set(profile.game_best_scores.map((entry) => entry.game)),
  new Set(Object.keys(GAMES).filter(isRanked)),
);
assert.ok(Array.isArray(profile.best_scores));
assert.equal(
  profile.game_best_scores.find((entry) => entry.game === "block-puzzle").score,
  80,
  "Profile uses highest score rather than latest result.",
);
assert.equal(
  profile.game_best_scores.find((entry) => entry.game === "brick-breaker")
    .score,
  110,
  "Profile uses score before the Brick duration tiebreak.",
);
for (const game of ["sudoku", "nonogram"])
  assert.ok(
    profile.game_best_scores.find((entry) => entry.game === game).elapsed_ms <
      3000,
    "Profile and leaderboard use the same fastest puzzle result.",
  );
assert.ok(
  !profile.game_best_scores.some((entry) =>
    ["connect-four", "reversi"].includes(entry.game),
  ),
);
assert.ok(
  !JSON.stringify(profile).match(/"(user_id|state|seed|events|email)":/),
);
assert.ok(
  !profile.game_best_scores.some(
    (entry) => entry.game === "sudoku" && entry.difficulty === "hard",
  ),
);
await rpc(
  "update_my_profile",
  {
    patch: { nickname: "New Board Name 中文", bio: "", avatar_kind: "none" },
    expected_user: a,
  },
  "authenticated",
  a,
);
board = await leaderboard("block-puzzle", "classic", null);
assert.equal(
  board.top.find((entry) => entry.public_id === profileId).nickname,
  "New Board Name 中文",
);
assert.ok(!JSON.stringify(board).match(/"(user_id|state|seed|events|email)":/));

console.log(
  "PASS expansion DB: six private saves/RLS, retries/conflicts/account isolation, private-only boards, wins-only puzzles, Block/Brick ordering, idempotence, nine public game bests and old-score compatibility.",
);
await db.close();
