import { applyGo, tryMove, liberties, groupAt, scoreGo } from "./go-engine.js";
// 入门启发式有界搜索；不标注棋力段位，不在主线程中执行。
export function chooseGoMove(s, level = 1, seed = 1) {
  if (s.phase !== "playing") return null;
  let rng = seed >>> 0 || 1;
  const random = () => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    return (rng >>> 0) / 4294967296;
  };
  const n = s.config.size,
    candidates = [];
  for (let i = 0; i < s.board.length; i++) {
    if (s.board[i]) continue;
    let m;
    try {
      m = tryMove(s, i);
    } catch {
      continue;
    }
    const next = { ...s, board: m.board },
      air = liberties(next, i).length,
      x = i % n,
      y = Math.floor(i / n);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]
      .filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n)
      .map(([a, b]) => b * n + a);
    let value =
      m.captured * 15 +
      Math.min(4, air) * 1.8 +
      random() * (level === 1 ? 7 : 1.5);
    if (air === 1) value -= 15;
    // 避免填自己的单眼；优先救一口气的友军、攻击敌方断点。
    if (neighbors.every((j) => s.board[j] === s.turn)) value -= 25;
    for (const j of neighbors)
      if (s.board[j] === s.turn && liberties(s, j).length === 1)
        value += 4 + groupAt(s, j).length;
    value += Math.min(x, y, n - 1 - x, n - 1 - y, 3) * (s.ply < n ? 1.2 : 0.2);
    candidates.push({ index: i, value });
  }
  candidates.sort((a, b) => b.value - a.value);
  if (!candidates.length) return { type: "pass" };
  // 最多六个候选、每个八个应手；搜索预算与棋盘规模有固定上限。
  if (level >= 2)
    for (const c of candidates.slice(0, level === 3 ? 6 : 3)) {
      const next = applyGo(s, { type: "move", index: c.index });
      let worst = 0,
        checked = 0;
      const replies = candidates
        .filter((x) => x.index !== c.index)
        .slice(0, level === 3 ? 8 : 4);
      for (const r of replies) {
        try {
          const m = tryMove(next, r.index);
          worst = Math.max(worst, m.captured * 10);
          checked++;
        } catch {}
      }
      c.value -= worst;
      if (checked && liberties(next, c.index).length > 1) c.value += 1;
    }
  candidates.sort((a, b) => b.value - a.value);
  if (s.passes && s.ply > (n * n) / 2 && candidates[0].value < 8)
    return { type: "pass" };
  return { type: "move", index: candidates[0].index };
}
