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
  armor,
  brickBounds,
  movingBrick,
  stageCount,
  brickRect,
  paddleCenter,
  paddleWidth,
} from "../../src/games/brick-v2-engine.js";
import {
  awardGuest,
  claimGuestDaily,
  dailyTaskProgress,
  malaysiaReset,
  compareLocal,
  featuredGame,
  malaysiaDay,
  localScoreKey,
} from "../../src/games/hub-model.js";

assert.equal(malaysiaDay(new Date("2026-04-01T15:59:59Z")), "2026-04-01");
assert.equal(malaysiaDay(new Date("2026-04-01T16:00:00Z")), "2026-04-02");
const guest = { days: {}, badges: [], balance: 0 };
for (let day = 1; day <= 7; day++) {
  const date = `2026-01-0${day}`;
  awardGuest(guest, { game: featuredGame(date), score: 1000 }, date);
  awardGuest(guest, { game: "pong" }, date);
}
assert.equal(guest.balance, 70);
assert.equal(malaysiaReset("2026-01-07"), Date.parse("2026-01-07T16:00:00Z"));
assert.deepEqual(
  dailyTaskProgress(["snake"], "2048").map(({ value }) => value),
  [1, 1, 0],
);
claimGuestDaily(guest, "2026-01-07", "warm-up", "2026-01-07");
claimGuestDaily(guest, "2026-01-07", "warm-up", "2026-01-08");
assert.equal(guest.balance, 80);
assert.throws(
  () => claimGuestDaily(guest, "2026-01-07", "explorer", "2026-01-08"),
  /expired/,
);
assert.throws(
  () => claimGuestDaily(guest, "2026-01-08", "featured", "2026-01-08"),
  /Complete this task/,
);
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
const brick = create("brick-breaker", "classic", 5, 3);
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

