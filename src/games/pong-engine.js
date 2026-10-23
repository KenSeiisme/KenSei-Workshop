// 休闲联机的物理规则；房主推进固定 120Hz，显示帧率不改变球速。
export const PONG = Object.freeze({
  width: 960,
  height: 540,
  fps: 120,
  paddleHeight: 96,
  paddleWidth: 14,
  paddleSpeed: 780,
  radius: 8,
  maxTicks: 72000,
});
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
// 恢复的 performance.now() 可能晚于本帧的 rAF 时间戳；逻辑 tick 只能前进。
export function pongTickAt(currentTick, baseTick, startedAt, frameAt) {
  const elapsed = Math.max(0, frameAt - startedAt);
  return Math.min(
    PONG.maxTicks,
    Math.max(currentTick, baseTick + Math.floor((elapsed * PONG.fps) / 1000)),
  );
}
function random(s) {
  let x = s.rng >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng / 4294967296;
}
function serve(s, direction, wait = 240) {
  s.ball = { x: 480, y: 270, vx: direction * 360, vy: (random(s) - 0.5) * 260 };
  s.serveAt = s.ticks + wait;
  s.rally = 0;
}
export function createPong(seed) {
  const s = {
    version: 1,
    rng: seed >>> 0 || 1,
    ticks: 0,
    left: 270,
    right: 270,
    score: [0, 0],
    ball: null,
    status: "playing",
    winner: 0,
    serveAt: 0,
    rally: 0,
    lastPoint: 0,
  };
  serve(s, random(s) < 0.5 ? -1 : 1, 360);
  return s;
}
export function advancePong(s, target, leftTarget = 512, rightTarget = 512) {
  if (
    !Number.isSafeInteger(target) ||
    target < s.ticks ||
    target > PONG.maxTicks
  )
    throw Error("Invalid Pong tick.");
  const targets = [leftTarget, rightTarget].map(
    (n) => (clamp(Number.isFinite(n) ? n : 512, 0, 1024) / 1024) * 540,
  );
  while (s.ticks < target && s.status === "playing") {
    s.ticks++;
    for (const [i, key] of ["left", "right"].entries())
      s[key] = clamp(s[key] + clamp(targets[i] - s[key], -6.5, 6.5), 48, 492);
    if (s.ticks >= s.serveAt) {
      const b = s.ball,
        oldX = b.x,
        oldY = b.y;
      b.x += b.vx / 120;
      b.y += b.vy / 120;
      if (b.y < 8) {
        b.y = 16 - b.y;
        b.vy = Math.abs(b.vy);
      } else if (b.y > 532) {
        b.y = 1064 - b.y;
        b.vy = -Math.abs(b.vy);
      }
      const side = b.vx < 0 ? 0 : 1,
        plane = side === 0 ? 58 : 902;
      if (
        (side === 0 && oldX >= plane && b.x <= plane) ||
        (side === 1 && oldX <= plane && b.x >= plane)
      ) {
        const t = (plane - oldX) / (b.x - oldX),
          impactY = oldY + (b.y - oldY) * t,
          paddle = side === 0 ? s.left : s.right;
        if (Math.abs(impactY - paddle) <= 56) {
          const angle = clamp((impactY - paddle) / 48, -1, 1) * 1.02,
            speed = Math.min(750, Math.hypot(b.vx, b.vy) * 1.05);
          b.x = plane;
          b.vx = (side === 0 ? 1 : -1) * Math.cos(angle) * speed;
          b.vy = Math.sin(angle) * speed;
          s.rally++;
        }
      }
      if (b.x < -8 || b.x > 968) {
        const scorer = b.x < 0 ? 1 : 0;
        s.score[scorer]++;
        s.lastPoint = s.ticks;
        if (s.score[scorer] >= 7) {
          s.status = "won";
          s.winner = scorer + 1;
        } else serve(s, scorer === 0 ? 1 : -1);
      }
    }
    if (s.ticks === PONG.maxTicks && s.status === "playing") {
      s.winner =
        s.score[0] === s.score[1] ? 0 : s.score[0] > s.score[1] ? 1 : 2;
      s.status = s.winner ? "won" : "draw";
    }
  }
  return s;
}
export function validPongState(s) {
  return (
    !!s &&
    s.version === 1 &&
    Number.isSafeInteger(s.ticks) &&
    s.ticks >= 0 &&
    s.ticks <= 72000 &&
    [s.left, s.right, s.ball?.x, s.ball?.y, s.ball?.vx, s.ball?.vy].every(
      Number.isFinite,
    ) &&
    s.left >= 48 &&
    s.left <= 492 &&
    s.right >= 48 &&
    s.right <= 492 &&
    Math.abs(s.ball.x) < 1100 &&
    Math.abs(s.ball.y) < 700 &&
    Math.abs(s.ball.vx) <= 800 &&
    Math.abs(s.ball.vy) <= 800 &&
    Array.isArray(s.score) &&
    s.score.length === 2 &&
    s.score.every((n) => Number.isInteger(n) && n >= 0 && n <= 7) &&
    ["playing", "won", "draw"].includes(s.status) &&
    [0, 1, 2].includes(s.winner) &&
    Number.isInteger(s.serveAt) &&
    s.serveAt >= 0 &&
    s.serveAt <= 72360
  );
}
