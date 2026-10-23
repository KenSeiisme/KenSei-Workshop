import assert from "node:assert/strict";
import {
  createPong,
  advancePong,
  validPongState,
} from "../../src/games/pong-engine.js";
for (const hz of [30, 60, 120, 144]) {
  const s = createPong(42);
  for (let f = 1; f <= hz * 20; f++)
    advancePong(s, Math.floor((f * 120) / hz), 512, 512);
  const expected = createPong(42);
  advancePong(expected, 2400, 512, 512);
  assert.deepEqual(s, expected);
  assert.ok(validPongState(s));
}
let s = createPong(1);
s.serveAt = 0;
s.ball = { x: 65, y: 270, vx: -750, vy: 0 };
advancePong(s, 2);
assert.ok(s.ball.vx > 0, "Fast ball hits the paddle plane without tunneling.");
s = createPong(1);
s.serveAt = 0;
s.ball = { x: 955, y: 20, vx: 750, vy: 0 };
advancePong(s, 5);
assert.equal(s.score[0], 1);
assert.ok(s.serveAt > s.ticks);
s = createPong(1);
s.ticks = 71999;
s.score = [3, 3];
advancePong(s, 72000);
assert.equal(s.status, "draw");
s = createPong(1);
s.ticks = 71999;
s.score = [3, 2];
advancePong(s, 72000);
assert.equal(s.winner, 1);
s = createPong(1);
s.score = [6, 0];
s.serveAt = 0;
s.ball = { x: 968, y: 20, vx: 750, vy: 0 };
advancePong(s, 2);
assert.equal(s.status, "won");
assert.equal(s.score[0], 7);
assert.equal(validPongState({ ...s, ball: { x: Infinity } }), false);
console.log(
  "PASS Pong: fixed-step refresh-rate equality, swept paddle collision, point/serve, first-to-seven, time limit, draw and network snapshot validation.",
);
