import assert from "node:assert/strict";
import {
  createGo,
  applyGo,
  tryMove,
  scoreGo,
  replayGo,
  compactGo,
  validateGoSave,
  handicapPoints,
  positionKey,
  exportSGF,
  createJapaneseConfirmation,
  applyJapaneseConfirmation,
} from "../../src/games/go-engine.js";
import { chooseGoMove } from "../../src/games/go-ai.js";
import {
  createClock,
  clockView,
  chargeClock,
  formatGoClock,
} from "../../src/games/go-clock.js";
let tests = 0;
const test = (name, fn) => {
  fn();
  tests++;
  console.log("PASS", name);
};
const fixture = (rule, rows, turn = 1) => {
  const s = createGo({ rule, size: 9 });
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length; x++)
      s.board[y * 9 + x] = rows[y][x] === "B" ? 1 : rows[y][x] === "W" ? -1 : 0;
  s.turn = turn;
  s.history = [{ p: positionKey(s.board), s: positionKey(s.board, turn) }];
  return s;
};
test("three fixed presets and sizes", () => {
  for (const rule of ["__proto__", "constructor", "toString", ["chinese"]])
    assert.throws(() => createGo({ rule, komi: 7.5 }), /Invalid/);
  for (const rule of ["chinese", "japanese", "aga"])
    for (const size of [9, 13, 19])
      assert.equal(createGo({ rule, size }).board.length, size ** 2);
});
test("capture precedes own-liberty check", () => {
  const s = fixture("chinese", [".WB", "WB.", "B.."]);
  const out = applyGo(s, { type: "move", index: 0 });
  assert.equal(out.captures[1], 2);
  assert.equal(out.board[1], 0);
  assert.equal(out.board[9], 0);
});
test("suicide and overwrite rejected without mutation", () => {
  const s = fixture("aga", [".W.", "W.."]),
    before = JSON.stringify(s);
  assert.throws(() => applyGo(s, { type: "move", index: 0 }), /Suicide/);
  assert.throws(() => applyGo(s, { type: "move", index: 1 }), /occupied/);
  assert.equal(JSON.stringify(s), before);
});
test("simple ko and superko distinguish pass", () => {
  for (const rule of ["chinese", "japanese", "aga"]) {
    const s = fixture(rule, [".BW.", "BW.W", ".BW."]);
    const n = applyGo(s, { type: "move", index: 11 });
    assert.equal(n.ko, 10);
    assert.throws(() => tryMove(n, 10), /ko/);
    assert.doesNotThrow(() => applyGo(n, { type: "pass" }));
  }
});
test("positional and situational superko use exact histories", () => {
  const s = createGo();
  const m = tryMove(s, 40);
  s.history.push({ p: m.p, s: m.s });
  assert.throws(() => tryMove(s, 40), /superko/);
  s.config.rule = "aga";
  s.history[1].s = positionKey(m.board, 1);
  assert.doesNotThrow(() => tryMove(s, 40));
  s.history[1].s = m.s;
  assert.throws(() => tryMove(s, 40), /superko/);
});
test("handicap placements are distinct and complete", () => {
  for (const size of [9, 13, 19])
    for (let n = 2; n <= 9; n++)
      assert.equal(new Set(handicapPoints(size, n).map(String)).size, n);
});
test("AGA white last pass and pass stones", () => {
  let s = createGo({ rule: "aga" });
  s = applyGo(s, { type: "move", index: 40 });
  s = applyGo(s, { type: "pass" });
  s = applyGo(s, { type: "pass" });
  assert.equal(s.phase, "playing");
  s = applyGo(s, { type: "pass" });
  assert.equal(s.phase, "scoring");
  assert.equal(s.passStones[1], 2);
  assert.equal(s.passStones[-1], 1);
});
test("marks revoke confirmations and agreement ends only after both", () => {
  let s = createGo();
  s = applyGo(s, { type: "pass" });
  s = applyGo(s, { type: "pass" });
  s = applyGo(s, { type: "confirm" }, 1);
  assert.equal(s.phase, "scoring");
  s = applyGo(s, { type: "mark", dead: [], seki: [] }, -1);
  assert.deepEqual(s.proposal.confirmations, []);
  s = applyGo(s, { type: "confirm" }, 1);
  s = applyGo(s, { type: "confirm" }, -1);
  assert.equal(s.phase, "finished");
  assert.equal(s.result.winner, -1);
});
test("Japanese seki eyes are not territory; Chinese area remains", () => {
  const s = fixture("japanese", ["BB.", "B.B", ".BB"]);
  s.proposal.seki = [0];
  assert.equal(scoreGo(s).territory[1], 0);
  s.config.rule = "chinese";
  assert.ok(scoreGo(s).territory[1] >= 1);
});
test("resumption uses rule-specific player", () => {
  for (const rule of ["japanese", "chinese", "aga"]) {
    let s = createGo({ rule });
    s = applyGo(s, { type: "pass" });
    s = applyGo(s, { type: "pass" });
    s = applyGo(s, { type: "dispute" }, 1);
    s = applyGo(s, { type: "resume" }, 1);
    assert.equal(s.turn, rule === "japanese" ? -1 : 1);
  }
});
test("compact replay and SGF retain setup and outcome", () => {
  let s = createGo({ rule: "aga", size: 13, handicap: 3, komi: 0.5 });
  s = applyGo(s, { type: "move", index: 84 });
  s = applyGo(s, { type: "resign" }, 1);
  assert.deepEqual(replayGo(compactGo(s).config, compactGo(s).log), s);
  assert.match(exportSGF(s), /SZ\[13\].*HA\[3\].*RE\[W\+R\]/);
});
test("AI always returns a legal move and is seed deterministic", () => {
  const s = createGo();
  for (let level = 1; level <= 3; level++) {
    const a = chooseGoMove(s, level, 10);
    assert.deepEqual(a, chooseGoMove(s, level, 10));
    assert.doesNotThrow(() => applyGo(s, a));
  }
});
test("byoyomi clock resets each move, consumes periods, expires at deadline", () => {
  let c = createClock(9, 1000);
  c = chargeClock(c, 1, 311000);
  assert.equal(c.remaining[1], 0);
  assert.equal(c.periods[1], 3);
  c = chargeClock(c, 1, 342000);
  assert.equal(c.periods[1], 2);
  assert.equal(clockView(c, 1, 382000).expired, true);
  assert.equal(formatGoClock(c, 1, 382000), "0:00 · 0×");
  assert.equal(
    formatGoClock(createClock(9, 0), 1, 1000, false, true),
    "0:00 · 0×",
  );
});
test("Japanese post-stop confirmation requires a ko-specific pass, not an ordinary threat", () => {
  const s = fixture("japanese", [".BW.", "BW.W", ".BW."]);
  s.phase = "scoring";
  const original = JSON.stringify(s);
  let v = createJapaneseConfirmation(s, 1);
  v = applyJapaneseConfirmation(v, { type: "move", index: 11 });
  assert.throws(
    () => applyJapaneseConfirmation(v, { type: "move", index: 10 }),
    /ko/,
  );
  v = applyJapaneseConfirmation(v, { type: "move", index: 80 });
  v = applyJapaneseConfirmation(v, { type: "move", index: 79 });
  assert.throws(
    () => applyJapaneseConfirmation(v, { type: "move", index: 10 }),
    /ko/,
  );
  v = applyJapaneseConfirmation(v, { type: "pass-ko", index: 10 });
  v = applyJapaneseConfirmation(v, { type: "move", index: 78 });
  assert.doesNotThrow(() =>
    applyJapaneseConfirmation(v, { type: "move", index: 10 }),
  );
  assert.equal(JSON.stringify(s), original);
});
test("Japanese both-lose needs mutual agreement in a stopped disputed game", () => {
  let s = createGo({ rule: "japanese" });
  assert.throws(() => applyGo(s, { type: "both-lose" }), /dispute/);
  s = applyGo(s, { type: "pass" });
  s = applyGo(s, { type: "pass" });
  s = applyGo(s, { type: "dispute" }, 1);
  s = applyGo(s, { type: "both-lose" }, 1);
  assert.equal(s.phase, "disputed");
  s = applyGo(s, { type: "both-lose" }, -1);
  assert.equal(s.result.reason, "both-lose");
});
test("private Go saves retain both practice clocks and reject oversized records", () => {
  const input = {
    game: "go",
    name: "My Go",
    mode: "local",
    state: compactGo(createGo()),
    practice_clock: { 1: 1200, "-1": 3400 },
  };
  const saved = validateGoSave(input);
  assert.equal(saved.elapsed, 4600);
  assert.deepEqual(saved.practice_clock, input.practice_clock);
  assert.throws(
    () => validateGoSave({ ...input, padding: "x".repeat(240000) }),
    /too large/,
  );
  assert.throws(() => validateGoSave({ ...input, name: "" }), /Invalid/);
});
console.log(`${tests} Go core checks passed.`);
