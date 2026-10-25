import {
  pieceCells,
  occupied,
  ghost,
  clearInput,
} from "./block-drop-engine.js";
import { patchMarkup } from "./dom.js";
import {
  animateElement as animate,
  effectsMode as effectiveEffects,
} from "./effects.js";
import { uiMsg, uiText, uiHtml } from "../site/ui.js";

const COLORS = [
  "#83e9f0",
  "#a999ff",
  "#ffc78a",
  "#f4df91",
  "#9ce7c5",
  "#d7b4f2",
  "#f5a8c6",
];
const KEYS = {
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right",
  ArrowDown: "down",
  s: "down",
  ArrowUp: "cw",
  x: "cw",
  z: "ccw",
  " ": "hard",
  c: "hold",
  Shift: "hold",
};
export function createDropUI(ctx) {
  let boardNode,
    canvasFailed = false,
    lastMoves = -1;
  const held = new Set();
  const playing = () => ctx.isRunning() && ctx.getState()?.status === "playing";
  function send(input) {
    if (!playing()) return false;
    return ctx.act({ type: "drop-input", input, tick: ctx.getState().ticks });
  }
  function press(input) {
    if (["left", "right", "down"].includes(input)) {
      if (held.has(input)) return;
      if (send(input + "-down")) held.add(input);
    } else send(input);
  }
  function release(input) {
    if (!held.delete(input)) return;
    send(input + "-up");
  }
  function mini(id) {
    if (id === null || id === undefined)
      return uiHtml('<span class="drop-hold-empty">Empty</span>');
    const cells = new Set(pieceCells(id).map(([x, y]) => y * 4 + x));
    return uiHtml`<span class="drop-mini" style="--drop-color:${COLORS[id]}" aria-label="${["I", "J", "L", "O", "S", "T", "Z"][id]} piece">${Array.from({ length: 16 }, (_, i) => uiHtml`<i class="${cells.has(i) ? "filled" : ""}"></i>`).join("")}</span>`;
  }
  function paint(canvas, s) {
    const g = canvas.getContext("2d");
    if (!g) return false;
    const cell = 24,
      w = 240,
      h = 480;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#0d101c";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#ffffff0a";
    g.lineWidth = 1;
    for (let x = 0; x <= 10; x++) {
      g.beginPath();
      g.moveTo(x * cell + 0.5, 0);
      g.lineTo(x * cell + 0.5, h);
      g.stroke();
    }
    for (let y = 0; y <= 20; y++) {
      g.beginPath();
      g.moveTo(0, y * cell + 0.5);
      g.lineTo(w, y * cell + 0.5);
      g.stroke();
    }
    function tile(x, y, id, outline = false) {
      if (y < 0) return;
      const px = x * cell + 2,
        py = y * cell + 2;
      g.fillStyle = outline ? COLORS[id] + "19" : COLORS[id];
      g.fillRect(px, py, 20, 20);
      if (outline) {
        g.strokeStyle = COLORS[id] + "99";
        g.strokeRect(px + 0.5, py + 0.5, 19, 19);
      } else {
        g.fillStyle = "#ffffff45";
        g.fillRect(px, py, 20, 3);
        g.fillStyle = "#00000025";
        g.fillRect(px, py + 17, 20, 3);
      }
    }
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 10; x++) {
        const id = s.board[(y + 4) * 10 + x];
        if (id) tile(x, y, id - 1);
      }
    if (s.status === "playing") {
      for (const [x, y] of ghost(s)) tile(x, y, s.piece.id, true);
      for (const [x, y] of occupied(s)) tile(x, y, s.piece.id);
    }
    return true;
  }
  function render(board) {
    boardNode = board;
    const s = ctx.getState();
    board.classList.add("drop-board");
    if (!board.querySelector(".drop-canvas")) {
      patchMarkup(
        board,
        uiHtml`<div class="drop-stage"><aside class="drop-hold"><h3>Hold <kbd>C</kbd></h3><div id="drop-hold-piece"></div><p id="drop-hold-note"></p></aside><div class="drop-well"><canvas class="drop-canvas" width="240" height="480" role="img" aria-label="Block Drop, ten columns and twenty rows"></canvas><div class="drop-clear-effects" aria-hidden="true"></div></div><aside class="drop-next"><h3>Next</h3><div id="drop-next-pieces"></div><dl><dt>Lines</dt><dd id="drop-lines">0</dd><dt>Level</dt><dd id="drop-level">1</dd></dl></aside></div><p class="drop-target" id="drop-target"></p><div class="drop-touch" role="group" aria-label="Block Drop controls"><button type="button" data-drop-input="hold" aria-label="Hold piece">Hold</button><button type="button" data-drop-input="ccw" aria-label="Rotate counterclockwise">↶</button><button type="button" data-drop-input="cw" aria-label="Rotate clockwise">↷</button><button type="button" data-drop-input="left" aria-label="Move piece left">←</button><button type="button" data-drop-input="down" aria-label="Soft drop">↓</button><button type="button" data-drop-input="right" aria-label="Move piece right">→</button><button type="button" data-drop-input="hard" aria-label="Hard drop">Drop ⤓</button></div><p class="arcade-control-note">← → move · ↑ / X / Z rotate · ↓ soft drop · Space drop · C / Shift hold</p>`,
      );
    }
    const canvas = board.querySelector(".drop-canvas");
    try {
      if (!paint(canvas, s)) canvasFailed = true;
    } catch {
      canvasFailed = true;
    }
    if (canvasFailed) {
      ctx.announce(
        uiMsg("Canvas drawing is unavailable. Try another browser."),
      );
      return false;
    }
    const hold = board.querySelector("#drop-hold-piece"),
      next = board.querySelector("#drop-next-pieces");
    const holdSignature = String(s.hold),
      nextSignature = s.queue.slice(0, 3).join();
    if (hold.dataset.signature !== holdSignature) {
      hold.innerHTML = mini(s.hold);
      hold.dataset.signature = holdSignature;
    }
    if (next.dataset.signature !== nextSignature) {
      next.innerHTML = s.queue.slice(0, 3).map(mini).join("");
      next.dataset.signature = nextSignature;
    }
    uiText(
      board.querySelector("#drop-hold-note"),
      s.holdUsed ? uiMsg("Available after landing") : uiMsg("Once per piece"),
    );
    uiText(board.querySelector("#drop-lines"), s.lines);
    uiText(board.querySelector("#drop-level"), s.level);
    uiText(
      board.querySelector("#drop-target"),
      s.difficulty === "sprint"
        ? uiMsg("{0} / 40 lines · finish to rank", [Math.min(s.lines, 40)])
        : uiMsg("Classic · {0} pieces placed", [s.moves]),
    );
    for (const b of board.querySelectorAll("[data-drop-input]"))
      b.disabled = !playing() || (b.dataset.dropInput === "hold" && s.holdUsed);
    if (
      lastMoves !== -1 &&
      s.moves !== lastMoves &&
      s.lastClear.length &&
      effectiveEffects() !== "off"
    ) {
      const fx = board.querySelector(".drop-clear-effects");
      fx.replaceChildren();
      for (const y of s.lastClear) {
        const line = document.createElement("i");
        line.style.top = `${y * 5}%`;
        fx.append(line);
        const a = animate(
          line,
          [
            { opacity: 1, transform: "scaleX(.2)" },
            { opacity: 0, transform: "scaleX(1.2)" },
          ],
          { duration: 240 },
        );
        a?.finished.then(
          () => line.remove(),
          () => line.remove(),
        );
      }
    }
    lastMoves = s.moves;
    return true;
  }
  function handleKey(e) {
    const input = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (!input) return false;
    e.preventDefault();
    if (!e.repeat) press(input);
    return true;
  }
  function bind(board) {
    board.addEventListener("pointerdown", (e) => {
      const b = e.target.closest("[data-drop-input]");
      if (!b || b.disabled) return;
      e.preventDefault();
      board.focus({ preventScroll: true });
      b.setPointerCapture(e.pointerId);
      press(b.dataset.dropInput);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      board.addEventListener(event, (e) => {
        const b = e.target.closest("[data-drop-input]");
        if (b) release(b.dataset.dropInput);
      });
    // 按钮也允许键盘和辅助技术触发；真实指针由 pointerdown 处理。
    board.addEventListener("click", (e) => {
      const b = e.target.closest("[data-drop-input]");
      if (b && e.detail === 0) {
        press(b.dataset.dropInput);
        release(b.dataset.dropInput);
      }
    });
    window.addEventListener("keyup", (e) => {
      const input = KEYS[e.key] || KEYS[e.key.toLowerCase()];
      if (input) release(input);
    });
    board.addEventListener("focusout", (e) => {
      if (!board.contains(e.relatedTarget))
        for (const input of [...held]) release(input);
    });
    window.addEventListener("blur", () => {
      for (const input of [...held]) release(input);
    });
  }
  function stop() {
    held.clear();
    const s = ctx.getState();
    if (s?.game === "block-drop") clearInput(s);
    boardNode?.querySelector(".drop-clear-effects")?.replaceChildren();
  }
  return {
    render,
    handleKey,
    handleClick: () => false,
    bind,
    stop,
    reset() {
      stop();
      lastMoves = -1;
      canvasFailed = false;
    },
  };
}
