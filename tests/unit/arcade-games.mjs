import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  CONFIG,
  SHAPES,
  BRICK,
  BRICK_LAYOUTS,
  create,
  apply,
  canPlace,
  availablePlacements,
  advanceBrick,
  brickRect,
  metrics,
  replayBrick,
  validate,
} from "../../src/games/arcade-engine.js";

const q = BRICK.scale;
const block = () => create("block-puzzle", "classic", 12345);
const brick = () => create("brick-breaker", "classic", 12345);
assert.equal(CONFIG["block-puzzle"].category, "Puzzle");
assert.equal(CONFIG["brick-breaker"].ranked, true);
assert.throws(() => create("brick-breaker", "unknown", 12));
assert.throws(() => create("block-puzzle", "classic", 0));
for (let seed = 1; seed < 40; seed++) {
  assert.deepEqual(
    create("block-puzzle", "classic", seed),
    create("block-puzzle", "classic", seed),
  );
  validate(create("block-puzzle", "classic", seed));
  validate(create("brick-breaker", "classic", seed));
}
for (let slot = 0; slot < 3; slot++)
  assert(availablePlacements(block(), slot).length);
{
  const s = block();
  s.hand = [0, 0, 0];
  assert(apply(s, { type: "place", slot: 0, index: 0 }));
  const previous = JSON.stringify(s);
  assert(!apply(s, { type: "place", slot: 1, index: 0 }));
  assert.equal(
    JSON.stringify(s),
    previous,
    "An invalid placement must not change a save",
  );
  assert(!apply(s, { type: "place", slot: 0, index: 2 }));
  assert(apply(s, { type: "place", slot: 1, index: 1 }));
  assert(apply(s, { type: "place", slot: 2, index: 2 }));
  assert(
    s.hand.every(Number.isInteger),
    "Only using all three pieces replenishes the hand",
  );
  assert.equal(s.score, 3);
  assert.equal(s.moves, 3);
  validate(s);
}
{
  const s = block();
  s.hand[0] = 0;
  for (let i = 0; i < 8; i++) {
    if (i !== 3) {
      s.board[3 * 8 + i] = 1;
      s.board[i * 8 + 3] = 1;
    }
  }
  assert(apply(s, { type: "place", slot: 0, index: 27 }));
  assert.equal(
    s.lastClear.length,
    15,
    "Crossing row/column shares exactly one cleared cell",
  );
  assert.equal(s.score, 21);
  assert.equal(s.cleared, 2);
  assert(s.board.every((n) => n === 0));
}
{
  const s = block();
  s.hand = [1, 2, 9];
  assert(!canPlace(s, 0, 7), "Horizontal pieces cannot wrap across rows");
  assert(!canPlace(s, 1, 63), "Vertical pieces cannot exceed the board");
  s.hand = [0, 10, 10];
  s.board = Array.from({ length: 64 }, (_, i) =>
    ((i % 8) + Math.floor(i / 8)) % 2 === 0 ? 1 : 0,
  );
  assert(apply(s, { type: "place", slot: 0, index: 1 }));
  assert.equal(
    s.status,
    "lost",
    "Only the remaining pieces determine the end of a hand",
  );
}
{
  const s = block();
  s.hand[0] = SHAPES.length;
  assert.throws(() => validate(s));
  const bad = block();
  bad.board.pop();
  assert.throws(() => validate(bad));
}
{
  const a = brick(),
    b = brick();
  assert(apply(a, { type: "launch", tick: 0 }));
  assert(apply(b, { type: "launch", tick: 0 }));
  assert(
    !apply(a, { type: "launch", tick: 0 }),
    "Cannot launch an active ball twice",
  );
  for (let i = 1; i <= 300; i++) advanceBrick(a, i);
  advanceBrick(b, 27);
  advanceBrick(b, 120);
  advanceBrick(b, 300);
  assert.deepEqual(a, b, "Rendering frame grouping must not change physics");
  validate(a);
}
{
  const s = brick();
  s.ball = { x: 6 * q + 100, y: 250 * q, vx: -3000, vy: 0, launched: true };
  advanceBrick(s, 1);
  assert(s.ball.vx > 0);
  assert(s.ball.x >= 6 * q);
  const c = brick();
  c.ball = {
    x: 6 * q + 100,
    y: 6 * q + 100,
    vx: -500,
    vy: -500,
    launched: true,
  };
  advanceBrick(c, 1);
  assert(c.ball.vx > 0 && c.ball.vy > 0, "Wall corner must reflect both axes");
}
{
  const s = brick();
  const r = brickRect(0);
  s.ball = {
    x: r.x + r.w / 2,
    y: r.y + r.h + 6 * q + 100,
    vx: 0,
    vy: -1000,
    launched: true,
  };
  advanceBrick(s, 1);
  assert.equal(s.bricks[0], 0);
  assert.equal(s.score, 10);
  assert(s.ball.vy > 0);
  const t = brick();
  t.ball = {
    x: r.x - 6 * q - 100,
    y: r.y - 6 * q - 100,
    vx: 500,
    vy: 500,
    launched: true,
  };
  advanceBrick(t, 1);
  assert.equal(t.bricks[0], 0);
  assert(
    t.ball.vx < 0 && t.ball.vy < 0,
    "A swept brick corner cannot tunnel or double-score",
  );
}
{
  const s = brick();
  for (let stage = 0; stage < 3; stage++) {
    assert.equal(s.stage, stage);
    const i = s.bricks.findIndex(Boolean),
      r = brickRect(i);
    s.bricks.fill(0);
    s.bricks[i] = 1;
    s.ball = {
      x: r.x + r.w / 2,
      y: r.y + r.h + 6 * q + 100,
      vx: 0,
      vy: -1000,
      launched: true,
    };
    advanceBrick(s, s.ticks + 1);
    if (stage < 2) {
      assert.equal(s.status, "playing");
      assert(!s.ball.launched);
      assert.equal(s.bricks.join(""), BRICK_LAYOUTS[stage + 1].join(""));
    }
  }
  assert.equal(s.status, "won");
  assert.equal(s.reason, "cleared");
  assert.equal(s.score, 30);
  validate(s);
}
{
  const s = brick();
  for (let lives = 2; lives >= 0; lives--) {
    s.ball = { x: 6 * q, y: 487 * q, vx: 0, vy: 1000, launched: true };
    advanceBrick(s, s.ticks + 1);
    assert.equal(s.lives, lives);
    if (lives) assert(!s.ball.launched);
  }
  assert.equal(s.status, "lost");
  assert.equal(s.reason, "lives");
  validate(s);
}
{
  const s = brick();
  s.ball = { x: 320 * q, y: 430 * q, vx: 0, vy: 9 * q, launched: true };
  advanceBrick(s, 2);
  assert(s.ball.vy < 0, "Paddle bounce must leave the paddle upward");
  const miss = brick();
  miss.ball = { x: 6 * q, y: 430 * q, vx: 0, vy: 9 * q, launched: true };
  advanceBrick(miss, 8);
  assert.equal(miss.lives, 2, "Missing the paddle consumes one shared life");
}
{
  const s = brick();
  assert(apply(s, { type: "paddle", tick: 0, x: 0 }));
  assert(!apply(s, { type: "paddle", tick: 1, x: 1024 }));
  assert(apply(s, { type: "paddle", tick: 2, x: 1024 }));
  assert(!apply(s, { type: "paddle", tick: 4, x: 1025 }));
  assert(!apply(s, { type: "paddle", tick: 4, x: 1024 }));
  assert.equal(s.ball.x, (640 - 46) * q);
  validate(s);
}
{
  const s = brick();
  assert(apply(s, { type: "paddle", tick: 1, x: 300 }));
  assert(!apply(s, { type: "paddle", tick: 2, x: 400 }));
  assert(apply(s, { type: "paddle", tick: 3, x: 500 }));
  assert.equal(
    s.lastPaddleTick,
    3,
    "30Hz input may start on either tick phase",
  );
}
{
  const result = replayBrick("classic", 8, [], 18000, 300000, "paddle-v1");
  assert.deepEqual(result, {
    score: 0,
    moves: 0,
    max_tile: 0,
    won: false,
    elapsed_ms: 300000,
  });
  assert.throws(
    () => replayBrick("classic", 8, [], 18000, 3000, "paddle-v1"),
    /speed/,
  );
  assert.throws(
    () => replayBrick("classic", 8, [], 3, 300000, "paddle-v1"),
    /not finished/,
  );
  assert.throws(
    () =>
      replayBrick(
        "classic",
        8,
        [
          [0, -1],
          [1, -1],
        ],
        18000,
        300000,
        "paddle-v1",
      ),
    /Invalid game action/,
  );
  assert.throws(() =>
    replayBrick(
      "classic",
      8,
      [
        [0, 0],
        [1, 1024],
      ],
      18000,
      300000,
      "paddle-v1",
    ),
  );
  assert.throws(
    () => replayBrick("classic", 8, [[18000, 0]], 18000, 300000, "paddle-v1"),
    /after game over/,
  );
  assert.throws(() =>
    replayBrick("classic", 8, [[-1, 0]], 18000, 300000, "paddle-v1"),
  );
  assert.throws(() => replayBrick("classic", 8, [], 18000, 300000, "unknown"));
  assert.throws(() =>
    replayBrick(
      "classic",
      8,
      Array(20001).fill([0, 0]),
      18000,
      300000,
      "paddle-v1",
    ),
  );
}
{
  const s = brick();
  s.ball.x = Infinity;
  assert.throws(() => validate(s));
  const t = brick();
  t.bricks[0] = -1;
  assert.throws(() => validate(t));
  const f = brick();
  f.status = "won";
  assert.throws(() => validate(f));
}
{
  // 完整合法通关：只记录真实挡板位置与发球，复算必须得到相同三关结果。
  const s = brick(),
    events = [];
  while (s.status === "playing") {
    if (s.ticks % 2 === 0) {
      const x = Math.max(
        0,
        Math.min(1024, Math.round(((s.ball.x / q - 46) / 548) * 1024)),
      );
      if (x !== s.paddle && apply(s, { type: "paddle", tick: s.ticks, x }))
        events.push([s.ticks, x]);
    }
    if (!s.ball.launched && apply(s, { type: "launch", tick: s.ticks }))
      events.push([s.ticks, -1]);
    advanceBrick(s, s.ticks + 1);
  }
  assert.equal(s.status, "won");
  assert.equal(s.stage, 2);
  assert.equal(s.score, 980);
  assert.equal(events.length, s.moves);
  assert(events.length <= 9003);
  const result = replayBrick(
    "classic",
    s.seed,
    events,
    s.ticks,
    (s.ticks * 1000) / 60,
    "paddle-v1",
  );
  assert.deepEqual(result, {
    ...metrics(s),
    elapsed_ms: Math.round((s.ticks * 1000) / 60),
  });
  validate(s);
}
// 最坏连续模拟：全砖保持碰撞候选，球持续横移，18,000 固定步均被执行。
const worst = brick();
worst.ball = { x: 320 * q, y: 300 * q, vx: 5 * q, vy: 0, launched: true };
const started = performance.now();
advanceBrick(worst, 18000);
const elapsed = performance.now() - started;
assert.equal(worst.ticks, 18000);
assert.equal(worst.reason, "timeout");
assert(
  elapsed < 1200,
  `18,000-tick simulation exceeded local CPU budget: ${elapsed.toFixed(0)}ms`,
);
console.log(
  `Arcade rules passed: simultaneous clear, fixed-step physics, three stages, replay limits and save validation. Worst simulation ${elapsed.toFixed(1)}ms.`,
);
