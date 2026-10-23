// 无 DOM、时钟或网络：浏览器与 Edge 使用同一套确定性规则。
export const CONFIG = {
  "block-puzzle": {
    name: "Block Puzzle",
    category: "Puzzle",
    ranked: true,
    default: "classic",
    modes: { classic: { label: "Classic · 8 × 8" } },
  },
  "brick-breaker": {
    name: "Brick Breaker",
    category: "Arcade",
    ranked: true,
    default: "classic",
    modes: { classic: { label: "Classic · 3 stages" } },
  },
};

const shape = (id, cells) => ({
  id,
  cells,
  w: 1 + Math.max(...cells.map(([x]) => x)),
  h: 1 + Math.max(...cells.map(([, y]) => y)),
});
const line = (n, vertical = false) =>
  Array.from({ length: n }, (_, i) => (vertical ? [0, i] : [i, 0]));
// 顺序属于 v1 规则；不能调整，否则旧种子的方块序列会改变。
export const SHAPES = [
  shape("single", [[0, 0]]),
  ...[2, 3, 4, 5].flatMap((n) => [
    shape(`line-${n}-h`, line(n)),
    shape(`line-${n}-v`, line(n, true)),
  ]),
  shape("square-2", [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]),
  shape(
    "square-3",
    Array.from({ length: 9 }, (_, i) => [i % 3, Math.floor(i / 3)]),
  ),
  shape("corner-ne", [
    [0, 0],
    [1, 0],
    [1, 1],
  ]),
  shape("corner-se", [
    [1, 0],
    [0, 1],
    [1, 1],
  ]),
  shape("corner-sw", [
    [0, 0],
    [0, 1],
    [1, 1],
  ]),
  shape("corner-nw", [
    [0, 0],
    [1, 0],
    [0, 1],
  ]),
  shape("l-down", [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 2],
  ]),
  shape("l-up", [
    [0, 0],
    [1, 0],
    [1, 1],
    [1, 2],
  ]),
  shape("l-left", [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
  ]),
  shape("l-right", [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ]),
  shape("t-down", [
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
  ]),
  shape("t-up", [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ]),
  shape("t-left", [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, 2],
  ]),
  shape("t-right", [
    [0, 0],
    [0, 1],
    [1, 1],
    [0, 2],
  ]),
  shape("rectangle-h", [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ]),
  shape("rectangle-v", [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0, 2],
    [1, 2],
  ]),
];

export const BRICK = Object.freeze({
  width: 640,
  height: 480,
  scale: 1024,
  fps: 60,
  maxTicks: 18000,
  paddleWidth: 92,
  paddleHeight: 12,
  paddleY: 445,
  radius: 6,
  columns: 8,
  rows: 5,
  brickWidth: 70,
  brickHeight: 18,
  brickLeft: 26,
  brickTop: 54,
  brickStepX: 74,
  brickStepY: 25,
});
// 三关原创有限布局；一个数字代表一块单次击碎的砖。
export const BRICK_LAYOUTS = Object.freeze([
  ["11111111", "11111111", "11111111", "11111111", "11111111"],
  ["11011011", "01111110", "11011011", "01111110", "11011011"],
  ["00111100", "01111110", "11111111", "01111110", "00111100"],
]);
const Q = BRICK.scale;
const integer = (n, low, high) =>
  Number.isSafeInteger(n) && n >= low && n <= high;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
