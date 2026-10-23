import assert from "node:assert/strict";
import {
  CONFIG,
  create,
  apply,
  validate,
  metrics,
  solution,
} from "../../src/games/puzzle-engine.js";
import { PUZZLE_BANK } from "../../src/games/puzzle-bank.js";
import {
  sudokuSolutions,
  sudokuRating,
  nonogramClues,
  nonogramSolutions,
} from "../../scripts/generate-puzzles.mjs";

let verified = 0;
for (const [game, modes] of Object.entries(PUZZLE_BANK))
  for (const [difficulty, items] of Object.entries(modes)) {
    assert.ok(items.length >= 30, `${game}/${difficulty} needs 30 puzzles`);
    assert.equal(
      new Set(items.map((p) => p.solution + (p.givens || ""))).size,
      items.length,
    );
    for (const item of items) {
      const answer = Array.from(item.solution, Number);
      if (game === "sudoku") {
        const givens = Array.from(item.givens, Number);
        const found = sudokuSolutions(givens);
        assert.equal(found.length, 1, `${item.id} is uniquely solvable`);
        assert.deepEqual(found[0], answer);
        assert.equal(sudokuRating(givens).tier, difficulty);
      } else {
        const clues = nonogramClues(answer, item.size);
        assert.deepEqual(clues.rows, item.rows);
        assert.deepEqual(clues.cols, item.cols);
        const found = nonogramSolutions(item.rows, item.cols, item.size);
        assert.equal(found.length, 1, `${item.id} is uniquely solvable`);
        assert.deepEqual(found[0], answer);
      }
      verified++;
    }
  }
assert.equal(
  sudokuSolutions(Array(81).fill(0)).length,
  2,
  "uniqueness solver detects ambiguous Sudoku",
);
assert.equal(
  sudokuSolutions(Array(81).fill(1)).length,
  0,
  "uniqueness solver rejects conflicting Sudoku",
);
assert.equal(
  nonogramSolutions([[1], [1]], [[1], [1]], 2).length,
  2,
  "uniqueness solver detects ambiguous Nonogram",
);
assert.equal(
  nonogramSolutions([[2], [2]], [[], []], 2).length,
  0,
  "uniqueness solver rejects inconsistent clues",
);

for (const [game, config] of Object.entries(CONFIG))
  for (const difficulty of Object.keys(config.modes)) {
    const state = create(game, difficulty, 987654321);
    assert.deepEqual(state, create(game, difficulty, 987654321));
    assert.equal(validate(state), state);
    assert.equal(metrics(state).won, false);
    const answer = solution(state);
    const cloneAnswer = solution(state);
    cloneAnswer[0] = -1;
    assert.notEqual(
      solution(state)[0],
      -1,
      "solution() returns an isolated copy",
    );
    const replayed = create(game, difficulty, state.seed);
    const events = [];
    if (game === "sudoku") {
      const given = state.givens.findIndex(Boolean);
      assert.equal(
        apply(state, { type: "digit", index: given, value: 0 }),
        false,
      );
      const editable = state.givens.findIndex((v) => !v);
      state.notes[editable] = [1, 2, 3];
      assert.equal(validate(state), state);
      assert.ok(
        apply(state, {
          type: "digit",
          index: editable,
          value: answer[editable] === 1 ? 2 : 1,
          t: 0,
        }),
      );
      assert.deepEqual(state.notes[editable], []);
      assert.equal(
        state.status,
        "playing",
        "incorrect values do not finish a puzzle",
      );
      assert.ok(
        apply(state, { type: "digit", index: editable, value: 0, t: 1 }),
      );
    } else {
      assert.ok(apply(state, { type: "cell", index: 0, value: 2, t: 0 }));
      assert.ok(apply(state, { type: "cell", index: 0, value: 0, t: 1 }));
    }
    // Replay a clean event sequence; corrections above are separately exercised.
    const clean = create(game, difficulty, state.seed);
    for (let index = 0; index < answer.length; index++) {
      if (game === "sudoku" && clean.givens[index]) continue;
      if (game === "nonogram" && !answer[index]) continue;
      const event = {
        type: game === "sudoku" ? "digit" : "cell",
        index,
        value: answer[index],
        t: index * 13,
      };
      assert.equal(apply(clean, event), true);
      events.push(event);
    }
    assert.equal(clean.status, "won");
    assert.equal(metrics(clean).won, true);
    validate(clean);
    for (const event of events) assert.equal(apply(replayed, event), true);
    assert.deepEqual(replayed, clean, "the same events replay identically");
    assert.equal(
      apply(clean, events[0]),
      false,
      "a completed puzzle cannot be edited",
    );
    for (const field of [
      "puzzleId",
      "version",
      "rng",
      "score",
      "status",
      "moves",
    ]) {
      const bad = structuredClone(state);
      bad[field] = field === "moves" ? 20001 : "malformed";
      assert.throws(() => validate(bad), `${field} is validated`);
    }
    const bad = structuredClone(state);
    bad.board.pop();
    assert.throws(() => validate(bad));
    const badValue = structuredClone(state);
    badValue.board[0] = 10;
    assert.throws(() => validate(badValue));
    const badWin = structuredClone(state);
    badWin.status = "won";
    assert.throws(() => validate(badWin), "forged completion is rejected");
    if (game === "sudoku") {
      const badGiven = structuredClone(state);
      badGiven.givens[0] = (badGiven.givens[0] + 1) % 10;
      assert.throws(() => validate(badGiven));
      const badNote = structuredClone(state);
      badNote.notes[state.givens.findIndex((v) => !v)] = [1, 1];
      assert.throws(() => validate(badNote));
    } else {
      const badClue = structuredClone(state);
      badClue.rows[0] = [100];
      assert.throws(() => validate(badClue));
    }
    assert.equal(apply(state, { type: "digit", index: -1, value: 1 }), false);
    assert.equal(apply(state, { type: "cell", index: 0.5, value: 1 }), false);
    assert.equal(apply(state, { type: "cell", index: 0, value: NaN }), false);
    assert.throws(() => create(game, difficulty, 0));
    assert.throws(() => create(game, difficulty, 4294967296));
  }
console.log(
  `Puzzle games passed: ${verified} independently uniqueness-checked puzzles; deterministic rules, corrections, replay and malformed-save checks.`,
);
