import assert from "node:assert/strict";
import fs from "node:fs";
import {
  XiangqiPosition,
  XIANGQI_START,
  checkedXiangqiFen,
  squareName,
  squareIndex,
} from "../../src/games/xiangqi-position.js";
import {
  repetitionSequence,
  judgeCycle,
} from "../../src/games/xiangqi-repetition.js";
import {
  createXiangqi,
  applyXiangqi,
  compactXiangqi,
  replayXiangqi,
  validateXiangqiSave,
  exportXiangqiText,
  exportXiangqiJSON,
  importXiangqiRecord,
  createXiangqiClock,
  chargeXiangqiClock,
  xiangqiClockView,
} from "../../src/games/xiangqi-engine.js";
const data = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/xiangqi/wxf2018-diagrams.json", import.meta.url),
  ),
);
assert.equal(data.fixtures.length, 110);
assert.deepEqual(
  data.fixtures.map((x) => x.diagram),
  Array.from({ length: 110 }, (_, i) => i + 1),
);
function mirrored(fen) {
  const p = new XiangqiPosition(fen),
    original = p.pieces;
  p.pieces = original
    .slice()
    .reverse()
    .map((x) => (x ? { ...x, color: x.color === "w" ? "b" : "w" } : null));
  p.color = p.color === "w" ? "b" : "w";
  return p.fen();
}
const mirrorMove = (move) =>
  [move.slice(0, 2), move.slice(2)]
    .map(
      (s) =>
        String.fromCharCode(105 - (s.charCodeAt(0) - 97)) + (9 - Number(s[1])),
    )
    .join("");
for (const fixture of data.fixtures)
  for (const mirror of [false, true]) {
    const moves = [
      ...fixture.prefix,
      ...Array.from(
        { length: fixture.cyclesToPlay },
        () => fixture.cycle,
      ).flat(),
    ];
    const frames = repetitionSequence(
      mirror ? mirrored(fixture.startFen) : fixture.startFen,
      mirror ? moves.map(mirrorMove) : moves,
    );
    const result = judgeCycle(frames);
    const expected =
      fixture.expected.result === "draw"
        ? 0
        : fixture.expected.winner === "red"
          ? 1
          : -1;
    assert.equal(
      result ? (result.offender ? -result.offender : 0) : null,
      mirror && expected ? -expected : expected,
      `Official diagram ${fixture.diagram}, mirror=${mirror}`,
    );
  }
console.log("PASS 110 official WXF rulings and 110 color/board symmetries");

const position = new XiangqiPosition();
assert.equal(position.moves().length, 44);
let depth2 = 0;
for (const m of position.moves()) {
  const p = position.clone();
  p.move(m.uci);
  depth2 += p.moves().length;
}
assert.equal(depth2, 1920);
assert.equal(checkedXiangqiFen(XIANGQI_START), XIANGQI_START);
assert.equal(squareName(squareIndex("i9")), "i9");
assert.throws(() => position.move("b0b2"), /legal/);
assert.throws(() => position.move("e0e9"), /legal/);
assert.throws(() => position.move("a10a9"), /Invalid/);
assert.throws(
  () => checkedXiangqiFen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"),
  /check/,
);
let state = createXiangqi();
const original = JSON.stringify(state);
state = applyXiangqi(state, { type: "move", uci: "e3e4" });
assert.equal(state.turn, -1);
assert.equal(state.last.to, "e4");
assert.equal(JSON.stringify(createXiangqi()), original);
state = applyXiangqi(state, { type: "move", uci: "e6e5" });
assert.equal(replayXiangqi(compactXiangqi(state)).fen, state.fen);
assert.equal(importXiangqiRecord(exportXiangqiText(state)).fen, state.fen);
assert.equal(importXiangqiRecord(exportXiangqiJSON(state)).fen, state.fen);
assert.throws(
  () => applyXiangqi(state, { type: "move", uci: "a0a1" }, -1),
  /turn/,
);
const offered = applyXiangqi(state, { type: "offer-draw" }, 1);
assert.throws(
  () => applyXiangqi(offered, { type: "accept-draw" }, 1),
  /opponent/,
);
assert.equal(
  applyXiangqi(offered, { type: "accept-draw" }, -1).result.reason,
  "agreement",
);
assert.equal(applyXiangqi(state, { type: "resign" }, 1).result.winner, -1);
const resigned = compactXiangqi(applyXiangqi(state, { type: "resign" }, 1));
assert.throws(
  () =>
    replayXiangqi({ ...resigned, result: { winner: 1, reason: "timeout" } }),
  /Invalid Xiangqi result/,
);
assert.throws(
  () =>
    replayXiangqi({
      ...compactXiangqi(state),
      result: { winner: 1, reason: "interrupted" },
    }),
  /Invalid Xiangqi result/,
);
assert.equal(
  JSON.parse(exportXiangqiJSON(state, { red: "Red fixture" })).players.red,
  "Red fixture",
);
assert.equal(
  validateXiangqiSave({
    game: "xiangqi",
    name: "Example",
    mode: "ai",
    level: 2,
    human: 1,
    state: compactXiangqi(state),
  }).game,
  "xiangqi",
);
assert.throws(() =>
  validateXiangqiSave({
    game: "xiangqi",
    name: "Example",
    mode: "online",
    level: 2,
    human: 1,
    state: compactXiangqi(state),
  }),
);

let natural = { ...createXiangqi(), naturalPlies: 99 };
assert.equal(
  applyXiangqi(natural, { type: "move", uci: "e3e4" }).result.reason,
  "natural-limit",
  "Pawn advance must not reset natural count",
);
natural = { ...createXiangqi(), naturalPlies: 99, checks: { 1: 12, "-1": 12 } };
assert.equal(
  applyXiangqi(natural, { type: "move", uci: "e3e4" }).phase,
  "playing",
);
let clock = createXiangqiClock("5+3", 1000);
clock = chargeXiangqiClock(clock, 1, 3000, true);
assert.equal(clock.remaining[1], 301000);
assert.equal(xiangqiClockView(clock, -1, 5000, -1).remaining, 298000);
assert.throws(() => chargeXiangqiClock(clock, -1, 1000000, true), /expired/);

let lawful = createXiangqi();
const horseCycle = ["b0c2", "b9c7", "c2b0", "c7b9"];
for (let returns = 1; returns <= 4; returns++) {
  for (const uci of horseCycle)
    lawful = applyXiangqi(lawful, { type: "move", uci });
  assert.equal(lawful.phase, returns < 4 ? "playing" : "finished");
}
assert.deepEqual(lawful.result, { winner: 0, reason: "lawful-repetition" });

const fixture = data.fixtures[0];
let warningGame = createXiangqi({}, fixture.startFen);
const line = [
  ...fixture.prefix,
  ...Array.from({ length: 8 }, () => fixture.cycle).flat(),
];
let warned = false;
for (const move of line) {
  if (warningGame.phase === "finished") break;
  warningGame = applyXiangqi(warningGame, { type: "move", uci: move });
  if (warningGame.warning) warned = true;
}
assert.equal(warned, true, "Warn before a repetition forfeit");
assert.equal(warningGame.result.winner, -1);
assert.equal(warningGame.result.reason, "perpetual-check");
assert.equal(
  replayXiangqi(compactXiangqi(warningGame)).result.reason,
  "perpetual-check",
);
console.log(
  "PASS Xiangqi legality, 44/1920 perft, immutable replay, ICCS/JSON, claims, clocks, natural count and warning-before-loss",
);
