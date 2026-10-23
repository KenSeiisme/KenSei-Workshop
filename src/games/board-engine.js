// 私人棋类规则与有界电脑搜索；没有 DOM、网络或时钟依赖。
const modes = {
  "ai-easy": { label: "Computer · Easy" },
  "ai-normal": { label: "Computer · Normal" },
  "ai-hard": { label: "Computer · Hard" },
  local: { label: "Two players · same device" },
};
export const CONFIG = {
  "connect-four": {
    name: "Connect Four",
    category: "Board",
    ranked: false,
    default: "ai-normal",
    modes,
  },
  reversi: {
    name: "Reversi",
    category: "Board",
    ranked: false,
    default: "ai-normal",
    modes,
  },
};
const DIRECTIONS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];
function validMode(game, difficulty) {
  if (!CONFIG[game]?.modes[difficulty])
    throw Error("Unknown board game or difficulty.");
}
function count(board) {
  return [
    board.filter((x) => x === 1).length,
    board.filter((x) => x === 2).length,
  ];
}
export function create(game, difficulty, seed) {
  validMode(game, difficulty);
  if (!Number.isInteger(seed) || seed <= 0 || seed > 4294967295)
    throw Error("Invalid random seed.");
  const s = {
    game,
    difficulty,
    version: 1,
    seed,
    rng: seed,
    score: 0,
    moves: 0,
    status: "playing",
    turn: 1,
    winner: null,
    board: Array(game === "connect-four" ? 42 : 64).fill(0),
    counts: [0, 0],
    passCount: 0,
    lastSkipped: null,
    lastMove: null,
  };
  if (game === "reversi") {
    s.board[27] = s.board[36] = 2;
    s.board[28] = s.board[35] = 1;
    s.counts = [2, 2];
    s.score = 2;
  }
  return s;
}
// 返回落子会翻转的格子；不修改棋盘。
export function reversiFlips(board, index, player) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 64 ||
    board[index] ||
    (player !== 1 && player !== 2)
  )
    return [];
  const result = [],
    x = index % 8,
    y = Math.floor(index / 8);
  for (const [dx, dy] of DIRECTIONS) {
    const line = [];
    let nx = x + dx,
      ny = y + dy;
    while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
      const i = ny * 8 + nx;
      if (board[i] === 3 - player) line.push(i);
      else {
        if (board[i] === player && line.length) result.push(...line);
        break;
      }
      nx += dx;
      ny += dy;
    }
  }
  return result;
}
export function legalMoves(s, player = s.turn) {
  if (s.status !== "playing" || (player !== 1 && player !== 2)) return [];
  if (s.game === "connect-four")
    return [3, 2, 4, 1, 5, 0, 6].filter((column) => !s.board[column]);
  return Array.from({ length: 64 }, (_, i) => i).filter(
    (i) => reversiFlips(s.board, i, player).length,
  );
}
function connectWinners(board) {
  const winners = new Set();
  for (let i = 0; i < 42; i++) {
    if (!board[i]) continue;
    const x = i % 7,
      y = Math.floor(i / 7);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]) {
      const nx = x + 3 * dx,
        ny = y + 3 * dy;
      if (nx < 0 || nx >= 7 || ny < 0 || ny >= 6) continue;
      if (
        [1, 2, 3].every(
          (n) => board[(y + n * dy) * 7 + x + n * dx] === board[i],
        )
      )
        winners.add(board[i]);
    }
  }
  return [...winners];
}
function refreshCounts(s) {
  s.counts = count(s.board);
  s.score = s.game === "reversi" ? Math.max(...s.counts) : 0;
}
export function apply(s, event) {
  if (!event || s.status !== "playing") return false;
  const player = s.turn,
    opponent = 3 - player;
  if (s.game === "connect-four") {
    if (
      event.type !== "drop" ||
      !Number.isInteger(event.column) ||
      event.column < 0 ||
      event.column > 6 ||
      s.board[event.column]
    )
      return false;
    let index = event.column;
    while (index + 7 < 42 && !s.board[index + 7]) index += 7;
    s.board[index] = player;
    s.lastMove = index;
    s.moves++;
    s.turn = opponent;
    refreshCounts(s);
    if (connectWinners(s.board).includes(player)) {
      s.status = "won";
      s.winner = player;
    } else if (s.moves === 42) {
      s.status = "draw";
      s.winner = 0;
    }
    return true;
  }
  if (s.game !== "reversi" || event.type !== "disc") return false;
  const flips = reversiFlips(s.board, event.index, player);
  if (!flips.length) return false;
  s.board[event.index] = player;
  for (const index of flips) s.board[index] = player;
  s.lastMove = event.index;
  s.moves++;
  refreshCounts(s);
  s.passCount = 0;
  s.lastSkipped = null;
  s.turn = opponent;
  if (!legalMoves(s).length) {
    s.passCount = 1;
    s.lastSkipped = opponent;
    s.turn = player;
    if (!legalMoves(s).length) {
      s.passCount = 2;
      s.winner =
        s.counts[0] === s.counts[1] ? 0 : s.counts[0] > s.counts[1] ? 1 : 2;
      s.status = s.winner ? "won" : "draw";
    }
  }
  return true;
}
export function metrics(s) {
  return {
    score: s.score,
    moves: s.moves,
    max_tile: 0,
    won: s.status === "won",
  };
}
export function validate(s) {
  if (!s || typeof s !== "object") throw Error("Invalid board save.");
  validMode(s.game, s.difficulty);
  const size = s.game === "connect-four" ? 42 : 64;
  if (
    s.version !== 1 ||
    !Number.isInteger(s.seed) ||
    s.seed <= 0 ||
    s.seed > 4294967295 ||
    !Number.isInteger(s.rng) ||
    s.rng <= 0 ||
    s.rng > 4294967295 ||
    !Array.isArray(s.board) ||
    s.board.length !== size ||
    !s.board.every((v) => Number.isInteger(v) && v >= 0 && v <= 2) ||
    ![1, 2].includes(s.turn) ||
    !["playing", "won", "draw"].includes(s.status) ||
    !Number.isInteger(s.moves) ||
    s.moves < 0 ||
    s.moves > (size === 42 ? 42 : 60) ||
    !Array.isArray(s.counts) ||
    s.counts.length !== 2 ||
    !s.counts.every((n, i) => Number.isInteger(n) && n === count(s.board)[i]) ||
    !Number.isInteger(s.passCount) ||
    s.passCount < 0 ||
    s.passCount > 2 ||
    (s.lastSkipped !== null && ![1, 2].includes(s.lastSkipped)) ||
    (s.lastMove !== null &&
      (!Number.isInteger(s.lastMove) ||
        s.lastMove < 0 ||
        s.lastMove >= size ||
        !s.board[s.lastMove]))
  )
    throw Error("Invalid board save.");
  if (s.game === "connect-four") {
    if (
      s.counts[0] + s.counts[1] !== s.moves ||
      s.score !== 0 ||
      s.counts[0] - s.counts[1] !== s.moves % 2 ||
      s.turn !== (s.moves % 2 ? 2 : 1) ||
      s.passCount !== 0 ||
      s.lastSkipped !== null
    )
      throw Error("Invalid Connect Four position.");
    for (let column = 0; column < 7; column++) {
      let occupied = false;
      for (let row = 0; row < 6; row++) {
        const cell = s.board[row * 7 + column];
        if (cell) occupied = true;
        else if (occupied) throw Error("A Connect Four disc cannot float.");
      }
    }
    const winners = connectWinners(s.board);
    if (
      winners.length > 1 ||
      (s.status === "playing" &&
        (winners.length || s.moves === 42 || s.winner !== null)) ||
      (s.status === "won" &&
        (winners.length !== 1 ||
          s.winner !== winners[0] ||
          s.winner !== 3 - s.turn)) ||
      (s.status === "draw" &&
        (s.winner !== 0 || s.moves !== 42 || winners.length))
    )
      throw Error("Invalid Connect Four result.");
  } else {
    if (
      s.counts[0] + s.counts[1] !== s.moves + 4 ||
      s.score !== Math.max(...s.counts)
    )
      throw Error("Invalid Reversi position.");
    const live = { ...s, status: "playing" };
    if (s.status === "playing") {
      if (s.winner !== null || !legalMoves(live).length || s.passCount === 2)
        throw Error("Invalid Reversi turn.");
      if (
        (s.passCount === 0 && s.lastSkipped !== null) ||
        (s.passCount === 1 &&
          (s.lastSkipped !== 3 - s.turn || legalMoves(live, 3 - s.turn).length))
      )
        throw Error("Invalid Reversi skipped turn.");
    } else {
      const winner =
        s.counts[0] === s.counts[1] ? 0 : s.counts[0] > s.counts[1] ? 1 : 2;
      if (
        legalMoves(live, 1).length ||
        legalMoves(live, 2).length ||
        s.winner !== winner ||
        s.status !== (winner ? "won" : "draw") ||
        s.passCount !== 2
      )
        throw Error("Invalid Reversi result.");
    }
  }
  return s;
}
function clone(s) {
  return { ...s, board: [...s.board], counts: [...s.counts] };
}
function eventFor(s, move) {
  return s.game === "connect-four"
    ? { type: "drop", column: move }
    : { type: "disc", index: move };
}
function seededIndex(s, length) {
  let x = (s.seed ^ Math.imul(s.moves + 1, 0x9e3779b1)) >>> 0;
  for (const n of s.board) x = Math.imul(x ^ n, 16777619) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) % length;
}
const REVERSI_WEIGHTS = [
  100, -20, 10, 5, 5, 10, -20, 100, -20, -35, -2, -2, -2, -2, -35, -20, 10, -2,
  3, 2, 2, 3, -2, 10, 5, -2, 2, 1, 1, 2, -2, 5, 5, -2, 2, 1, 1, 2, -2, 5, 10,
  -2, 3, 2, 2, 3, -2, 10, -20, -35, -2, -2, -2, -2, -35, -20, 100, -20, 10, 5,
  5, 10, -20, 100,
];
function evaluate(s, player) {
  if (s.status !== "playing")
    return s.winner === 0 ? 0 : s.winner === player ? 1000000 : -1000000;
  if (s.game === "reversi") {
    const positional = s.board.reduce(
      (sum, v, i) =>
        sum + (v === player ? REVERSI_WEIGHTS[i] : v ? -REVERSI_WEIGHTS[i] : 0),
      0,
    );
    const mobility =
      legalMoves(s, player).length - legalMoves(s, 3 - player).length;
    const discs = s.counts[player - 1] - s.counts[2 - player];
    return positional + mobility * 8 + discs * (s.moves >= 44 ? 4 : 0.25);
  }
  let value = 0;
  for (let row = 0; row < 6; row++) {
    const p = s.board[row * 7 + 3];
    if (p) value += p === player ? 6 : -6;
  }
  for (let i = 0; i < 42; i++) {
    const x = i % 7,
      y = Math.floor(i / 7);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]) {
      const nx = x + 3 * dx,
        ny = y + 3 * dy;
      if (nx < 0 || nx >= 7 || ny < 0 || ny >= 6) continue;
      const cells = [0, 1, 2, 3].map(
        (n) => s.board[(y + n * dy) * 7 + x + n * dx],
      );
      const own = cells.filter((p) => p === player).length,
        other = cells.filter((p) => p === 3 - player).length;
      if (!other) value += [0, 1, 12, 100, 1000000][own];
      if (!own) value -= [0, 1, 14, 120, 1000000][other];
    }
  }
  return value;
}
function ordered(s) {
  const moves = legalMoves(s);
  if (s.game === "reversi")
    moves.sort((a, b) => REVERSI_WEIGHTS[b] - REVERSI_WEIGHTS[a] || a - b);
  return moves;
}
// 节点预算固定，同样存档与难度必定给出同样落子。
export function chooseMove(s) {
  validate(s);
  if (s.status !== "playing") return null;
  const available = ordered(s);
  if (!available.length) return null;
  for (const move of available) {
    const next = clone(s);
    apply(next, eventFor(s, move));
    if (next.status === "won" && next.winner === s.turn)
      return eventFor(s, move);
  }
  if (s.difficulty === "ai-easy" || s.difficulty === "local")
    return eventFor(s, available[seededIndex(s, available.length)]);
  const hard = s.difficulty === "ai-hard",
    player = s.turn;
  const budget =
    s.game === "connect-four" ? (hard ? 24000 : 2400) : hard ? 14000 : 1400;
  const maxDepth =
    s.game === "connect-four"
      ? hard
        ? 7
        : 4
      : hard
        ? s.moves > 46
          ? 8
          : 5
        : 3;
  let nodes = 0,
    best = available[0],
    exhausted = false;
  function search(state, depth, alpha, beta) {
    nodes++;
    if (nodes > budget) {
      exhausted = true;
      return 0;
    }
    if (!depth || state.status !== "playing") return evaluate(state, player);
    const maximize = state.turn === player;
    let result = maximize ? -Infinity : Infinity;
    for (const move of ordered(state)) {
      const next = clone(state);
      apply(next, eventFor(state, move));
      const score = search(next, depth - 1, alpha, beta);
      if (exhausted) return 0;
      if (maximize) {
        result = Math.max(result, score);
        alpha = Math.max(alpha, result);
      } else {
        result = Math.min(result, score);
        beta = Math.min(beta, result);
      }
      if (beta <= alpha) break;
    }
    return result;
  }
  for (let depth = 1; depth <= maxDepth && !exhausted; depth++) {
    let candidate = best,
      value = -Infinity,
      alpha = -Infinity;
    const moves = [best, ...available.filter((move) => move !== best)];
    for (const move of moves) {
      const next = clone(s);
      apply(next, eventFor(s, move));
      const score = search(next, depth - 1, alpha, Infinity);
      if (exhausted) break;
      if (score > value) {
        value = score;
        candidate = move;
      }
      alpha = Math.max(alpha, value);
    }
    if (!exhausted) best = candidate;
  }
  return eventFor(s, best);
}
