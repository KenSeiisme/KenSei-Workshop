// V2–V4 共用固定步長。V4 的速度、磚陣與掉落獨立於舊規則。
import { BRICK, BRICK_LAYOUTS, brickRect } from "./arcade-engine.js";
export { BRICK, brickRect };
const Q = BRICK.scale;
const integer = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const POWERUPS = Object.freeze({
  1: "Multiball",
  2: "Wide Paddle",
  3: "Slow Ball",
  4: "Laser",
  5: "Shield",
});
const MAPS = [
  ...BRICK_LAYOUTS,
  ["11000000", "11110000", "11111100", "11111111", "11111111"],
  ["00011000", "00111100", "11111111", "00111100", "00011000"],
];
const FAST_MAPS = [
  BRICK_LAYOUTS[0],
  ["11100111", "11100111", "11000011", "11000011", "10000001"],
  MAPS[3],
  MAPS[4],
  ["10000001", "11000011", "11100111", "01111110", "00111100"],
  ["11111111", "12000021", "12011021", "12111121", "02200220"],
  ["11111111", "11030011", "11003011", "10030001", "11000011"],
  ["11222211", "12030021", "12003021", "11030011", "02200220"],
].map((rows) => rows.join(""));
const FAST_COUNTS = FAST_MAPS.map((map) => map.replaceAll("0", "").length);
const FAST_TOTAL = FAST_COUNTS.reduce((sum, count) => sum + count, 0);
const FAST_DROPS = FAST_COUNTS.reduce(
  (sum, count) => sum + 1 + Math.floor((count - 1) / 4),
  0,
);
const BASE_RECTS = Array.from({ length: 40 }, (_, index) => brickRect(index));
export const stageCount = (s) =>
  s.version === 4
    ? FAST_MAPS.length
    : s.version === 3
      ? MAPS.length
      : BRICK_LAYOUTS.length;
const powerCount = (s) => (s.version >= 3 ? 5 : 3);
const moving = (s, index) =>
  s.version === 4 && FAST_MAPS[s.stage][index] === "3";
const offsetAt = (index, tick) => {
  const phase = (tick + index * 13) % 120;
  return Math.round((1 - Math.abs(phase - 60) / 30) * 16 * Q);
};
export function brickBounds(s, index, tick = s.ticks) {
  const rect = BASE_RECTS[index];
  if (!moving(s, index)) return rect;
  return { ...rect, x: rect.x + offsetAt(index, tick) };
}
export const armor = (s, index) =>
  s.version === 4 && FAST_MAPS[s.stage][index] === "2";
