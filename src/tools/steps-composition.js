export function stepsLayout(images, mode, width) {
  const columns = mode === "compare" && images.length > 1 ? 2 : 1;
  const gap = Math.round(width * 0.02);
  const available = width - (columns + 1) * gap;
  const cells = images.map(({ width: w, height: h }, i) => {
    const column = i % columns;
    const left = Math.round((available * column) / columns);
    const cellWidth = Math.round((available * (column + 1)) / columns) - left;
    return {
      x: gap * (column + 1) + left,
      y: 0,
      width: cellWidth,
      height: Math.max(1, Math.round((cellWidth * h) / w)),
    };
  });
  let y = gap;
  for (let i = 0; i < cells.length; i += columns) {
    const row = cells.slice(i, i + columns);
    row.forEach((cell) => {
      cell.y = y;
    });
    y += Math.max(...row.map((cell) => cell.height)) + gap;
  }
  return { width, height: y, cells };
}

export function drawStep(ctx, img, { x, y, width, height }, marks) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const unit = Math.max(5, Math.min(width, height) * 0.037);
  ctx.lineWidth = unit * 0.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.font = "600 " + unit + "px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (const mark of marks) {
    if (mark.type === "cover") continue;
    const cx = mark.x * width,
      cy = mark.y * height;
    if (mark.type === "arrow") {
      const ex = mark.endX * width,
        ey = mark.endY * height,
        angle = Math.atan2(ey - cy, ex - cx);
      ctx.strokeStyle = "#9861ce";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.lineTo(
        ex - Math.cos(angle - 0.5) * unit,
        ey - Math.sin(angle - 0.5) * unit,
      );
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - Math.cos(angle + 0.5) * unit,
        ey - Math.sin(angle + 0.5) * unit,
      );
      ctx.stroke();
    } else {
      ctx.textAlign = "center";
      const text = mark.value;
      const textWidth = Math.min(width * 0.8, ctx.measureText(text).width);
      const boxWidth =
        mark.type === "number" ? unit * 1.7 : textWidth + unit * 0.9;
      const boxX = Math.max(0, Math.min(width - boxWidth, cx - boxWidth / 2));
      const boxY = Math.max(0, Math.min(height - unit * 1.5, cy - unit * 0.75));
      ctx.fillStyle = "#332047";
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, unit * 1.5, unit * 0.4);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(
        text,
        boxX + boxWidth / 2,
        boxY + unit * 0.76,
        boxWidth - unit * 0.45,
      );
    }
  }
  ctx.fillStyle = "#201827";
  // Round the opaque mask outward so boundary pixels contain no source colors.
  for (const mark of marks.filter((mark) => mark.type === "cover")) {
    const left = Math.floor(Math.min(mark.x, mark.endX) * width);
    const top = Math.floor(Math.min(mark.y, mark.endY) * height);
    const right = Math.ceil(Math.max(mark.x, mark.endX) * width);
    const bottom = Math.ceil(Math.max(mark.y, mark.endY) * height);
    ctx.fillRect(left, top, right - left, bottom - top);
  }
  ctx.restore();
}
