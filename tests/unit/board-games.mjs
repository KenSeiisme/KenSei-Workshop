import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import {
  CONFIG,
  create,
  apply,
  validate,
  metrics,
  legalMoves,
  reversiFlips,
  chooseMove,
} from "../../src/games/board-engine.js";

for (const game of Object.keys(CONFIG)) {
  assert.equal(CONFIG[game].ranked, false);
  assert.equal(CONFIG[game].category, "Board");
  for (const difficulty of Object.keys(CONFIG[game].modes)) {
    const s = create(game, difficulty, 42);
    assert.deepEqual(s, create(game, difficulty, 42));
    assert.equal(validate(s), s);
    const before = structuredClone(s),
      event = chooseMove(s);
    assert.deepEqual(s, before, "Choosing a move does not mutate the save.");
    assert.deepEqual(event, chooseMove(s));
    assert.ok(apply(s, event));
    validate(s);
  }
}
assert.throws(() => create("reversi", "ranked", 1), /difficulty/);
assert.throws(() => create("connect-four", "local", 0), /seed/);

const runColumns = (columns) => {
  const s = create("connect-four", "local", 10);
  for (const column of columns) {
    assert.ok(apply(s, { type: "drop", column }));
    validate(s);
  }
  return s;
};
for (const columns of [
  [0, 1, 0, 1, 0, 1, 0],
  [0, 0, 1, 1, 2, 2, 3],
  [0, 1, 1, 2, 4, 2, 2, 3, 4, 3, 5, 3, 3],
  [6, 5, 5, 4, 2, 4, 4, 3, 2, 3, 1, 3, 3],
]) {
  const s = runColumns(columns);
  assert.equal(s.status, "won");
  assert.equal(s.winner, 1);
  assert.equal(chooseMove(s), null);
  assert.equal(apply(s, { type: "drop", column: 6 }), false);
  assert.equal(metrics(s).won, true);
}
let s = runColumns([0, 0, 0, 0, 0, 0]);
assert.equal(apply(s, { type: "drop", column: 0 }), false);
const beforeInvalid = structuredClone(s);
for (const event of [
  { type: "disc", index: 0 },
  { type: "drop", column: -1 },
  { type: "drop", column: 1.5 },
  null,
])
  assert.equal(apply(s, event), false);
assert.deepEqual(s, beforeInvalid);

// Fill a real legal draw by choosing only moves that do not already win.
let draw = null;
for (let attempt = 1; !draw && attempt < 300; attempt++) {
  const candidate = create("connect-four", "local", attempt);
  let n = attempt;
  while (candidate.status === "playing") {
    const safe = legalMoves(candidate).filter((column) => {
      const next = structuredClone(candidate);
      apply(next, { type: "drop", column });
      return next.status !== "won";
    });
    if (!safe.length) break;
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    apply(candidate, { type: "drop", column: safe[n % safe.length] });
  }
  if (candidate.status === "draw") draw = candidate;
}
assert.ok(draw, "A full legal draw is supported.");
assert.equal(draw.moves, 42);
assert.equal(draw.winner, 0);
validate(draw);

for (const difficulty of ["ai-easy", "ai-normal", "ai-hard"]) {
  s = create("connect-four", difficulty, 1);
  for (const column of [0, 1, 0, 1, 0, 2]) apply(s, { type: "drop", column });
  assert.equal(chooseMove(s).column, 0, "Every level takes an immediate win.");
}
for (const difficulty of ["ai-normal", "ai-hard"]) {
  s = create("connect-four", difficulty, 1);
  for (const column of [4, 0, 4, 0, 5, 0]) apply(s, { type: "drop", column });
  assert.equal(
    chooseMove(s).column,
    0,
    "Search blocks an immediate vertical loss.",
  );
}

s = create("reversi", "local", 2);
assert.deepEqual(legalMoves(s), [19, 26, 37, 44]);
assert.deepEqual(reversiFlips(s.board, 19, 1), [27]);
assert.ok(apply(s, { type: "disc", index: 19 }));
assert.deepEqual(s.counts, [4, 1]);
assert.equal(s.turn, 2);
validate(s);
assert.equal(apply(s, { type: "disc", index: 19 }), false);
assert.equal(apply(s, { type: "disc", index: -1 }), false);
assert.equal(apply(s, { type: "drop", column: 3 }), false);

