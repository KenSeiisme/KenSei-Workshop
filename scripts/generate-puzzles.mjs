// Original deterministic puzzle generation. Run once at development time, never in a browser.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function rng(seed) {
  let value = seed >>> 0;
  return (n) => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    return Math.floor((value / 4294967296) * n);
  };
}
function shuffle(values, random) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
const UNITS = Array.from({ length: 27 }, (_, unit) =>
  Array.from({ length: 9 }, (_, k) =>
    unit < 9
      ? unit * 9 + k
      : unit < 18
        ? k * 9 + unit - 9
        : (Math.floor((unit - 18) / 3) * 3 + Math.floor(k / 3)) * 9 +
          ((unit - 18) % 3) * 3 +
          (k % 3),
  ),
);
const PEERS = Array.from({ length: 81 }, (_, i) => [
  ...new Set(
    UNITS.filter((u) => u.includes(i))
      .flat()
      .filter((j) => j !== i),
  ),
]);
function candidates(board, index) {
  const used = new Set(PEERS[index].map((j) => board[j]));
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !used.has(n));
}
export function sudokuSolutions(input, limit = 2, random = null) {
  const board = [...input],
    solutions = [];
  if (
    board.length !== 81 ||
    board.some((v) => !Number.isInteger(v) || v < 0 || v > 9)
  )
    return solutions;
  if (board.some((v, i) => v && PEERS[i].some((j) => board[j] === v)))
    return solutions;
  function search() {
    if (solutions.length >= limit) return;
    let index = -1,
      choices = [];
    for (let i = 0; i < 81; i++)
      if (!board[i]) {
        const next = candidates(board, i);
        if (!next.length) return;
        if (index === -1 || next.length < choices.length) {
          index = i;
          choices = next;
        }
        if (choices.length === 1) break;
      }
    if (index === -1) {
      solutions.push([...board]);
      return;
    }
    if (random) shuffle(choices, random);
    for (const digit of choices) {
      board[index] = digit;
      search();
      if (solutions.length >= limit) break;
    }
    board[index] = 0;
  }
  search();
  return solutions;
}
// Difficulty is a reproducible solver threshold, not a claim about human solving time.
export function sudokuRating(input) {
  const board = [...input];
  let hiddenSingles = 0;
  while (board.includes(0)) {
    let changed = false;
    for (let i = 0; i < 81; i++)
      if (!board[i]) {
        const choices = candidates(board, i);
        if (!choices.length) return { tier: "invalid", hiddenSingles };
        if (choices.length === 1) {
          board[i] = choices[0];
          changed = true;
        }
      }
    if (changed) continue;
    outer: for (const unit of UNITS)
      for (let digit = 1; digit <= 9; digit++) {
        if (unit.some((i) => board[i] === digit)) continue;
        const possible = unit.filter(
          (i) => !board[i] && candidates(board, i).includes(digit),
        );
        if (possible.length === 1) {
          board[possible[0]] = digit;
          hiddenSingles++;
          changed = true;
          break outer;
        }
      }
    if (!changed) return { tier: "hard", hiddenSingles };
  }
  return { tier: hiddenSingles ? "normal" : "easy", hiddenSingles };
}
export function lineClues(cells) {
  const runs = [];
  let run = 0;
  for (const cell of cells) {
    if (cell) run++;
    else if (run) {
      runs.push(run);
      run = 0;
    }
  }
  if (run) runs.push(run);
  return runs;
}
export function nonogramClues(board, size) {
  return {
    rows: Array.from({ length: size }, (_, y) =>
      lineClues(board.slice(y * size, (y + 1) * size)),
    ),
    cols: Array.from({ length: size }, (_, x) =>
      lineClues(Array.from({ length: size }, (_, y) => board[y * size + x])),
    ),
  };
}
function linePatterns(clues, size) {
  if (!clues.length) return [0];
  const patterns = [];
  function place(k, start, mask) {
    const remaining = clues.slice(k + 1).reduce((a, b) => a + b + 1, 0);
    for (let pos = start; pos <= size - clues[k] - remaining; pos++) {
      const next = mask | (((1 << clues[k]) - 1) << pos);
      if (k === clues.length - 1) patterns.push(next);
      else place(k + 1, pos + clues[k] + 1, next);
    }
  }
  place(0, 0, 0);
  return patterns;
}
export function nonogramSolutions(
  rows,
  cols,
  size,
  limit = 2,
  nodeBudget = 20000,
) {
  let nodes = 0;
  const found = [];
  function search(rowOptions, colOptions) {
    if (++nodes > nodeBudget)
      throw Error("Nonogram solver node budget exceeded.");
    if (found.length >= limit) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (let y = 0; y < size; y++) {
        const next = rowOptions[y].filter((row) =>
          colOptions.every((opts, x) =>
            opts.some((col) => ((row >>> x) & 1) === ((col >>> y) & 1)),
          ),
        );
        if (!next.length) return;
        if (next.length !== rowOptions[y].length) {
          rowOptions[y] = next;
          changed = true;
        }
      }
      for (let x = 0; x < size; x++) {
        const next = colOptions[x].filter((col) =>
          rowOptions.every((opts, y) =>
            opts.some((row) => ((row >>> x) & 1) === ((col >>> y) & 1)),
          ),
        );
        if (!next.length) return;
        if (next.length !== colOptions[x].length) {
          colOptions[x] = next;
          changed = true;
        }
      }
    }
    let branch = -1;
    for (let y = 0; y < size; y++)
      if (
        rowOptions[y].length > 1 &&
        (branch < 0 || rowOptions[y].length < rowOptions[branch].length)
      )
        branch = y;
    if (branch === -1) {
      found.push(
        rowOptions.flatMap((options) =>
          Array.from({ length: size }, (_, x) => (options[0] >>> x) & 1),
        ),
      );
      return;
    }
    for (const option of rowOptions[branch]) {
      const nextRows = rowOptions.map((options) => [...options]);
      nextRows[branch] = [option];
      search(
        nextRows,
        colOptions.map((options) => [...options]),
      );
      if (found.length >= limit) return;
    }
  }
  search(
    rows.map((c) => linePatterns(c, size)),
    cols.map((c) => linePatterns(c, size)),
  );
  return found;
}
export function generateBanks() {
  const random = rng(0x4b656e53);
  const bank = {
    sudoku: { easy: [], normal: [], hard: [] },
    nonogram: { easy: [], normal: [], hard: [] },
  };
  const seen = new Set();
  let attempts = 0;
  while (Object.values(bank.sudoku).some((items) => items.length < 30)) {
    if (++attempts > 6000) throw Error("Could not complete Sudoku bank.");
    const answer = sudokuSolutions(Array(81).fill(0), 1, random)[0];
    const givens = [...answer];
    const target = 25 + random(17);
    for (const index of shuffle(
      Array.from({ length: 81 }, (_, i) => i),
      random,
    )) {
      if (givens.filter(Boolean).length <= target) break;
      const digit = givens[index];
      givens[index] = 0;
      if (sudokuSolutions(givens).length !== 1) givens[index] = digit;
    }
    const rating = sudokuRating(givens);
    const items = bank.sudoku[rating.tier];
    const text = givens.join("");
    if (items && items.length < 30 && !seen.has(text)) {
      seen.add(text);
      items.push({
        id: `sudoku-${rating.tier}-${String(items.length + 1).padStart(2, "0")}`,
        givens: text,
        solution: answer.join(""),
        rating,
      });
      if (items.length === 30)
        console.log(
          `Generated 30 Sudoku ${rating.tier} puzzles (${attempts} candidates).`,
        );
    }
  }
  for (const [difficulty, size] of [
    ["easy", 5],
    ["normal", 10],
    ["hard", 15],
  ]) {
    const items = bank.nonogram[difficulty];
    let tries = 0;
    while (items.length < 30) {
      if (++tries > 3000)
        throw Error(`Could not complete Nonogram ${difficulty}.`);
      const density = 50 + random(30);
      const answer = Array.from({ length: size * size }, () =>
        random(100) < density ? 1 : 0,
      );
      const count = answer.reduce((a, b) => a + b, 0);
      if (
        count < size * size * 0.35 ||
        count > size * size * 0.8 ||
        seen.has(answer.join(""))
      )
        continue;
      const clues = nonogramClues(answer, size);
      let solutions;
      try {
        solutions = nonogramSolutions(clues.rows, clues.cols, size);
      } catch {
        continue;
      }
      if (solutions.length !== 1) continue;
      seen.add(answer.join(""));
      items.push({
        id: `nonogram-${difficulty}-${String(items.length + 1).padStart(2, "0")}`,
        size,
        solution: answer.join(""),
        ...clues,
      });
    }
    console.log(
      `Generated 30 Nonogram ${difficulty} puzzles (${tries} candidates).`,
    );
  }
  return bank;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bank = generateBanks();
  const text = `// Original fixed puzzle bank. Generated and uniqueness-verified by scripts/generate-puzzles.mjs.\nexport const PUZZLE_BANK = ${JSON.stringify(bank)};\n`;
  await writeFile(
    new URL("../src/games/puzzle-bank.js", import.meta.url),
    text,
  );
  console.log("Wrote 180 validated puzzles to src/games/puzzle-bank.js.");
}
