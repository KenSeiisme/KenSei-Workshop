// 表现层只比较状态，不调用规则或消耗对局随机数。
export const AUDIO_PROFILES = Object.freeze({
  go: "board",
  chess: "board",
  xiangqi: "board",
  "connect-four": "board",
  reversi: "board",
  2048: "puzzle",
  minesweeper: "puzzle",
  "memory-match": "puzzle",
  sudoku: "puzzle",
  nonogram: "puzzle",
  "block-puzzle": "puzzle",
  snake: "arcade",
  "brick-breaker": "arcade",
  "block-drop": "arcade",
  pong: "arcade",
});
export function normalizeAudioPreference(value, legacy) {
  const clamp = (v, fallback) =>
    Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
  if (value?.version === 2)
    return {
      version: 2,
      enabled: value.enabled !== false,
      volume: clamp(value.volume, 0.35),
      musicEnabled: value.musicEnabled !== false,
      musicVolume: clamp(value.musicVolume, 0.12),
      countdown: value.countdown !== false,
    };
  return {
    version: 2,
    enabled: legacy?.enabled !== false,
    volume: clamp(legacy?.volume, 0.35),
    musicEnabled: true,
    musicVolume: 0.12,
    countdown: true,
  };
}
export const TERMINAL_CUES = new Set(["win", "loss", "draw", "over", "end"]);
export const PRIORITY_CUES = new Set([
  ...TERMINAL_CUES,
  "life",
  "pickup",
  "multiball",
  "wide",
  "slow",
  "milestone",
  "countdown",
]);
export function resultCue(winner, player = null, reason = "") {
  if (reason === "both-lose") return player === null ? "end" : "loss";
  if (
    winner === null ||
    ["interrupted", "no-result", "closed"].includes(reason)
  )
    return "end";
  if (winner === 0) return "draw";
  if (player === null) return "end";
  return winner === player ? "win" : "loss";
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function terminal(before, after) {
  if (before.status !== "playing" || after.status === "playing") return null;
  if (after.status === "draw") return "draw";
  if (["connect-four", "reversi"].includes(after.game))
    return resultCue(
      after.winner,
      after.difficulty === "local" ? null : after.humanSide || 1,
    );
  return after.status === "won"
    ? "win"
    : ["2048", "snake", "block-puzzle", "block-drop"].includes(after.game)
      ? "over"
      : "loss";
}
function runs(values) {
  const result = [];
  let count = 0;
  for (const v of [...values, 0]) {
    if (v === 1) count++;
    else if (count) {
      result.push(count);
      count = 0;
    }
  }
  return result.length ? result : [0];
}
function regionCompleted(before, after, index) {
  if (!Array.isArray(after.board) || !Number.isInteger(index)) return false;
  const n = after.game === "sudoku" ? 9 : after.size;
  const row = Math.floor(index / n),
    col = index % n;
  const regions = [
    Array.from({ length: n }, (_, i) => row * n + i),
    Array.from({ length: n }, (_, i) => i * n + col),
  ];
  if (after.game === "sudoku")
    regions.push(
      Array.from(
        { length: 9 },
        (_, i) =>
          (Math.floor(row / 3) * 3 + Math.floor(i / 3)) * 9 +
          Math.floor(col / 3) * 3 +
          (i % 3),
      ),
    );
  return regions.some((cells, i) => {
    const complete = (board) => {
      const values = cells.map((j) => board[j]);
      return after.game === "sudoku"
        ? values.every(Boolean) && new Set(values).size === 9
        : same(runs(values), i === 0 ? after.rows?.[row] : after.cols?.[col]);
    };
    return complete(after.board) && !complete(before.board);
  });
}
export function audioEvents(before, after, event = {}) {
  if (!before || !after || (before.game && before.game !== after.game))
    return [];
  const ended = terminal(before, after);
  if (ended) return [ended];
  if (after.status !== "playing") return [];
  const g = after.game,
    moved = (after.moves || 0) > (before.moves || 0);
  if (g === "brick-breaker") {
    if (after.lives < before.lives) return ["life"];
    if (after.stage > before.stage) return ["line"];
    if ((after.pickups || 0) > (before.pickups || 0))
      return [
        { Multiball: "multiball", "Wide Paddle": "wide", "Slow Ball": "slow" }[
          after.lastPickup
        ] || "pickup",
      ];
    if (after.score > before.score) return ["brick"];
    if ((after.paddleHits || 0) > (before.paddleHits || 0)) return ["paddle"];
    const a = after.balls?.[0] || after.ball,
      b = before.balls?.[0] || before.ball;
    return a?.launched && !b?.launched
      ? ["serve"]
      : a?.vy < 0 && b?.vy > 0 && a.y > 390 * 1024
        ? ["paddle"]
        : [];
  }
  if (g === "2048") {
    if (same(before.board, after.board)) return [];
    if (after.score > before.score)
      return Math.max(...after.board) >= 2048 &&
        Math.max(...before.board) < 2048
        ? ["milestone"]
        : ["merge"];
    return moved ? ["move"] : [];
  }
  if (g === "minesweeper")
    return !same(before.flags, after.flags)
      ? ["flag"]
      : after.revealed?.length > before.revealed?.length
        ? ["reveal"]
        : [];
  if (g === "snake")
    return after.score > before.score
      ? ["point"]
      : event.type === "turn" && moved
        ? ["move"]
        : [];
  if (g === "memory-match")
    return after.matched?.length > before.matched?.length
      ? ["pair"]
      : after.holdUntil && !before.holdUntil
        ? ["miss"]
        : event.type === "flip" && !same(before.faceUp, after.faceUp)
          ? ["flip"]
          : [];
  if (g === "block-drop") {
    if (after.lines > before.lines) return ["line"];
    if (event.input === "hard" && moved) return ["harddrop"];
    if (["cw", "ccw"].includes(event.input) && !same(before.piece, after.piece))
      return ["rotate"];
    if (moved) return ["move"];
    return event.type === "drop-input" &&
      !event.input.endsWith("up") &&
      before.piece?.x !== after.piece?.x
      ? ["move"]
      : [];
  }
  if (g === "block-puzzle")
    return after.cleared > before.cleared ? ["line"] : moved ? ["move"] : [];
  if (["sudoku", "nonogram"].includes(g)) {
    if (same(before.board, after.board)) return [];
    if (g === "sudoku" && event.value) {
      const row = Math.floor(event.index / 9),
        col = event.index % 9;
      if (
        after.board.some(
          (v, i) =>
            i !== event.index &&
            v === event.value &&
            (Math.floor(i / 9) === row ||
              i % 9 === col ||
              (Math.floor(i / 27) === Math.floor(row / 3) &&
                Math.floor((i % 9) / 3) === Math.floor(col / 3))),
        )
      )
        return ["conflict"];
    }
    return regionCompleted(before, after, event.index)
      ? ["line"]
      : [event.value === 0 ? "erase" : "input"];
  }
  if (g === "reversi")
    return moved
      ? after.lastSkipped != null
        ? ["flip", "pass"]
        : ["flip"]
      : [];
  if (g === "connect-four") return moved ? ["move"] : [];
  return [];
}
// 兼容旧测试与调用；新观察器可播放一次操作中的少量语义反馈。
export function audioEvent(before, after, event = {}) {
  return audioEvents(before, after, event)[0] || null;
}

export function createCountdownTracker() {
  let previous = null;
  return (info) => {
    const seconds = Math.ceil(info?.remainingMs / 1000);
    const current = info
      ? { key: `${info.matchId}:${info.turnId}:${info.periodId}`, seconds }
      : null;
    const valid =
      info?.playing &&
      info.ownTurn &&
      info.controller &&
      info.visible &&
      info.connected &&
      info.overtime &&
      seconds >= 1 &&
      seconds <= 5;
    const emit =
      !!valid &&
      !!previous &&
      previous.key === current.key &&
      previous.seconds > seconds;
    previous = current;
    return emit ? { key: `${current.key}:${seconds}`, seconds } : null;
  };
}