export const movingBrick = moving;
export const FAST_STAGE_NAMES = [
  "Full grid",
  "Split lanes",
  "Staircase",
  "Diamond",
  "Twin wings",
  "Armored gate",
  "Moving corridor",
  "Final mix",
];
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
  s.powerBricks = Array(40).fill(0);
  if (s.version === 4) {
    s.bricks = Array.from(FAST_MAPS[s.stage], (cell) =>
      cell === "2" ? 2 : Number(cell !== "0"),
    );
    s.stageBroken = 0;
    return;
  }
  s.bricks = MAPS[s.stage].join("").split("").map(Number);
  const available = s.bricks.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  for (let kind = 1; kind <= powerCount(s); kind++)
    s.powerBricks[available.splice(random(s, available.length), 1)[0]] = kind;
}
function clearPower(s) {
  s.wideUntil = s.slowUntil = 0;
  s.drops = [];
  if (s.version >= 3) {
    s.laserUntil = s.nextVolley = 0;
    s.shield = false;
    s.shots = [];
  }
}
function attach(s) {
  clearPower(s);
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
export function create(game, difficulty, seed, version = 2) {
  if (
    game !== "brick-breaker" ||
    difficulty !== "classic" ||
    ![2, 3, 4].includes(version) ||
    !integer(seed, 1, 4294967295)
  )
    throw Error("Unknown Brick Breaker rules or seed.");
  const s = {
    game,
    difficulty,
    version,
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
  if (version === 4) s.dropBag = [];
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
function nextDrop(s) {
  if (!s.dropBag.length) {
    s.dropBag = [1, 2, 3, 4, 5];
    for (let i = 4; i > 0; i--) {
      const j = random(s, i + 1);
      [s.dropBag[i], s.dropBag[j]] = [s.dropBag[j], s.dropBag[i]];
    }
  }
  return s.dropBag.pop();
}
function hitBrick(s, index, rect = BASE_RECTS[index]) {
  if (!s.bricks[index] || --s.bricks[index]) return;
  s.score += 10;
  let kind = s.powerBricks[index];
  s.powerBricks[index] = 0;
  if (s.version === 4) {
    const broken = ++s.stageBroken;
    if (broken < FAST_COUNTS[s.stage] && (broken === 1 || broken % 4 === 0))
      kind = nextDrop(s);
  }
  if (kind)
    s.drops.push({
      id: s.nextDropId++,
      kind,
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
    });
}
function physics(s, b) {
  if (!b.launched) {
    b.x = paddleCenter(s);
    return;
  }
  let fraction = speedFactor(s);
  let tickStart = 0,
    tickRemaining = 1;
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
    if (
      Math.min(b.y, b.y + dy) <= BASE_RECTS[39].y + BASE_RECTS[39].h + r &&
      Math.max(b.y, b.y + dy) >= BASE_RECTS[0].y - r
    ) {
      for (let i = 0; i < 40; i++) {
        if (!s.bricks[i]) continue;
        let rect = BASE_RECTS[i],
          shift = 0;
        if (moving(s, i)) {
          const start = offsetAt(i, s.ticks - 1);
          const delta = offsetAt(i, s.ticks) - start;
          rect = { ...rect, x: rect.x + start + delta * tickStart };
          shift = delta * tickRemaining;
        }
        const relativeX = dx - shift;
        if (
          Math.max(b.x, b.x + relativeX) < rect.x - r ||
          Math.min(b.x, b.x + relativeX) > rect.x + rect.w + r ||
          Math.max(b.y, b.y + dy) < rect.y - r ||
          Math.min(b.y, b.y + dy) > rect.y + rect.h + r
        )
          continue;
        offer(sweep(b.x, b.y, relativeX, dy, rect), "brick", i);
      }
    }
    if (!hit) {
      b.x = Math.round(b.x + dx);
      b.y = Math.round(b.y + dy);
      break;
    }
    b.x = Math.round(b.x + dx * hit.t) + hit.nx;
    b.y = Math.round(b.y + dy * hit.t) + hit.ny;
    fraction *= 1 - hit.t;
    tickStart += tickRemaining * hit.t;
    tickRemaining *= 1 - hit.t;
    if (hit.kind === "paddle") {
      const offset = clamp(
          (b.x - paddleCenter(s)) / ((paddleWidth(s) * Q) / 2),
          -1,
          1,
        ),
        speed =
          (s.version === 4
            ? Math.min(7.75, 5.625 + s.stage * 0.34)
            : 4.5 + s.stage * 0.55) * Q;
      let vx = Math.round(speed * offset * 0.88);
      if (Math.abs(vx) < Q * 0.85)
        vx = Math.round(Q * 0.85) * (b.vx < 0 ? -1 : 1);
      b.vx = vx;
      b.vy = -Math.round(Math.sqrt(speed * speed - vx * vx));
      s.paddleHits++;
    } else {
      if (hit.nx) b.vx = -b.vx;
      if (hit.ny) b.vy = -b.vy;
      if (hit.kind === "brick")
        hitBrick(
          s,
          hit.index,
          brickBounds(s, hit.index, s.ticks - 1 + tickStart),
        );
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
  if (drop.kind === 4) {
    if (s.laserUntil <= s.ticks) s.nextVolley = s.ticks + 1;
    s.laserUntil = s.ticks + 480;
  }
  if (drop.kind === 5) s.shield = true;
}
function lasers(s) {
  if (
    s.laserUntil > s.ticks &&
    s.nextVolley <= s.ticks &&
    s.balls.some((b) => b.launched)
  ) {
    const center = paddleCenter(s);
    const offset = (paddleWidth(s) * Q) / 4;
    for (const x of [center - offset, center + offset])
      s.shots.push({ x, y: BRICK.paddleY * Q });
    s.nextVolley = s.ticks + 24;
  }
  s.shots = s.shots.filter((shot) => {
    const nextY = shot.y - 12 * Q;
    let hit = -1,
      bottom = -Infinity;
    for (let i = 0; i < s.bricks.length; i++) {
      if (!s.bricks[i]) continue;
      const base = BASE_RECTS[i];
      const edge = base.y + base.h;
      if (shot.y < edge || nextY > edge || edge <= bottom) continue;
      const rect = moving(s, i)
        ? brickBounds(s, i, s.ticks - 1 + (shot.y - edge) / (shot.y - nextY))
        : base;
      if (
        shot.x >= rect.x &&
        shot.x <= rect.x + rect.w &&
        shot.y >= rect.y &&
        nextY <= edge &&
        edge > bottom
      ) {
        hit = i;
        bottom = edge;
      }
    }
    if (hit >= 0) {
      hitBrick(
        s,
        hit,
        brickBounds(s, hit, s.ticks - 1 + (shot.y - bottom) / (shot.y - nextY)),
      );
      return false;
    }
    shot.y = nextY;
    return nextY >= 0;
  });
}
function tick(s) {
  const stageBefore = s.stage;
  for (const ball of s.balls) physics(s, ball);
  if (s.version >= 3) lasers(s);
  // Stage end takes precedence over a same-tick loss or pickup.
  if (!s.bricks.some(Boolean)) {
    if (s.stage === stageCount(s) - 1) {
      s.status = "won";
      s.reason = "cleared";
      s.balls = [];
      clearPower(s);
      return;
    }
    s.stage++;
    stage(s);
    attach(s);
    return;
  }
  if (s.shield) {
    const lost = s.balls.find((ball) => ball.y > (480 + BRICK.radius) * Q);
    if (lost) {
      lost.y = (480 - BRICK.radius) * Q;
      lost.vy = -Math.max(Q, Math.abs(lost.vy));
      s.shield = false;
    }
  }
  s.balls = s.balls.filter((b) => b.y <= (480 + BRICK.radius) * Q);
  if (!s.balls.length) {
    s.lives--;
    clearPower(s);
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
    drop.y += s.version === 4 ? Math.round(2.6 * Q) : 2 * Q;
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
    if (s.version === 4) {
      b.vx = Math.round(b.vx * 1.25);
      b.vy = -Math.round(Math.min(6.7, 3.85 * 1.25 + s.stage * 0.28) * Q);
    } else b.vy = -Math.round(3.85 * Q + s.stage * Q * 0.5);
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
  version = 2,
) {
  if (
    format !== `paddle-v${version}` ||
    !Array.isArray(events) ||
    events.length > 20000 ||
    !integer(finalTick, 0, 18000) ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > 7200000 ||
    (finalTick * 1000) / 60 > durationMs + 250
  )
    throw Error("Invalid Brick Breaker replay or game speed.");
  const s = create("brick-breaker", difficulty, seed, version);
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
  const powers = powerCount(s);
  const stages = stageCount(s);
  const fast = s.version === 4;
  const drops = fast ? FAST_DROPS : stages * powers;
  if (
    fast &&
    (!Number.isInteger(s.stage) ||
      s.stage < 0 ||
      s.stage >= stages ||
      !integer(s.stageBroken, 0, FAST_COUNTS[s.stage]) ||
      !Array.isArray(s.dropBag) ||
      s.dropBag.length > powers ||
      !s.dropBag.every((kind) => integer(kind, 1, powers)) ||
      new Set(s.dropBag).size !== s.dropBag.length)
  )
    throw Error("Invalid Brick Breaker v4 state.");
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
    !integer(s.stage, 0, stages - 1) ||
    !integer(s.lives, 0, 3) ||
    !integer(s.paddle, 0, 1024) ||
    !integer(s.lastPaddleTick, -2, s.ticks) ||
    !integer(s.paddleChanges, 0, 9000) ||
    !integer(s.wideUntil, 0, 18720) ||
    !integer(s.slowUntil, 0, 18480) ||
    !integer(s.nextBallId, 1, 1001) ||
    !integer(s.nextDropId, 1, drops + 1) ||
    !integer(s.pickups, 0, drops) ||
    !integer(s.paddleHits, 0, 100000) ||
    !integer(s.pickupTick, -1, s.ticks)
  )
    throw Error("Invalid Brick Breaker v2 state.");
  if (
    !Array.isArray(s.bricks) ||
    s.bricks.length !== 40 ||
    !s.bricks.every((n, i) =>
      fast
        ? integer(n, 0, armor(s, i) ? 2 : Number(FAST_MAPS[s.stage][i] !== "0"))
        : n === 0 || n === 1,
    ) ||
    (fast &&
      s.stageBroken !==
        FAST_COUNTS[s.stage] - s.bricks.filter(Boolean).length) ||
    !Array.isArray(s.powerBricks) ||
    s.powerBricks.length !== 40 ||
    !s.powerBricks.every(
      (n, i) => integer(n, 0, powers) && (!n || s.bricks[i] === 1),
    ) ||
    s.powerBricks.filter(Boolean).length > (fast ? 0 : powers)
  )
    throw Error("Invalid power bricks.");
  if (
    !Array.isArray(s.balls) ||
    s.balls.length > 3 ||
    !s.balls.every(ball) ||
    new Set(s.balls.map((b) => b.id)).size !== s.balls.length ||
    s.balls.some((b) => b.id >= s.nextBallId) ||
    !Array.isArray(s.drops) ||
    s.drops.length > (fast ? 11 : powers) ||
    !s.drops.every(
      (d) =>
        integer(d.id, 1, drops) &&
        d.id < s.nextDropId &&
        integer(d.kind, 1, powers) &&
        integer(d.x, 0, 640 * Q) &&
        integer(d.y, 0, 492 * Q),
    ) ||
    new Set(s.drops.map((d) => d.id)).size !== s.drops.length
  )
    throw Error("Invalid balls or drops.");
  if (
    (s.status === "playing" && (!s.lives || !s.balls.length)) ||
    (s.status === "won" &&
      (s.stage !== stages - 1 || s.bricks.some(Boolean))) ||
    s.score % 10 !== 0 ||
    s.score > (fast ? FAST_TOTAL * 10 : s.version === 3 ? 1500 : 1020) ||
    (fast &&
      s.score !==
        (s.stageBroken +
          FAST_COUNTS.slice(0, s.stage).reduce((a, b) => a + b, 0)) *
          10) ||
    ![null, "cleared", "lives", "timeout"].includes(s.reason) ||
    ![null, "Max balls", ...Object.values(POWERUPS)].includes(s.lastPickup)
  )
    throw Error("Invalid Brick Breaker result.");
  if (
    s.version >= 3 &&
    (typeof s.shield !== "boolean" ||
      !integer(s.laserUntil, 0, 18480) ||
      !integer(s.nextVolley, 0, 18024) ||
      !Array.isArray(s.shots) ||
      s.shots.length > 6 ||
      s.shots.some(
        (shot) => !integer(shot.x, 0, 640 * Q) || !integer(shot.y, 0, 480 * Q),
      ))
  )
    throw Error("Invalid laser or shield state.");
  return s;
}
