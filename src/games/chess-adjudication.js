import {
  Chess,
  DEFAULT_POSITION,
  positionKey,
  colorName,
  parseUci,
  applyChess,
} from "./chess-engine.js";

const proofs = new Map();
function materialImpossible(c, color) {
  const pieces = c.board().flat().filter(Boolean);
  return (
    pieces
      .filter((p) => p.color === colorName(color))
      .every((p) => p.type === "k") || c.isInsufficientMaterial()
  );
}
function remember(fen, color, path) {
  const c = new Chess(fen);
  for (let i = 0; i <= path.length; i++) {
    proofs.set(`${positionKey(c.fen())}:${color}`, {
      verdict: "possible",
      witness: path.slice(i),
    });
    if (i < path.length) c.move(parseUci(path[i]));
  }
}
// 這些是完整重放驗證過的合作將死證據，不用子力或引擎評分猜勝負。
remember(DEFAULT_POSITION, 1, ["e2e4", "f7f6", "d2d4", "g7g5", "d1h5"]);
remember(DEFAULT_POSITION, -1, ["f2f3", "e7e5", "g2g4", "d8h4"]);
export function matingPossibility(
  fen,
  winner,
  { maxNodes = 600, maxMs = 100 } = {},
) {
  const key = `${positionKey(fen)}:${winner}`,
    known = proofs.get(key);
  if (known) return known;
  const root = new Chess(fen);
  if (materialImpossible(root, winner)) return { verdict: "impossible" };
  const start = Date.now(),
    queue = [{ fen, path: [] }],
    seen = new Set([positionKey(fen)]);
  let index = 0;
  while (
    index < queue.length &&
    index < maxNodes &&
    Date.now() - start < maxMs
  ) {
    const node = queue[index++],
      c = new Chess(node.fen);
    if (c.isCheckmate()) {
      if (c.turn() !== colorName(winner)) {
        remember(fen, winner, node.path);
        return { verdict: "possible", witness: node.path };
      }
      continue;
    }
    if (c.isStalemate() || c.isInsufficientMaterial()) continue;
    const moves = c.moves({ verbose: true });
    // 先找一步將死；單憑有攻擊子力並不構成勝局證明。
    moves.sort(
      (a, b) =>
        Number(b.san.endsWith("#")) * 100 +
        Number(b.san.includes("+")) * 10 +
        Number(!!b.captured) -
        (Number(a.san.endsWith("#")) * 100 +
          Number(a.san.includes("+")) * 10 +
          Number(!!a.captured)),
    );
    for (const m of moves) {
      c.move(m.lan);
      if (c.isCheckmate() && c.turn() !== colorName(winner)) {
        const path = [...node.path, m.lan];
        remember(fen, winner, path);
        return { verdict: "possible", witness: path };
      }
      const next = c.fen(),
        normalized = positionKey(next);
      if (!seen.has(normalized)) {
        if (seen.size >= maxNodes) return { verdict: "unknown" };
        seen.add(normalized);
        queue.push({ fen: next, path: [...node.path, m.lan] });
      }
      c.undo();
    }
  }
  if (index === queue.length) return { verdict: "impossible" };
  return { verdict: "unknown" };
}
export function timeoutVerdicts(state, options) {
  const result = {};
  for (const loser of [1, -1]) {
    let proof = matingPossibility(state.fen, -loser, options);
    if (proof.verdict === "possible") {
      // 快取只保存候選證據；每次仍按本局的重複歷史和 75 步規則重放。
      try {
        let next = state;
        for (const uci of proof.witness)
          next = applyChess(next, { type: "move", uci }, next.turn);
        if (
          next.result?.reason !== "checkmate" ||
          next.result.winner !== -loser
        )
          proof = { verdict: "unknown" };
      } catch {
        proof = { verdict: "unknown" };
      }
    }
    result[loser] = {
      winner:
        proof.verdict === "possible"
          ? -loser
          : proof.verdict === "impossible"
            ? 0
            : null,
      reason:
        proof.verdict === "unknown"
          ? "unresolved"
          : proof.verdict === "impossible"
            ? "timeout-draw"
            : "timeout",
      proof: proof.verdict,
    };
  }
  return result;
}
