import { BRICK, brickRect, paddleCenter } from "./arcade-engine.js";

// 仅负责画面，不推进逻辑；刷新率不会影响球速或成绩。
export function paintBrick(canvas, state, view = {}) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return false;
  if (canvas.width !== BRICK.width) canvas.width = BRICK.width;
  if (canvas.height !== BRICK.height) canvas.height = BRICK.height;
  const { width: w, height: h, scale: q } = BRICK;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#151725");
  bg.addColorStop(0.55, "#1d1930");
  bg.addColorStop(1, "#111c25");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#bba5df0c";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#aa9bbb";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`STAGE ${state.stage + 1} / 3`, 27, 29);
  ctx.textAlign = "right";
  ctx.fillText(
    `${state.lives} ${state.lives === 1 ? "LIFE" : "LIVES"}`,
    w - 27,
    29,
  );
  const colors = ["#c7a5ef", "#a995eb", "#92c6df", "#8cdbcb", "#e3a9ca"];
  for (let i = 0; i < state.bricks.length; i++) {
    if (!state.bricks[i]) continue;
    const r = brickRect(i),
      x = r.x / q,
      y = r.y / q,
      bw = r.w / q,
      bh = r.h / q;
    const row = Math.floor(i / 8),
      c = colors[(row + state.stage) % colors.length];
    ctx.fillStyle = "#00000035";
    ctx.beginPath();
    ctx.roundRect(x, y + 3, bw, bh, 4);
    ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, 4);
    ctx.fill();
    ctx.fillStyle = "#ffffff35";
    ctx.fillRect(x + 6, y + 3, bw - 12, 1.5);
  }
  const px = paddleCenter(state) / q - BRICK.paddleWidth / 2;
  ctx.save();
  ctx.shadowColor = "#c2a6ef";
  ctx.shadowBlur = 18;
  const paddle = ctx.createLinearGradient(px, 0, px + BRICK.paddleWidth, 0);
  paddle.addColorStop(0, "#bda0e9");
  paddle.addColorStop(0.5, "#e9d9ff");
  paddle.addColorStop(1, "#bda0e9");
  ctx.fillStyle = paddle;
  ctx.beginPath();
  ctx.roundRect(px, BRICK.paddleY, BRICK.paddleWidth, BRICK.paddleHeight, 6);
  ctx.fill();
  ctx.restore();
  const b = { ...state.ball, ...view.ball },
    bx = b.x / q,
    by = b.y / q;
  if (view.full !== false && b.launched && state.status === "playing") {
    const tail = ctx.createLinearGradient(
      bx - (b.vx / q) * 5,
      by - (b.vy / q) * 5,
      bx,
      by,
    );
    tail.addColorStop(0, "#a0dfcd00");
    tail.addColorStop(1, "#a0dfcda0");
    ctx.strokeStyle = tail;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bx - (b.vx / q) * 5, by - (b.vy / q) * 5);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.save();
  ctx.shadowColor = "#a5f3d9";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#e5fff7";
  ctx.beginPath();
  ctx.arc(bx, by, BRICK.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (!b.launched && state.status === "playing") {
    ctx.textAlign = "center";
    ctx.fillStyle = "#d9cdea";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(
      state.ticks === 0
        ? "Move your paddle. Tap or press Space to launch."
        : "Ready for another ball? Tap or press Space.",
      w / 2,
      h - 78,
    );
  }
  return true;
}
