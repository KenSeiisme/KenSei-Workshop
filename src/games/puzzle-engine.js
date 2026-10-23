// Pure versioned puzzle rules, shared by browser and server. No DOM, clocks or generation.
import { PUZZLE_BANK } from "./puzzle-bank.js";

export const CONFIG = {
  sudoku: {
    name: "Sudoku",
    category: "Puzzle",
    ranked: true,
    default: "normal",
    modes: {
      easy: { label: "Easy · 9 × 9" },
      normal: { label: "Normal · 9 × 9" },
      hard: { label: "Hard · 9 × 9" },
    },
  },
  nonogram: {
    name: "Nonogram",
    category: "Puzzle",
    ranked: true,
    default: "normal",
    modes: {
      easy: { label: "Easy · 5 × 5", size: 5 },
      normal: { label: "Normal · 10 × 10", size: 10 },
      hard: { label: "Hard · 15 × 15", size: 15 },
    },
  },
};
function puzzle(game, difficulty, seed) {
  const items = PUZZLE_BANK[game]?.[difficulty];
  if (!items || !CONFIG[game]?.modes[difficulty])
    throw Error("Unknown puzzle or difficulty.");
  if (!Number.isInteger(seed) || seed < 1 || seed > 4294967295)
    throw Error("Invalid random seed.");
  // Mixing avoids adjacent seeds merely stepping through adjacent puzzles.
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return items[(value >>> 0) % items.length];
}
const digits = (text) => Array.from(text, Number);
export function create(game, difficulty, seed) {
  const item = puzzle(game, difficulty, seed);
  const state = {
    game,
    difficulty,
    version: 1,
    seed,
    rng: seed,
    score: 0,
    moves: 0,
    status: "playing",
    puzzleId: item.id,
    board:
      game === "sudoku" ? digits(item.givens) : Array(item.size ** 2).fill(0),
  };
  if (game === "sudoku") {
    state.givens = digits(item.givens);
    state.notes = Array.from({ length: 81 }, () => []);
  } else {
    state.size = item.size;
    state.rows = item.rows.map((row) => [...row]);
    state.cols = item.cols.map((col) => [...col]);
  }
  return state;
}
export function solution(state) {
  return digits(puzzle(state.game, state.difficulty, state.seed).solution);
}
function complete(state, item) {
  return state.game === "sudoku"
    ? state.board.every((value, i) => value === Number(item.solution[i]))
    : state.board.every(
        (value, i) => (value === 1) === (item.solution[i] === "1"),
      );
}
export function apply(state, event) {
  if (
    !state ||
    state.status !== "playing" ||
    !event ||
    !Number.isInteger(event.index) ||
    !Number.isInteger(event.value)
  )
    return false;
  const index = event.index;
  if (index < 0 || index >= state.board.length) return false;
  if (state.game === "sudoku") {
    if (
      event.type !== "digit" ||
      event.value < 0 ||
      event.value > 9 ||
      state.givens[index]
    )
      return false;
  } else if (state.game === "nonogram") {
    if (event.type !== "cell" || event.value < 0 || event.value > 2)
      return false;
  } else return false;
  if (state.board[index] === event.value) return false;
  state.board[index] = event.value;
  if (state.game === "sudoku" && state.notes) state.notes[index] = [];
  state.moves++;
  const item = puzzle(state.game, state.difficulty, state.seed);
  if (complete(state, item)) state.status = "won";
  return true;
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function validate(state) {
  if (!state || typeof state !== "object") throw Error("Invalid puzzle save.");
  const item = puzzle(state.game, state.difficulty, state.seed);
  const length = state.game === "sudoku" ? 81 : item.size ** 2;
  if (
    state.version !== 1 ||
    state.rng !== state.seed ||
    state.puzzleId !== item.id ||
    state.score !== 0 ||
    !Number.isInteger(state.moves) ||
    state.moves < 0 ||
    state.moves > 20000 ||
    !["playing", "won"].includes(state.status) ||
    !Array.isArray(state.board) ||
    state.board.length !== length ||
    state.board.some(
      (value) =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > (state.game === "sudoku" ? 9 : 2),
    )
  )
    throw Error("Invalid puzzle save.");
  if (state.game === "sudoku") {
    if (
      !same(state.givens, digits(item.givens)) ||
      state.givens.some((value, i) => value && state.board[i] !== value)
    )
      throw Error("Puzzle givens cannot be changed.");
    if (
      !Array.isArray(state.notes) ||
      state.notes.length !== 81 ||
      state.notes.some(
        (notes, i) =>
          !Array.isArray(notes) ||
          notes.length > 9 ||
          new Set(notes).size !== notes.length ||
          notes.some((n) => !Number.isInteger(n) || n < 1 || n > 9) ||
          (state.board[i] && notes.length),
      )
    )
      throw Error("Invalid Sudoku notes.");
  } else if (
    state.size !== item.size ||
    !same(state.rows, item.rows) ||
    !same(state.cols, item.cols)
  ) {
    throw Error("Puzzle clues cannot be changed.");
  }
  if ((state.status === "won") !== complete(state, item))
    throw Error("Invalid puzzle completion state.");
  return state;
}
export function metrics(state) {
  return {
    score: state.score,
    moves: state.moves,
    max_tile: 0,
    won: state.status === "won",
  };
}
