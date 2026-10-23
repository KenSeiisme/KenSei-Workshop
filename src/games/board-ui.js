import { legalMoves, reversiFlips } from "./board-engine.js";

// 棋类只负责棋盘、焦点和电脑任务；保存及开局流程由通用控制器负责。
export function createBoardUI(ctx) {
  const connect = ctx.game === "connect-four";
  let worker = null,
    timer = null,
    job = null,
    serial = 0,
    failure = "",
    focusIndex = 0;
  let boardNode = null;
  const bound = new WeakSet();
  const human = (s) => (s?.humanSide === 2 ? 2 : 1);
  const computerMode = (s) => s?.difficulty !== "local";
  const computerTurn = (s) => computerMode(s) && s.turn !== human(s);
  const canPlay = (s) =>
    s?.status === "playing" &&
    ctx.isRunning() &&
    !ctx.isPublic() &&
    !computerTurn(s);
  const signature = (s) =>
    s
      ? [
          s.game,
          s.difficulty,
          s.seed,
          s.moves,
          s.turn,
          human(s),
          s.status,
          s.board.join(""),
        ].join("|")
      : "";
  function clearJob() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (worker) worker.terminate();
    worker = null;
    job = null;
  }
  function stop() {
    serial++;
    clearJob();
  }
  function reset() {
    stop();
    failure = "";
    focusIndex = 0;
  }
  function label(s, side) {
    if (!computerMode(s)) return `Player ${side}`;
    return side === human(s) ? "You" : "Computer";
  }
  function resultText() {
    const s = ctx.getState();
    if (!s || s.status === "playing") return "";
    if (!s.winner) return "A draw. Well played.";
    if (!computerMode(s)) return `Player ${s.winner} wins.`;
    return s.winner === human(s)
      ? "You win. Well played!"
      : "Computer wins. Try another round.";
  }
  function fail(message) {
    clearJob();
    failure = message || "The computer could not choose a move.";
    ctx.announce(`${failure} Choose Retry computer move to try again.`);
    ctx.redraw();
  }
  function schedule() {
    const s = ctx.getState();
    if (
      !s ||
      !ctx.isRunning() ||
      ctx.isPublic() ||
      s.status !== "playing" ||
      !computerTurn(s)
    ) {
      clearJob();
      return;
    }
    const position = signature(s);
    if (job?.position === position || failure) return;
    clearJob();
    const id = ++serial;
    job = { id, position };
    try {
      worker = new Worker(new URL("./board-ai-worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        if (job?.id !== id || data?.id !== id) return;
        const current = ctx.getState();
        if (
          !ctx.isRunning() ||
          ctx.isPublic() ||
          signature(current) !== position ||
          !computerTurn(current)
        ) {
          clearJob();
          return;
        }
        if (data.error || !data.event) {
          fail(data.error || "The computer returned no legal move.");
          return;
        }
        const event = data.event;
        const move = connect ? event.column : event.index;
        if (
          event.type !== (connect ? "drop" : "disc") ||
          !legalMoves(current).includes(move)
        ) {
          fail("The computer returned an invalid move.");
          return;
        }
        clearJob();
        failure = "";
        ctx.act({ ...event, computer: true });
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        if (job?.id === id) fail("The computer could not start. Please retry.");
      };
      timer = setTimeout(() => {
        if (job?.id === id) fail("The computer took too long. Please retry.");
      }, 10000);
      worker.postMessage({ id, state: s });
    } catch {
      fail(
        "This browser could not start the computer. Please retry or choose two players.",
      );
    }
  }
  function preview(index) {
    if (!boardNode || connect) return;
    const s = ctx.getState();
    for (const cell of boardNode.querySelectorAll("[data-preview]"))
      delete cell.dataset.preview;
    if (!canPlay(s)) return;
    for (const i of reversiFlips(s.board, index, s.turn)) {
      const cell = boardNode.querySelector(`[data-board-cell="${i}"]`);
      if (cell) cell.dataset.preview = String(s.turn);
    }
  }
  function bind(board) {
    if (bound.has(board)) return;
    bound.add(board);
    board.addEventListener("pointerover", (e) => {
      const cell = e.target.closest?.("[data-disc]");
      if (cell) preview(Number(cell.dataset.disc));
    });
    board.addEventListener("pointerleave", () => preview(-1));
    board.addEventListener("focusin", (e) => {
      const cell = e.target.closest?.("[data-board-cell]");
      if (cell) {
        focusIndex = Number(cell.dataset.boardCell);
        for (const other of board.querySelectorAll("[data-board-cell]"))
          other.tabIndex = other === cell ? 0 : -1;
        if (!connect) preview(focusIndex);
      }
    });
    board.addEventListener("focusout", (e) => {
      if (!board.contains(e.relatedTarget)) preview(-1);
    });
  }
  function render(board) {
    boardNode = board;
    const s = ctx.getState();
    if (!s) {
      stop();
      return;
    }
    const oldFocus = document.activeElement;
    const hadFocus = board.contains(oldFocus);
    if (oldFocus?.dataset?.boardCell !== undefined)
      focusIndex = Number(oldFocus.dataset.boardCell);
    const playable = canPlay(s),
      legal = legalMoves(s);
    if (
      !Number.isInteger(focusIndex) ||
      focusIndex < 0 ||
      focusIndex >= s.board.length
    )
      focusIndex = legal[0] || 0;
    const colors = connect ? ["Pink", "Blue"] : ["Black", "White"];
    const turnText =
      s.status !== "playing"
        ? resultText()
        : !ctx.isRunning()
          ? "Paused · continue when you are ready."
          : computerTurn(s)
            ? failure
              ? "Computer paused · retry below."
              : "Computer is thinking…"
            : computerMode(s)
              ? connect
                ? "Your turn. Choose a column."
                : "Your turn. Pick a square."
              : `Player ${s.turn} to move.`;
    const playerChips = [1, 2]
      .map(
        (side) =>
          `<div class="board-player ${s.turn === side && s.status === "playing" ? "is-turn" : ""}" data-side="${side}"><span class="board-player-piece" aria-hidden="true"></span><span>${label(s, side)}<small>${colors[side - 1]}${s.turn === side && s.status === "playing" ? " · to move" : ""}</small></span><strong>${s.counts[side - 1]}</strong></div>`,
      )
      .join("");
    const cells = s.board
      .map((value, index) => {
        const row = Math.floor(index / (connect ? 7 : 8)) + 1,
          column = (index % (connect ? 7 : 8)) + 1;
        const isLegal = connect
          ? legal.includes(column - 1)
          : legal.includes(index);
        const flips =
          !connect && isLegal ? reversiFlips(s.board, index, s.turn).length : 0;
        const text = `Row ${row}, column ${column}. ${value ? `${colors[value - 1]} disc.` : "Empty."} ${connect ? (isLegal ? `Drop in column ${column}.` : "Column full.") : isLegal ? `Legal move. Flip ${flips} ${flips === 1 ? "disc" : "discs"}.` : "No legal move here."}`;
        return `<button type="button" class="board-cell ${value ? "occupied" : ""} ${isLegal ? "is-legal" : ""} ${s.lastMove === index ? "last-move" : ""}" data-board-cell="${index}" ${connect ? `data-drop="${column - 1}"` : `data-disc="${index}"`} data-piece="${value}" aria-label="${text}" aria-disabled="${!playable || !isLegal}" tabindex="${index === focusIndex ? 0 : -1}" ${!playable ? "disabled" : ""}><span class="board-disc" aria-hidden="true">${s.lastMove === index ? '<i class="board-last-dot"></i>' : ""}</span>${!connect && !value && isLegal ? '<span class="board-legal-dot" aria-hidden="true"></span>' : ""}</button>`;
      })
      .join("");
    const note =
      s.status === "playing"
        ? connect
          ? "Choose a column. Discs fall to the lowest empty space."
          : `${legal.length} legal ${legal.length === 1 ? "move" : "moves"}. Hover or focus a marked square to preview flips.`
        : "Start a new game to play again.";
    board.innerHTML = `<div class="board-native ${connect ? "connect-native" : "reversi-native"}"><div class="board-players">${playerChips}</div><p class="board-turn" role="status">${turnText}</p>${!connect && s.passCount === 1 ? `<p class="board-pass-notice">${label(s, s.lastSkipped)} has no legal move. ${label(s, s.turn)} plays again.</p>` : ""}<div class="board-grid ${connect ? "connect-grid" : "reversi-grid"}" role="group" aria-label="${connect ? "Seven column, six row Connect Four board" : "Eight by eight Reversi board"}">${cells}</div><p class="board-input-note">${note}</p>${failure ? '<div class="board-ai-error"><p>The computer move did not finish. Your position is unchanged.</p><button type="button" class="button secondary" data-board-retry>Retry computer move</button></div>' : ""}</div>`;
    bind(board);
    if (hadFocus) {
      const target = board.querySelector(`[data-board-cell="${focusIndex}"]`);
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else board.focus({ preventScroll: true });
    }
    schedule();
  }
  function handleClick(e) {
    const button = e.target.closest?.(
      "[data-drop], [data-disc], [data-board-retry]",
    );
    if (!button || !boardNode?.contains(button)) return false;
    e.preventDefault?.();
    const s = ctx.getState();
    if (button.hasAttribute("data-board-retry")) {
      failure = "";
      stop();
      ctx.redraw();
      return true;
    }
    if (!canPlay(s)) return true;
    const move = Number(connect ? button.dataset.drop : button.dataset.disc);
    if (!legalMoves(s).includes(move)) {
      ctx.announce(
        connect
          ? "This column is full. Choose another column."
          : "That square is not a legal move. Choose a marked square.",
      );
      return true;
    }
    focusIndex = Number(button.dataset.boardCell);
    ctx.act(
      connect ? { type: "drop", column: move } : { type: "disc", index: move },
    );
    return true;
  }
  function handleKey(e) {
    if (
      !boardNode?.contains(e.target) ||
      e.isComposing ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    )
      return false;
    const cell = e.target.closest?.("[data-board-cell]");
    if (cell && (e.key === "Enter" || e.key === " ")) return handleClick(e);
    const columns = connect ? 7 : 8,
      total = connect ? 42 : 64;
    const delta = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    }[e.key];
    if (!delta || !canPlay(ctx.getState())) return false;
    e.preventDefault();
    const next = (focusIndex + delta + total) % total;
    boardNode
      .querySelector(`[data-board-cell="${next}"]`)
      ?.focus({ preventScroll: true });
    return true;
  }
  return { render, handleClick, handleKey, stop, reset, resultText };
}
