import { patchMarkup } from "./dom.js";
import {
  animateElement,
  effectsMode,
  cancelEffects,
  mountEffects,
} from "./effects.js";
import {
  tileDestinations,
  completedSudokuUnits,
  winningCells,
  interpolatePoint,
  matchedNonogramLines,
  shouldCelebrate,
} from "./motion-state.js";
import { paintBrick as paintBrickBoard } from "./arcade-paint.js";
import { BRICK, brickRect } from "./arcade-engine.js";

const ease = "cubic-bezier(.2,.8,.2,1)",
  clamp = (v) => Math.max(0, Math.min(1, v));
const changes = (a, b) =>
  b.map((v, i) => (v !== a[i] ? i : -1)).filter((i) => i >= 0);
const cellSelector = (game, index) =>
  game === "block-puzzle"
    ? `[data-block-cell="${index}"]`
    : ["connect-four", "reversi"].includes(game)
      ? `[data-board-cell="${index}"]`
      : ["sudoku", "nonogram"].includes(game)
        ? `[data-puzzle-cell="${index}"]`
        : `[data-cell="${index}"]`;

export function createGamePresenter(root, game) {
  mountEffects();
  const board = root.querySelector("#game-board"),
    shell = root.querySelector(".game-board-shell");
  const canvas = shell.querySelector(".game-fx"),
    labels = shell.querySelector(".game-fx-labels");
  const particles = [],
    temporary = new Set();
  let last = null,
    ticket = null,
    current = null,
    running = false,
    interpolation = null,
    fxFrame = 0;
  let snakeCanvas = null,
    brickCanvas = null,
    currentSubmission = "private",
    disposed = false,
    serial = 0;
  const color = () =>
    getComputedStyle(root).getPropertyValue("--game-accent").trim() ||
    "#d6b5ed";
  const animate = (node, frames, options = {}) =>
    animateElement(node, frames, { easing: ease, ...options });
  function transient(node, animation) {
    node.dataset.motionLayer = "true";
    temporary.add(node);
    const clean = () => {
      node.remove();
      temporary.delete(node);
    };
    if (animation) animation.finished.then(clean, clean);
    else clean();
  }
  function clearTransient() {
    serial++;
    cancelEffects();
    for (const node of temporary) node.remove();
    temporary.clear();
    board.querySelectorAll("[data-motion-hidden]").forEach((node) => {
      node.style.removeProperty("opacity");
      delete node.dataset.motionHidden;
    });
  }
  function clearParticles() {
    cancelAnimationFrame(fxFrame);
    fxFrame = 0;
    particles.length = 0;
    try {
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    } catch {}
  }
  function center(node) {
    const r = node?.getBoundingClientRect(),
      s = shell.getBoundingClientRect();
    return r
      ? { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 }
      : { x: s.width / 2, y: s.height / 2 };
  }
  function world(node, x, y, width, height) {
    const r = node?.getBoundingClientRect(),
      s = shell.getBoundingClientRect();
    return r
      ? {
          x: r.left - s.left + (x / width) * r.width,
          y: r.top - s.top + (y / height) * r.height,
        }
      : center();
  }
  function fxPaint(now) {
    fxFrame = 0;
    if (disposed || document.hidden || effectsMode() !== "full") {
      clearParticles();
      return;
    }
    let ctx;
    try {
      ctx = canvas?.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;
    const width = shell.clientWidth,
      height = shell.clientHeight,
      dpr = Math.min(2, devicePixelRatio || 1);
    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i],
        t = (now - p.start) / p.life;
      if (t >= 1) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = (1 - t) ** 2;
      ctx.fillStyle = p.color;
      const x = p.x + p.vx * t,
        y = p.y + p.vy * t + p.gravity * t * t;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.spin * t);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    root.dataset.particles = String(particles.length);
    if (particles.length) fxFrame = requestAnimationFrame(fxPaint);
  }
  function burst(point, count = 12, celebrate = false) {
    if (effectsMode() !== "full" || document.hidden) return;
    const cap = matchMedia("(max-width: 600px)").matches ? 60 : 120,
      now = performance.now();
    const palette = [color(), "#ed95da", "#9effdf", "#eee5ff"];
    for (let i = 0, n = Math.min(count, cap - particles.length); i < n; i++) {
      const angle = Math.random() * Math.PI * 2,
        speed = celebrate ? 80 + Math.random() * 150 : 18 + Math.random() * 60;
      particles.push({
        ...point,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (celebrate ? 90 : 18),
        size: 2 + Math.random() * 4,
        gravity: celebrate ? 180 : 65,
        spin: (Math.random() - 0.5) * 8,
        color: palette[i % palette.length],
        start: now,
        life: celebrate ? 700 + Math.random() * 300 : 250 + Math.random() * 200,
      });
    }
    root.dataset.particles = String(particles.length);
    if (!fxFrame) fxFrame = requestAnimationFrame(fxPaint);
  }
  function floatText(text, point = center(), headline = false) {
    if (effectsMode() !== "full") return;
    const label = document.createElement("span");
    label.className = headline
      ? "game-float game-float-headline"
      : "game-float";
    label.textContent = text;
    label.style.left = `${point.x}px`;
    label.style.top = `${point.y}px`;
    labels.append(label);
    transient(
      label,
      animate(
        label,
        [
          { opacity: 0, transform: "translate(-50%, 0) scale(.8)" },
          {
            opacity: 1,
            transform: "translate(-50%, -12px) scale(1)",
            offset: 0.2,
          },
          { opacity: 0, transform: "translate(-50%, -42px) scale(1)" },
        ],
        { duration: headline ? 1000 : 600 },
      ),
    );
  }
  function pulse(node, delay = 0, duration = 120) {
    animate(
      node,
      [
        { transform: "scale(.88)", opacity: 0.65 },
        { transform: "scale(1.06)", opacity: 1, offset: 0.6 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration, delay },
    );
  }
  function ring(point) {
    if (effectsMode() !== "full") return;
    const node = document.createElement("span");
    node.className = "game-impact-ring";
    Object.assign(node.style, { left: `${point.x}px`, top: `${point.y}px` });
    labels.append(node);
    transient(
      node,
      animate(
        node,
        [
          { opacity: 0.8, transform: "translate(-50%,-50%) scale(.4)" },
          { opacity: 0, transform: "translate(-50%,-50%) scale(2.2)" },
        ],
        { duration: 260 },
      ),
    );
  }
  function clearShard(node, index) {
    if (effectsMode() !== "full" || !node) return;
    const point = center(node),
      rect = node.getBoundingClientRect(),
      shard = document.createElement("span");
    shard.className = "game-clear-shard";
    Object.assign(shard.style, {
      left: `${point.x - rect.width / 2}px`,
      top: `${point.y - rect.height / 2}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    labels.append(shard);
    transient(
      shard,
      animate(
        shard,
        [
          { opacity: 0.8, transform: "scale(1)" },
          { opacity: 1, transform: "scale(1.1,.15)", offset: 0.5 },
          { opacity: 0, transform: "scale(1.3,.05)" },
        ],
        {
          duration: 200,
          delay: Math.min(80, (index % 8) * 10 + Math.floor(index / 8) * 2),
        },
      ),
    );
  }
  function connectNodes(a, b, delay = 0) {
    if (effectsMode() !== "full" || !a || !b) return;
    const p = center(a),
      q = center(b),
      length = Math.hypot(q.x - p.x, q.y - p.y);
    const line = document.createElement("span");
    line.className = "game-match-link";
    Object.assign(line.style, {
      left: `${p.x}px`,
      top: `${p.y}px`,
      width: `${length}px`,
      rotate: `${Math.atan2(q.y - p.y, q.x - p.x)}rad`,
    });
    labels.append(line);
    transient(
      line,
      animate(
        line,
        [
          { opacity: 0, transform: "scaleX(0)" },
          { opacity: 1, transform: "scaleX(1)", offset: 0.4 },
          { opacity: 0, transform: "scaleX(1)" },
        ],
        { duration: 450, delay },
      ),
    );
  }
  function remember(state) {
    return structuredClone(state);
  }
  function prepare(state, options = {}) {
    current = state;
    running = !!options.running;
    const valid =
      last && last.seed === state.seed && last.difficulty === state.difficulty;
    const changed =
      valid &&
      (last.moves !== state.moves ||
        last.ticks !== state.ticks ||
        last.status !== state.status ||
        (game === "sudoku" &&
          JSON.stringify(last.notes) !== JSON.stringify(state.notes)) ||
        (game === "memory-match" && last.holdUntil !== state.holdUntil));
    if (changed && !["snake", "brick-breaker"].includes(game)) clearTransient();
    if (valid && state.ticks !== last.ticks)
      interpolation = { before: last, start: performance.now() };
    ticket = {
      before: valid ? last : null,
      changed,
      reason: options.reason || "view",
      event: options.event,
    };
    if (!valid) interpolation = null;
    return ticket;
  }
  function render2048(element, state) {
    patchMarkup(
      element,
      `<div class="board-2048">${state.board.map((n, i) => `<div class="tile" data-cell="${i}" data-value="${n}" data-level="${Math.min(12, Math.log2(n) || 0)}" aria-label="${n || "Empty"}">${n || ""}</div>`).join("")}</div>`,
    );
  }
  function slide2048(before, state, event) {
    if (effectsMode() !== "full" || event?.type !== "move") return;
    const grid = board.querySelector(".board-2048"),
      bounds = grid.getBoundingClientRect();
    const { moves, merged } = tileDestinations(before.board, event.dir);
    const occupied = new Set(moves.map((m) => m.to));
    for (const index of occupied) {
      const tile = grid.querySelector(`[data-cell="${index}"]`);
      tile.dataset.motionHidden = "true";
      tile.style.opacity = "0";
    }
    let finished = 0;
    const token = serial;
    for (const move of moves) {
      const start = grid
          .querySelector(`[data-cell="${move.from}"]`)
          .getBoundingClientRect(),
        end = grid
          .querySelector(`[data-cell="${move.to}"]`)
          .getBoundingClientRect();
      const ghost = document.createElement("span");
      ghost.className = "moving-tile";
      ghost.dataset.level = String(Math.min(12, Math.log2(move.value)));
      ghost.textContent = String(move.value);
      ghost.setAttribute("aria-hidden", "true");
      ghost.dataset.motionLayer = "true";
      Object.assign(ghost.style, {
        left: `${start.left - bounds.left}px`,
        top: `${start.top - bounds.top}px`,
        width: `${start.width}px`,
        height: `${start.height}px`,
      });
      grid.append(ghost);
      temporary.add(ghost);
      const animation = animate(
        ghost,
        [
          { transform: "translate(0,0)" },
          {
            transform: `translate(${end.left - start.left}px,${end.top - start.top}px)`,
          },
        ],
        { duration: 150 },
      );
      const done = () => {
        ghost.remove();
        temporary.delete(ghost);
        if (token !== serial) return;
        if (++finished !== moves.length) return;
        for (const index of occupied) {
          const node = grid.querySelector(`[data-cell="${index}"]`);
          node.style.removeProperty("opacity");
          delete node.dataset.motionHidden;
        }
        for (const index of merged) {
          const tile = grid.querySelector(`[data-cell="${index}"]`);
          pulse(tile, 0, 140);
          burst(center(tile), 8);
          floatText(`+${state.board[index]}`, center(tile));
        }
      };
      // 取消时只清理表现；不会通过动画回调推进或修改对局。
      if (animation)
        animation.finished.then(done, () => {
          ghost.remove();
          temporary.delete(ghost);
        });
      else done();
    }
    state.board.forEach((n, i) => {
      if (n && !occupied.has(i))
        pulse(grid.querySelector(`[data-cell="${i}"]`), 80, 120);
    });
  }
  function discFlip(node, oldValue, delay) {
    const disc = node.querySelector(".board-disc");
    if (effectsMode() !== "full") {
      pulse(disc);
      return;
    }
    const old = document.createElement("span");
    old.className = "reversi-old-face";
    old.setAttribute("aria-hidden", "true");
    old.style.background =
      oldValue === 1
        ? "linear-gradient(145deg,#555361,#090b13)"
        : "linear-gradient(145deg,#fffef8,#bfc2d8)";
    node.append(old);
    transient(
      old,
      animate(
        old,
        [{ transform: "rotateY(0deg)" }, { transform: "rotateY(90deg)" }],
        { duration: 110, delay },
      ),
    );
    animate(
      disc,
      [
        { transform: "rotateY(-90deg)", opacity: 0 },
        { transform: "rotateY(-90deg)", opacity: 0, offset: 0.49 },
        { transform: "rotateY(0deg)", opacity: 1 },
      ],
      { duration: 220, delay },
    );
  }
  function updateResult(state) {
    const panel = root.querySelector("#game-result");
    if (!panel) return;
    panel.hidden = state.status === "playing";
    if (panel.hidden) return;
    const boardGame = ["connect-four", "reversi"].includes(game);
    const draw = state.status === "draw",
      won = state.status === "won";
    const winner = boardGame
      ? state.difficulty === "local"
        ? `Player ${state.winner} wins`
        : state.winner === (state.humanSide || 1)
          ? "You win"
          : "Computer wins"
      : won
        ? "Challenge cleared"
        : game === "brick-breaker"
          ? state.reason === "timeout"
            ? "Time’s up"
            : "Out of lives"
          : game === "minesweeper"
            ? "Mine found"
            : "Run complete";
    root.querySelector("#game-result-title").textContent = draw
      ? "An even match"
      : winner;
    panel.dataset.outcome = draw
      ? "draw"
      : boardGame
        ? state.difficulty === "local" ||
          state.winner === (state.humanSide || 1)
          ? "won"
          : "lost"
        : won
          ? "won"
          : "lost";
    root.querySelector("#game-result-value").textContent =
      boardGame && game === "reversi"
        ? `${state.counts[0]} : ${state.counts[1]}`
        : boardGame
          ? draw
            ? "Board complete"
            : "Four connected"
          : won && ["minesweeper", "sudoku", "nonogram"].includes(game)
            ? root.querySelector("#game-clock").textContent
            : root.querySelector("#game-score").textContent;
    root.querySelector("#game-result-time").textContent =
      game === "brick-breaker"
        ? [Math.floor(state.ticks / 3600), Math.floor(state.ticks / 60) % 60]
            .map((n) => String(n).padStart(2, "0"))
            .join(":")
        : root.querySelector("#game-clock").textContent;
    root.querySelector("#game-result-best").textContent = boardGame
      ? "Private match"
      : `Local best · ${root.querySelector("#game-best").textContent}`;
    if (root.querySelector("#game-mode").value === "private")
      setSubmission(
        "private",
        "Private result · not submitted to a leaderboard",
      );
  }
  function commit(state) {
    const before = ticket?.before,
      changed = ticket?.changed;
    const setup = root.querySelector("#game-setup");
    if (setup && running) setup.open = false;
    const mode = root.querySelector("#game-mode"),
      difficulty = root.querySelector("#game-difficulty");
    if (root.querySelector("#game-mode-summary"))
      root.querySelector("#game-mode-summary").textContent =
        `${mode.value === "public" ? "Public · Ranked" : "Private"} / ${difficulty.selectedOptions[0]?.textContent || ""}`;
    updateResult(state);
    if (game === "connect-four" && state.status === "won")
      winningCells(state.board).forEach((i) =>
        board.querySelector(cellSelector(game, i))?.classList.add("is-winning"),
      );
    if (
      !before ||
      !changed ||
      ["pause", "resume", "restore", "undo"].includes(ticket.reason)
    ) {
      last = remember(state);
      return;
    }
    const node = (i) => board.querySelector(cellSelector(game, i));
    if (state.score > before.score && game !== "2048") {
      pulse(root.querySelector("#game-score"));
      if (game !== "block-puzzle")
        floatText(
          `+${state.score - before.score}`,
          center(
            game === "brick-breaker"
              ? brickCanvas
              : game === "snake"
                ? snakeCanvas
                : board,
          ),
        );
    }
    if (game === "2048") {
      slide2048(before, state, ticket.event);
      if (
        Math.max(...state.board) >= 2048 &&
        Math.max(...before.board) < 2048
      ) {
        floatText("2048 REACHED", center(board), true);
        burst(center(board), 80, true);
      }
    } else if (game === "minesweeper") {
      const opened = state.revealed.filter((i) => !before.revealed.includes(i));
      const start = ticket.event?.index ?? opened[0] ?? 0,
        width = { beginner: 9, intermediate: 16, expert: 30 }[state.difficulty];
      opened.forEach((i) =>
        pulse(
          node(i),
          Math.min(
            180,
            (Math.abs((i % width) - (start % width)) +
              Math.abs(Math.floor(i / width) - Math.floor(start / width))) *
              12,
          ),
        ),
      );
      state.flags
        .filter((i) => !before.flags.includes(i))
        .forEach((i) => pulse(node(i), 0, 140));
      if (state.status === "lost" && before.status === "playing") {
        burst(center(node(ticket.event?.index)), 45);
        pulse(shell, 0, 150);
      }
    } else if (game === "memory-match") {
      const paired = state.matched.filter((i) => !before.matched.includes(i));
      if (paired.length) {
        paired.forEach((i) => {
          pulse(node(i), 0, 220);
          burst(center(node(i)), 10);
        });
        connectNodes(node(paired[0]), node(paired[1]));
      }
    } else if (game === "sudoku") {
      for (const i of changes(before.board, state.board)) pulse(node(i));
      state.notes.forEach((notes, i) => {
        if (notes.join() !== before.notes[i].join())
          animate(
            node(i)?.querySelector(".sudoku-notes"),
            [{ opacity: 0.2 }, { opacity: 1 }],
            { duration: 120 },
          );
      });
      const old = new Set(
        completedSudokuUnits(before.board).map((u) => u.join()),
      );
      for (const unit of completedSudokuUnits(state.board))
        if (!old.has(unit.join()))
          unit.forEach((i, n) => pulse(node(i), n * 12, 160));
    } else if (game === "nonogram") {
      for (const i of changes(before.board, state.board)) {
        if (state.board[i] === 2)
          node(i)
            ?.querySelectorAll("path")
            .forEach((path, n) =>
              animate(
                path,
                [{ strokeDashoffset: 20 }, { strokeDashoffset: 0 }],
                { duration: 80, delay: n * 40 },
              ),
            );
        else
          animate(node(i), [{ opacity: 0.35 }, { opacity: 1 }], {
            duration: 120,
          });
      }
      const oldLines = matchedNonogramLines(before),
        lines = matchedNonogramLines(state);
      for (const [kind, selector] of [
        ["rows", ".nonogram-row-clue"],
        ["cols", ".nonogram-col-clue"],
      ]) {
        const clues = board.querySelectorAll(selector);
        lines[kind].forEach((matched, i) => {
          if (matched && !oldLines[kind][i]) pulse(clues[i], 0, 160);
        });
      }
    } else if (game === "block-puzzle") {
      for (const i of changes(before.board, state.board))
        if (state.board[i]) pulse(node(i), 0, 130);
      if (state.lastLines && state.moves !== before.moves) {
        state.lastClear.forEach((i, n) => {
          const at = center(node(i));
          burst(at, 3);
          clearShard(node(i), i);
        });
        floatText(
          `${state.lastLines} ${state.lastLines === 1 ? "LINE" : "LINES"} · +${state.score - before.score}`,
          center(board.querySelector(".block-grid")),
          true,
        );
      } else if (state.score > before.score)
        floatText(
          `+${state.score - before.score}`,
          center(board.querySelector(".block-grid")),
        );
    } else if (game === "connect-four") {
      for (const i of changes(before.board, state.board))
        if (state.board[i]) {
          const disc = node(i)?.querySelector(".board-disc"),
            row = Math.floor(i / 7),
            height = node(i)?.getBoundingClientRect().height || 40;
          animate(
            disc,
            [
              { transform: `translateY(${-height * (row + 1)}px)` },
              { transform: "translateY(3px)", offset: 0.82 },
              { transform: "translateY(0)" },
            ],
            {
              duration: Math.min(280, 170 + row * 18),
              easing: "cubic-bezier(.45,.05,.8,.7)",
            },
          );
        }
      if (state.status === "won") {
        const line = winningCells(state.board);
        line.forEach((i, n) => pulse(node(i), n * 45, 220));
        for (let n = 1; n < line.length; n++)
          connectNodes(node(line[n - 1]), node(line[n]), n * 45);
      }
    } else if (game === "reversi") {
      const changedCells = changes(before.board, state.board);
      changedCells.forEach((i, n) => {
        if (before.board[i])
          discFlip(node(i), before.board[i], Math.min(80, n * 16));
        else pulse(node(i)?.querySelector(".board-disc"), 0, 160);
      });
      if (state.passCount === 1 && state.moves !== before.moves)
        floatText(
          "TURN PASSED",
          center(board.querySelector(".board-turn")),
          true,
        );
    } else if (game === "snake") {
      if (state.score > before.score)
        burst(
          world(
            snakeCanvas,
            (state.body[0] % 20) * 23 + 11.5,
            Math.floor(state.body[0] / 20) * 23 + 11.5,
            460,
            460,
          ),
          18,
        );
      if (state.status !== "playing")
        burst(
          world(
            snakeCanvas,
            (state.body[0] % 20) * 23 + 11.5,
            Math.floor(state.body[0] / 20) * 23 + 11.5,
            460,
            460,
          ),
          25,
        );
    } else if (game === "brick-breaker") {
      const ball = state.balls?.[0] || state.ball;
      const priorBall =
        before.balls?.find((b) => b.id === ball?.id) || before.ball;
      if (state.stage === before.stage)
        changes(before.bricks, state.bricks)
          .filter((i) => !state.bricks[i])
          .forEach((i) =>
            burst(
              world(
                brickCanvas,
                (brickRect(i).x + brickRect(i).w / 2) / BRICK.scale,
                (brickRect(i).y + brickRect(i).h / 2) / BRICK.scale,
                640,
                480,
              ),
              9,
            ),
          );
      if (ball?.vy < 0 && priorBall?.vy > 0 && ball.y / BRICK.scale > 390) {
        burst(
          world(brickCanvas, ball.x / BRICK.scale, BRICK.paddleY, 640, 480),
          10,
        );
      }
      if (ball?.vy < 0 && priorBall?.vy > 0 && ball.y / BRICK.scale > 390)
        ring(world(brickCanvas, ball.x / BRICK.scale, BRICK.paddleY, 640, 480));
      if (state.lives < before.lives) {
        floatText(
          `${state.lives} ${state.lives === 1 ? "LIFE" : "LIVES"} LEFT`,
          center(brickCanvas),
          true,
        );
        pulse(board.querySelector(".brick-lives"));
      }
      if ((state.pickups || 0) > (before.pickups || 0)) {
        floatText(state.lastPickup, center(brickCanvas), true);
        if (ball)
          ring(
            world(
              brickCanvas,
              ball.x / BRICK.scale,
              ball.y / BRICK.scale,
              640,
              480,
            ),
          );
        burst(center(brickCanvas), 18);
      }
      if (state.stage > before.stage) {
        floatText(
          `STAGE ${state.stage + 1} · READY TO LAUNCH`,
          center(brickCanvas),
          true,
        );
        burst(center(brickCanvas), 40);
      }
    }
    if (state.status !== "playing" && before.status === "playing") {
      if (shouldCelebrate(state)) burst(center(board), 100, true);
      pulse(root.querySelector("#game-result"), 0, 240);
    }
    last = remember(state);
  }
  function snakePaint(canvasNode, state, now = performance.now()) {
    snakeCanvas = canvasNode;
    const ctx = canvasNode?.getContext("2d");
    if (!ctx) return false;
    const full = effectsMode() === "full",
      previous = interpolation?.before;
    const rate = { slow: 6, normal: 10, fast: 14 }[state.difficulty];
    const t =
      running &&
      full &&
      state.status === "playing" &&
      previous?.ticks + 1 === state.ticks
        ? clamp((now - interpolation.start) / (1000 / rate))
        : 1;
    const bg = ctx.createLinearGradient(0, 0, 460, 460);
    bg.addColorStop(0, "#102c2b");
    bg.addColorStop(1, "#11101e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 460, 460);
    ctx.strokeStyle = "#8be2c20c";
    ctx.lineWidth = 1;
    for (let x = 0; x <= 460; x += 23) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 460);
      ctx.moveTo(0, x);
      ctx.lineTo(460, x);
      ctx.stroke();
    }
    for (let i = state.body.length - 1; i >= 0; i--) {
      const n = state.body[i],
        old = previous?.body[Math.min(i, previous.body.length - 1)] ?? n;
      const p = interpolatePoint(
        { x: (old % 20) * 23, y: Math.floor(old / 20) * 23 },
        { x: (n % 20) * 23, y: Math.floor(n / 20) * 23 },
        t,
      );
      ctx.fillStyle = i
        ? `hsl(157 48% ${Math.max(31, 66 - i * 0.7)}%)`
        : "#d9fff0";
      ctx.beginPath();
      ctx.roundRect(p.x + 1.5, p.y + 1.5, 20, 20, i ? 6 : 7);
      ctx.fill();
      if (!i) {
        const dx = [0, 1, 0, -1][state.pending ?? state.dir],
          dy = [-1, 0, 1, 0][state.pending ?? state.dir];
        ctx.fillStyle = "#123f35";
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(
            p.x + 11.5 + dx * 4 - dy * side * 4,
            p.y + 11.5 + dy * 4 + dx * side * 4,
            1.9,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }
    if (state.food >= 0) {
      const x = (state.food % 20) * 23 + 11.5,
        y = Math.floor(state.food / 20) * 23 + 11.5;
      ctx.save();
      ctx.fillStyle = "#ffb2e3";
      ctx.shadowColor = "#ff79d5";
      ctx.shadowBlur = full ? 14 : 0;
      ctx.beginPath();
      ctx.arc(x, y, full ? 7 + Math.sin(now * 0.004) * 0.7 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return true;
  }
  function brickPaint(canvasNode, state, now = performance.now()) {
    brickCanvas = canvasNode;
    const old = interpolation?.before,
      t =
        running &&
        effectsMode() === "full" &&
        state.status === "playing" &&
        old?.ticks + 1 === state.ticks &&
        old.stage === state.stage &&
        old.lives === state.lives
          ? clamp((now - interpolation.start) / (1000 / 60))
          : 1;
    const ball =
      state.version === 2
        ? null
        : old && t < 1
          ? interpolatePoint(old.ball, state.ball, t)
          : state.ball;
    const balls = state.balls?.map((b) => {
      const previous = old?.balls?.find((p) => p.id === b.id);
      return previous && t < 1
        ? { ...b, ...interpolatePoint(previous, b, t) }
        : b;
    });
    return paintBrickBoard(canvasNode, state, {
      ball,
      balls,
      full: effectsMode() === "full",
      now,
    });
  }
  function frame(now) {
    if (!current || !running || document.hidden) return;
    if (game === "snake" && snakeCanvas) snakePaint(snakeCanvas, current, now);
    if (game === "brick-breaker" && brickCanvas)
      brickPaint(brickCanvas, current, now);
  }
  function reset(state = null) {
    clearTransient();
    clearParticles();
    interpolation = null;
    ticket = null;
    last = state ? remember(state) : null;
    current = state;
    running = false;
    root.dataset.particles = "0";
    root.querySelector("#game-result")?.setAttribute("hidden", "");
    currentSubmission = "private";
  }
  function setSubmission(kind, text) {
    currentSubmission = kind;
    const node = root.querySelector("#game-result-public");
    if (node) {
      node.dataset.submission = kind;
      node.textContent = text;
    }
  }
  function onModeChange() {
    clearTransient();
    clearParticles();
    interpolation = null;
    if (current) {
      if (snakeCanvas) snakePaint(snakeCanvas, current);
      if (brickCanvas) brickPaint(brickCanvas, current);
    }
  }
  window.addEventListener("game-effects-change", onModeChange);
  const hidden = () => {
    if (document.hidden) {
      clearTransient();
      clearParticles();
    }
  };
  document.addEventListener("visibilitychange", hidden);
  function dispose() {
    reset();
    disposed = true;
    window.removeEventListener("game-effects-change", onModeChange);
    document.removeEventListener("visibilitychange", hidden);
  }
  window.addEventListener("pagehide", dispose);
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted || !disposed) return;
    disposed = false;
    window.addEventListener("game-effects-change", onModeChange);
    document.addEventListener("visibilitychange", hidden);
  });
  return {
    prepare,
    commit,
    render2048,
    paintSnake: snakePaint,
    paintBrick: brickPaint,
    frame,
    reset,
    dispose,
    setSubmission,
    debug: () => ({
      particles: particles.length,
      temporary: temporary.size,
      submission: currentSubmission,
    }),
  };
}
