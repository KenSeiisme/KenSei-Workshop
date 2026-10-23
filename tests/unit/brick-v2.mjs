import assert from "node:assert/strict";
import {
  create,
  apply,
  advanceBrick,
  replayBrick,
  validate,
  BRICK,
  brickRect,
  paddleWidth,
  paddleCenter,
} from "../../src/games/brick-v2-engine.js";
import {
  create as dispatchCreate,
  replay,
  validateSave,
  gameVersion,
} from "../../src/games/engine.js";
const q = BRICK.scale,
  make = (seed = 42) => create("brick-breaker", "classic", seed);
function flying(s, extra = {}) {
  Object.assign(
    s.balls[0],
    { launched: true, x: 320 * q, y: 300 * q, vx: 2 * q, vy: 0 },
    extra,
  );
}
function catchDrop(s, kind) {
  s.drops = [
    {
      id: s.nextDropId++,
      kind,
      x: paddleCenter(s),
      y: (BRICK.paddleY - 9) * q - 1,
    },
  ];
  advanceBrick(s, s.ticks + 1);
}
for (const seed of [1, 42, 159, 4294967295]) {
  const s = make(seed);
  assert.deepEqual(s, make(seed));
  assert.deepEqual(s.powerBricks.filter(Boolean).sort(), [1, 2, 3]);
  assert(s.powerBricks.every((x, i) => !x || s.bricks[i]));
  validate(s);
}
assert.equal(gameVersion("brick-breaker"), 2);
assert.equal(gameVersion("snake"), 1);
assert.equal(dispatchCreate("brick-breaker", "classic", 1).version, 2);
assert.equal(dispatchCreate("brick-breaker", "classic", 1, 1).version, 1);
let s = make();
flying(s);
catchDrop(s, 1);
assert.equal(s.balls.length, 3);
assert.equal(s.lives, 3);
assert.equal(s.pickups, 1);
const ids = s.balls.map((b) => b.id);
assert.equal(new Set(ids).size, 3);
catchDrop(s, 1);
assert.equal(s.balls.length, 3);
assert.equal(s.lastPickup, "Max balls");
assert.equal(s.score, 0);
for (const kind of [2, 3]) {
  s = make();
  flying(s);
  catchDrop(s, kind);
  const key = kind === 2 ? "wideUntil" : "slowUntil",
    length = kind === 2 ? 720 : 480;
  assert.equal(s[key], s.ticks + length);
  if (kind === 2) assert.equal(paddleWidth(s), 138);
  advanceBrick(s, s.ticks + 30);
  catchDrop(s, kind);
  assert.equal(s[key], s.ticks + length);
  const end = s[key];
  advanceBrick(s, end);
  assert.equal(s[key], end);
  if (kind === 2) assert.equal(paddleWidth(s), 92);
}
s = make();
flying(s);
catchDrop(s, 1);
s.balls[0].y = 487 * q;
advanceBrick(s, s.ticks + 1);
assert.equal(s.balls.length, 2);
assert.equal(s.lives, 3);
s.balls.forEach((b) => Object.assign(b, { y: 487 * q, vy: q }));
advanceBrick(s, s.ticks + 1);
assert.equal(s.lives, 2);
assert.equal(s.balls.length, 1);
assert.equal(s.balls[0].launched, false);
assert.equal(s.wideUntil, 0);
s = make();
s.powerBricks.fill(0);
s.powerBricks[0] = 1;
const r = brickRect(0);
flying(s, { x: r.x + r.w / 2, y: r.y + r.h + 6 * q + 100, vx: 0, vy: -1000 });
s.balls.push({ ...s.balls[0], id: s.nextBallId++ });
advanceBrick(s, 1);
assert.equal(s.score, 10);
assert.equal(s.drops.length, 1);
assert.equal(s.bricks[0], 0);
s = make();
for (let stage = 0; stage < 3; stage++) {
  const index = s.bricks.findIndex(Boolean),
    rect = brickRect(index);
  s.bricks.fill(0);
  s.bricks[index] = 1;
  s.powerBricks.fill(0);
  s.drops = [];
  flying(s, {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h + 6 * q + 100,
    vx: 0,
    vy: -1000,
  });
  s.wideUntil = s.ticks + 100;
  s.slowUntil = s.ticks + 100;
  advanceBrick(s, s.ticks + 1);
  assert.equal(s.drops.length, 0);
  assert.equal(s.wideUntil, 0);
  assert.equal(s.slowUntil, 0);
  if (stage < 2) {
    assert.equal(s.stage, stage + 1);
    assert.equal(s.balls.length, 1);
    assert(!s.balls[0].launched);
  }
}
assert.equal(s.status, "won");
assert.equal(s.balls.length, 0);
for (const hz of [30, 60, 120, 144]) {
  const state = make(11);
  apply(state, { type: "launch", tick: 0 });
  for (let f = 1; f <= hz * 20; f++)
    advanceBrick(state, Math.floor((f * 60) / hz));
  const direct = make(11);
  apply(direct, { type: "launch", tick: 0 });
  advanceBrick(direct, 1200);
  assert.deepEqual(state, direct);
}
const ended = make(11);
apply(ended, { type: "launch", tick: 0 });
const events = [[0, -1]];
while (ended.status === "playing") {
  if (
    !ended.balls[0]?.launched &&
    apply(ended, { type: "launch", tick: ended.ticks })
  )
    events.push([ended.ticks, -1]);
  advanceBrick(ended, Math.min(18000, ended.ticks + 1));
}
assert.deepEqual(
  replayBrick(
    "classic",
    11,
    events,
    ended.ticks,
    (ended.ticks / 60) * 1000,
    "paddle-v2",
  ).score,
  ended.score,
);
assert.equal(
  replay(
    "brick-breaker",
    "classic",
    11,
    events,
    ended.ticks,
    (ended.ticks / 60) * 1000,
    "paddle-v2",
    2,
  ).score,
  ended.score,
);
assert.throws(() =>
  replayBrick("classic", 11, events, ended.ticks, 300000, "paddle-v1"),
);
assert.throws(() =>
  replayBrick("classic", 11, events, ended.ticks, 1, "paddle-v2"),
);
assert.throws(() =>
  replayBrick("classic", 11, [[0, 2048]], 18000, 300000, "paddle-v2"),
);
validateSave({
  game: "brick-breaker",
  difficulty: "classic",
  state: make(),
  elapsed: 0,
});
const legacy = dispatchCreate("brick-breaker", "classic", 3, 1);
validateSave({
  game: "brick-breaker",
  difficulty: "classic",
  state: legacy,
  elapsed: 0,
});
const bad = make();
bad.balls.push({ ...bad.balls[0] });
assert.throws(() => validate(bad));
const worst = make();
flying(worst, { vx: 5 * q });
worst.balls.push(
  { ...worst.balls[0], id: worst.nextBallId++, y: 260 * q },
  { ...worst.balls[0], id: worst.nextBallId++, y: 340 * q },
);
const began = performance.now();
advanceBrick(worst, 18000);
const took = performance.now() - began;
assert.equal(worst.ticks, 18000);
assert.equal(worst.reason, "timeout");
assert.equal(worst.bricks.filter(Boolean).length, 40);
// 完整合法操作通关，不修改砖块/球状态，验证浏览器与服务端共享入口。
const full = make(12345),
  fullEvents = [];