function random(s, n) {
  let x = s.rng >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return Math.floor((s.rng / 4294967296) * n);
}
function newHand(s) {
  s.hand = Array.from({ length: 3 }, () => random(s, SHAPES.length));
}
function stageBricks(stage) {
  return BRICK_LAYOUTS[stage].join("").split("").map(Number);
}
export function paddleCenter(s) {
  return Math.round(
    (BRICK.paddleWidth / 2 +
      (s.paddle / 1024) * (BRICK.width - BRICK.paddleWidth)) *
      Q,
  );
}
function attachBall(s) {
  s.ball = {
    x: paddleCenter(s),
    y: (BRICK.paddleY - BRICK.radius - 2) * Q,
    vx: 0,
    vy: 0,
    launched: false,
  };
}
export function create(game, difficulty, seed) {
  if (!CONFIG[game]?.modes[difficulty])
    throw Error("Unknown arcade game or difficulty.");
  if (!integer(seed, 1, 4294967295)) throw Error("Invalid random seed.");
  const s = {
    game,
    difficulty,
    version: 1,
    seed,
    rng: seed,
    score: 0,
    moves: 0,
    status: "playing",
  };
  if (game === "block-puzzle") {
    Object.assign(s, {
      board: Array(64).fill(0),
      cleared: 0,
      lastClear: [],
      lastLines: 0,
    });
    newHand(s);
  } else {
    Object.assign(s, {
      ticks: 0,
      stage: 0,
      lives: 3,
      bricks: stageBricks(0),
      paddle: 512,
      lastPaddleTick: -2,
      paddleChanges: 0,
      reason: null,
    });
    attachBall(s);
  }
  return s;
}
export function canPlace(s, slot, index) {
  if (
    s.game !== "block-puzzle" ||
    s.status !== "playing" ||
    !integer(slot, 0, 2) ||
    !integer(index, 0, 63) ||
    s.hand[slot] === null
  )
    return false;
  const item = SHAPES[s.hand[slot]],
    x = index % 8,
    y = Math.floor(index / 8);
  return (
    x + item.w <= 8 &&
    y + item.h <= 8 &&
    item.cells.every(([dx, dy]) => !s.board[(y + dy) * 8 + x + dx])
  );
}
export function availablePlacements(s, slot) {
  return Array.from({ length: 64 }, (_, i) => i).filter((i) =>
    canPlace(s, slot, i),
  );
}
function place(s, e) {
  if (!canPlace(s, e.slot, e.index)) return false;
  const item = SHAPES[s.hand[e.slot]],
    x = e.index % 8,
    y = Math.floor(e.index / 8);
  item.cells.forEach(([dx, dy]) => {
    s.board[(y + dy) * 8 + x + dx] = 1;
  });
  s.score += item.cells.length;
  const rows = [],
    cols = [],
    cells = new Set();
  for (let n = 0; n < 8; n++) {
    if (Array.from({ length: 8 }, (_, i) => s.board[n * 8 + i]).every(Boolean))
      rows.push(n);
    if (Array.from({ length: 8 }, (_, i) => s.board[i * 8 + n]).every(Boolean))
      cols.push(n);
  }
  rows.forEach((r) => {
    for (let i = 0; i < 8; i++) cells.add(r * 8 + i);
  });
  cols.forEach((c) => {
    for (let i = 0; i < 8; i++) cells.add(i * 8 + c);
  });
  s.lastClear = [...cells];
  s.lastLines = rows.length + cols.length;
  s.cleared += s.lastLines;
  s.score += s.lastLines * 10;
  cells.forEach((i) => {
    s.board[i] = 0;
  });
  s.hand[e.slot] = null;
  s.moves++;
  if (s.hand.every((v) => v === null)) newHand(s);
  if (![0, 1, 2].some((slot) => availablePlacements(s, slot).length))
    s.status = "lost";
  return true;
}

