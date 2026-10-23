import { SHAPES, BRICK, canPlace } from "./arcade-engine.js";
import { paintBrick } from "./arcade-paint.js";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const playing = (ctx) =>
  ctx.isRunning() && ctx.getState()?.status === "playing";

export function createArcadeUI(ctx) {
  let boardNode,
    selected = 0,
    cursor = 0,
    hover = null,
    drag = null;
  let target = 512,
    held = new Set(),
    lastFrame = null,
    suppressClickUntil = 0;
  let canvasFailed = false,
    bound = false;
  const announce = (text) => ctx.announce?.(text);
  const state = () => ctx.getState();
  const chooseAvailable = () => {
    const s = state();
    if (s?.game === "block-puzzle" && s.hand[selected] === null)
      selected = Math.max(
        0,
        s.hand.findIndex((v) => v !== null),
      );
  };
  function previewCells(s, index) {
    if (index === null || s.hand[selected] === null) return new Set();
    const shape = SHAPES[s.hand[selected]],
      x = index % 8,
      y = Math.floor(index / 8);
    return new Set(
      shape.cells
        .filter(([dx, dy]) => x + dx < 8 && y + dy < 8)
        .map(([dx, dy]) => (y + dy) * 8 + x + dx),
    );
  }
  function renderBlock(board) {
    const s = state();
    chooseAvailable();
    const focus = board.contains(document.activeElement)
      ? document.activeElement
      : null;
    const focusedCell = focus?.getAttribute("data-block-cell");
    const focusedSlot = focus?.getAttribute("data-block-slot");
    const hadBoardFocus = focus === board;
    const scrollTop = board.scrollTop,
      scrollLeft = board.scrollLeft;
    const preview = previewCells(s, hover),
      valid = hover !== null && canPlace(s, selected, hover);
    board.classList.add("arcade-board", "block-puzzle-board");
    board.innerHTML = `<div class="block-instruction"><span>${s.board.filter(Boolean).length} / 64 cells filled</span><span>${s.cleared} lines cleared</span></div><div class="block-grid" role="group" aria-label="8 by 8 block puzzle board">${s.board.map((filled, i) => `<button type="button" data-block-cell="${i}" class="block-cell${filled ? " is-filled" : ""}${preview.has(i) ? (valid ? " is-preview" : " is-invalid-preview") : ""}" tabindex="${i === cursor ? "0" : "-1"}" aria-label="Row ${Math.floor(i / 8) + 1}, column ${(i % 8) + 1}, ${filled ? "occupied" : "empty"}" aria-disabled="${!playing(ctx) || !!filled}">${filled ? '<span aria-hidden="true"></span>' : ""}</button>`).join("")}</div><div class="block-tray" role="group" aria-label="Choose a piece; use 1, 2 or 3 on the keyboard">${s.hand
      .map((id, slot) => {
        if (id === null)
          return `<button type="button" class="block-piece is-used" data-block-slot="${slot}" disabled aria-label="Piece ${slot + 1} already used"><span aria-hidden="true">✓</span><small>Placed</small></button>`;
        const item = SHAPES[id],
          cells = new Set(item.cells.map(([x, y]) => y * item.w + x));
        return `<button type="button" class="block-piece${selected === slot ? " is-selected" : ""}" data-block-slot="${slot}" aria-pressed="${selected === slot}" aria-label="Piece ${slot + 1}: ${item.cells.length} cells, ${item.w} wide by ${item.h} tall" ${playing(ctx) ? "" : "disabled"}><span class="block-piece-art" style="--piece-width:${item.w};--piece-height:${item.h}" aria-hidden="true">${Array.from({ length: item.w * item.h }, (_, i) => `<i${cells.has(i) ? ' class="is-part"' : ""}></i>`).join("")}</span><small>Piece ${slot + 1}</small></button>`;
      })
      .join(
        "",
      )}</div><p class="arcade-control-note">Choose a piece, then tap a square. Drag to place, or use 1–3, arrow keys and Enter.</p>`;
    board.scrollTop = scrollTop;
    board.scrollLeft = scrollLeft;
    if (focusedCell !== null && focusedCell !== undefined)
      board
        .querySelector(`[data-block-cell="${focusedCell}"]`)
        ?.focus({ preventScroll: true });
    else if (focusedSlot !== null && focusedSlot !== undefined)
      board
        .querySelector(`[data-block-slot="${focusedSlot}"]:not(:disabled)`)
        ?.focus({ preventScroll: true });
    else if (hadBoardFocus) board.focus({ preventScroll: true });
    return true;
  }
  function placeAt(index) {
    const s = state();
    if (!playing(ctx)) {
      announce("Start or resume the game before placing a piece.");
      return;
    }
    if (!canPlace(s, selected, index)) {
      announce(
        "That piece does not fit there. Choose another square or piece.",
      );
      return;
    }
    const accepted = ctx.act({ type: "place", slot: selected, index });
    if (accepted === false) return;
    hover = null;
    chooseAvailable();
    ctx.redraw();
  }
  function flushPaddle() {
    const s = state();
    if (
      !playing(ctx) ||
      canvasFailed ||
      s.game !== "brick-breaker" ||
      s.paddle === target ||
      s.ticks - s.lastPaddleTick < 2
    )
      return;
    ctx.act({ type: "paddle", tick: s.ticks, x: target });
  }
  function launch() {
    const s = state();
    if (!playing(ctx) || canvasFailed || s.ball.launched) return;
    flushPaddle();
    ctx.act({ type: "launch", tick: s.ticks });
  }
  function renderBrick(board) {
    const s = state();
    board.classList.add("arcade-board", "brick-breaker-board");
    if (!board.querySelector(".brick-canvas")) {
      board.innerHTML =
        '<div class="brick-situation"><span class="brick-stage"></span><span class="brick-lives"></span></div><canvas class="brick-canvas" width="640" height="480" tabindex="0" role="img" aria-label="Brick Breaker board"></canvas><p class="brick-unavailable" role="alert" hidden>Your browser cannot draw this game. Try another browser or enable canvas support.</p><div class="brick-controller"><label class="brick-slider-label">Paddle position<input type="range" class="brick-paddle-slider" min="0" max="1024" step="1" value="512" aria-label="Paddle position"></label><button type="button" class="button primary brick-launch" data-brick-launch>Launch ball →</button></div><div class="brick-limit"><progress max="18000" value="0" aria-label="Five-minute game limit"></progress><span class="brick-time-left"></span></div><p class="arcade-control-note">Move the paddle with your pointer, the slider or ← / →. Tap the board or press Space to launch.</p>';
      target = s.paddle;
    }
    const canvas = board.querySelector(".brick-canvas");
    let supported = false;
    try {
      supported = paintBrick(canvas, s);
    } catch {
      supported = false;
    }
    if (!supported && !canvasFailed)
      announce(
        "Canvas drawing is unavailable. This game needs a browser with 2D canvas support.",
      );
    canvasFailed = !supported;
    canvas.hidden = !supported;
    board.querySelector(".brick-unavailable").hidden = supported;
    canvas.setAttribute(
      "aria-label",
      `Brick Breaker, stage ${s.stage + 1} of 3, ${s.bricks.filter(Boolean).length} bricks remaining, ${s.lives} lives`,
    );
    board.querySelector(".brick-stage").textContent =
      `Stage ${s.stage + 1} / 3 · ${s.bricks.filter(Boolean).length} bricks`;
    board.querySelector(".brick-lives").textContent =
      `${s.lives} ${s.lives === 1 ? "life" : "lives"} left`;
    const slider = board.querySelector(".brick-paddle-slider");
    if (document.activeElement !== slider) slider.value = String(s.paddle);
    slider.disabled = !playing(ctx) || !supported;
    const button = board.querySelector(".brick-launch");
    button.disabled = !playing(ctx) || !supported || s.ball.launched;
    button.textContent = s.ball.launched
      ? "Ball in play"
      : s.stage > 0
        ? "Launch next ball →"
        : "Launch ball →";
    const remain = Math.max(0, 300 - Math.floor(s.ticks / 60));
    board.querySelector(".brick-time-left").textContent =
      `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, "0")} left`;
    board.querySelector("progress").value = s.ticks;
    return supported;
  }
  function render(board) {
    boardNode = board;
    return ctx.game === "block-puzzle"
      ? renderBlock(board)
      : renderBrick(board);
  }
  function handleClick(e) {
    const targetNode = e.target.closest?.(
      "[data-block-slot], [data-block-cell], [data-brick-launch]",
    );
    if (!targetNode || !boardNode?.contains(targetNode)) return false;
    if (performance.now() < suppressClickUntil) {
      e.preventDefault();
      return true;
    }
    if (targetNode.hasAttribute("data-block-slot")) {
      const slot = Number(targetNode.dataset.blockSlot);
      if (state().hand[slot] !== null) {
        selected = slot;
        ctx.redraw();
      }
    } else if (targetNode.hasAttribute("data-block-cell")) {
      cursor = Number(targetNode.dataset.blockCell);
      placeAt(cursor);
    } else launch();
    return true;
  }
  function handleKey(e) {
    if (
      e.ctrlKey ||
      e.altKey ||
      e.metaKey ||
      e.isComposing ||
      !boardNode?.contains(e.target)
    )
      return false;
    if (!state()) return false;
    const key = e.key.toLowerCase();
    if (ctx.game === "brick-breaker") {
      if (
        e.target.matches("input[type=range]") &&
        ![" ", "enter"].includes(key)
      )
        return false;
      if (["arrowleft", "arrowright", "a", "d"].includes(key)) {
        e.preventDefault();
        held.add(key);
        return true;
      }
      if ([" ", "enter"].includes(key)) {
        e.preventDefault();
        launch();
        return true;
      }
      return false;
    }
    if (["1", "2", "3"].includes(key)) {
      e.preventDefault();
      const slot = Number(key) - 1;
      if (state().hand[slot] !== null) {
        selected = slot;
        hover = cursor;
        ctx.redraw();
      }
      return true;
    }
    const steps = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    };
    if (steps[key]) {
      e.preventDefault();
      const [dx, dy] = steps[key];
      const focused = Number(
        e.target.closest?.("[data-block-cell]")?.dataset.blockCell,
      );
      if (Number.isInteger(focused) && focused >= 0 && focused < 64)
        cursor = focused;
      cursor =
        clamp(Math.floor(cursor / 8) + dy, 0, 7) * 8 +
        clamp((cursor % 8) + dx, 0, 7);
      hover = cursor;
      ctx.redraw();
      boardNode
        .querySelector(`[data-block-cell="${cursor}"]`)
        ?.focus({ preventScroll: true });
      return true;
    }
    if (
      [" ", "enter"].includes(key) &&
      !e.target.closest?.("[data-block-slot]")
    ) {
      e.preventDefault();
      placeAt(cursor);
      return true;
    }
    return false;
  }
  function pointerCell(e) {
    const cell = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-block-cell]");
    return cell && boardNode.contains(cell)
      ? Number(cell.dataset.blockCell)
      : null;
  }
  function pointPaddle(e) {
    const canvas = boardNode.querySelector(".brick-canvas");
    const rect = canvas?.getBoundingClientRect();
    if (!rect?.width) return;
    const worldX = ((e.clientX - rect.left) / rect.width) * BRICK.width;
    target = clamp(
      Math.round(
        ((worldX - BRICK.paddleWidth / 2) / (BRICK.width - BRICK.paddleWidth)) *
          1024,
      ),
      0,
      1024,
    );
    flushPaddle();
  }
  function bind(board) {
    boardNode = board;
    if (bound) return;
    bound = true;
    board.addEventListener("pointerdown", (e) => {
      suppressClickUntil = 0;
      if (!playing(ctx)) return;
      if (ctx.game === "block-puzzle") {
        const piece = e.target.closest("[data-block-slot]");
        if (!piece || piece.disabled) return;
        e.preventDefault();
        selected = Number(piece.dataset.blockSlot);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
        board.setPointerCapture?.(e.pointerId);
        ctx.redraw();
      } else if (e.target.closest(".brick-canvas") && !canvasFailed) {
        e.preventDefault();
        e.target.focus({ preventScroll: true });
        board.setPointerCapture?.(e.pointerId);
        pointPaddle(e);
        launch();
      }
    });
    board.addEventListener("pointermove", (e) => {
      if (!playing(ctx)) return;
      if (ctx.game === "brick-breaker") {
        if (
          e.target.closest(".brick-canvas") ||
          board.hasPointerCapture?.(e.pointerId)
        )
          pointPaddle(e);
        return;
      }
      if (drag?.id === e.pointerId) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5)
          drag.moved = true;
        const next = pointerCell(e);
        if (hover !== next) {
          hover = next;
          ctx.redraw();
        }
        e.preventDefault();
      } else if (e.pointerType === "mouse") {
        const next = e.target.closest("[data-block-cell]")?.dataset.blockCell;
        const index = next === undefined ? null : Number(next);
        if (hover !== index) {
          hover = index;
          ctx.redraw();
        }
      }
    });
    board.addEventListener("pointerup", (e) => {
      if (drag?.id === e.pointerId) {
        const index = pointerCell(e),
          moved = drag.moved;
        drag = null;
        hover = null;
        suppressClickUntil = performance.now() + 350;
        if (moved && index !== null) {
          cursor = index;
          placeAt(index);
        } else ctx.redraw();
      }
      if (board.hasPointerCapture?.(e.pointerId))
        board.releasePointerCapture(e.pointerId);
    });
    board.addEventListener("pointercancel", () => {
      drag = null;
      hover = null;
      ctx.redraw();
    });
    board.addEventListener("pointerleave", () => {
      if (!drag && ctx.game === "block-puzzle" && hover !== null) {
        hover = null;
        ctx.redraw();
      }
    });
    board.addEventListener("input", (e) => {
      if (e.target.matches(".brick-paddle-slider")) {
        target = Number(e.target.value);
        flushPaddle();
      }
    });
    window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => {
      held.clear();
      lastFrame = null;
    });
  }
  function frame(now) {
    if (ctx.game !== "brick-breaker") return;
    if (!playing(ctx)) {
      held.clear();
      lastFrame = null;
      return;
    }
    const dt = lastFrame === null ? 0 : clamp((now - lastFrame) / 1000, 0, 0.1);
    lastFrame = now;
    const direction =
      (held.has("arrowright") || held.has("d") ? 1 : 0) -
      (held.has("arrowleft") || held.has("a") ? 1 : 0);
    if (direction)
      target = clamp(Math.round(target + direction * 850 * dt), 0, 1024);
    flushPaddle();
  }
  function stop() {
    held.clear();
    lastFrame = null;
    drag = null;
    hover = null;
  }
  function reset() {
    stop();
    selected = 0;
    cursor = 0;
    canvasFailed = false;
    target = state()?.paddle ?? 512;
  }
  return { render, handleClick, handleKey, bind, frame, stop, reset };
}
