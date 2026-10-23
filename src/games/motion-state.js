// 仅供表现层使用的映射；不推进游戏、不消耗规则随机数。
export function tileDestinations(board, direction) {
  const moves = [],
    merged = new Set();
  for (let lane = 0; lane < 4; lane++) {
    const indexes = Array.from({ length: 4 }, (_, i) =>
      direction === 0
        ? i * 4 + lane
        : direction === 2
          ? (3 - i) * 4 + lane
          : direction === 3
            ? lane * 4 + i
            : lane * 4 + 3 - i,
    );
    const sources = indexes.filter((i) => board[i]);
    let target = 0;
    for (let i = 0; i < sources.length; i++) {
      const from = sources[i],
        to = indexes[target++];
      moves.push({ from, to, value: board[from] });
      if (i + 1 < sources.length && board[sources[i + 1]] === board[from]) {
        moves.push({ from: sources[++i], to, value: board[from] });
        merged.add(to);
      }
    }
  }
  return { moves, merged: [...merged] };
}
export function completedSudokuUnits(board) {
  const units = [];
  for (let n = 0; n < 9; n++) {
    units.push(Array.from({ length: 9 }, (_, i) => n * 9 + i));
    units.push(Array.from({ length: 9 }, (_, i) => i * 9 + n));
    const row = Math.floor(n / 3) * 3,
      col = (n % 3) * 3;
    units.push(
      Array.from(
        { length: 9 },
        (_, i) => (row + Math.floor(i / 3)) * 9 + col + (i % 3),
      ),
    );
  }
  return units.filter(
    (u) =>
      u.every((i) => board[i]) && new Set(u.map((i) => board[i])).size === 9,
  );
}
export function winningCells(board, width = 7) {
  for (let i = 0; i < board.length; i++) {
    if (!board[i]) continue;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]) {
      const line = Array.from({ length: 4 }, (_, n) => [
        (i % width) + dx * n,
        Math.floor(i / width) + dy * n,
      ]);
      if (
        line.every(
          ([x, y]) =>
            x >= 0 &&
            x < width &&
            y >= 0 &&
            y < board.length / width &&
            board[y * width + x] === board[i],
        )
      )
        return line.map(([x, y]) => y * width + x);
    }
  }
  return [];
}
export function interpolatePoint(a, b, progress) {
  const t = Math.max(0, Math.min(1, progress));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export function matchedNonogramLines(state) {
  const match = (values, clues) => {
    const runs = [];
    let count = 0;
    for (const value of [...values, 0]) {
      if (value === 1) count++;
      else if (count) {
        runs.push(count);
        count = 0;
      }
    }
    return runs.length === clues.length && runs.every((v, i) => v === clues[i]);
  };
  const n = state.size;
  return {
    rows: state.rows.map((clues, y) =>
      match(state.board.slice(y * n, (y + 1) * n), clues),
    ),
    cols: state.cols.map((clues, x) =>
      match(
        Array.from({ length: n }, (_, y) => state.board[y * n + x]),
        clues,
      ),
    ),
  };
}
export function shouldCelebrate(state) {
  if (state.status !== "won") return false;
  if (!["connect-four", "reversi"].includes(state.game)) return true;
  return (
    state.difficulty === "local" || state.winner === (state.humanSide || 1)
  );
}
