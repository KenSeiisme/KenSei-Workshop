// 纯规则：固定 60Hz，浏览器和服务端重放共用，不读取时钟或 DOM。
export const CONFIG = {
  "block-drop": {
    name: "Block Drop",
    category: "Arcade",
    ranked: true,
    default: "classic",
    modes: {
      classic: { label: "Classic" },
      sprint: { label: "40-line Sprint" },
    },
  },
};
export const DROP = Object.freeze({
  width: 10,
  height: 20,
  hidden: 4,
  fps: 60,
  maxTicks: 432000,
  lockTicks: 30,
  das: 10,
  arr: 3,
});
export const PIECES = ["I", "J", "L", "O", "S", "T", "Z"];
const START = [
  [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ],
  [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
];
const JLSTZ = {
  "01": [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  10: [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  12: [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  21: [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  23: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  32: [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  30: [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  "03": [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
};
const IKICKS = {
  "01": [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  10: [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  12: [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  21: [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  23: [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  32: [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  30: [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  "03": [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
};
export function pieceCells(id, rotation = 0) {
  if (!Number.isInteger(id) || id < 0 || id > 6) throw Error("Invalid piece.");
  let cells = START[id].map((p) => [...p]);
  if (id === 3) return cells;
  const edge = id === 0 ? 3 : 2;
  for (let r = 0; r < rotation; r++)
    cells = cells.map(([x, y]) => [edge - y, x]);
  return cells;
}
export function occupied(s, p = s.piece) {
  return pieceCells(p.id, p.rotation).map(([x, y]) => [x + p.x, y + p.y]);
}
export function fits(s, p) {
  return occupied(s, p).every(
    ([x, y]) =>
      x >= 0 && x < 10 && y >= -4 && y < 20 && !s.board[(y + 4) * 10 + x],
  );
}
export function ghost(s) {
  const p = { ...s.piece };
  while (fits(s, { ...p, y: p.y + 1 })) p.y++;
  return occupied(s, p);
}
function random(s, n) {
  let x = s.rng >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return Math.floor((s.rng / 4294967296) * n);
}
function supply(s) {
  while (s.queue.length < 4) {
    const bag = [0, 1, 2, 3, 4, 5, 6];
    for (let i = 6; i > 0; i--) {
      const j = random(s, i + 1);
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    s.queue.push(...bag);
  }
}
function spawn(s, id) {
  if (id === undefined) {
    supply(s);
    id = s.queue.shift();
    supply(s);
  }
  s.piece = { id, x: id === 3 ? 4 : 3, y: -2, rotation: 0 };
  s.gravity = 0;
  s.grounded = null;
  s.lockResets = 0;
  if (!fits(s, s.piece)) s.status = "lost";
}
export function create(game, difficulty, seed) {
  if (
    game !== "block-drop" ||
    !CONFIG[game].modes[difficulty] ||
    !Number.isInteger(seed) ||
    seed < 1 ||
    seed > 4294967295
  )
    throw Error("Invalid Block Drop game.");
  const s = {
    game,
    difficulty,
    version: 1,
    seed,
    rng: seed,
    board: Array(240).fill(0),
    queue: [],
    hold: null,
    holdUsed: false,
    piece: null,
    score: 0,
    moves: 0,
    lines: 0,
    level: 1,
    ticks: 0,
    gravity: 0,
    grounded: null,
    lockResets: 0,
    status: "playing",
    held: { left: false, right: false, down: false },
    horizontal: 0,
    repeatAt: 0,
    lastClear: [],
    lastLock: [],
    lastGain: 0,
  };
  spawn(s);
  return s;
}
function adjust(s, dx, rotation = s.piece.rotation) {
  const p = { ...s.piece, x: s.piece.x + dx, rotation };
  if (!fits(s, p)) return false;
  const wasGrounded = s.grounded !== null;
  s.piece = p;
  if (wasGrounded && s.lockResets < 15) {
    s.grounded = s.ticks;
    s.lockResets++;
  }
  return true;
}
function rotate(s, dir) {
  if (s.piece.id === 3) return true;
  const from = s.piece.rotation,
    to = (from + dir + 4) % 4;
  for (const [dx, dy] of (s.piece.id === 0 ? IKICKS : JLSTZ)[`${from}${to}`]) {
    const p = {
      ...s.piece,
      x: s.piece.x + dx,
      y: s.piece.y - dy,
      rotation: to,
    };
    if (!fits(s, p)) continue;
    const wasGrounded = s.grounded !== null;
    s.piece = p;
    if (wasGrounded && s.lockResets < 15) {
      s.grounded = s.ticks;
      s.lockResets++;
    }
    return true;
  }
  return false;
}
function lock(s) {
  const cells = occupied(s);
  s.lastLock = cells.map((p) => [...p]);
  s.lastClear = [];
  s.moves++;
  if (cells.some(([, y]) => y < 0)) {
    s.status = "lost";
    return;
  }
  for (const [x, y] of cells) s.board[(y + 4) * 10 + x] = s.piece.id + 1;
  const remaining = [];
  for (let y = -4; y < 20; y++) {
    const row = s.board.slice((y + 4) * 10, (y + 5) * 10);
    if (row.every(Boolean)) s.lastClear.push(y);
    else remaining.push(...row);
  }
  const n = s.lastClear.length;
  s.lastGain = ([0, 100, 300, 500, 800][n] || 0) * s.level;
  s.score += s.lastGain;
  s.lines += n;
  s.level = 1 + Math.floor(s.lines / 10);
  s.board = [...Array(n * 10).fill(0), ...remaining];
  s.holdUsed = false;
  if (s.difficulty === "sprint" && s.lines >= 40) {
    s.status = "won";
    return;
  }
  spawn(s);
}
export function clearInput(s) {
  s.held = { left: false, right: false, down: false };
  s.horizontal = 0;
  s.repeatAt = s.ticks;
}
export function advanceDrop(s, target) {
  if (!Number.isSafeInteger(target) || target < s.ticks || target > 4320000)
    throw Error("Invalid Block Drop tick.");
  while (s.ticks < target && s.status === "playing") {
    s.ticks++;
    const key = s.horizontal < 0 ? "left" : "right";
    if (s.horizontal && s.held[key] && s.ticks >= s.repeatAt) {
      adjust(s, s.horizontal);
      s.repeatAt = s.ticks + DROP.arr;
    }
    const interval = s.held.down
      ? Math.min(2, Math.max(6, 60 - (s.level - 1) * 5))
      : Math.max(6, 60 - (s.level - 1) * 5);
    if (++s.gravity >= interval) {
      s.gravity = 0;
      if (fits(s, { ...s.piece, y: s.piece.y + 1 })) {
        s.piece.y++;
        s.grounded = null;
        if (s.held.down) s.score++;
      }
    }
    if (!fits(s, { ...s.piece, y: s.piece.y + 1 })) {
      if (s.grounded === null) s.grounded = s.ticks;
      if (s.ticks - s.grounded >= DROP.lockTicks) lock(s);
    } else s.grounded = null;
  }
  return s;
}
export const INPUTS = [
  "left-down",
  "left-up",
  "right-down",
  "right-up",
  "down-down",
  "down-up",
  "cw",
  "ccw",
  "hard",
  "hold",
];
export function apply(s, e) {
  if (
    s.status !== "playing" ||
    e.type !== "drop-input" ||
    !INPUTS.includes(e.input) ||
    !Number.isSafeInteger(e.tick) ||
    e.tick < s.ticks
  )
    return false;
  advanceDrop(s, e.tick);
  if (s.status !== "playing") return false;
  const [key, edge] = e.input.split("-");
  if (edge) {
    const pressed = edge === "down";
    if (s.held[key] === pressed) return false;
    s.held[key] = pressed;
    if (key !== "down") {
      if (pressed) {
        s.horizontal = key === "left" ? -1 : 1;
        adjust(s, s.horizontal);
        s.repeatAt = s.ticks + DROP.das;
      } else if (s.horizontal === (key === "left" ? -1 : 1)) {
        const other = key === "left" ? "right" : "left";
        s.horizontal = s.held[other] ? (other === "left" ? -1 : 1) : 0;
        s.repeatAt = s.ticks + DROP.das;
      }
    }
    return true;
  }
  if (e.input === "cw" || e.input === "ccw") {
    rotate(s, e.input === "cw" ? 1 : -1);
    return true;
  }
  if (e.input === "hard") {
    let n = 0;
    while (fits(s, { ...s.piece, y: s.piece.y + 1 })) {
      s.piece.y++;
      n++;
    }
    s.score += n * 2;
    lock(s);
    return true;
  }
  if (e.input === "hold") {
    if (s.holdUsed) return false;
    const id = s.piece.id,
      old = s.hold;
    s.hold = id;
    spawn(s, old === null ? undefined : old);
    s.holdUsed = true;
    return true;
  }
  return false;
}
export const metrics = (s) => ({
  score: s.score,
  moves: s.moves,
  max_tile: 0,
  won: s.status === "won",
  lines: s.lines,
});
export function replayDrop(
  difficulty,
  seed,
  events,
  finalTick,
  durationMs,
  format,
) {
  if (
    format !== "block-drop-v1" ||
    !Array.isArray(events) ||
    events.length > 20000 ||
    !Number.isSafeInteger(finalTick) ||
    finalTick < 0 ||
    finalTick > DROP.maxTicks ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > 7200000 ||
    (finalTick * 1000) / 60 > durationMs + 250
  )
    throw Error("Invalid Block Drop replay limits.");
  const s = create("block-drop", difficulty, seed);
  let previous = 0;
  for (const item of events) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      !Number.isSafeInteger(item[0]) ||
      item[0] < previous ||
      item[0] > finalTick ||
      !Number.isInteger(item[1]) ||
      !INPUTS[item[1]]
    )
      throw Error("Invalid Block Drop input.");
    previous = item[0];
    if (
      !apply(s, { type: "drop-input", tick: item[0], input: INPUTS[item[1]] })
    )
      throw Error("Invalid Block Drop action.");
  }
  advanceDrop(s, finalTick);
  if (s.status === "playing" || s.ticks !== finalTick)
    throw Error("Block Drop has not ended at this tick.");
  return { ...metrics(s), elapsed_ms: Math.max(1, Math.round(durationMs)) };
}
export function validate(s) {
  const integer = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b;
  if (
    !Array.isArray(s.board) ||
    s.board.length !== 240 ||
    !s.board.every((n) => integer(n, 0, 7)) ||
    !Array.isArray(s.queue) ||
    s.queue.length < 3 ||
    s.queue.length > 10 ||
    !s.queue.every((n) => integer(n, 0, 6)) ||
    !(s.hold === null || integer(s.hold, 0, 6)) ||
    typeof s.holdUsed !== "boolean" ||
    !integer(s.lines, 0, 80000) ||
    s.level !== 1 + Math.floor(s.lines / 10) ||
    !integer(s.ticks, 0, 4320000) ||
    !integer(s.gravity, 0, 60) ||
    !(s.grounded === null || integer(s.grounded, 0, s.ticks)) ||
    !integer(s.lockResets, 0, 15) ||
    !s.held ||
    !["left", "right", "down"].every((k) => typeof s.held[k] === "boolean") ||
    ![-1, 0, 1].includes(s.horizontal) ||
    !integer(s.repeatAt, 0, 4320100) ||
    !s.piece ||
    !integer(s.piece.id, 0, 6) ||
    !integer(s.piece.rotation, 0, 3) ||
    !integer(s.piece.x, -3, 9) ||
    !integer(s.piece.y, -4, 19) ||
    !Array.isArray(s.lastClear) ||
    !s.lastClear.every((y) => integer(y, -4, 19)) ||
    s.lastClear.length > 4 ||
    !Array.isArray(s.lastLock) ||
    s.lastLock.length > 4 ||
    !s.lastLock.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        integer(p[0], 0, 9) &&
        integer(p[1], -4, 19),
    ) ||
    !integer(s.lastGain, 0, 100000000) ||
    (s.status === "playing" && !fits(s, s.piece)) ||
    (s.status === "won" && (s.difficulty !== "sprint" || s.lines < 40))
  )
    throw Error("Invalid Block Drop save.");
  return s;
}
