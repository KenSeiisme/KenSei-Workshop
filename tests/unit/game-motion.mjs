import assert from "node:assert/strict";
import {
  create,
  apply,
  advanceSnake,
  advanceBrick,
} from "../../src/games/engine.js";
import {
  tileDestinations,
  completedSudokuUnits,
  winningCells,
  interpolatePoint,
  matchedNonogramLines,
  shouldCelebrate,
} from "../../src/games/motion-state.js";

// 视觉移动映射必须与权威合并一致，不能因为重复数字产生多次合并。
for (let seed = 1; seed <= 250; seed++)
  for (let dir = 0; dir < 4; dir++) {
    const state = create("2048", "classic", seed);
    state.board = Array.from(
      { length: 16 },
      (_, i) => [0, 0, 2, 2, 4, 8, 16][(seed * 13 + i * 7 + i * i) % 7],
    );
    const original = structuredClone(state),
      mapping = tileDestinations(state.board, dir),
      expected = Array(16).fill(0);
    mapping.moves.forEach((move) => (expected[move.to] += move.value));
    const changed = apply(state, { type: "move", dir });
    if (changed) {
      const spawns = state.board.filter((value, i) => value !== expected[i]);
      assert.equal(spawns.length, 1);
      assert.ok([2, 4].includes(spawns[0]));
      state.board.forEach((value, i) => {
        if (expected[i]) assert.equal(value, expected[i]);
      });
      assert.equal(
        state.score - original.score,
        mapping.merged.reduce((sum, i) => sum + expected[i], 0),
      );
    } else assert.deepEqual(expected, state.board);
    assert.deepEqual(
      original.board,
      tileDestinations(original.board, dir).moves.reduce((out, m) => {
        out[m.from] = m.value;
        return out;
      }, Array(16).fill(0)),
    );
  }
assert.equal(
  completedSudokuUnits([1, 2, 3, 4, 5, 6, 7, 8, 9, ...Array(72).fill(0)])
    .length,
  1,
);
assert.equal(
  completedSudokuUnits([1, 1, 3, 4, 5, 6, 7, 8, 9, ...Array(72).fill(0)])
    .length,
  0,
);
assert.deepEqual(
  winningCells([...Array(35).fill(0), 1, 1, 1, 1, 0, 0, 0]),
  [35, 36, 37, 38],
);
assert.deepEqual(winningCells(Array(42).fill(0)), []);
assert.deepEqual(interpolatePoint({ x: 0, y: 2 }, { x: 10, y: 12 }, 0.5), {
  x: 5,
  y: 7,
});
assert.deepEqual(interpolatePoint({ x: 0, y: 0 }, { x: 10, y: 10 }, 2), {
  x: 10,
  y: 10,
});
const lines = matchedNonogramLines({
  size: 2,
  board: [1, 2, 0, 1],
  rows: [[1], [1]],
  cols: [[1], [1]],
});
assert.deepEqual(lines, { rows: [true, true], cols: [true, true] });
assert.equal(
  shouldCelebrate({
    game: "reversi",
    status: "won",
    difficulty: "ai-hard",
    winner: 2,
    humanSide: 1,
  }),
  false,
);
assert.equal(
  shouldCelebrate({
    game: "reversi",
    status: "won",
    difficulty: "ai-hard",
    winner: 2,
    humanSide: 2,
  }),
  true,
);
assert.equal(
  shouldCelebrate({
    game: "connect-four",
    status: "won",
    difficulty: "local",
    winner: 2,
  }),
  true,
);
assert.equal(
  shouldCelebrate({
    game: "connect-four",
    status: "draw",
    difficulty: "local",
    winner: 0,
  }),
  false,
);
console.log(
  "PASS 1,000 authoritative 2048 movement/merge mappings, local-only unit/clue detection and bounded interpolation.",
);
for (const game of ["snake", "brick-breaker"]) {
  let reference;
  for (const fps of [30, 60, 120, 144]) {
    const state = create(game, game === "snake" ? "normal" : "classic", 12345);
    if (game === "brick-breaker") apply(state, { type: "launch", tick: 0 });
    for (let frame = 1; frame <= fps * 3; frame++) {
      const tick = Math.floor((frame * (game === "snake" ? 10 : 60)) / fps);
      (game === "snake" ? advanceSnake : advanceBrick)(state, tick);
    }
    if (reference) assert.deepEqual(state, reference);
    else reference = state;
  }
}
console.log(
  "PASS identical Snake and Brick terminal/physics state across 30/60/120/144Hz frame groupings.",
);