function play(seed, version) {
  const state = create("brick-breaker", "classic", seed, version),
    log = [];
  while (state.status === "playing") {
    if (state.ticks % 2 === 0) {
      const ball =
        state.balls
          .filter((b) => b.launched)
          .sort((a, b) => (b.vy > 0 ? b.y : -1) - (a.vy > 0 ? a.y : -1))[0] ||
        state.balls[0];
      const width = paddleWidth(state);
      let center = ball.x / q;
      if (version === 4 && ball.launched && ball.vy > 0) {
        const line = BRICK.paddleY - BRICK.radius;
        const span = 640 - 2 * BRICK.radius;
        const predicted =
          center + ((line - ball.y / q) * ball.vx) / ball.vy - BRICK.radius;
        center =
          span -
          Math.abs(
            (((predicted % (2 * span)) + 2 * span) % (2 * span)) - span,
          ) +
          BRICK.radius;
        const target = state.bricks
          .flatMap((hp, i) =>
            hp ? [brickBounds(state, i, state.ticks + 40)] : [],
          )
          .sort(
            (a, b) =>
              (b.y - a.y) / q +
              (Math.abs((a.x + a.w / 2) / q - center) -
                Math.abs((b.x + b.w / 2) / q - center)) /
                2,
          )[0];
        if (target) {
          let dx = (target.x + target.w / 2) / q - center;
          const dy = line - (target.y + target.h) / q;
          if (Math.abs(dx) < 35) dx = (dx < 0 ? -1 : 1) * 35;
          const offset = Math.max(
            -0.91,
            Math.min(0.91, dx / Math.hypot(dx, dy) / 0.88),
          );
          center -= (offset * width) / 2;
        }
      }
      const x = Math.max(
        0,
        Math.min(
          1024,
          Math.round(((center - width / 2) / (640 - width)) * 1024),
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
  .map((seed) => play(seed, 3))
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
    3,
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
    3,
  ),
);
console.log(
  "PASS Snake v2 boosts and obstacles, Brick v3 five-stage replay, laser and shield, and lobby daily boundaries",
);

const v4 = create("brick-breaker", "classic", 105);
assert.equal(v4.version, 4);
assert.equal(stageCount(v4), 8);
assert.notEqual(
  localScoreKey("brick-breaker", "classic", 3),
  localScoreKey("brick-breaker", "classic"),
);
assert.equal(v4.powerBricks.filter(Boolean).length, 0);
apply(v4, { type: "launch", tick: 0 });
assert.equal(v4.balls[0].vy, -Math.round(3.85 * 1.25 * q));

function strikeWithLasers(state, i, times = 1) {
  const rect = brickBounds(state, i);
  state.shots = Array.from({ length: times }, () => ({
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h + q,
  }));
  advanceBrick(state, state.ticks + 1);
}
const dropped = [];
const bag = create("brick-breaker", "classic", 22);
for (let i = 0; i < 19; i++) {
  const drops = bag.nextDropId;
  strikeWithLasers(bag, i);
  if (bag.nextDropId > drops)
    dropped.push([bag.stageBroken, bag.drops.at(-1).kind]);
}
assert.deepEqual(
  dropped.map(([count]) => count),
  [1, 4, 8, 12, 16],
);
assert.equal(new Set(dropped.map(([, kind]) => kind)).size, 5);
assert.equal(bag.score, 190);

const fixture = create("brick-breaker", "classic", 105);
for (let i = 0; i < 5; i++) {
  fixture.bricks.fill(0);
  advanceBrick(fixture, fixture.ticks + 1);
}
const armored = fixture.bricks.findIndex(
  (hp, i) => hp === 2 && armor(fixture, i),
);
assert.notEqual(armored, -1);
strikeWithLasers(fixture, armored);
assert.equal(fixture.bricks[armored], 1);
assert.equal(fixture.score, 0);
strikeWithLasers(fixture, armored, 2);
assert.equal(fixture.bricks[armored], 0);
assert.equal(fixture.score, 10);
fixture.bricks.fill(0);
advanceBrick(fixture, fixture.ticks + 1);
const mobileBrick = fixture.bricks.findIndex(
  (hp, i) => hp && movingBrick(fixture, i),
);
assert.notEqual(mobileBrick, -1);
assert.notEqual(
  brickBounds(fixture, mobileBrick).x,
  brickBounds(fixture, mobileBrick, fixture.ticks + 30).x,
);
const rect = brickBounds(fixture, mobileBrick);
fixture.balls = [1, 2].map((id) => ({
  id,
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h + 9 * q,
  vx: q,
  vy: -7 * q,
  launched: true,
}));
fixture.nextBallId = 3;
advanceBrick(fixture, fixture.ticks + 1);
assert.equal(fixture.bricks[mobileBrick], 0);
assert.equal(
  fixture.score,
  20,
  "both balls crossing a moving brick award one brick",
);
const victory = play(105, 4);
assert.equal(victory.state.status, "won");
assert.equal(victory.state.stage, 7);
assert.equal(victory.state.score, 2140);
assert.equal(victory.state.ticks, 16912);
for (const rate of [30, 60, 120, 144]) {
  const game = create("brick-breaker", "classic", 105);
  let frame = 0,
    index = 0;
  while (game.status === "playing") {
    const target = Math.min(
      victory.state.ticks,
      Math.floor((++frame * 60) / rate),
    );
    while (index < victory.log.length && victory.log[index][0] <= target) {
      const [tick, x] = victory.log[index++];
      assert(
        apply(
          game,
          x === -1 ? { type: "launch", tick } : { type: "paddle", tick, x },
        ),
      );
    }
    advanceBrick(game, target);
    assert(frame < 50000);
  }
  assert.deepEqual(game, victory.state);
}
const playtime = (victory.state.ticks * 1000) / 60;
validateSave({
  game: v4.game,
  difficulty: v4.difficulty,
  state: victory.state,
  elapsed: playtime,
});
const cpu = process.cpuUsage();
let replayed;
for (let repeat = 0; repeat < 16; repeat++)
  replayed = replay(
    v4.game,
    v4.difficulty,
    v4.seed,
    victory.log,
    victory.state.ticks,
    playtime,
    "paddle-v4",
    4,
  );
const usage = process.cpuUsage(cpu);
assert.deepEqual(replayed, {
  ...metrics(victory.state),
  elapsed_ms: Math.round(playtime),
});
console.log(
  `PASS Brick v4 eight-stage replay, rotating drop bag, armor and moving brick collision. Local replay CPU ${((usage.user + usage.system) / 16000).toFixed(1)} ms`,
);
