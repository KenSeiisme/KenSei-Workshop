import { api, downloadText } from "/tool-scripts/common.js";
import { uiDate, uiHtml, uiMsg, uiText } from "../site/ui.js";
import { boardResult } from "./board-result.js";
import { MATCH_ID } from "./match-link.js";

const chinesePieces = {
  w: { p: "兵", n: "馬", b: "相", r: "車", a: "仕", c: "炮", k: "帥" },
  b: { p: "卒", n: "馬", b: "象", r: "車", a: "士", c: "砲", k: "將" },
};

function drawGo(board, state, flipped) {
  const size = state.config.size;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 760;
  canvas.setAttribute("aria-hidden", "true");
  board.replaceChildren(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pad = 40,
    end = 720,
    step = (end - pad) / (size - 1);
  ctx.fillStyle = "#30243a";
  ctx.fillRect(0, 0, 760, 760);
  ctx.strokeStyle = "#aa98b5";
  ctx.fillStyle = "#ebdef3";
  ctx.font = "18px sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < size; i++) {
    const p = pad + step * i;
    ctx.beginPath();
    ctx.moveTo(pad, p);
    ctx.lineTo(end, p);
    ctx.moveTo(p, pad);
    ctx.lineTo(p, end);
    ctx.stroke();
    const column = flipped ? size - i - 1 : i;
    ctx.fillText("ABCDEFGHJKLMNOPQRST"[column], p, 25);
    ctx.fillText(String(flipped ? i + 1 : size - i), 20, p + 6);
  }
  state.board.forEach((stone, index) => {
    if (!stone) return;
    const point = flipped ? size * size - 1 - index : index;
    const x = pad + (point % size) * step;
    const y = pad + Math.floor(point / size) * step;
    ctx.beginPath();
    ctx.arc(x, y, step * 0.45, 0, 2 * Math.PI);
    const color = ctx.createLinearGradient(x, y - step / 2, x, y + step / 2);
    color.addColorStop(0, stone === 1 ? "#56505f" : "#fff9ff");
    color.addColorStop(1, stone === 1 ? "#100d15" : "#bcb0c8");
    ctx.fillStyle = color;
    ctx.fill();
    if (state.last === index) {
      ctx.beginPath();
      ctx.strokeStyle = stone === 1 ? "#e8bbff" : "#8253a4";
      ctx.lineWidth = 2.5;
      ctx.arc(x, y, step * 0.16, 0, 2 * Math.PI);
      ctx.stroke();
    }
  });
}