while (full.status === "playing") {
  if (full.ticks % 2 === 0) {
    const ball =
      full.balls
        .filter((b) => b.launched)
        .sort((a, b) => (b.vy > 0 ? b.y : -1) - (a.vy > 0 ? a.y : -1))[0] ||
      full.balls[0];
    const width = paddleWidth(full);
    const x = Math.max(
      0,
      Math.min(
        1024,
        Math.round(((ball.x / q - width / 2) / (640 - width)) * 1024),
      ),
    );
    if (
      x !== full.paddle &&
      apply(full, { type: "paddle", tick: full.ticks, x })
    )
      fullEvents.push([full.ticks, x]);
  }
  if (
    !full.balls.some((b) => b.launched) &&
    apply(full, { type: "launch", tick: full.ticks })
  )
    fullEvents.push([full.ticks, -1]);
  advanceBrick(full, full.ticks + 1);
}
assert.equal(full.status, "won");
assert.equal(full.score, 980);
assert(full.pickups > 0);
assert.deepEqual(
  replay(
    "brick-breaker",
    "classic",
    12345,
    fullEvents,
    full.ticks,
    (full.ticks * 1000) / 60,
    "paddle-v2",
    2,
  ),
  { ...metricsForTest(full), elapsed_ms: Math.round((full.ticks * 1000) / 60) },
);
function metricsForTest(s) {
  return {
    score: s.score,
    moves: s.moves,
    max_tile: 0,
    won: s.status === "won",
  };
}
console.log(
  `PASS Brick v2: seeded drops, three-ball cap, timed refresh/expiry, last-ball life, simultaneous hit, stage cleanup, legacy saves, versioned replay, refresh-rate equality; worst 3-ball simulation ${took.toFixed(1)}ms.`,
);
