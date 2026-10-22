import assert from "node:assert/strict";
import {
  create,
  apply,
  advanceSnake,
  metrics,
  replay,
  validateSave,
  GAMES,
} from "../../src/games/engine.js";
for (const [game, settings] of Object.entries(GAMES))
  for (const difficulty of Object.keys(settings.modes)) {
    assert.deepEqual(
      create(game, difficulty, 42),
      create(game, difficulty, 42),
    );
    const s = create(game, difficulty, 42);
    assert.deepEqual(
      validateSave({ game, difficulty, state: s, elapsed: 0 }).state,
      s,
    );
  }
let s = create("2048", "classic", 123);
s.board = [2, 2, 2, 2, ...Array(12).fill(0)];
assert.ok(apply(s, { type: "move", dir: 3 }));
assert.deepEqual(s.board.slice(0, 2), [4, 4]);
assert.equal(s.score, 8);
s = create("2048", "classic", 2);
const actions = [];
let t = 0;
for (let i = 0; s.status === "playing" && i < 10000; i++) {
  const e = {
    type: "move",
    dir: (i * 7 + Math.floor(i / 4)) % 4,
    t: (t += 10),
  };
  if (apply(s, e)) actions.push(e);
}
assert.notEqual(s.status, "playing");
assert.deepEqual(replay("2048", "classic", 2, actions, 0, t), {
  ...metrics(s),
  elapsed_ms: t,
});
assert.throws(
  () => replay("2048", "classic", 2, actions.slice(0, 1), 0, t),
  /not finished/,
);
assert.throws(
  () => replay("2048", "classic", 2, [{ type: "move", dir: 99, t: 0 }], 0, t),
  /Invalid game action/,
);
for (const difficulty of ["beginner", "intermediate", "expert"])
  for (const seed of [1, 42, 123456]) {
    const m = GAMES.minesweeper.modes[difficulty],
      first = Math.floor(m.h / 2) * m.w + Math.floor(m.w / 2),
      state = create("minesweeper", difficulty, seed),
      ev = [{ type: "reveal", index: first, t: 1 }];
    apply(state, ev[0]);
    assert.equal(state.board[first], 0);
    assert.equal(state.board.filter((x) => x === -1).length, m.mines);
    for (let i = 0; i < state.board.length && state.status === "playing"; i++)
      if (state.board[i] !== -1 && !state.revealed.includes(i)) {
        const e = { type: "reveal", index: i, t: ev.length + 1 };
        apply(state, e);
        ev.push(e);
      }
    assert.equal(state.status, "won");
    assert.equal(
      replay("minesweeper", difficulty, seed, ev, 0, 10000).won,
      true,
    );
  }
s = create("minesweeper", "beginner", 20);
assert.ok(apply(s, { type: "flag", index: 0 }));
assert.equal(apply(s, { type: "reveal", index: 0 }), false);
assert.ok(apply(s, { type: "flag", index: 0 }));
assert.ok(apply(s, { type: "reveal", index: 0 }));
for (const difficulty of ["slow", "normal", "fast"]) {
  const a = create("snake", difficulty, 12),
    b = structuredClone(a);
  advanceSnake(a, 5);
  for (let i = 1; i <= 5; i++) advanceSnake(b, i);
  assert.deepEqual(a, b);
  const state = create("snake", difficulty, 12);
  assert.equal(apply(state, { type: "turn", dir: 3 }), false);
  assert.ok(apply(state, { type: "turn", dir: 0 }));
  assert.equal(apply(state, { type: "turn", dir: 3 }), false);
  advanceSnake(state, 11);
  assert.equal(state.status, "lost");
  const rate = GAMES.snake.modes[difficulty].rate;
  assert.deepEqual(
    replay(
      "snake",
      difficulty,
      12,
      [{ type: "turn", dir: 0, tick: 0, t: 0 }],
      11,
      Math.ceil(11000 / rate),
    ),
    { ...metrics(state), elapsed_ms: Math.ceil(11000 / rate) },
  );
  assert.throws(
    () => replay("snake", difficulty, 12, [], 10, 10),
    /Impossible/,
  );
}
for (const difficulty of ["easy", "normal", "hard"]) {
  const seed = 24,
    state = create("memory-match", difficulty, seed),
    ev = [];
  let time = 0;
  for (let p = 0; p < GAMES["memory-match"].modes[difficulty].pairs; p++)
    for (let i = 0; i < state.cards.length; i++)
      if (state.cards[i] === p) {
        const e = { type: "flip", index: i, t: (time += 20) };
        assert.ok(apply(state, e));
        ev.push(e);
      }
  assert.equal(state.status, "won");
  assert.equal(state.moves, GAMES["memory-match"].modes[difficulty].pairs);
  assert.ok(replay("memory-match", difficulty, seed, ev, 0, time).won);
}
s = create("memory-match", "normal", 77);
let i = s.cards.findIndex((x) => x !== s.cards[0]);
apply(s, { type: "flip", index: 0, t: 0 });
apply(s, { type: "flip", index: i, t: 1 });
assert.equal(
  apply(s, {
    type: "flip",
    index: s.cards.findIndex((_, n) => n !== 0 && n !== i),
    t: 100,
  }),
  false,
);
const broken = create("2048", "classic", 1);
broken.board[0] = "<img>";
assert.throws(
  () =>
    validateSave({
      game: "2048",
      difficulty: "classic",
      state: broken,
      elapsed: 0,
    }),
  /Invalid/,
);
assert.throws(() => create("snake", "fake", 1), /Unknown/);
// 走完整个安全回路，覆盖长局、吃满棋盘与 Edge 复算预算。
const cycle = [];
for (let x = 0; x < 20; x++) cycle.push(x);
for (let x = 19; x >= 1; x--)
  for (let n = 1; n < 20; n++) {
    const y = x % 2 ? n : 20 - n;
    cycle.push(y * 20 + x);
  }
for (let y = 19; y >= 1; y--) cycle.push(y * 20);
const longGame = create("snake", "normal", 42),
  longEvents = [];
let at = cycle.indexOf(longGame.body[0]);
while (longGame.status === "playing" && longGame.ticks < 72000) {
  const next = cycle[(at + 1) % 400],
    head = longGame.body[0],
    dir =
      next === head - 20
        ? 0
        : next === head + 1
          ? 1
          : next === head + 20
            ? 2
            : 3;
  if (dir !== longGame.dir) {
    const e = {
      type: "turn",
      dir,
      tick: longGame.ticks,
      t: longGame.ticks * 100,
    };
    assert.ok(apply(longGame, e));
    longEvents.push(e);
  }
  advanceSnake(longGame, longGame.ticks + 1);
  at = (at + 1) % 400;
}
assert.equal(longGame.status, "won");
assert.equal(longGame.body.length, 400);
assert.equal(longGame.score, 3960);
const began = performance.now();
assert.equal(
  replay(
    "snake",
    "normal",
    42,
    longEvents,
    longGame.ticks,
    longGame.ticks * 100,
  ).score,
  3960,
);
assert.ok(performance.now() - began < 1500);
console.log(
  "PASS four game rules, deterministic replays, first-click safety, merge order, input locks, fixed ticks and save validation",
);
