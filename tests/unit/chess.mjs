import assert from "node:assert/strict";
import {
  Chess,
  createChess,
  applyChess,
  chessMoves,
  claimsAvailable,
  replayChess,
  compactChess,
  exportChessPGN,
  importChessPGN,
  validateChessSave,
  createChessClock,
  chargeChessClock,
  chessClockView,
} from "../../src/games/chess-engine.js";
import {
  matingPossibility,
  timeoutVerdicts,
} from "../../src/games/chess-adjudication.js";
let groups = 0;
const play = (s, moves) =>
  moves.reduce((next, uci) => applyChess(next, { type: "move", uci }), s);
function perft(c, depth) {
  if (!depth) return 1;
  let n = 0;
  for (const m of c.moves()) {
    c.move(m);
    n += perft(c, depth - 1);
    c.undo();
  }
  return n;
}
assert.equal(perft(new Chess(), 3), 8902);
const kiwi = new Chess(
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
);
assert.equal(perft(kiwi, 1), 48);
assert.equal(perft(kiwi, 2), 2039);
groups++;
let s = createChess();
assert.equal(chessMoves(s).length, 20);
assert.throws(() => applyChess(s, { type: "move", uci: "e2e5" }), /not legal/);
assert.throws(() => applyChess(s, { type: "move", uci: "e2e4" }, -1), /turn/);
s = play(s, ["f2f3", "e7e5", "g2g4", "d8h4"]);
assert.equal(s.result.winner, -1);
assert.equal(s.result.reason, "checkmate");
groups++;
const castling = createChess({}, "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
assert.ok(chessMoves(castling, "e1").some((m) => m.lan === "e1g1"));
assert.ok(chessMoves(castling, "e1").some((m) => m.lan === "e1c1"));
assert.equal(
  new Chess(applyChess(castling, { type: "move", uci: "e1g1" }).fen).get("f1")
    .type,
  "r",
);
const attacked = createChess({}, "4kr2/8/8/8/8/8/8/4K2R w K - 0 1");
assert.equal(
  chessMoves(attacked, "e1").some((m) => m.lan === "e1g1"),
  false,
);
const ep = createChess({}, "k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
assert.equal(
  chessMoves(ep, "e5").some((m) => m.lan === "e5d6"),
  false,
);
groups++;
for (const piece of ["q", "r", "b", "n"]) {
  const promotion = createChess({}, "7k/P7/8/8/8/8/8/7K w - - 0 1");
  assert.equal(
    new Chess(
      applyChess(promotion, { type: "move", uci: "a7a8" + piece }).fen,
    ).get("a8").type,
    piece,
  );
}
groups++;
const loop = ["g1f3", "g8f6", "f3g1", "f6g8"];
s = play(createChess(), [...loop, ...loop]);
assert.equal(s.phase, "playing");
assert.equal(claimsAvailable(s).repetition, true);
assert.equal(
  applyChess(s, { type: "claim-draw" }).result.reason,
  "threefold-claim",
);
let before = play(createChess(), [...loop, ...loop.slice(0, 3)]);
assert.equal(claimsAvailable(before, "f6g8").repetition, true);
const claimed = applyChess(before, { type: "claim-draw", uci: "f6g8" });
assert.equal(claimed.fen, before.fen);
s = play(createChess(), [...loop, ...loop, ...loop, ...loop]);
assert.equal(s.result.reason, "fivefold");
groups++;
s = createChess({}, "7k/8/8/8/8/8/R7/K7 w - - 99 1");
assert.equal(claimsAvailable(s, "a2a3").fifty, true);
assert.equal(
  applyChess(s, { type: "claim-draw", uci: "a2a3" }).result.reason,
  "fifty-claim",
);
assert.equal(
  play(createChess({}, "7k/8/8/8/8/8/R7/K7 w - - 149 1"), ["a2a3"]).result
    .reason,
  "seventy-five",
);
const mate75 = play(createChess({}, "k7/2K5/2N5/3N4/8/8/8/8 w - - 149 1"), [
  "d5b6",
]);
assert.equal(mate75.result.reason, "checkmate");
groups++;
s = createChess();
assert.throws(() => applyChess(s, { type: "claim-draw" }), /not valid/);
s = applyChess(s, { type: "offer-draw" }, 1);
assert.throws(() => applyChess(s, { type: "accept-draw" }, 1), /no opponent/);
assert.equal(applyChess(s, { type: "accept-draw" }, -1).result.winner, 0);
assert.equal(play(s, ["e2e4", "e7e5"]).offer, null);
groups++;
assert.equal(createChess({}, "7k/8/8/8/8/8/8/K7 w - - 0 1").result.winner, 0);
for (const [fen, color] of [
  ["k7/2K5/2N5/3N4/8/8/8/8 w - - 0 1", 1],
  ["8/8/8/8/1n6/8/B7/K1k5 b - - 2 1", -1],
  ["8/8/8/8/1b6/8/B1k5/K7 b - - 0 1", -1],
]) {
  const proof = matingPossibility(fen, color);
  assert.equal(proof.verdict, "possible");
  const c = new Chess(fen);
  for (const uci of proof.witness) c.move(uci);
  assert.ok(c.isCheckmate());
}
assert.equal(
  matingPossibility("7k/8/8/8/8/8/R7/K7 w - - 0 1", -1).verdict,
  "impossible",
);
assert.equal(
  matingPossibility("1k6/8/8/8/p1p1p1p1/PpPpPpPp/1P1P1P1P/1K6 w - - 0 1", 1, {
    maxNodes: 2000,
    maxMs: 10000,
  }).verdict,
  "impossible",
);
assert.equal(timeoutVerdicts(createChess())[1].winner, -1);
const blockedWitness = createChess();
const afterFirst = applyChess(blockedWitness, { type: "move", uci: "e2e4" });
blockedWitness.repetitions[afterFirst.fen.split(" ").slice(0, 4).join(" ")] = 4;
assert.equal(
  timeoutVerdicts(blockedWitness)[-1].winner,
  null,
  "A cached mate witness cannot cross automatic fivefold draw",
);
let review = applyChess(createChess(), { type: "request-review" }, 1);
review = applyChess(review, { type: "move", uci: "e2e4" }, 1);
review = applyChess(review, { type: "request-review" }, -1);
assert.equal(
  review.phase,
  "playing",
  "Moving clears old unresolved-review consent",
);
groups++;
let clock = createChessClock("5+3", 1000);
clock = chargeChessClock(clock, 1, 3000, true);
assert.equal(clock.remaining[1], 301000);
clock = chargeChessClock(clock, -1, 5000, false);
assert.equal(clock.remaining[-1], 298000);
assert.equal(chessClockView(clock, -1, 6000, -1).remaining, 297000);
groups++;
s = play(createChess(), ["e2e4", "e7e5", "g1f3"]);
assert.equal(replayChess(compactChess(s)).fen, s.fen);
const pgn = exportChessPGN(s, { white: "White tester", black: "Black tester" });
assert.match(pgn, /White tester/);
assert.equal(importChessPGN(pgn).fen, s.fen);
assert.throws(() => importChessPGN("1. e4 (1. d4)"), /main line/);
assert.throws(() => createChess({}, "not a fen"), /FEN/);
assert.throws(() => createChess({}, "8/8/8/8/8/8/k7/K7 w - - 0 1"), /king/);
assert.equal(
  validateChessSave({
    game: "chess",
    name: "Test",
    state: compactChess(s),
    mode: "ai",
    level: 2,
    human: 1,
  }).game,
  "chess",
);
groups++;
console.log(
  `Chess rules: ${groups} groups passed (perft, legality, claims, automatic endings, proven mate, clocks, replay and PGN).`,
);
