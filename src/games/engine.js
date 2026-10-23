import * as puzzles from "./puzzle-engine.js";
import * as arcade from "./arcade-engine.js";
import * as boards from "./board-engine.js";
import * as drop from "./block-drop-engine.js";
import * as brickV2 from "./brick-v2-engine.js";
// 浏览器与服务端共用规则；此文件不访问 DOM、网络或时钟。
export const VERSION = 1;
export const GAMES = {
  2048: {
    name: "2048",
    category: "Puzzle",
    ranked: true,
    default: "classic",
    modes: { classic: { label: "Classic · 4 × 4" } },
  },
  minesweeper: {
    name: "Minesweeper",
    category: "Puzzle",
    ranked: true,
    default: "beginner",
    modes: {
      beginner: { label: "Beginner · 9 × 9", w: 9, h: 9, mines: 10 },
      intermediate: {
        label: "Intermediate · 16 × 16",
        w: 16,
        h: 16,
        mines: 40,
      },
      expert: { label: "Expert · 30 × 16", w: 30, h: 16, mines: 99 },
    },
  },
  snake: {
    name: "Snake",
    category: "Arcade",
    ranked: true,
    default: "normal",
    modes: {
      slow: { label: "Slow · 6 cells/s", rate: 6 },
      normal: { label: "Normal · 10 cells/s", rate: 10 },
      fast: { label: "Fast · 14 cells/s", rate: 14 },
    },
  },
  "memory-match": {
    name: "Memory Match",
    category: "Puzzle",
    ranked: true,
    default: "normal",
    modes: {
      easy: { label: "Easy · 6 pairs", pairs: 6, cols: 4 },
      normal: { label: "Normal · 8 pairs", pairs: 8, cols: 4 },
      hard: { label: "Hard · 12 pairs", pairs: 12, cols: 6 },
    },
  },
  ...puzzles.CONFIG,
  ...arcade.CONFIG,
  ...boards.CONFIG,
  ...drop.CONFIG,
};
export const gameVersion = (game) => (game === "brick-breaker" ? 2 : 1);
export const supportsVersion = (game, version) =>
  !!GAMES[game] &&
  (version === 1 || (game === "brick-breaker" && version === 2));
function extension(game, version = gameVersion(game)) {
  return game === "brick-breaker" && version === 2
    ? brickV2
    : drop.CONFIG[game]
      ? drop
      : puzzles.CONFIG[game]
        ? puzzles
        : arcade.CONFIG[game]
          ? arcade
          : boards.CONFIG[game]
            ? boards
            : null;
}
export const isRanked = (game) => GAMES[game]?.ranked === true;
export const timeScored = (game) =>
  ["minesweeper", "sudoku", "nonogram"].includes(game);
export const needsWin = (game) =>
  ["minesweeper", "memory-match", "sudoku", "nonogram"].includes(game);
