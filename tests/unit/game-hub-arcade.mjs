import assert from "node:assert/strict";
import {
  advanceSnake,
  advanceBrick,
  apply,
  create,
  metrics,
  replay,
  validateSave,
} from "../../src/games/engine.js";
import {
  BRICK,
  brickRect,
  paddleCenter,
  paddleWidth,
} from "../../src/games/brick-v2-engine.js";
import {
  awardGuest,
  compareLocal,
  featuredGame,
  malaysiaDay,
} from "../../src/games/hub-model.js";

assert.equal(malaysiaDay(new Date("2026-04-01T15:59:59Z")), "2026-04-01");
assert.equal(malaysiaDay(new Date("2026-04-01T16:00:00Z")), "2026-04-02");
const guest = { days: {}, badges: [], balance: 0 };
for (let day = 1; day <= 7; day++) {
  const date = `2026-01-0${day}`;
  awardGuest(guest, { game: featuredGame(date), score: 1000 }, date);
  awardGuest(guest, { game: "pong" }, date);
}
assert.equal(guest.balance, 280);
assert.deepEqual(guest.badges, ["first-finish", "seven-days"]);
awardGuest(guest, { game: "2048", score: 1001 }, "2026-01-07");
assert(guest.badges.includes("score-1000"));
const older = { score: 500, elapsed_ms: 40000, date: "2026-01-01" };
const faster = { ...older, elapsed_ms: 35000, date: "2026-01-02" };
assert(compareLocal("snake", "normal", older, faster) < 0);
assert(compareLocal("brick-breaker", "classic", faster, older) < 0);

const snake = create("snake", "normal", 42);
assert.equal(snake.version, 2);
snake.body.push(206, 205);
snake.eaten = 2;
snake.score = 20;
snake.food = 211;
advanceSnake(snake, 6);
assert.equal(snake.score, 30);
assert(snake.boost >= 0 && !snake.body.includes(snake.boost));
snake.boost = 212;
snake.food = 213;
advanceSnake(snake, 12);
assert.equal(snake.boostUntil, 312);
assert.equal(snake.nextStep, 16);
advanceSnake(snake, 16);
snake.food = 214;
advanceSnake(snake, 20);
assert.equal(snake.score, 50);
assert.equal(snake.obstacles.length, 1);
assert(![...snake.body, snake.food, 215].includes(snake.obstacles[0]));
validateSave({
  game: "snake",
  difficulty: "normal",
  state: snake,
  elapsed: 333,
});
const terminal = create("snake", "normal", 123);
advanceSnake(terminal, 300);
assert.notEqual(terminal.status, "playing");
assert.deepEqual(replay("snake", "normal", 123, [], terminal.ticks, 5000), {
  ...metrics(terminal),
  elapsed_ms: 5000,
});
assert.throws(
  () => replay("snake", "normal", 123, [], terminal.ticks, 1),
  /Impossible/,
);

const q = BRICK.scale;
const brick = create("brick-breaker", "classic", 5);
assert.equal(brick.version, 3);
assert.deepEqual(brick.powerBricks.filter(Boolean).sort(), [1, 2, 3, 4, 5]);
apply(brick, { type: "launch", tick: 0 });
function catchPower(kind) {
  brick.drops.push({
    id: brick.nextDropId++,
    kind,
    x: paddleCenter(brick),
    y: (BRICK.paddleY - 8) * q,
  });
  advanceBrick(brick, brick.ticks + 1);
}
catchPower(1);
assert.equal(brick.balls.length, 3);
catchPower(4);
assert.equal(brick.laserUntil - brick.ticks, 480);
advanceBrick(brick, brick.ticks + 1);
assert.equal(brick.shots.length, 2);
const index = brick.bricks.findIndex(Boolean);
const target = brickRect(index);
brick.shots = [
  { x: target.x + 10, y: target.y + target.h + q },
  { x: target.x + 10, y: target.y + target.h + q },
];
const score = brick.score;
advanceBrick(brick, brick.ticks + 1);
assert.equal(
  brick.score - score,
  10,
  "two lasers cannot break the same brick twice",
);
catchPower(5);
assert.equal(brick.shield, true);
Object.assign(brick.balls[0], { y: 488 * q, vy: 8 * q });
advanceBrick(brick, brick.ticks + 1);
assert.equal(brick.shield, false);
assert.equal(brick.balls.length, 3);
assert.equal(brick.lives, 3);

function playFive(seed) {
  const state = create("brick-breaker", "classic", seed),
    log = [];
  while (state.status === "playing") {
    if (state.ticks % 2 === 0) {
      const ball =
        state.balls
          .filter((b) => b.launched)
          .sort((a, b) => (b.vy > 0 ? b.y : -1) - (a.vy > 0 ? a.y : -1))[0] ||
        state.balls[0];
      const width = paddleWidth(state);
      const x = Math.max(
        0,
        Math.min(
          1024,
          Math.round(((ball.x / q - width / 2) / (640 - width)) * 1024),
        ),
      );
      if (
        x !== state.paddle &&
        apply(state, { type: "paddle", tick: state.ticks, x })
      )
        log.push([state.ticks, x]);
    }
    if (
      !state.balls.some((ball) => ball.launched) &&
      apply(state, { type: "launch", tick: state.ticks })
    )
      log.push([state.ticks, -1]);
    advanceBrick(state, state.ticks + 1);
  }
  return { state, log };
}
const attempt = [12345, 14, 29, 42, 64, 100]
  .map(playFive)
  .find(({ state }) => state.status === "won");
assert(attempt, "the deterministic five-stage fixture reaches the win");
const { state, log } = attempt;
assert.equal(state.stage, 4);
assert.equal(state.score, 1460);
assert.equal(state.shots.length, 0);
validateSave({
  game: state.game,
  difficulty: state.difficulty,
  state,
  elapsed: (state.ticks * 1000) / 60,
});
assert.equal(
  replay(
    state.game,
    state.difficulty,
    state.seed,
    log,
    state.ticks,
    (state.ticks * 1000) / 60,
    "paddle-v3",
  ).score,
  state.score,
);
assert.throws(() =>
  replay(
    state.game,
    state.difficulty,
    state.seed,
    log,
    state.ticks,
    (state.ticks * 1000) / 60,
    "paddle-v2",
  ),
);
console.log(
  "PASS Snake v2 boosts and obstacles, Brick v3 five-stage replay, laser and shield, and lobby daily boundaries",
);