function drawPieces(board, state, game, Position, flipped) {
  const xiangqi = game === "xiangqi";
  const [files, ranks] = xiangqi ? [9, 10] : [8, 8];
  const position = new Position(state.fen);
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < files * ranks; i++) {
    const offset = flipped ? files * ranks - i - 1 : i;
    const file = offset % files;
    const rank = ranks - 1 - Math.floor(offset / files);
    const square = String.fromCharCode(97 + file) + (xiangqi ? rank : rank + 1);
    const cell = document.createElement("span");
    cell.className = game + "-square";
    cell.setAttribute("role", "gridcell");
    if ((file + rank + (xiangqi ? 0 : 1)) % 2 === 0) cell.classList.add("dark");
    if (state.last?.from === square || state.last?.to === square)
      cell.classList.add("last");
    const piece = position.get(square);
    if (piece) {
      const icon = document.createElement("span");
      icon.className = game + "-piece";
      if (xiangqi) {
        const label = chinesePieces[piece.color][piece.type];
        icon.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="piece-rim" cx="24" cy="24" r="21"/><circle class="piece-inner" cx="24" cy="24" r="17.5"/><text x="24" y="25" text-anchor="middle" dominant-baseline="central" class="piece-letter ${piece.color === "w" ? "red" : "black"}">${label}</text></svg>`;
        cell.setAttribute("aria-label", square + " " + label);
      } else {
        const image = document.createElement("img");
        image.src = `/assets/chess/${piece.color}${piece.type}.svg`;
        image.alt = "";
        icon.append(image);
        cell.setAttribute(
          "aria-label",
          `${square} ${piece.color.toUpperCase()}${piece.type.toUpperCase()}`,
        );
      }
      cell.append(icon);
    } else cell.setAttribute("aria-label", square);
    fragment.append(cell);
  }
  board.replaceChildren(fragment);
}

async function replayEngine(game) {
  if (game === "go") {
    const { replayGo, exportSGF } = await import("./go-engine.js");
    return {
      frame: (state, end) => replayGo(state.config, state.log.slice(0, end)),
      draw: drawGo,
      download: (state, names) =>
        downloadText(
          exportSGF(state, names),
          "kensei-go.sgf",
          "application/x-go-sgf",
        ),
    };
  }
  if (game === "chess") {
    const { Chess, compactChess, replayChess, exportChessPGN } =
      await import("./chess-engine.js");
    return {
      frame: (state, end) => replayChess(compactChess(state), end),
      draw: (board, state, flipped) =>
        drawPieces(board, state, game, Chess, flipped),
      download: (state, names) =>
        downloadText(
          exportChessPGN(state, names),
          "kensei-chess.pgn",
          "application/x-chess-pgn",
        ),
    };
  }
  const { XiangqiPosition, compactXiangqi, replayXiangqi, exportXiangqiText } =
    await import("./xiangqi-engine.js");
  return {
    frame: (state, end) => replayXiangqi(compactXiangqi(state), end),
    draw: (board, state, flipped) =>
      drawPieces(board, state, game, XiangqiPosition, flipped),
    download: (state, names) =>
      downloadText(
        exportXiangqiText(state, names),
        "kensei-xiangqi.txt",
        "text/plain;charset=utf-8",
      ),
  };
}

export function mountBoardReview(root) {
  const game = root.dataset.gameTheme;
  const id = new URLSearchParams(location.search).get("review");
  root.innerHTML = uiHtml`<header class="board-review-heading">
    <a class="text-link" data-review-back href="/games/#hub-recent-title">← Games</a>
    <h1>Match replay</h1>
    <p class="muted" data-review-status role="status"></p>
    <button type="button" class="button secondary" data-review-sign-in hidden>Sign in</button>
    <button type="button" class="button secondary" data-review-retry hidden>Retry</button>
  </header>
  <div class="board-review-content" data-review-content hidden>
    <div id="game-board" class="${game}-board archive-board" data-review-board role="${game === "go" ? "img" : "grid"}" tabindex="0" aria-label="Reviewed position"></div>
    <label class="field">Review move
      <input data-review-ply type="range" min="0" max="0" value="0">
    </label>
    <output data-review-number></output>
    <div class="action-row board-review-actions">
      <button type="button" class="button secondary" data-review-prev>Previous move</button>
      <button type="button" class="button secondary" data-review-next>Next move</button>
      <button type="button" class="button secondary" data-review-flip>Flip board</button>
      <button type="button" class="button primary" data-review-download>Download record</button>
    </div>

  </div>`;
  const $ = (selector) => root.querySelector(selector);
  const board = $("[data-review-board]");
  const back = $("[data-review-back]");
  const status = $("[data-review-status]");
  const retry = $("[data-review-retry]");
  const signIn = $("[data-review-sign-in]");
  const content = $("[data-review-content]");
  const range = $("[data-review-ply]");
  const prev = $("[data-review-prev]");
  const next = $("[data-review-next]");
  let match,
    engine,
    steps = [],
    names,
    owner,
    flipped,
    request;
  let message = uiMsg("Loading match replay…");

  function paint() {
    back.href = window.KenseiI18n.localePath("/games/") + "#hub-recent-title";
    if (!match) {
      uiText(status, message);
      return;
    }
    const index = Number(range.value);
    const state =
      index === steps.length
        ? match.state
        : engine.frame(match.state, steps[index - 1] || 0);
    engine.draw(board, state, flipped);
    prev.disabled = index === 0;
    next.disabled = index === steps.length;
    uiText(
      $("[data-review-number]"),
      uiMsg("Move {0} / {1}", [index, steps.length]),
    );
    uiText(
      status,
      uiMsg("{0} · {1}", [
        boardResult(match),
        uiDate(new Date(match.ended_at), {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      ]),
    );
  }

  async function load() {
    const nextOwner = api.user?.id;
    if (request && owner === nextOwner) return;
    owner = nextOwner;
    match = request = null;
    board.replaceChildren();
    content.hidden = signIn.hidden = retry.hidden = true;
    message = uiMsg("Loading match replay…");
    if (!api.ready) return paint();
    if (!MATCH_ID.test(id)) {
      message = uiMsg("This match is unavailable.");
      return paint();
    }
    if (!owner || !api.client) {
      signIn.hidden = false;
      message = uiMsg("Sign in to review your matches.");
      return paint();
    }
    const ticket = {};
    request = ticket;
    paint();
    try {
      const query = api.client.rpc("get_my_board_match_review", {
        match_id: id,
      });
      const { data, error } = await (query.abortSignal?.(
        AbortSignal.timeout(10000),
      ) ?? query);
      if (request !== ticket || owner !== api.user?.id) return;
      if (error) throw error;
      if (data?.game !== game || !Array.isArray(data.state?.log)) {
        message = uiMsg("This match is unavailable.");
        return;
      }
      const renderer = await replayEngine(game);
      if (request !== ticket || owner !== api.user?.id) return;
      const player = (color) =>
        data.members
          ?.find((m) => m.color === color)
          ?.nickname?.replace(/[\r\n"]/g, "");
      names = {
        white: player(game === "go" ? -1 : 1),
        black: player(game === "go" ? 1 : -1),
        red: player(1),
      };
      steps = data.state.log.flatMap((action, i) =>
        action.type === "move" || (game === "go" && action.type === "pass")
          ? [i + 1]
          : [],
      );
      range.max = steps.length;
      range.value = steps.length;
      match = data;
      engine = renderer;
      flipped = match.color === -1;
      content.hidden = false;
    } catch {
      if (request !== ticket || owner !== api.user?.id) return;
      retry.hidden = false;
      message = uiMsg("Replay could not load. Retry when connected.");
    } finally {
      if (request === ticket) {
        request = null;
        paint();
      }
    }
  }

  const step = (amount) => {
    range.value = Math.max(
      0,
      Math.min(steps.length, Number(range.value) + amount),
    );
    paint();
  };
  prev.onclick = () => step(-1);
  next.onclick = () => step(1);
  range.oninput = paint;
  $("[data-review-flip]").onclick = () => {
    flipped = !flipped;
    paint();
  };
  $("[data-review-download]").onclick = () => {
    if (owner === api.user?.id && match) engine.download(match.state, names);
  };
  board.onkeydown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  };
  signIn.onclick = () => api.openAuth();
  retry.onclick = load;
  window.addEventListener("workspace-ready", load);
  window.addEventListener("locale-change", paint);
  load();
}
