import { solution } from "./puzzle-engine.js";

const SUDOKU_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const escapeText = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function sudokuConflicts(state) {
  const conflicts = new Set();
  for (let i = 0; i < 81; i++) {
    if (!state.board[i]) continue;
    for (let j = i + 1; j < 81; j++) {
      const sameRow = Math.floor(i / 9) === Math.floor(j / 9);
      const sameCol = i % 9 === j % 9;
      const sameBox =
        Math.floor(i / 27) === Math.floor(j / 27) &&
        Math.floor((i % 9) / 3) === Math.floor((j % 9) / 3);
      if (
        (sameRow || sameCol || sameBox) &&
        state.board[i] === state.board[j]
      ) {
        conflicts.add(i);
        conflicts.add(j);
      }
    }
  }
  return conflicts;
}
function runs(cells) {
  const result = [];
  let count = 0;
  for (const value of cells) {
    if (value === 1) count++;
    else if (count) {
      result.push(count);
      count = 0;
    }
  }
  if (count) result.push(count);
  return result;
}
const sameRuns = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function createPuzzleUI(ctx) {
  let selected = 0,
    noteMode = false,
    paintMode = "fill",
    board = null;
  let pointer = null,
    paintValue = 0,
    visited = new Set(),
    suppressClick = false,
    lastPaintIndex = null;
  const bound = new WeakSet();
  const state = () => ctx.getState();
  const playable = () => ctx.isRunning() && state()?.status === "playing";
  const announce = (text) => ctx.announce?.(text);
  const owns = (target) =>
    !!(board && target instanceof Element && board.contains(target));
  const cellTarget = (target) =>
    target instanceof Element ? target.closest("[data-puzzle-cell]") : null;
  function select(index, focus = false) {
    const current = state();
    if (
      !current ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= current.board.length
    )
      return;
    selected = index;
    ctx.redraw();
    if (focus)
      board
        ?.querySelector(`[data-puzzle-cell="${selected}"]`)
        ?.focus({ preventScroll: true });
  }
  function enterDigit(value) {
    const current = state();
    if (!playable() || current?.game !== "sudoku") return;
    if (current.givens[selected]) {
      announce("This is a given digit. Select an empty cell.");
      return;
    }
    if (noteMode && value) {
      if (current.board[selected]) {
        announce("Erase the digit before adding pencil notes.");
        return;
      }
      const notes = new Set(current.notes[selected]);
      if (notes.has(value)) notes.delete(value);
      else notes.add(value);
      current.notes[selected] = [...notes].sort((a, b) => a - b);
      ctx.queueSave();
      ctx.redraw();
      announce(
        `Pencil note ${value} ${notes.has(value) ? "added" : "removed"}.`,
      );
    } else if (
      !value &&
      !current.board[selected] &&
      current.notes[selected].length
    ) {
      current.notes[selected] = [];
      ctx.queueSave();
      ctx.redraw();
      announce("Pencil notes cleared.");
    } else ctx.act({ type: "digit", index: selected, value });
  }
  function paint(index, value) {
    const current = state();
    if (!playable() || current?.game !== "nonogram" || visited.has(index))
      return;
    visited.add(index);
    selected = index;
    if (current.board[index] !== value) ctx.act({ type: "cell", index, value });
  }
  function paintLine(index) {
    const size = state()?.size;
    if (!size || lastPaintIndex === null) {
      paint(index, paintValue);
      lastPaintIndex = index;
      return;
    }
    let x = lastPaintIndex % size,
      y = Math.floor(lastPaintIndex / size);
    const tx = index % size,
      ty = Math.floor(index / size),
      dx = Math.abs(tx - x),
      dy = -Math.abs(ty - y);
    const sx = x < tx ? 1 : -1,
      sy = y < ty ? 1 : -1;
    let error = dx + dy;
    while (true) {
      paint(y * size + x, paintValue);
      if (x === tx && y === ty) break;
      const twice = 2 * error;
      if (twice >= dy) {
        error += dy;
        x += sx;
      }
      if (twice <= dx) {
        error += dx;
        y += sy;
      }
    }
    lastPaintIndex = index;
  }
  function renderSudoku(current) {
    const conflicts = sudokuConflicts(current);
    const row = Math.floor(selected / 9),
      col = selected % 9;
    const cells = current.board
      .map((value, index) => {
        const y = Math.floor(index / 9),
          x = index % 9;
        const related =
          y === row ||
          x === col ||
          (Math.floor(y / 3) === Math.floor(row / 3) &&
            Math.floor(x / 3) === Math.floor(col / 3));
        const classes = [
          "sudoku-cell",
          current.givens[index] ? "is-given" : "is-editable",
          index === selected ? "is-selected" : "",
          related ? "is-related" : "",
          conflicts.has(index) ? "is-conflict" : "",
          x === 2 || x === 5 ? "box-right" : "",
          y === 2 || y === 5 ? "box-bottom" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const notes = current.notes[index];
        const label = `Row ${y + 1}, column ${x + 1}, ${value ? `digit ${value}${current.givens[index] ? ", given" : ""}` : `empty${notes.length ? `, notes ${notes.join(", ")}` : ""}`}${conflicts.has(index) ? ", conflict" : ""}`;
        const content =
          value ||
          `<span class="sudoku-notes" aria-hidden="true">${SUDOKU_DIGITS.map((n) => `<span>${notes.includes(n) ? n : ""}</span>`).join("")}</span>`;
        return `${x === 0 ? '<div class="puzzle-grid-row" role="row">' : ""}<button type="button" class="${classes}" data-puzzle-cell="${index}" role="gridcell" aria-label="${escapeText(label)}" aria-selected="${index === selected}" ${conflicts.has(index) ? 'aria-invalid="true"' : ""} tabindex="${index === selected ? 0 : -1}">${content}</button>${x === 8 ? "</div>" : ""}`;
      })
      .join("");
    const filled = current.board.filter(Boolean).length;
    return `<div class="puzzle-stage sudoku-stage"><div class="puzzle-summary"><span><strong>${filled}</strong> / 81 cells filled</span><span class="puzzle-conflict-summary" ${conflicts.size ? "" : "hidden"}>${conflicts.size} conflicting cells</span></div><div class="sudoku-grid" role="grid" aria-label="Sudoku puzzle, use arrow keys to select a cell">${cells}</div><div class="puzzle-controls"><button type="button" class="button secondary puzzle-notes-toggle" data-puzzle-action="notes" aria-pressed="${noteMode}">Pencil notes <span>${noteMode ? "On" : "Off"}</span></button><button type="button" class="button secondary" data-puzzle-digit="0">Erase</button></div><div class="sudoku-number-pad" aria-label="Enter a digit">${SUDOKU_DIGITS.map((n) => `<button type="button" data-puzzle-digit="${n}" aria-label="${noteMode ? "Toggle pencil note" : "Enter digit"} ${n}">${n}</button>`).join("")}</div><p class="puzzle-key-help">Select a cell, then enter 1–9. Arrow keys move; Delete erases; N toggles notes. Conflicts show an underline.</p></div>`;
  }
  function renderNonogram(current) {
    const n = current.size;
    const maxRows = Math.max(1, ...current.rows.map((r) => r.length));
    const maxCols = Math.max(1, ...current.cols.map((c) => c.length));
    const completeRows = current.rows.map((clues, y) =>
      sameRuns(runs(current.board.slice(y * n, (y + 1) * n)), clues),
    );
    const completeCols = current.cols.map((clues, x) =>
      sameRuns(
        runs(Array.from({ length: n }, (_, y) => current.board[y * n + x])),
        clues,
      ),
    );
    const clue = (list) =>
      (list.length ? list : [0]).map((v) => `<span>${v}</span>`).join("");
    const top = current.cols
      .map(
        (clues, x) =>
          `<div class="nonogram-col-clue ${completeCols[x] ? "is-complete" : ""}" role="columnheader" aria-label="Column ${x + 1}: ${clues.join(", ") || "empty"}${completeCols[x] ? ", runs match" : ""}">${clue(clues)}${completeCols[x] ? '<i aria-hidden="true">✓</i>' : ""}</div>`,
      )
      .join("");
    const rows = current.rows
      .map(
        (clues, y) =>
          `<div class="puzzle-grid-row" role="row"><div class="nonogram-row-clue ${completeRows[y] ? "is-complete" : ""}" role="rowheader" aria-label="Row ${y + 1}: ${clues.join(", ") || "empty"}${completeRows[y] ? ", runs match" : ""}">${clue(clues)}${completeRows[y] ? '<i aria-hidden="true">✓</i>' : ""}</div>${Array.from(
            { length: n },
            (_, x) => {
              const index = y * n + x,
                value = current.board[index];
              const classes = [
                "nonogram-cell",
                value === 1 ? "is-filled" : value === 2 ? "is-crossed" : "",
                index === selected ? "is-selected" : "",
                x > 0 && x % 5 === 0 ? "group-left" : "",
                y > 0 && y % 5 === 0 ? "group-top" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `<button type="button" class="${classes}" data-puzzle-cell="${index}" role="gridcell" tabindex="${index === selected ? 0 : -1}" aria-selected="${index === selected}" aria-label="Row ${y + 1}, column ${x + 1}, ${value === 1 ? "filled" : value === 2 ? "marked empty" : "unknown"}">${value === 2 ? '<span aria-hidden="true">×</span>' : ""}</button>`;
            },
          ).join("")}</div>`,
      )
      .join("");
    return `<div class="puzzle-stage nonogram-stage"><div class="puzzle-summary"><span><strong>${n} × ${n}</strong> picture puzzle</span><span>${current.board.filter((v) => v === 1).length} cells filled</span></div><div class="puzzle-controls nonogram-mode" role="group" aria-label="Drawing mode"><button type="button" class="button secondary" data-puzzle-paint="fill" aria-pressed="${paintMode === "fill"}">■ Fill</button><button type="button" class="button secondary" data-puzzle-paint="mark" aria-pressed="${paintMode === "mark"}">× Mark empty</button></div><div class="nonogram-viewport" tabindex="0" role="region" aria-label="Scrollable Nonogram board"><div class="nonogram-grid" role="grid" aria-label="Nonogram puzzle" style="--nonogram-size:${n};--row-clue-width:${Math.max(50, maxRows * 15 + 8)}px;--col-clue-height:${Math.max(48, maxCols * 16 + 12)}px"><div class="puzzle-grid-row" role="row"><div class="nonogram-corner" aria-hidden="true">${n} × ${n}</div>${top}</div>${rows}</div></div><p class="puzzle-key-help">Drag cells to paint; select the same mark to erase. Swipe the clues or scroll to move a large board. Arrows move; Space fills; X marks empty. A check means the visible runs match the clues.</p></div>`;
  }
  function render(element) {
    board = element;
    const current = state();
    if (!current || !["sudoku", "nonogram"].includes(current.game)) return;
    selected = Math.min(Math.max(0, selected), current.board.length - 1);
    const focused = element.contains(document.activeElement);
    const focusCell = document.activeElement?.hasAttribute("data-puzzle-cell");
    const action = document.activeElement?.getAttribute("data-puzzle-action");
    const digit = document.activeElement?.getAttribute("data-puzzle-digit");
    const paintControl =
      document.activeElement?.getAttribute("data-puzzle-paint");
    const viewport = element.querySelector(".nonogram-viewport");
    const scroll = viewport
      ? [viewport.scrollLeft, viewport.scrollTop]
      : [0, 0];
    element.innerHTML =
      current.game === "sudoku"
        ? renderSudoku(current)
        : renderNonogram(current);
    const nextViewport = element.querySelector(".nonogram-viewport");
    if (nextViewport) {
      nextViewport.scrollLeft = scroll[0];
      nextViewport.scrollTop = scroll[1];
    }
    if (focused) {
      const selector = focusCell
        ? `[data-puzzle-cell="${selected}"]`
        : action
          ? `[data-puzzle-action="${action}"]`
          : digit !== null && digit !== undefined
            ? `[data-puzzle-digit="${digit}"]`
            : paintControl
              ? `[data-puzzle-paint="${paintControl}"]`
              : ".nonogram-viewport";
      element.querySelector(selector)?.focus({ preventScroll: true });
    }
    bind(element);
  }
  function handleClick(event) {
    if (!owns(event.target)) return false;
    const target = event.target.closest(
      "[data-puzzle-cell],[data-puzzle-action],[data-puzzle-digit],[data-puzzle-paint]",
    );
    if (!target) return false;
    if (target.hasAttribute("data-puzzle-cell")) {
      const index = Number(target.dataset.puzzleCell);
      if (state()?.game === "sudoku") select(index, true);
      else if (!suppressClick) {
        selected = index;
        visited.clear();
        const desired = paintMode === "fill" ? 1 : 2;
        paint(index, state().board[index] === desired ? 0 : desired);
        ctx.redraw();
        board
          ?.querySelector(`[data-puzzle-cell="${index}"]`)
          ?.focus({ preventScroll: true });
      }
      suppressClick = false;
    } else if (target.hasAttribute("data-puzzle-digit"))
      enterDigit(Number(target.dataset.puzzleDigit));
    else if (target.dataset.puzzleAction === "notes") {
      noteMode = !noteMode;
      ctx.redraw();
      announce(`Pencil notes ${noteMode ? "on" : "off"}.`);
    } else if (target.hasAttribute("data-puzzle-paint")) {
      paintMode = target.dataset.puzzlePaint;
      ctx.redraw();
      announce(paintMode === "fill" ? "Fill mode." : "Mark empty mode.");
    }
    return true;
  }
  function handleKey(event) {
    if (
      !owns(event.target) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.isComposing
    )
      return false;
    const current = state();
    if (!current) return false;
    const onCell = !!cellTarget(event.target);
    if (!onCell) return false;
    const n = current.game === "sudoku" ? 9 : current.size;
    const directions = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -n,
      ArrowDown: n,
    };
    if (event.key in directions) {
      event.preventDefault();
      const row = Math.floor(selected / n),
        col = selected % n;
      const next =
        event.key === "ArrowLeft"
          ? row * n + Math.max(0, col - 1)
          : event.key === "ArrowRight"
            ? row * n + Math.min(n - 1, col + 1)
            : Math.min(
                current.board.length - 1,
                Math.max(0, selected + directions[event.key]),
              );
      select(next, true);
      return true;
    }
    if (!playable()) return false;
    if (current.game === "sudoku") {
      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        enterDigit(Number(event.key));
        return true;
      }
      if (["Backspace", "Delete", "0"].includes(event.key)) {
        event.preventDefault();
        enterDigit(0);
        return true;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        noteMode = !noteMode;
        ctx.redraw();
        announce(`Pencil notes ${noteMode ? "on" : "off"}.`);
        return true;
      }
    } else if (
      [" ", "Enter", "x", "X", "Delete", "Backspace"].includes(event.key)
    ) {
      event.preventDefault();
      visited.clear();
      const desired = ["x", "X"].includes(event.key)
        ? 2
        : ["Delete", "Backspace"].includes(event.key)
          ? 0
          : 1;
      paint(selected, current.board[selected] === desired ? 0 : desired);
      ctx.redraw();
      return true;
    }
    return false;
  }
  function stop() {
    pointer = null;
    lastPaintIndex = null;
    visited.clear();
  }
  function bind(element) {
    board = element;
    if (bound.has(element)) return;
    bound.add(element);
    element.addEventListener("pointerdown", (event) => {
      const current = state(),
        cell = cellTarget(event.target);
      if (
        !cell ||
        !element.contains(cell) ||
        current?.game !== "nonogram" ||
        !playable() ||
        event.button !== 0
      )
        return;
      event.preventDefault();
      pointer = event.pointerId;
      lastPaintIndex = null;
      visited.clear();
      suppressClick = true;
      const index = Number(cell.dataset.puzzleCell),
        desired = paintMode === "fill" ? 1 : 2;
      paintValue = current.board[index] === desired ? 0 : desired;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* Synthetic or released pointer. */
      }
      paintLine(index);
      ctx.redraw();
      element
        .querySelector(`[data-puzzle-cell="${index}"]`)
        ?.focus({ preventScroll: true });
    });
    element.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointer || !playable()) return;
      const cell = cellTarget(
        document.elementFromPoint(event.clientX, event.clientY),
      );
      if (cell && element.contains(cell)) {
        event.preventDefault();
        paintLine(Number(cell.dataset.puzzleCell));
      }
    });
    const release = (event) => {
      if (event.pointerId !== pointer) return;
      stop();
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        /* Already released. */
      }
      // Pointer painting already applied the initial cell; do not apply the synthetic click again.
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    };
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
    element.addEventListener("lostpointercapture", () => stop());
  }
  function hint() {
    const current = state();
    if (!playable() || !current) {
      announce("Start or resume this puzzle before using a hint.");
      return;
    }
    if (ctx.isPublic()) {
      announce("Hints are available in Private games only.");
      return;
    }
    const answer = solution(current);
    const needs = (i) =>
      current.game === "sudoku"
        ? !current.givens[i] && current.board[i] !== answer[i]
        : (current.board[i] === 1) !== !!answer[i];
    const index = needs(selected)
      ? selected
      : answer.findIndex((_, i) => needs(i));
    if (index < 0) return;
    selected = index;
    ctx.act({
      type: current.game === "sudoku" ? "digit" : "cell",
      index,
      value: current.game === "sudoku" ? answer[index] : answer[index] ? 1 : 2,
    });
    announce(
      `Hint applied to row ${Math.floor(index / (current.game === "sudoku" ? 9 : current.size)) + 1}, column ${(index % (current.game === "sudoku" ? 9 : current.size)) + 1}.`,
    );
  }
  function reset() {
    stop();
    selected = 0;
    noteMode = false;
    paintMode = "fill";
    suppressClick = false;
  }
  return { render, handleClick, handleKey, bind, hint, stop, reset };
}