const surround = create("reversi", "local", 9);
surround.board.fill(0);
for (const [dx, dy] of [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]) {
  surround.board[(3 + dy) * 8 + 3 + dx] = 2;
  surround.board[(3 + dy * 2) * 8 + 3 + dx * 2] = 1;
}
surround.counts = [8, 8];
surround.score = 8;
surround.moves = 12;
assert.equal(reversiFlips(surround.board, 27, 1).length, 8);
assert.ok(apply(surround, { type: "disc", index: 27 }));
assert.deepEqual(surround.counts, [17, 0]);
assert.equal(surround.winner, 1);
assert.equal(surround.passCount, 2);
validate(surround);

let passed = false,
  terminal = false;
for (let seed = 1; seed <= 24; seed++) {
  const state = create("reversi", "local", seed);
  let random = seed;
  while (state.status === "playing") {
    const legal = legalMoves(state);
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const previous = state.turn;
    assert.ok(
      apply(state, { type: "disc", index: legal[random % legal.length] }),
    );
    validate(state);
    if (state.passCount === 1) {
      passed = true;
      assert.equal(state.turn, previous);
      assert.equal(state.lastSkipped, 3 - previous);
      assert.equal(legalMoves(state, 3 - previous).length, 0);
    }
  }
  terminal = true;
  assert.equal(state.passCount, 2);
  assert.equal(chooseMove(state), null);
  assert.equal(
    state.winner,
    state.counts[0] === state.counts[1]
      ? 0
      : state.counts[0] > state.counts[1]
        ? 1
        : 2,
  );
}
assert.ok(
  passed && terminal,
  "Reversi forced passes and terminal counting are exercised.",
);

for (const game of Object.keys(CONFIG)) {
  const good = create(game, "local", 2);
  for (const change of [
    { board: [] },
    { moves: -1 },
    { version: 99 },
    { rng: 0 },
    { turn: 0 },
    { status: "won", winner: 1 },
    { counts: [0, 123] },
    { score: Infinity },
    { lastMove: 999 },
    { passCount: 8 },
  ])
    assert.throws(() => validate({ ...good, ...change }));
}
const floating = create("connect-four", "local", 1);
floating.board[0] = 1;
floating.moves = 1;
floating.turn = 2;
floating.counts = [1, 0];
assert.throws(() => validate(floating), /float/);

const measurements = [];
for (const game of Object.keys(CONFIG)) {
  const state = create(game, "ai-hard", 137);
  for (let i = 0; i < 12 && state.status === "playing"; i++) {
    const available = legalMoves(state),
      move = available[(i * 7 + 3) % available.length];
    apply(
      state,
      game === "connect-four"
        ? { type: "drop", column: move }
        : { type: "disc", index: move },
    );
  }
  if (state.status === "playing") {
    const started = performance.now(),
      event = chooseMove(state),
      elapsed = performance.now() - started;
    assert.ok(apply(structuredClone(state), event));
    assert.ok(elapsed < 4000, `${game} bounded search took ${elapsed}ms`);
    measurements.push(`${game}: ${elapsed.toFixed(0)}ms`);
  }
}

const replies = [];
globalThis.self = { postMessage: (reply) => replies.push(reply) };
await import("../../src/games/board-ai-worker.js");
self.onmessage({
  data: { id: "move-1", state: create("reversi", "ai-normal", 22) },
});
assert.equal(replies[0].id, "move-1");
assert.equal(replies[0].event.type, "disc");
self.onmessage({ data: { id: "invalid", state: {} } });
assert.equal(replies[1].id, "invalid");
assert.equal(typeof replies[1].error, "string");
delete globalThis.self;
const workerModule = new URL(
  "../../src/games/board-ai-worker.js",
  import.meta.url,
).href;
const worker = new Worker(
  new URL(
    `data:text/javascript,${encodeURIComponent(`
  import { parentPort } from 'node:worker_threads';
  globalThis.self = { postMessage: value => parentPort.postMessage(value) };
  await import(${JSON.stringify(workerModule)});
  parentPort.on('message', data => self.onmessage({ data }));
`)}`,
  ),
);
try {
  const reply = new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  worker.postMessage({
    id: "dedicated-thread",
    state: create("connect-four", "ai-hard", 81),
  });
  const message = await reply;
  assert.equal(message.id, "dedicated-thread");
  assert.ok(apply(create("connect-four", "ai-hard", 81), message.event));
} finally {
  await worker.terminate();
}
console.log(
  `PASS board games: directional wins, draw, Reversi flips/pass/end, AI, saves, worker protocol; ${measurements.join(", ")}`,
);
