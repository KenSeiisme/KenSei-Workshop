import assert from "node:assert/strict";
import {
  create,
  apply,
  advanceDrop,
  ghost,
  pieceCells,
  validate,
  replayDrop,
  INPUTS,
  metrics,
} from "../../src/games/block-drop-engine.js";
import { validateSave, replay } from "../../src/games/engine.js";
const make = (seed = 42, mode = "classic") => create("block-drop", mode, seed);
let s = make();
assert.deepEqual(s, make());
assert.equal(new Set([s.piece.id, ...s.queue.slice(0, 6)]).size, 7);
assert.equal(
  pieceCells(0, 1).every(([x]) => x === 2),
  true,
);
const before = structuredClone(s);
assert.ok(apply(s, { type: "drop-input", input: "hold", tick: 0 }));
assert.equal(s.hold, before.piece.id);
assert.equal(apply(s, { type: "drop-input", input: "hold", tick: 0 }), false);
assert.equal(
  ghost(s).every(([, y]) => y < 20),
  true,
);
for (const hz of [30, 60, 120, 144]) {
  const state = make();
  for (let f = 1; f <= hz * 8; f++)
    advanceDrop(state, Math.floor((f * 60) / hz));
  const expected = make();
  advanceDrop(expected, 480);
  assert.deepEqual(state, expected);
}
s = make();
s.piece = { id: 0, rotation: 1, x: 7, y: 0 };
assert.ok(apply(s, { type: "drop-input", input: "cw", tick: 0 }));
assert.ok(s.piece.x < 7, "I piece rotates using wall kick");
s = make();
s.piece = { id: 0, rotation: 1, x: 2, y: 15 };
for (let y = 16; y < 20; y++)
  for (let x = 0; x < 10; x++) if (x !== 4) s.board[(y + 4) * 10 + x] = 2;
assert.ok(apply(s, { type: "drop-input", input: "hard", tick: 0 }));
assert.equal(s.lines, 4);
assert.equal(s.lastGain, 800);
assert.equal(s.board.filter(Boolean).length, 0);
s = make(42, "sprint");
s.lines = 36;
s.level = 4;
s.piece = { id: 0, rotation: 1, x: 2, y: 15 };
for (let y = 16; y < 20; y++)
  for (let x = 0; x < 10; x++) if (x !== 4) s.board[(y + 4) * 10 + x] = 2;
apply(s, { type: "drop-input", input: "hard", tick: 0 });
assert.equal(s.status, "won");
assert.equal(s.lines, 40);
assert.equal(s.lastGain, 3200);
assert.equal(s.score, 3202);
s = make();
apply(s, { type: "drop-input", input: "left-down", tick: 0 });
const x = s.piece.x;
advanceDrop(s, 9);
assert.equal(s.piece.x, x);
advanceDrop(s, 10);
assert.equal(s.piece.x, x - 1);
apply(s, { type: "drop-input", input: "left-up", tick: 10 });
advanceDrop(s, 40);
assert.equal(s.piece.x, x - 1);
validateSave({
  game: "block-drop",
  difficulty: "classic",
  state: s,
  elapsed: 1000,
});
for (const edit of [
  (v) => v.board.push(0),
  (v) => (v.piece.id = 8),
  (v) => (v.queue[0] = 99),
  (v) => (v.held.left = "yes"),
  (v) => (v.lines = -1),
]) {
  const invalid = structuredClone(s);
  edit(invalid);
  assert.throws(() => validate(invalid));
}
s = make();
const events = [];
for (let i = 0; s.status === "playing" && i < 40; i++) {
  const tick = i * 30;
  advanceDrop(s, tick);
  if (s.status !== "playing") break;
  const input = { type: "drop-input", input: "hard", tick };
  assert.ok(apply(s, input));
  events.push([tick, INPUTS.indexOf("hard")]);
}
assert.equal(s.status, "lost");
assert.deepEqual(
  replayDrop(
    "classic",
    42,
    events,
    s.ticks,
    (s.ticks / 60) * 1000,
    "block-drop-v1",
  ),
  { ...metrics(s), elapsed_ms: Math.max(1, Math.round((s.ticks / 60) * 1000)) },
);
assert.deepEqual(
  replay(
    "block-drop",
    "classic",
    42,
    events,
    s.ticks,
    (s.ticks / 60) * 1000,
    "block-drop-v1",
  ).lines,
  s.lines,
);
assert.throws(() =>
  replayDrop("classic", 42, events, s.ticks, 10, "block-drop-v1"),
);
assert.throws(() =>
  replayDrop("classic", 42, [[1, 99]], 2, 100, "block-drop-v1"),
);
console.log(
  "PASS Block Drop: bags, SRS wall kick, hold, ghost, scoring, Sprint, repeat controls, save validation, replay and 30/60/120/144Hz equality.",
);