export function advanceBrick(state, tick) {
  return (state.version === 2 ? brickV2 : arcade).advanceBrick(state, tick);
}
export { advanceDrop } from "./block-drop-engine.js";
export function rules(game, difficulty) {
  const mode = GAMES[game]?.modes[difficulty];
  if (!mode) throw Error("Unknown game or difficulty.");
  return mode;
}
function random(s, n) {
  let x = s.rng >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return Math.floor((s.rng / 4294967296) * n);
}
function shuffle(s, items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = random(s, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
function spawn(s) {
  const empty = s.board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (empty.length)
    s.board[empty[random(s, empty.length)]] = random(s, 10) < 9 ? 2 : 4;
}
export function create(game, difficulty, seed, version = gameVersion(game)) {
  const mode = rules(game, difficulty);
  if (!supportsVersion(game, version)) throw Error("Unsupported game rules.");
  if (!Number.isInteger(seed) || seed <= 0 || seed > 4294967295)
    throw Error("Invalid random seed.");
  if (extension(game, version))
    return extension(game, version).create(game, difficulty, seed);
  const s = {
    game,
    difficulty,
    version: VERSION,
    seed,
    rng: seed,
    score: 0,
    status: "playing",
    moves: 0,
  };
  if (game === "2048") {
    s.board = Array(16).fill(0);
    spawn(s);
    spawn(s);
  }
  if (game === "minesweeper")
    Object.assign(s, {
      board: Array(mode.w * mode.h).fill(0),
      revealed: [],
      flags: [],
      planted: false,
    });
  if (game === "snake") {
    Object.assign(s, {
      body: [210, 209, 208, 207],
      dir: 1,
      pending: null,
      ticks: 0,
    });
    food(s);
  }
  if (game === "memory-match")
    Object.assign(s, {
      cards: shuffle(
        s,
        Array.from({ length: mode.pairs * 2 }, (_, i) => i % mode.pairs),
      ),
      matched: [],
      faceUp: [],
      holdUntil: 0,
    });
  return s;
}
function neighbors(i, w, h) {
  const x = i % w,
    y = Math.floor(i / w),
    out = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if ((dx || dy) && x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h)
        out.push((y + dy) * w + x + dx);
  return out;
}
function plant(s, first) {
  const { w, h, mines } = rules(s.game, s.difficulty),
    safe = new Set([first, ...neighbors(first, w, h)]);
  const cells = shuffle(
    s,
    s.board.map((_, i) => i).filter((i) => !safe.has(i)),
  );
  for (const i of cells.slice(0, mines)) s.board[i] = -1;
  s.board.forEach((v, i) => {
    if (v !== -1)
      s.board[i] = neighbors(i, w, h).filter((j) => s.board[j] === -1).length;
  });
  s.planted = true;
}
function reveal(s, index) {
  const { w, h } = rules(s.game, s.difficulty),
    seen = new Set(s.revealed),
    flags = new Set(s.flags),
    stack = [index];
  while (stack.length) {
    const i = stack.pop();
    if (seen.has(i) || flags.has(i)) continue;
    seen.add(i);
    if (s.board[i] === -1) {
      s.status = "lost";
      break;
    }
    if (s.board[i] === 0)
      stack.push(...neighbors(i, w, h).filter((j) => !seen.has(j)));
  }
  s.revealed = [...seen];
}
function move2048(s, dir) {
  const before = s.board.join(",");
  for (let a = 0; a < 4; a++) {
    const ids = Array.from({ length: 4 }, (_, b) =>
      dir === 0
        ? b * 4 + a
        : dir === 1
          ? a * 4 + 3 - b
          : dir === 2
            ? (3 - b) * 4 + a
            : a * 4 + b,
    );
    const line = ids.map((i) => s.board[i]).filter(Boolean),
      result = [];
    for (let i = 0; i < line.length; i++) {
      if (line[i] === line[i + 1]) {
        result.push(line[i] * 2);
        s.score += line[i] * 2;
        i++;
      } else result.push(line[i]);
    }
    ids.forEach((id, i) => (s.board[id] = result[i] || 0));
  }
  if (before === s.board.join(",")) return false;
  s.moves++;
  spawn(s);
  if (
    !s.board.includes(0) &&
    !s.board.some(
      (v, i) =>
        (i % 4 < 3 && s.board[i + 1] === v) || (i < 12 && s.board[i + 4] === v),
    )
  )
    s.status = "lost";
  return true;
}
function food(s) {
  const used = new Set(s.body),
    empty = Array.from({ length: 400 }, (_, i) => i).filter(
      (i) => !used.has(i),
    );
  s.food = empty.length ? empty[random(s, empty.length)] : -1;
  if (!empty.length) s.status = "won";
}
export function advanceSnake(s, ticks) {
  if (
    s.game !== "snake" ||
    !Number.isSafeInteger(ticks) ||
    ticks < s.ticks ||
    ticks > 100800
  )
    throw Error("Invalid game tick.");
  while (s.ticks < ticks && s.status === "playing") {
    if (s.pending !== null) {
      s.dir = s.pending;
      s.pending = null;
    }
    const head = s.body[0],
      x = head % 20,
      y = Math.floor(head / 20),
      dx = [0, 1, 0, -1][s.dir],
      dy = [-1, 0, 1, 0][s.dir];
    const next = (y + dy) * 20 + x + dx,
      eating = next === s.food;
    s.ticks++;
    if (
      x + dx < 0 ||
      x + dx >= 20 ||
      y + dy < 0 ||
      y + dy >= 20 ||
      s.body.slice(0, eating ? undefined : -1).includes(next)
    ) {
      s.status = "lost";
      break;
    }
    s.body.unshift(next);
    if (eating) {
      s.score += 10;
      food(s);
    } else s.body.pop();
  }
  return s;
}
export function settleMemory(s, time) {
  if (s.game === "memory-match" && s.holdUntil && time >= s.holdUntil) {
    s.faceUp = [];
    s.holdUntil = 0;
  }
}
export function apply(s, e) {
  if (s.status !== "playing" || !e || typeof e !== "object") return false;
  const m = rules(s.game, s.difficulty);
  if (extension(s.game, s.version))
    return extension(s.game, s.version).apply(s, e);
  if (s.game === "2048")
    return e.type === "move" && [0, 1, 2, 3].includes(e.dir)
      ? move2048(s, e.dir)
      : false;
  if (s.game === "snake") {
    if (
      e.type !== "turn" ||
      ![0, 1, 2, 3].includes(e.dir) ||
      s.pending !== null ||
      e.dir === s.dir ||
      (e.dir + 2) % 4 === s.dir
    )
      return false;
    s.pending = e.dir;
    s.moves++;
    return true;
  }
  if (!Number.isInteger(e.index)) return false;
  if (s.game === "minesweeper") {
    const i = e.index;
    if (i < 0 || i >= s.board.length) return false;
    if (e.type === "flag" && !s.revealed.includes(i)) {
      s.flags = s.flags.includes(i)
        ? s.flags.filter((j) => j !== i)
        : [...s.flags, i];
      s.moves++;
      return true;
    }
    if (
      e.type === "reveal" &&
      !s.revealed.includes(i) &&
      !s.flags.includes(i)
    ) {
      if (!s.planted) plant(s, i);
      reveal(s, i);
    } else if (e.type === "chord" && s.revealed.includes(i) && s.board[i] > 0) {
      const around = neighbors(i, m.w, m.h);
      if (
        around.filter((j) => s.flags.includes(j)).length !== s.board[i] ||
        around.every((j) => s.flags.includes(j) || s.revealed.includes(j))
      )
        return false;
      for (const j of around) {
        reveal(s, j);
        if (s.status === "lost") break;
      }
    } else return false;
    s.moves++;
    if (s.status === "playing" && s.revealed.length === m.w * m.h - m.mines)
      s.status = "won";
    return true;
  }
  if (s.game === "memory-match") {
    if (
      e.type !== "flip" ||
      !Number.isFinite(e.t) ||
      e.t < 0 ||
      e.index < 0 ||
      e.index >= s.cards.length
    )
      return false;
    settleMemory(s, e.t);
    if (
      s.holdUntil ||
      s.matched.includes(e.index) ||
      s.faceUp.includes(e.index)
    )
      return false;
    s.faceUp.push(e.index);
    if (s.faceUp.length === 2) {
      s.moves++;
      if (s.cards[s.faceUp[0]] === s.cards[s.faceUp[1]]) {
        s.matched.push(...s.faceUp);
        s.faceUp = [];
      } else s.holdUntil = e.t + 650;
      if (s.matched.length === s.cards.length) s.status = "won";
    }
    return true;
  }
  return false;
}
export function metrics(s) {
  if (extension(s.game, s.version))
    return extension(s.game, s.version).metrics(s);
  return {
    score: s.score,
    moves: s.moves,
    max_tile: s.game === "2048" ? Math.max(...s.board) : 0,
    won: s.status === "won",
  };
}
export function replay(
  game,
  difficulty,
  seed,
  events,
  finalTick = 0,
  durationMs = 0,
  format = "legacy",
  version = gameVersion(game),
) {
  if (!supportsVersion(game, version)) throw Error("Unsupported game rules.");
  if (!isRanked(game)) throw Error("This game supports Private play only.");
  if (game === "block-drop")
    return drop.replayDrop(
      difficulty,
      seed,
      events,
      finalTick,
      durationMs,
      format,
    );
  if (game === "brick-breaker")
    return (version === 2 ? brickV2 : arcade).replayBrick(
      difficulty,
      seed,
      events,
      finalTick,
      durationMs,
      format,
    );
  if (format !== "legacy") throw Error("Unsupported replay format.");
  if (
    !Array.isArray(events) ||
    events.length > 20000 ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > 7200000
  )
    throw Error("Replay exceeds game limits.");
  const s = create(game, difficulty, seed);
  let previous = 0;
  for (const e of events) {
    if (!Number.isSafeInteger(e.t) || e.t < previous || e.t > durationMs)
      throw Error("Invalid event timing.");
    previous = e.t;
    if (game === "snake") {
      if ((e.tick * 1000) / rules(game, difficulty).rate > e.t + 250)
        throw Error("Impossible game speed.");
      advanceSnake(s, e.tick);
    }
    if (!apply(s, e)) throw Error("Invalid game action.");
  }
  if (game === "snake") {
    if ((finalTick * 1000) / rules(game, difficulty).rate > durationMs + 250)
      throw Error("Impossible game speed.");
    advanceSnake(s, finalTick);
    if (s.ticks !== finalTick) throw Error("Actions after game over.");
  }
  if (s.status === "playing") throw Error("This game has not finished.");
  return { ...metrics(s), elapsed_ms: Math.max(1, Math.round(durationMs)) };
}
export function validateSave(data) {
  if (!data || JSON.stringify(data).length > 240000)
    throw Error("Game save is too large.");
  const { game, difficulty } = data;
  rules(game, difficulty);
  const s = data.state;
  if (
    !s ||
    s.game !== game ||
    s.difficulty !== difficulty ||
    !supportsVersion(game, s.version) ||
    ![
      "playing",
      "won",
      "lost",
      ...(boards.CONFIG[game] ? ["draw"] : []),
    ].includes(s.status)
  )
    throw Error("This save uses unsupported game rules.");
  create(game, difficulty, s.seed, s.version);
  if (
    ![s.score, s.moves, s.rng].every(
      (v) => Number.isSafeInteger(v) && v >= 0,
    ) ||
    !Number.isFinite(data.elapsed) ||
    data.elapsed < 0
  )
    throw Error("Invalid game save.");
  if (extension(game, s.version)) extension(game, s.version).validate(s);
  if (
    boards.CONFIG[game] &&
    s.humanSide !== undefined &&
    ![1, 2].includes(s.humanSide)
  )
    throw Error("Invalid player side in saved game.");
  const ints = (a, max, length) =>
    Array.isArray(a) &&
    a.length <= length &&
    a.every((x) => Number.isSafeInteger(x) && x >= 0 && x < max);
  const unique = (a) => new Set(a).size === a.length;
  if (
    game === "2048" &&
    (!ints(s.board, 2147483648, 16) ||
      s.board.length !== 16 ||
      s.board.some((x) => x && (x < 2 || !Number.isInteger(Math.log2(x)))))
  )
    throw Error("Invalid 2048 board.");
  if (game === "minesweeper") {
    const n = rules(game, difficulty).w * rules(game, difficulty).h;
    if (
      !Array.isArray(s.board) ||
      s.board.length !== n ||
      !s.board.every((x) => Number.isInteger(x) && x >= -1 && x <= 8) ||
      !ints(s.revealed, n, n) ||
      !ints(s.flags, n, n) ||
      !unique(s.revealed) ||
      !unique(s.flags) ||
      typeof s.planted !== "boolean"
    )
      throw Error("Invalid mines board.");
  }
  if (
    game === "snake" &&
    (!ints(s.body, 400, 400) ||
      !s.body.length ||
      !unique(s.body) ||
      !Number.isInteger(s.ticks) ||
      s.ticks < 0 ||
      ![0, 1, 2, 3].includes(s.dir) ||
      ![null, 0, 1, 2, 3].includes(s.pending) ||
      !Number.isInteger(s.food) ||
      s.food < -1 ||
      s.food > 399)
  )
    throw Error("Invalid snake board.");
  if (game === "memory-match") {
    const p = rules(game, difficulty).pairs,
      n = p * 2;
    if (
      !ints(s.cards, p, n) ||
      s.cards.length !== n ||
      Array.from(
        { length: p },
        (_, i) => s.cards.filter((x) => x === i).length,
      ).some((x) => x !== 2) ||
      !ints(s.faceUp, n, 2) ||
      !ints(s.matched, n, n) ||
      !unique([...s.faceUp, ...s.matched]) ||
      !Number.isFinite(s.holdUntil) ||
      s.holdUntil < 0
    )
      throw Error("Invalid matching board.");
  }
  const best =
    data.best &&
    ["score", "moves", "max_tile", "elapsed_ms"].every(
      (k) => Number.isFinite(data.best[k]) && data.best[k] >= 0,
    ) &&
    typeof data.best.won === "boolean"
      ? data.best
      : null;
  return structuredClone({
    game,
    difficulty,
    state: s,
    elapsed: data.elapsed,
    best,
    name: `${GAMES[game].name} · ${rules(game, difficulty).label}`,
  });
}
