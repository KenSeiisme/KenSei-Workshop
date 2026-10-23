// v2 独立规则；原 arcade-engine.js 的 v1 逐行保留供旧存档和会话重放。
import { BRICK, BRICK_LAYOUTS, brickRect } from "./arcade-engine.js";
export { BRICK, brickRect };
const Q = BRICK.scale;
const integer = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const POWERUPS = Object.freeze({
  1: "Multiball",
  2: "Wide Paddle",
  3: "Slow Ball",
});
function random(s, n) {
  let x = s.rng >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return Math.floor((s.rng / 4294967296) * n);
}
export const paddleWidth = (s) => (s.wideUntil > s.ticks ? 138 : 92);
export const paddleCenter = (s) =>
  Math.round(
    (paddleWidth(s) / 2 + (s.paddle / 1024) * (640 - paddleWidth(s))) * Q,
  );
export const speedFactor = (s) => (s.slowUntil > s.ticks ? 0.75 : 1);
function stage(s) {
  s.bricks = BRICK_LAYOUTS[s.stage].join("").split("").map(Number);
  s.powerBricks = Array(40).fill(0);
  const available = s.bricks.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  for (let kind = 1; kind <= 3; kind++)
    s.powerBricks[available.splice(random(s, available.length), 1)[0]] = kind;
}
function attach(s) {
  s.wideUntil = s.slowUntil = 0;
  s.drops = [];
  s.balls = [
    {
      id: s.nextBallId++,
      x: paddleCenter(s),
      y: (BRICK.paddleY - BRICK.radius - 2) * Q,
      vx: 0,
      vy: 0,
      launched: false,
    },
  ];
}
export function create(game, difficulty, seed) {
  if (
    game !== "brick-breaker" ||
    difficulty !== "classic" ||
    !integer(seed, 1, 4294967295)
  )
    throw Error("Unknown Brick Breaker rules or seed.");
  const s = {
    game,
    difficulty,
    version: 2,
    seed,
    rng: seed,
    score: 0,
    moves: 0,
    status: "playing",
    ticks: 0,
    stage: 0,
    lives: 3,
    paddle: 512,
    lastPaddleTick: -2,
    paddleChanges: 0,
    reason: null,
    nextBallId: 1,
    nextDropId: 1,
    wideUntil: 0,
    slowUntil: 0,
    pickups: 0,
    paddleHits: 0,
    lastPickup: null,
    pickupTick: -1,
  };
  stage(s);
  attach(s);
  return s;
}
// Swept collision uses the v1 planes and fixed-point world; order is deterministic.
function sweep(x, y, dx, dy, rect) {
  const r = BRICK.radius * Q;
  let near = -Infinity,
    far = Infinity,
    nx = 0,
    ny = 0;
  for (const [p, d, min, max, ax, ay] of [
    [x, dx, rect.x - r, rect.x + rect.w + r, 1, 0],
    [y, dy, rect.y - r, rect.y + rect.h + r, 0, 1],
  ]) {
    if (!d) {
      if (p < min || p > max) return null;
      continue;
    }
    const a = (min - p) / d,
      b = (max - p) / d,
      entry = Math.min(a, b),
      exit = Math.max(a, b),
      sign = d > 0 ? -1 : 1;
    if (entry > near + 1e-10) {
      near = entry;
      nx = ax * sign;
      ny = ay * sign;
    } else if (Math.abs(entry - near) <= 1e-10) {
      nx += ax * sign;
      ny += ay * sign;
    }
    far = Math.min(far, exit);
    if (near > far) return null;
  }
  return near >= -1e-10 && near <= 1 && far >= 0
    ? { t: Math.max(0, near), nx, ny }
    : null;
}
function breakBrick(s, index) {
  if (!s.bricks[index]) return;
  s.bricks[index] = 0;
  s.score += 10;
  const kind = s.powerBricks[index];
  s.powerBricks[index] = 0;
  if (kind) {
    const rect = brickRect(index);
    s.drops.push({
      id: s.nextDropId++,
      kind,
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
    });
  }
}
function physics(s, b) {
  if (!b.launched) {
    b.x = paddleCenter(s);
    return;
  }
  let fraction = speedFactor(s);
  for (let impact = 0; impact < 5 && fraction > 0.00001; impact++) {
    const dx = b.vx * fraction,
      dy = b.vy * fraction,
      r = BRICK.radius * Q;
    let hit = null;
    const offer = (candidate, kind, index = -1) => {
      if (
        candidate &&
        candidate.t >= 0 &&
        candidate.t <= 1 &&
        (!hit || candidate.t < hit.t - 1e-10)
      )
        hit = { ...candidate, kind, index };
    };
    if (dx < 0) offer({ t: (r - b.x) / dx, nx: 1, ny: 0 }, "wall");
    if (dx > 0) offer({ t: (640 * Q - r - b.x) / dx, nx: -1, ny: 0 }, "wall");
    if (dy < 0) offer({ t: (r - b.y) / dy, nx: 0, ny: 1 }, "wall");
    if (dy > 0 && b.y <= (BRICK.paddleY - BRICK.radius) * Q)
      offer(
        sweep(b.x, b.y, dx, dy, {
          x: paddleCenter(s) - (paddleWidth(s) * Q) / 2,
          y: BRICK.paddleY * Q,
          w: paddleWidth(s) * Q,
          h: BRICK.paddleHeight * Q,
        }),
        "paddle",
      );
    for (let i = 0; i < 40; i++)
      if (s.bricks[i]) offer(sweep(b.x, b.y, dx, dy, brickRect(i)), "brick", i);
    if (!hit) {
      b.x = Math.round(b.x + dx);
      b.y = Math.round(b.y + dy);
      break;
    }
    b.x = Math.round(b.x + dx * hit.t) + hit.nx;
    b.y = Math.round(b.y + dy * hit.t) + hit.ny;
    fraction *= 1 - hit.t;
    if (hit.kind === "paddle") {
      const offset = clamp(
          (b.x - paddleCenter(s)) / ((paddleWidth(s) * Q) / 2),
          -1,
          1,
        ),
        speed = (4.5 + s.stage * 0.55) * Q;
      let vx = Math.round(speed * offset * 0.88);
      if (Math.abs(vx) < Q * 0.85)
        vx = Math.round(Q * 0.85) * (b.vx < 0 ? -1 : 1);
      b.vx = vx;
      b.vy = -Math.round(Math.sqrt(speed * speed - vx * vx));
      s.paddleHits++;
    } else {
      if (hit.nx) b.vx = -b.vx;
      if (hit.ny) b.vy = -b.vy;
      if (hit.kind === "brick") breakBrick(s, hit.index);
    }
  }
}
function split(s) {
  const source = s.balls.find((b) => b.launched);
  if (!source) return;
  // ±20° rotation, quantized constants. Never consume the game's RNG for visuals.
  const original = { ...source };
  for (const sign of [-1, 1]) {
    if (s.balls.length >= 3) break;
    let vx = Math.round((original.vx * 962 - sign * original.vy * 350) / 1024),
      vy = Math.round((sign * original.vx * 350 + original.vy * 962) / 1024);
    if (Math.abs(vy) < Q) vy = (vy < 0 ? -1 : 1) * Q;
    s.balls.push({ ...original, id: s.nextBallId++, vx, vy });
  }
}
function collect(s, drop) {
  s.pickups++;
  s.pickupTick = s.ticks;
  s.lastPickup =
    drop.kind === 1 && s.balls.length === 3 ? "Max balls" : POWERUPS[drop.kind];
  if (drop.kind === 1) split(s);
  if (drop.kind === 2) s.wideUntil = s.ticks + 720;
  if (drop.kind === 3) s.slowUntil = s.ticks + 480;
}
function tick(s) {
  const stageBefore = s.stage;
  for (const ball of s.balls) physics(s, ball);
  // Stage end takes precedence over a same-tick loss or pickup.
  if (!s.bricks.some(Boolean)) {
    if (s.stage === 2) {
      s.status = "won";
      s.reason = "cleared";
      s.balls = [];
      s.drops = [];
      s.wideUntil = s.slowUntil = 0;
      return;
    }
    s.stage++;
    stage(s);
    attach(s);
    return;
  }
  s.balls = s.balls.filter((b) => b.y <= (480 + BRICK.radius) * Q);
  if (!s.balls.length) {
    s.lives--;
    s.wideUntil = s.slowUntil = 0;
    s.drops = [];
    if (!s.lives) {
      s.status = "lost";
      s.reason = "lives";
      return;
    }
    attach(s);
    return;
  }
  if (stageBefore !== s.stage) return;
  const remaining = [];
  for (const drop of s.drops) {
    const previousY = drop.y;
    drop.y += 2 * Q;
    const cx = paddleCenter(s),
      half = (paddleWidth(s) * Q) / 2;
    if (
      previousY <= (BRICK.paddleY + BRICK.paddleHeight) * Q &&
      drop.y + 9 * Q >= BRICK.paddleY * Q &&
      Math.abs(drop.x - cx) <= half + 9 * Q
    )
      collect(s, drop);
    else if (drop.y <= (480 + 12) * Q) remaining.push(drop);
  }
  s.drops = remaining;
}
export function advanceBrick(s, target) {
  if (!integer(target, s.ticks, BRICK.maxTicks))
    throw Error("Invalid game tick.");
  while (s.ticks < target && s.status === "playing") {
    s.ticks++;
    tick(s);
    if (s.ticks === BRICK.maxTicks && s.status === "playing") {
      s.status = "lost";
      s.reason = "timeout";
      s.drops = [];
    }
  }
  return s;
}
export function apply(s, e) {
  if (
    s.status !== "playing" ||
    !e ||
    !["paddle", "launch"].includes(e.type) ||
    !integer(e.tick, s.ticks, 18000)
  )
    return false;
  if (
    e.type === "paddle" &&
    (!integer(e.x, 0, 1024) ||
      e.x === s.paddle ||
      e.tick - s.lastPaddleTick < 2 ||
      s.paddleChanges >= 9000)
  )
    return false;
  advanceBrick(s, e.tick);
  if (s.status !== "playing") return false;
  if (e.type === "paddle") {
    s.paddle = e.x;
    s.lastPaddleTick = e.tick;
    s.paddleChanges++;
    for (const b of s.balls) if (!b.launched) b.x = paddleCenter(s);
  } else {
    const b = s.balls[0];
    if (!b || b.launched) return false;
    b.launched = true;
    b.vx = (random(s, 2) ? 1 : -1) * (2 * Q + random(s, 600));
    b.vy = -Math.round(3.85 * Q + s.stage * Q * 0.5);
  }
  s.moves++;
  return true;
}
export const metrics = (s) => ({
  score: s.score,
  moves: s.moves,
  max_tile: 0,
  won: s.status === "won",
});
export function replayBrick(
  difficulty,
  seed,
  events,
  finalTick,
  durationMs,
  format,
) {
  if (
    format !== "paddle-v2" ||
    !Array.isArray(events) ||
    events.length > 20000 ||
    !integer(finalTick, 0, 18000) ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > 7200000 ||
    (finalTick * 1000) / 60 > durationMs + 250
  )
    throw Error("Invalid Brick Breaker replay or game speed.");
  const s = create("brick-breaker", difficulty, seed);
  let previous = 0;
  for (const item of events) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      !integer(item[0], previous, finalTick) ||
      !integer(item[1], -1, 1024)
    )
      throw Error("Invalid Brick Breaker event.");
    previous = item[0];
    if (
      !apply(
        s,
        item[1] === -1
          ? { type: "launch", tick: item[0] }
          : { type: "paddle", tick: item[0], x: item[1] },
      )
    )
      throw Error("Invalid Brick Breaker action.");
  }
  advanceBrick(s, finalTick);
  if (s.status === "playing" || s.ticks !== finalTick)
    throw Error("Brick Breaker has not ended at this tick.");
  return { ...metrics(s), elapsed_ms: Math.max(1, Math.round(durationMs)) };
}
export function validate(s) {
  const ball = (b) =>
    b &&
    integer(b.id, 1, 1000) &&
    integer(b.x, -10 * Q, 650 * Q) &&
    integer(b.y, -10 * Q, 500 * Q) &&
    integer(b.vx, -12 * Q, 12 * Q) &&
    integer(b.vy, -12 * Q, 12 * Q) &&
    typeof b.launched === "boolean";
  if (
    !integer(s.ticks, 0, 18000) ||
    !integer(s.stage, 0, 2) ||
    !integer(s.lives, 0, 3) ||
    !integer(s.paddle, 0, 1024) ||
    !integer(s.lastPaddleTick, -2, s.ticks) ||
    !integer(s.paddleChanges, 0, 9000) ||
    !integer(s.wideUntil, 0, 18720) ||
    !integer(s.slowUntil, 0, 18480) ||
    !integer(s.nextBallId, 1, 1001) ||
    !integer(s.nextDropId, 1, 10) ||
    !integer(s.pickups, 0, 9) ||
    !integer(s.paddleHits, 0, 100000) ||
    !integer(s.pickupTick, -1, s.ticks)
  )
    throw Error("Invalid Brick Breaker v2 state.");
  if (
    !Array.isArray(s.bricks) ||
    s.bricks.length !== 40 ||
    !s.bricks.every((n) => n === 0 || n === 1) ||
    !Array.isArray(s.powerBricks) ||
    s.powerBricks.length !== 40 ||
    !s.powerBricks.every(
      (n, i) => integer(n, 0, 3) && (!n || s.bricks[i] === 1),
    ) ||
    s.powerBricks.filter(Boolean).length > 3
  )
    throw Error("Invalid power bricks.");
  if (
    !Array.isArray(s.balls) ||
    s.balls.length > 3 ||
    !s.balls.every(ball) ||
    new Set(s.balls.map((b) => b.id)).size !== s.balls.length ||
    s.balls.some((b) => b.id >= s.nextBallId) ||
    !Array.isArray(s.drops) ||
    s.drops.length > 3 ||
    !s.drops.every(
      (d) =>
        integer(d.id, 1, 9) &&
        d.id < s.nextDropId &&
        integer(d.kind, 1, 3) &&
        integer(d.x, 0, 640 * Q) &&
        integer(d.y, 0, 492 * Q),
    ) ||
    new Set(s.drops.map((d) => d.id)).size !== s.drops.length
  )
    throw Error("Invalid balls or drops.");
  if (
    (s.status === "playing" && (!s.lives || !s.balls.length)) ||
    (s.status === "won" && (s.stage !== 2 || s.bricks.some(Boolean))) ||
    s.score % 10 !== 0 ||
    s.score > 1020 ||
    ![null, "cleared", "lives", "timeout"].includes(s.reason) ||
    ![null, "Max balls", ...Object.values(POWERUPS)].includes(s.lastPickup)
  )
    throw Error("Invalid Brick Breaker result.");
  return s;
}