export function brickRect(index) {
  return {
    x: (BRICK.brickLeft + (index % 8) * BRICK.brickStepX) * Q,
    y: (BRICK.brickTop + Math.floor(index / 8) * BRICK.brickStepY) * Q,
    w: BRICK.brickWidth * Q,
    h: BRICK.brickHeight * Q,
  };
}
// 点对扩展矩形的连续碰撞，避免高速度穿砖。正好撞角时同时反转两个方向。
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
      b = (max - p) / d;
    const entry = Math.min(a, b),
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
function physics(s) {
  const b = s.ball;
  if (!b.launched) {
    b.x = paddleCenter(s);
    return;
  }
  let fraction = 1;
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
    if (dx > 0)
      offer({ t: (BRICK.width * Q - r - b.x) / dx, nx: -1, ny: 0 }, "wall");
    if (dy < 0) offer({ t: (r - b.y) / dy, nx: 0, ny: 1 }, "wall");
    if (dy > 0 && b.y <= (BRICK.paddleY - BRICK.radius) * Q)
      offer(
        sweep(b.x, b.y, dx, dy, {
          x: paddleCenter(s) - (BRICK.paddleWidth * Q) / 2,
          y: BRICK.paddleY * Q,
          w: BRICK.paddleWidth * Q,
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
        (b.x - paddleCenter(s)) / ((BRICK.paddleWidth * Q) / 2),
        -1,
        1,
      );
      const speed = (4.5 + s.stage * 0.55) * Q;
      let vx = Math.round(speed * offset * 0.88);
      if (Math.abs(vx) < Q * 0.85)
        vx = Math.round(Q * 0.85) * (b.vx < 0 ? -1 : 1);
      b.vx = vx;
      b.vy = -Math.round(Math.sqrt(speed * speed - vx * vx));
    } else {
      if (hit.nx) b.vx = -b.vx;
      if (hit.ny) b.vy = -b.vy;
      if (hit.kind === "brick") {
        s.bricks[hit.index] = 0;
        s.score += 10;
        if (!s.bricks.some(Boolean)) {
          if (s.stage === 2) {
            s.status = "won";
            s.reason = "cleared";
          } else {
            s.stage++;
            s.bricks = stageBricks(s.stage);
            attachBall(s);
          }
          return;
        }
      }
    }
  }
  if (b.y > (BRICK.height + BRICK.radius) * Q) {
    s.lives--;
    if (!s.lives) {
      s.status = "lost";
      s.reason = "lives";
    } else attachBall(s);
  }
}
export function advanceBrick(s, tick) {
  if (s.game !== "brick-breaker" || !integer(tick, s.ticks, BRICK.maxTicks))
    throw Error("Invalid game tick.");
  while (s.ticks < tick && s.status === "playing") {
    s.ticks++;
    physics(s);
    if (s.ticks === BRICK.maxTicks && s.status === "playing") {
      s.status = "lost";
      s.reason = "timeout";
    }
  }
  return s;
}
export function apply(s, e) {
  if (s.status !== "playing" || !e || typeof e !== "object") return false;
  if (s.game === "block-puzzle") return e.type === "place" && place(s, e);
  if (
    s.game !== "brick-breaker" ||
    !["paddle", "launch"].includes(e.type) ||
    !integer(e.tick, s.ticks, BRICK.maxTicks)
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
    if (!s.ball.launched) s.ball.x = paddleCenter(s);
  } else {
    if (s.ball.launched) return false;
    s.ball.launched = true;
    s.ball.vx = (random(s, 2) ? 1 : -1) * (2 * Q + random(s, 600));
    s.ball.vy = -Math.round(3.85 * Q + s.stage * Q * 0.5);
  }
  s.moves++;
  return true;
}
export function metrics(s) {
  return {
    score: s.score,
    moves: s.moves,
    max_tile: 0,
    won: s.status === "won",
  };
}
export function replayBrick(
  difficulty,
  seed,
  events,
  finalTick,
  durationMs,
  format,
) {
  if (
    format !== "paddle-v1" ||
    !Array.isArray(events) ||
    events.length > 20000 ||
    !integer(finalTick, 0, BRICK.maxTicks) ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > 7200000 ||
    (finalTick * 1000) / 60 > durationMs + 250
  )
    throw Error("Invalid Brick Breaker replay or game speed.");
  const s = create("brick-breaker", difficulty, seed);
  let last = 0;
  for (const e of events) {
    if (
      !Array.isArray(e) ||
      e.length !== 2 ||
      !integer(e[0], last, finalTick) ||
      !integer(e[1], -1, 1024)
    )
      throw Error("Invalid paddle replay event.");
    last = e[0];
    if (
      !apply(
        s,
        e[1] === -1
          ? { type: "launch", tick: e[0] }
          : { type: "paddle", tick: e[0], x: e[1] },
      )
    )
      throw Error("Invalid game action or actions after game over.");
  }
  advanceBrick(s, finalTick);
  if (s.ticks !== finalTick) throw Error("Actions after game over.");
  if (s.status === "playing") throw Error("This game has not finished.");
  return { ...metrics(s), elapsed_ms: Math.max(1, Math.round(durationMs)) };
}
export function validate(s) {
  if (
    !s ||
    !CONFIG[s.game]?.modes[s.difficulty] ||
    s.version !== 1 ||
    !integer(s.seed, 1, 4294967295) ||
    !integer(s.rng, 1, 4294967295) ||
    !integer(s.score, 0, 1000000000) ||
    !integer(s.moves, 0, 100000000) ||
    !["playing", "won", "lost"].includes(s.status)
  )
    throw Error("Invalid arcade save.");
  const bits = (a, n) =>
    Array.isArray(a) && a.length === n && a.every((x) => x === 0 || x === 1);
  if (s.game === "block-puzzle") {
    if (
      !bits(s.board, 64) ||
      !Array.isArray(s.hand) ||
      s.hand.length !== 3 ||
      s.hand.every((v) => v === null) ||
      !s.hand.every((v) => v === null || integer(v, 0, SHAPES.length - 1)) ||
      !integer(s.cleared, 0, 1600000000) ||
      !integer(s.lastLines, 0, 16) ||
      !Array.isArray(s.lastClear) ||
      s.lastClear.length > 64 ||
      !s.lastClear.every((v) => integer(v, 0, 63)) ||
      new Set(s.lastClear).size !== s.lastClear.length ||
      s.status === "won"
    )
      throw Error("Invalid Block Puzzle save.");
    return true;
  }
  const b = s.ball;
  if (
    !integer(s.ticks, 0, BRICK.maxTicks) ||
    !integer(s.stage, 0, 2) ||
    !integer(s.lives, 0, 3) ||
    !bits(s.bricks, 40) ||
    s.bricks.some((v, i) => v && !stageBricks(s.stage)[i]) ||
    !integer(s.paddle, 0, 1024) ||
    !integer(s.lastPaddleTick, -2, s.ticks) ||
    !integer(s.paddleChanges, 0, 9000) ||
    !b ||
    typeof b.launched !== "boolean" ||
    !integer(b.x, -20 * Q, (BRICK.width + 20) * Q) ||
    !integer(b.y, -20 * Q, (BRICK.height + 30) * Q) ||
    !integer(b.vx, -12 * Q, 12 * Q) ||
    !integer(b.vy, -12 * Q, 12 * Q) ||
    ![null, "cleared", "lives", "timeout"].includes(s.reason) ||
    s.score % 10 ||
    s.score >
      BRICK_LAYOUTS.flat()
        .join("")
        .split("")
        .filter((v) => v === "1").length *
        10
  )
    throw Error("Invalid Brick Breaker save.");
  if (
    (s.status === "won" &&
      (s.stage !== 2 || s.bricks.some(Boolean) || s.reason !== "cleared")) ||
    (s.status === "playing" &&
      (s.reason !== null || !s.lives || s.ticks === BRICK.maxTicks))
  )
    throw Error("Invalid Brick Breaker end state.");
  return true;
}
