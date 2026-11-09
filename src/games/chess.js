import { api, downloadText } from "/tool-scripts/common.js";
import { ensureProfile, paintAvatar } from "/tool-scripts/profile-service.js";
import { createRecordStore } from "/tool-scripts/record-store.js";
import {
  createChess,
  applyChess,
  replayChess,
  compactChess,
  validateChessSave,
  chessSettings,
  Chess,
  CHESS_VERSION,
  CHESS_CLOCKS,
  chessMoves,
  createChessClock,
  chargeChessClock,
  chessClockView,
  exportChessPGN,
  importChessPGN,
} from "./chess-engine.js";
import { timeoutVerdicts } from "./chess-adjudication.js";
import { createChessAI } from "./chess-ai.js";
import { boardClientId } from "./board-identity.js";
import { trackBoardGame } from "./hub-activity.js";
import { mountPlayShell } from "./play-shell.js";
import { mountEffects } from "./effects.js";
import {
  mountAudio,
  unlockAudio,
  stopAudio,
  playCue,
  setAudioState,
  resultCue,
} from "./audio.js";
import {
  uiMsg,
  uiFrom,
  uiText,
  uiAttr,
  uiError,
  uiConfirm,
  uiDate,
} from "../site/ui.js";

const $ = (s) => document.querySelector(s),
  root = $("[data-chess]"),
  board = $("#game-board");
mountEffects();
mountAudio();
const shell = mountPlayShell(root),
  tab = await boardClientId(),
  store = createRecordStore("game", validateChessSave, { syncDelay: 500 });
const owner = () => api.user?.id || "guest",
  tx = (id, value) => uiText($(id), value),
  say = (value) => tx("#chess-status", value);
let identity = owner(),
  state = null,
  room = null,
  queued = false,
  queueConfig = null,
  mode = "ai",
  human = 1,
  level = 2,
  clock = null,
  paused = false,
  busy = false,
  thinking = false,
  connected = false,
  flipped = false,
  selected = null,
  candidate = null,
  cursor = "e2",
  saveId = null,
  savedRow = null,
  saveTimer,
  engine = null,
  generation = 0,
  onlineEpoch = 0,
  savesSerial = 0,
  pending = null,
  polling = false,
  channel = null,
  channelKey = "",
  channelEpoch = 0,
  offset = 0,
  replayPly = null,
  rankSerial = 0,
  rankData = null,
  top50 = false,
  disposed = false,
  audioSnapshot = null,
  endRead = false;
const cells = new Map();
const names = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};
const art = {
  p: '<circle cx="24" cy="13" r="6"/><path d="M20 20h8l3 16H17zM14 37h20v5H14z"/>',
  r: '<path d="M12 7h6v5h4V7h5v5h4V7h6v12l-5 5v12H17V24l-5-5zM13 37h23v5H13z"/>',
  n: '<path d="m15 35 4-12-8-3 7-13 7-3 9 7-1 10 1 14zM13 37h23v5H13z"/><path d="m17 11 5 1M26 11h1" fill="none" stroke-width="3"/>',
  b: '<path d="M24 5c-12 9-10 17 0 20 10-3 12-11 0-20zM21 25h6l5 11H16zM13 37h23v5H13z"/><path d="m24 11-4 7" fill="none" stroke-width="2"/>',
  q: '<path d="m12 16 7 7 5-13 5 13 7-7-6 20H18zM13 37h23v5H13z"/><circle cx="11" cy="12" r="3"/><circle cx="24" cy="7" r="3"/><circle cx="37" cy="12" r="3"/>',
  k: '<path d="M21 4h6v5h5v5h-5v7h-6v-7h-5V9h5zM17 23q7-7 14 0l-3 13h-8zM13 37h23v5H13z"/>',
};
function pieceSvg(piece) {
  return `<svg viewBox="0 0 48 48" aria-hidden="true" fill="${piece.color === "w" ? "#fff5ef" : "#292237"}" stroke="${piece.color === "w" ? "#71607e" : "#d4bfec"}" stroke-width="1.35" stroke-linejoin="round">${art[piece.type]}</svg>`;
}
for (let rank = 8; rank >= 1; rank--)
  for (let f = 0; f < 8; f++) {
    const square = String.fromCharCode(97 + f) + rank,
      button = document.createElement("button");
    button.type = "button";
    button.id = `chess-square-${square}`;
    button.className = `chess-square ${(f + rank) % 2 === 0 ? "dark" : ""}`;
    button.dataset.square = square;
    button.tabIndex = -1;
    button.setAttribute("role", "gridcell");
    const icon = document.createElement("span");
    icon.className = "chess-piece";
    icon.style.display = "contents";
    const coord = document.createElement("small");
    coord.className = "coordinate";
    coord.textContent = square;
    button.append(icon, coord);
    board.append(button);
    cells.set(square, { button, icon, coord, code: "" });
  }
function cancelAI() {
  generation++;
  engine?.close();
  engine = null;
  thinking = false;
}
function setup() {
  return chessSettings({ clock: $("#chess-clock").value });
}
function configLabel(config = state?.config || room?.config || setup()) {
  return uiMsg("Standard chess · {0}", [
    config.clock === "none" ? uiFrom("Unlimited") : config.clock,
  ]);
}
const actor = () => (room ? room.color : mode === "ai" ? human : state?.turn);
const isUnresolved = () => state?.result?.reason === "unresolved";
const canPlay = () =>
  !!state &&
  state.phase === "playing" &&
  !paused &&
  !thinking &&
  !pending &&
  replayPly === null &&
  (!room || (room.controller && connected && state.turn === room.color)) &&
  (mode !== "ai" || state.turn === human);
function shownState() {
  if (replayPly !== null && state)
    return replayChess(
      compactChess(state),
      replayPly ? reviewSteps()[replayPly - 1] : 0,
    );
  return state || createChess(setup());
}
const reviewSteps = () =>
  state?.log.flatMap((action, index) =>
    action.type === "move" ? [index + 1] : [],
  ) || [];
function draw() {
  const s = shownState(),
    c = new Chess(s.fen),
    moves = selected ? c.moves({ square: selected, verbose: true }) : [],
    legal = new Set(moves.map((m) => m.to));
  const squares = [...cells.keys()];
  if (flipped) squares.reverse();
  for (let i = 0; i < squares.length; i++) {
    const square = squares[i],
      cell = cells.get(square),
      piece = c.get(square),
      code = piece ? piece.color + piece.type : "";
    cell.button.style.order = i;
    if (cell.code !== code) {
      cell.icon.innerHTML = piece ? pieceSvg(piece) : "";
      cell.code = code;
    }
    cell.button.classList.toggle(
      "last",
      s.last?.from === square || s.last?.to === square,
    );
    cell.button.classList.toggle("selected", square === selected);
    cell.button.classList.toggle("candidate", square === candidate?.to);
    cell.button.classList.toggle("legal", legal.has(square) && canPlay());
    cell.button.classList.toggle(
      "checked",
      !!piece && piece.type === "k" && piece.color === c.turn() && c.inCheck(),
    );
    cell.button.classList.toggle(
      "keyboard-cursor",
      document.activeElement === board && cursor === square,
    );
    uiAttr(
      cell.button,
      "aria-label",
      piece
        ? uiMsg("{0} · {1} {2}", [
            square,
            uiFrom(piece.color === "w" ? "White" : "Black"),
            uiFrom(names[piece.type]),
          ])
        : uiMsg("{0} · empty", [square]),
    );
    cell.button.setAttribute("aria-selected", String(square === selected));
  }
  board.setAttribute("aria-activedescendant", `chess-square-${cursor}`);
}
const reasonText = {
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  "dead-material": "Dead position · insufficient material",
  fivefold: "Fivefold repetition",
  "seventy-five": "Seventy-five moves",
  "threefold-claim": "Threefold repetition claimed",
  "fifty-claim": "Fifty moves claimed",
  agreement: "Draw agreed",
  resignation: "Resignation",
  timeout: "Time expired",
  "timeout-draw": "Time expired · no possible mate",
  disconnect: "Disconnection",
  interrupted: "Interrupted · no public result",
  unresolved: "Unresolved · no public result",
};
function syncAudio() {
  const id = room?.id || saveId || "",
    playable =
      state?.phase === "playing" &&
      !paused &&
      replayPly === null &&
      (!room || (connected && room.controller));
  setAudioState({
    game: "chess",
    runId: id,
    phase: playable
      ? "playing"
      : state?.phase === "finished"
        ? "complete"
        : state
          ? "paused"
          : "ready",
  });
  const previous = audioSnapshot;
  if (
    previous?.id === id &&
    state &&
    replayPly === null &&
    (!room || room.controller)
  ) {
    if (previous.phase !== "finished" && state.phase === "finished")
      playCue(
        resultCue(
          state.result?.winner,
          mode === "local" ? null : actor(),
          state.result?.reason,
        ),
        1,
        { id: `${id}:result` },
      );
    else if (state.log.length > previous.moves && state.phase === "playing") {
      const a = state.log.at(-1);
      if (a.type === "move")
        playCue(
          a.captured ? "capture" : a.san?.includes("+") ? "turn" : "move",
        );
    }
  }
  audioSnapshot = state
    ? { id, phase: state.phase, moves: state.log.length }
    : null;
}
function renderClock() {
  const activeClock = room?.clock || clock,
    now = room ? Date.now() + offset : Date.now();
  for (const [color, id] of [
    [1, "white"],
    [-1, "black"],
  ]) {
    const remaining = chessClockView(
      activeClock,
      color,
      now,
      state?.turn,
      !paused && state?.phase === "playing",
    ).remaining;
    const sec = Math.ceil(remaining / 1000);
    tx(
      `#chess-${id}-clock`,
      Number.isFinite(sec)
        ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`
        : "—",
    );
    $(`#chess-${id}-clock`).parentElement.classList.toggle(
      "is-turn",
      state?.turn === color && state?.phase === "playing",
    );
    if (
      !room &&
      state?.phase === "playing" &&
      !paused &&
      remaining === 0 &&
      color === state.turn
    ) {
      const result = timeoutVerdicts(state, { maxNodes: 120, maxMs: 30 })[
        color
      ];
      state = { ...state, phase: "finished", result };
      cancelAI();
      saveSoon();
      render();
      return;
    }
  }
  if (room?.status === "ready")
    tx(
      "#chess-ready-time",
      uiMsg("Ready within {0} seconds", [
        Math.max(
          0,
          Math.ceil(
            (Date.parse(room.ready_deadline) - Date.now() - offset) / 1000,
          ),
        ),
      ]),
    );
}
const activity = trackBoardGame("chess", $("#chess-result"));
let newActivity = false;
function render() {
  activity({
    state,
    room,
    saveId,
    identity,
    paused,
    mode,
    human,
    started: newActivity,
  });
  for (const node of root.querySelectorAll(
    "#chess-start,#chess-continue,#chess-create,#chess-find,#chess-join,.chess-entry select",
  ))
    node.disabled = busy;
  if (busy && !state && !room && !queued)
    tx("#chess-entry-status", uiMsg("Preparing game…"));
  root.dataset.chessPhase = state?.phase || "ready";
  const waiting =
    queued || (!!room && ["waiting", "ready"].includes(room.status));
  $("#chess-entry").hidden = !!state || waiting;
  $("#chess-room").hidden = !waiting;
  $("#chess-paused").hidden = !paused || !state || state.phase !== "playing";
  $("#chess-result").hidden =
    !state || state.phase !== "finished" || replayPly !== null;
  $("#chess-replay").hidden = replayPly === null;
  $("#chess-confirm").hidden = !candidate;
  $("#chess-confirm").disabled = !canPlay();
  for (const id of ["#chess-pause", "#chess-undo"])
    $(id).disabled = !state || !!room || busy || state.phase !== "playing";
  $("#chess-undo").disabled ||= !state?.log.some(
    (a) => a.type === "move" && (mode !== "ai" || a.actor === human),
  );
  $("#chess-resign").disabled =
    !state ||
    state.phase !== "playing" ||
    busy ||
    !!pending ||
    (!!room && (!connected || !room.controller));
  $("#chess-draw").disabled =
    !state ||
    !!pending ||
    busy ||
    (!!room && (!connected || !room.controller)) ||
    (state.phase === "finished" && !isUnresolved());
  $("#chess-takeover").hidden = !room || room.controller;
  $("#chess-retry").hidden =
    (!pending && !room && !thinking) || (!pending && connected && !!room);
  if (!room)
    $("#chess-retry").hidden =
      !state || state.phase !== "playing" || !$("#chess-status").dataset.retry;
  for (const [color, id] of [
    [1, "white"],
    [-1, "black"],
  ]) {
    const member = room?.members?.find((m) => m.color === color);
    tx(
      `#chess-${id}-name`,
      member?.nickname || uiFrom(color === 1 ? "White" : "Black"),
    );
  }
  tx(
    "#chess-turn",
    !state
      ? uiMsg("Ready preview")
      : state.phase === "finished"
        ? uiFrom(reasonText[state.result.reason] || "Game complete")
        : uiMsg("{0} to move{1}", [
            uiFrom(state.turn === 1 ? "White" : "Black"),
            new Chess(state.fen).inCheck() ? uiMsg(" · Check") : "",
          ]),
  );
  tx(
    "#chess-qualification",
    room
      ? uiFrom(
          room.ranked
            ? state?.phase === "finished" &&
              [1, -1, 0].includes(state.result?.winner) &&
              !["unresolved", "interrupted"].includes(state.result?.reason)
              ? "Verified"
              : "Ranked · online"
            : "Online practice",
        )
      : uiMsg("Local practice"),
  );
  tx("#chess-setup-summary", configLabel(setup()));
  tx("#chess-pause", uiFrom(paused ? "Continue" : "Pause"));
  $("#chess-draw-offer").hidden = !state?.offer;
  tx(
    "#chess-offer-text",
    state?.offer
      ? uiMsg("{0} offers a draw", [
          uiFrom(state.offer === 1 ? "White" : "Black"),
        ])
      : "",
  );
  const mayRespond =
    !!state?.offer &&
    (!room || (room.controller && connected)) &&
    (mode === "local" || state.offer !== actor());
  $("#chess-accept").hidden = $("#chess-decline").hidden = !mayRespond;
  if (waiting) {
    tx(
      "#chess-room-title",
      uiFrom(queued ? "Finding an opponent…" : "Waiting for your opponent"),
    );
    tx(
      "#chess-room-summary",
      configLabel(room?.config || queueConfig || setup()),
    );
    $("#chess-invite").hidden = !room || room.origin !== "invite";
    tx("#chess-invite-code", room?.code || "");
    $("#chess-ready").hidden = !room;
    $("#chess-ready").disabled =
      busy ||
      room?.status !== "ready" ||
      !room?.controller ||
      !!room?.members.find((m) => m.color === room.color)?.ready;
    const list = $("#chess-members");
    list.replaceChildren();
    for (const m of room?.members || []) {
      const row = document.createElement("div"),
        avatar = document.createElement("span"),
        label = document.createElement("span");
      row.className = "chess-member";
      avatar.className = "avatar-badge";
      paintAvatar(avatar, m);
      uiText(
        label,
        uiMsg("{0} · {1} · {2}", [
          m.nickname,
          uiFrom(m.color === 1 ? "White" : "Black"),
          uiFrom(m.ready ? "Ready" : "Not ready"),
        ]),
      );
      row.append(avatar, label);
      list.append(row);
    }
  }
  if (state?.phase === "finished") {
    $("#chess-promotion").close();
    if (!isUnresolved()) $("#chess-draw-dialog").close();
    const result = state.result;
    tx(
      "#chess-result-title",
      result.winner === null
        ? uiMsg("Unresolved / interrupted")
        : result.winner === 0
          ? uiMsg("Draw")
          : uiMsg("{0} wins", [
              uiFrom(result.winner === 1 ? "White" : "Black"),
            ]),
    );
    tx(
      "#chess-result-detail",
      uiFrom(reasonText[result.reason] || "Game complete"),
    );
    if (!endRead) {
      endRead = true;
      refreshRank();
    }
  }
  const history = $("#chess-moves"),
    signature =
      state?.log
        .filter((a) => a.type === "move")
        .map((a) => a.san)
        .join(" ") || "";
  if (history.dataset.signature !== signature) {
    history.dataset.signature = signature;
    history.replaceChildren();
    let i = 0;
    for (const a of state?.log || [])
      if (a.type === "move") {
        const n = document.createElement("span");
        n.textContent = `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ""}${a.san}`;
        history.append(n);
        i++;
      }
  }
  shell.update({
    state:
      !state && !waiting
        ? "ready"
        : state?.phase === "finished"
          ? "finished"
          : paused
            ? "paused"
            : "playing",
    label: configLabel(),
    session: room?.id || saveId,
  });
  draw();
  renderClock();
  syncAudio();
}
async function guarded(fn) {
  if (busy) return;
  busy = true;
  let failed = false;
  render();
  try {
    await fn();
  } catch (e) {
    failed = true;
    say(uiError(e));
    tx("#chess-entry-status", uiError(e));
    if ($("#chess-draw-dialog").open) tx("#chess-draw-status", uiError(e));
  } finally {
    busy = false;
    if (!failed && !state && !room && !queued) tx("#chess-entry-status", "");
    render();
  }
}
function saveSoon(immediate = false) {
  if (!state || room) return;
  clearTimeout(saveTimer);
  const expected = identity,
    id = saveId,
    savedClock = structuredClone(clock);
  if (savedClock && state.phase === "playing" && !paused) {
    savedClock.remaining[state.turn] = chessClockView(
      clock,
      state.turn,
      Date.now(),
      state.turn,
    ).remaining;
    savedClock.anchor = Date.now();
  }
  const data = {
    game: "chess",
    difficulty: state.config.clock,
    name: "Chess · " + state.config.clock,
    state: compactChess(state),
    mode,
    level,
    human,
    clock: savedClock,
    elapsed: 0,
    best: null,
  };
  const write = async () => {
    await store.put(data, id, expected);
    if (identity === expected) tx("#chess-sync", uiFrom(store.saveState()));
  };
  if (immediate) return write();
  saveTimer = setTimeout(
    () =>
      write().catch((e) => {
        if (identity === expected) say(uiError(e));
      }),
    500,
  );
}
async function refreshSaves() {
  const serial = ++savesSerial,
    expected = owner();
  await store.ready();
  await store.load(true);
  if (serial !== savesSerial || expected !== owner() || identity !== owner())
    return;
  const id = new URLSearchParams(location.search).get("save"),
    unfinished = store
      .rows()
      .filter(
        (record) => record.data.game === "chess" && !record.data.state.result,
      );
  const row = id
    ? await store.get(id)
    : unfinished.find(
        (record) => record.data.state.config.clock === setup().clock,
      ) || unfinished[0];
  if (serial !== savesSerial || expected !== owner()) return;
  savedRow = row?.data.game === "chess" ? row : null;
  $("#chess-continue").hidden = !savedRow;
  tx(
    "#chess-save-info",
    savedRow
      ? uiMsg("{0} · {1}", [
          savedRow.data.name,
          uiDate(savedRow.updated_at, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        ])
      : "",
  );
}
async function disconnect() {
  channelEpoch++;
  channelKey = "";
  const previous = channel;
  channel = null;
  if (previous) await api.client?.removeChannel(previous);
}
function startLocal(restore = false, imported = null) {
  newActivity = !restore && !imported;
  if (room && room.status === "playing")
    throw Error("Leave the online match before starting practice.");
  cancelAI();
  tx("#chess-entry-status", "");
  disconnect();
  room = null;
  queued = false;
  pending = null;
  connected = false;
  endRead = false;
  audioSnapshot = null;
  selected = candidate = null;
  replayPly = null;
  paused = false;
  if (restore) {
    const data = validateChessSave(savedRow.data);
    state = replayChess(data.state);
    mode = data.mode;
    level = data.level;
    human = data.human;
    saveId = savedRow.id;
    clock = structuredClone(
      data.clock || createChessClock(state.config.clock, Date.now()),
    );
    if (clock) clock.anchor = Date.now();
  } else {
    mode = $("#chess-mode").value === "local" ? "local" : "ai";
    level = Number($("#chess-level").value);
    human =
      Number($("#chess-side").value) ||
      (crypto.getRandomValues(new Uint32Array(1))[0] % 2 ? 1 : -1);
    state = imported || createChess(setup());
    saveId = crypto.randomUUID();
    clock = createChessClock(state.config.clock, Date.now());
  }
  flipped = mode === "ai" && human === -1;
  unlockAudio();
  say(uiMsg("Your move. Select a piece and destination."));
  saveSoon();
  render();
  maybeAI();
}
async function maybeAI() {
  if (
    !state ||
    state.phase !== "playing" ||
    mode !== "ai" ||
    room ||
    paused ||
    state.turn === human ||
    thinking ||
    disposed
  )
    return;
  const epoch = generation;
  thinking = true;
  render();
  try {
    engine ||= createChessAI((message) => {
      if (generation === epoch) say(uiFrom(message));
    });
    const move = await engine.move(
      state,
      level,
      chessClockView(clock, state.turn, Date.now(), state.turn).remaining,
    );
    if (generation !== epoch || paused || room || disposed) return;
    if (!move || move === "(none)")
      throw Error("Stockfish returned no legal move. Retry the engine.");
    const before = state,
      next = applyChess(state, { type: "move", uci: move });
    clock = chargeChessClock(clock, before.turn, Date.now(), true);
    state = next;
    say(uiMsg("Your turn."));
    delete $("#chess-status").dataset.retry;
    saveSoon();
  } catch (e) {
    if (generation === epoch) {
      say(uiError(e));
      $("#chess-status").dataset.retry = "true";
    }
  } finally {
    if (generation === epoch) {
      thinking = false;
      render();
    }
  }
}
async function rpc(action, body = {}) {
  if (!api.user) {
    api.openAuth(location.pathname + location.search);
    throw Error("Sign in to play online chess.");
  }
  const expected = owner();
  let timer, result;
  try {
    result = await Promise.race([
      api.client.functions.invoke(`board-match/${action}`, {
        body: { ...body, game: "chess", client_id: tab },
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error(
                "The online board could not be updated. Check your connection and retry.",
              ),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (expected !== owner()) throw Error("Account changed. Reopen this game.");
  let data = result.data;
  if (result.error?.context?.json)
    try {
      data = await result.error.context.json();
    } catch {}
  if (result.error || data?.error) {
    if (data?.snapshot) await acceptRoom(data.snapshot);
    throw Object.assign(
      Error(
        data?.error ||
          "The online board could not be updated. Check your connection and retry.",
      ),
      {
        status:
          result.error?.context?.status ||
          result.error?.status ||
          (data?.error ? 409 : undefined),
        code: data?.code,
      },
    );
  }
  return data;
}
async function subscribe() {
  const key = room ? `board:${room.id}:${room.channel_key}` : "";
  if (!key || key === channelKey) return;
  await disconnect();
  if (
    disposed ||
    key === channelKey ||
    key !== (room ? `board:${room.id}:${room.channel_key}` : "")
  )
    return;
  const epoch = channelEpoch;
  channelKey = key;
  channel = api.client
    .channel(key, { config: { private: true } })
    .on("broadcast", { event: "version" }, () => poll())
    .subscribe((status) => {
      if (epoch === channelEpoch && status === "SUBSCRIBED") poll();
    });
}
async function acceptRoom(next) {
  if (!next?.id) return;
  if (next.game !== "chess")
    throw Error("This room belongs to another board game.");
  if (room?.id === next.id && next.revision < room.revision) return;
  const newRoom = room?.id !== next.id,
    changed = newRoom || room.revision !== next.revision;
  cancelAI();
  room = next;
  mode = "online";
  queued = false;
  connected = true;
  offset = next.server_now - Date.now();
  paused = false;
  clock = null;
  state = ["waiting", "ready", "closed"].includes(room.status)
    ? null
    : room.state;
  saveId = null;
  flipped = next.color === -1;
  if (changed) {
    selected = candidate = null;
    replayPly = null;
    $("#chess-promotion").close();
  }
  const address = new URL(location.href);
  address.searchParams.set("match", room.id);
  history.replaceState(null, "", address);
  if (newRoom) {
    $("#chess-rank-clock").value = room.config.clock;
    refreshRank();
  }
  if (room.status === "closed") {
    room = null;
    state = null;
    await disconnect();
    say(uiMsg("The room closed before play started. No result was recorded."));
  } else await subscribe();
  render();
}
async function onlineStart(action) {
  if (!api.user) {
    api.openAuth(location.pathname + location.search);
    return;
  }
  if (
    state?.phase === "playing" &&
    !room &&
    !uiConfirm(uiMsg("Leave the current practice game and open online play?"))
  )
    return;
  const epoch = ++onlineEpoch;
  await ensureProfile();
  if (epoch !== onlineEpoch) return;
  const config = setup();
  if (config.clock === "none")
    throw Error("Choose a supported chess time control.");
  const data = await rpc(action, {
    config,
    rules_version: CHESS_VERSION,
    code: $("#chess-code").value,
    preferred_color: Number($("#chess-side").value),
  });
  if (epoch !== onlineEpoch) return;
  cancelAI();
  state = null;
  audioSnapshot = null;
  endRead = false;
  if (data.waiting) {
    queued = true;
    queueConfig = config;
    room = null;
    say(
      uiFrom(
        data.capacity
          ? "Waiting for a free online room and an opponent. You can cancel at any time."
          : "Waiting for an opponent with the same time control.",
      ),
    );
  } else await acceptRoom(data);
  render();
}
async function poll() {
  if (polling || disposed || !api.user || (!room && !queued)) return;
  polling = true;
  const epoch = onlineEpoch;
  try {
    const data = await rpc(
      queued ? "queue" : "get",
      queued
        ? { config: queueConfig, rules_version: CHESS_VERSION }
        : { match_id: room.id },
    );
    if (epoch === onlineEpoch && data.id) await acceptRoom(data);
  } catch (e) {
    if (epoch !== onlineEpoch) return;
    connected = false;
    say(uiError(e));
    render();
  } finally {
    polling = false;
  }
}
async function act(action, localActor) {
  if (!state || paused) return;
  if (room) {
    const epoch = onlineEpoch;
    if (!connected || !room.controller)
      throw Error("Reconnect or take control before playing.");
    pending ||= {
      match_id: room.id,
      expected_version: room.revision,
      request_id: crypto.randomUUID(),
      action,
    };
    try {
      const data = await rpc("command", pending);
      if (epoch !== onlineEpoch) return;
      pending = null;
      await acceptRoom(data);
    } catch (e) {
      if (
        Number.isInteger(e.status) &&
        e.status >= 400 &&
        e.status < 500 &&
        ![408, 429].includes(e.status)
      )
        pending = null;
      else connected = false;
      throw e;
    }
  } else {
    const before = state,
      next = applyChess(
        state,
        action,
        localActor ?? (mode === "ai" ? human : state.turn),
      );
    if (state.phase === "playing")
      clock = chargeChessClock(
        clock,
        before.turn,
        Date.now(),
        action.type === "move",
      );
    state = next;
    if (mode === "ai" && action.type === "offer-draw") {
      // 引擎不擔任判分者；本機人機的協議和棋需明確確認。
      if (uiConfirm(uiMsg("End this private computer game as a draw?")))
        state = applyChess(state, { type: "accept-draw" }, -human);
      else state = applyChess(state, { type: "decline-draw" }, -human);
    }
    saveSoon();
  }
  selected = candidate = null;
  render();
  maybeAI();
}
async function moveTo(from, to) {
  if (!canPlay()) return;
  const moves = chessMoves(state, from).filter((m) => m.to === to);
  if (!moves.length) throw Error("That move is not legal.");
  const promoting = moves.some((m) => m.promotion);
  if (promoting) {
    candidate = { from, to };
    $("#chess-promotion").showModal();
    return;
  }
  await act({ type: "move", uci: from + to });
}
function squareAt(event) {
  const r = board.getBoundingClientRect(),
    f = Math.floor(((event.clientX - r.left) / r.width) * 8),
    rank = Math.floor(((event.clientY - r.top) / r.height) * 8);
  return f < 0 || f > 7 || rank < 0 || rank > 7
    ? null
    : String.fromCharCode(97 + (flipped ? 7 - f : f)) +
        (flipped ? rank + 1 : 8 - rank);
}
async function choose(square, touch = false) {
  if (!canPlay() || !square) return;
  cursor = square;
  const c = new Chess(state.fen),
    piece = c.get(square);
  if (piece && piece.color === c.turn()) {
    selected = square;
    candidate = null;
    draw();
    return;
  }
  if (!selected) return;
  if (!chessMoves(state, selected).some((m) => m.to === square)) {
    say(uiMsg("That move is not legal."));
    return;
  }
  if (touch) {
    candidate = { from: selected, to: square };
    say(uiMsg("Preview selected. Confirm your move."));
    render();
  } else await moveTo(selected, square);
}
let pointer = null;
board.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || busy || !canPlay()) return;
  const square = squareAt(event);
  pointer = {
    square,
    x: event.clientX,
    y: event.clientY,
    type: event.pointerType,
  };
  board.focus({ preventScroll: true });
  board.setPointerCapture(event.pointerId);
  event.preventDefault();
});
board.addEventListener("pointerup", (event) => {
  if (!pointer) return;
  const p = pointer;
  pointer = null;
  const square = squareAt(event);
  if (
    Math.hypot(event.clientX - p.x, event.clientY - p.y) > 8 &&
    p.square &&
    new Chess(state.fen).get(p.square)?.color === new Chess(state.fen).turn()
  )
    selected = p.square;
  guarded(() => choose(square, p.type === "touch"));
});
board.addEventListener("pointercancel", () => {
  pointer = null;
});
board.addEventListener("keydown", (event) => {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
    return;
  const delta = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  }[event.key];
  if (delta) {
    event.preventDefault();
    const direction = flipped ? -1 : 1;
    cursor =
      String.fromCharCode(
        97 +
          Math.max(
            0,
            Math.min(7, cursor.charCodeAt(0) - 97 + delta[0] * direction),
          ),
      ) + Math.max(1, Math.min(8, Number(cursor[1]) + delta[1] * direction));
    draw();
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    guarded(() => choose(cursor));
  }
  if (event.key === "Escape" && !root.querySelector("dialog[open]")) {
    event.preventDefault();
    togglePause();
  }
});
board.addEventListener("focus", draw);
board.addEventListener("blur", draw);
function togglePause() {
  if (!state || room || state.phase !== "playing") return;
  if (!paused) {
    if (clock) clock = chargeChessClock(clock, state.turn, Date.now());
    paused = true;
    cancelAI();
  } else {
    paused = false;
    if (clock) clock.anchor = Date.now();
    unlockAudio();
    maybeAI();
  }
  render();
  saveSoon();
}
async function newSetup() {
  if (room && room.status === "playing")
    throw Error("Leave the online match before starting practice.");
  if (
    state?.phase === "playing" &&
    !uiConfirm(uiMsg("Start a new game? Your current progress remains saved."))
  )
    return;
  onlineEpoch++;
  if (queued) await rpc("cancel");
  if (room && ["waiting", "ready"].includes(room.status))
    await rpc("leave", { match_id: room.id });
  await saveSoon(true);
  cancelAI();
  disconnect();
  state = room = null;
  paused = false;
  replayPly = null;
  selected = candidate = null;
  endRead = false;
  audioSnapshot = null;
  shell.closeDialogs();
  queued = false;
  queueConfig = null;
  pending = null;
  connected = false;
  const address = new URL(location.href);
  address.searchParams.delete("match");
  address.searchParams.delete("code");
  address.searchParams.delete("save");
  history.replaceState(null, "", address);
  refreshSaves();
  render();
}
function exportPGN() {
  if (!state) throw Error("Start a game before exporting.");
  downloadText(
    exportChessPGN(state, {
      white:
        room?.members.find((m) => m.color === 1)?.nickname ||
        (mode === "ai" && human !== 1 ? `Stockfish Level ${level}` : "White"),
      black:
        room?.members.find((m) => m.color === -1)?.nickname ||
        (mode === "ai" && human !== -1 ? `Stockfish Level ${level}` : "Black"),
    }),
    "kensei-chess.pgn",
    "application/x-chess-pgn",
  );
}
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    say(uiMsg("Copied."));
  } catch {
    window.prompt(String(uiMsg("Copy this text:")), value);
  }
}
function click(id, fn) {
  $(id).onclick = () => guarded(fn);
}
click("#chess-start", () => startLocal());
click("#chess-continue", () => startLocal(true));
click("#chess-create", () => onlineStart("create"));
click("#chess-find", () => onlineStart("queue"));
click("#chess-join", () => onlineStart("join"));
click("#chess-ready", async () => {
  unlockAudio();
  await acceptRoom(await rpc("ready", { match_id: room.id }));
});
click("#chess-cancel", async () => {
  if (queued) await rpc("cancel");
  else if (room) await rpc("leave", { match_id: room.id });
  queued = false;
  room = null;
  state = null;
  await disconnect();
  render();
});
click("#chess-copy-invite", () =>
  copy(`${location.origin}${location.pathname}?code=${room.code}`),
);
click("#chess-pause", () => togglePause());
click("#chess-resume", () => togglePause());
click("#chess-undo", () => {
  if (!state || room || !state.log.some((a) => a.type === "move")) return;
  cancelAI();
  let count = state.log.length;
  do {
    count--;
  } while (
    count > 0 &&
    (state.log[count].type !== "move" ||
      (mode === "ai" && state.log[count].actor !== human))
  );
  state = replayChess(compactChess(state), count);
  selected = candidate = null;
  paused = false;
  if (clock) clock.anchor = Date.now();
  saveSoon();
  render();
  maybeAI();
});
click("#chess-flip", () => {
  flipped = !flipped;
  draw();
});
click(
  "#chess-confirm",
  () => candidate && moveTo(candidate.from, candidate.to),
);
for (const button of root.querySelectorAll("[data-promote]"))
  button.onclick = () =>
    guarded(async () => {
      if (!candidate || !canPlay()) return;
      const move = candidate.from + candidate.to + button.dataset.promote;
      $("#chess-promotion").close();
      await act({ type: "move", uci: move });
      board.focus({ preventScroll: true });
    });
$("#chess-promotion-cancel").onclick = () => {
  $("#chess-promotion").close();
  candidate = null;
  render();
};
click("#chess-draw", () => {
  tx("#chess-draw-status", "");
  $("#chess-draw-dialog").showModal();
});
$("#chess-draw-close").onclick = () => {
  $("#chess-draw-dialog").close();
  board.focus({ preventScroll: true });
};
for (const [id, action] of [
  ["#chess-offer", "offer-draw"],
  ["#chess-claim", "claim-draw"],
  ["#chess-accept", "accept-draw"],
  ["#chess-decline", "decline-draw"],
  ["#chess-dispute", "request-review"],
])
  click(id, async () => {
    if (
      action === "request-review" &&
      !uiConfirm(
        uiMsg(
          "Request an unresolved-position review? Both players must agree; no public result is awarded.",
        ),
      )
    )
      return;
    const who =
      mode === "local" && ["accept-draw", "decline-draw"].includes(action)
        ? -state.offer
        : undefined;
    await act({ type: action }, who);
    $("#chess-draw-dialog").close();
  });
click("#chess-claim-next", async () => {
  await act({
    type: "claim-draw",
    uci: $("#chess-claim-move").value.trim().toLowerCase(),
  });
  $("#chess-draw-dialog").close();
});
click("#chess-resign", async () => {
  if (uiConfirm(uiMsg("Resign this game?"))) await act({ type: "resign" });
});
click("#chess-leave", async () => {
  if (
    room &&
    uiConfirm(
      uiMsg("Leave this online match? A started game counts as resignation."),
    )
  ) {
    const result = await rpc("leave", { match_id: room.id });
    await acceptRoom(result);
    shell.closeDialogs();
  }
});
click("#chess-takeover", async () =>
  acceptRoom(await rpc("takeover", { match_id: room.id })),
);
click("#chess-retry", async () => {
  if (pending) {
    const data = await rpc("command", pending);
    pending = null;
    await acceptRoom(data);
  } else if (room) await poll();
  else {
    cancelAI();
    delete $("#chess-status").dataset.retry;
    await maybeAI();
  }
});
click("#chess-again", newSetup);
click("#chess-new-setup", newSetup);
click("#chess-export", exportPGN);
click("#chess-result-pgn", exportPGN);
click("#chess-fen-copy", () => copy(state?.fen || createChess(setup()).fen));
click("#chess-import", () => {
  if (room) throw Error("Leave the online match before starting practice.");
  if (
    state?.phase === "playing" &&
    !uiConfirm(uiMsg("Replace the current practice position?"))
  )
    return;
  const value = $("#chess-import-text").value.trim(),
    imported =
      value.startsWith("[") || /\d+\./.test(value)
        ? importChessPGN(value, setup())
        : createChess(setup(), value);
  startLocal(false, imported);
  shell.closeDialogs();
});
click("#chess-review", () => {
  replayPly = reviewSteps().length;
  $("#chess-ply").max = replayPly;
  $("#chess-ply").value = replayPly;
  render();
});
$("#chess-ply").oninput = () => {
  replayPly = Number($("#chess-ply").value);
  tx("#chess-ply-label", `${replayPly} / ${reviewSteps().length}`);
  draw();
};
click("#chess-close-review", () => {
  replayPly = null;
  render();
});
function rankRows(rows, target) {
  const list = $(target);
  list.replaceChildren();
  for (const r of rows) {
    const row = document.createElement("div"),
      rank = document.createElement("b"),
      avatar = document.createElement("span"),
      link = document.createElement("a"),
      stats = document.createElement("span"),
      detail = document.createElement("small");
    row.className = "chess-rank-row";
    rank.textContent = r.rank;
    avatar.className = "avatar-badge";
    paintAvatar(avatar, r);
    link.textContent = r.nickname;
    link.href = `${location.pathname.startsWith("/zh-hant/") ? "/zh-hant" : ""}/profile/?id=${r.public_id}`;
    stats.className = "rank-stats";
    uiText(
      stats,
      uiMsg("{0} wins · {1}", [
        r.wins,
        r.played ? `${(r.win_rate * 100).toFixed(1)}%` : "—",
      ]),
    );
    uiText(
      detail,
      uiMsg("{0} games · {1} losses · {2} draws", [
        r.played,
        r.losses,
        r.draws,
      ]),
    );
    stats.append(detail);
    if (r.achieved_at) {
      const date = document.createElement("small");
      uiText(date, uiDate(r.achieved_at, { dateStyle: "medium" }));
      stats.append(date);
    }
    row.append(rank, avatar, link, stats);
    list.append(row);
  }
}
async function refreshRank() {
  const serial = ++rankSerial;
  if (!api.client) return;
  const query = `${owner()}:${$("#chess-rank-clock").value}:${$("#chess-rank-sort").value}`;
  if (root.dataset.rankQuery !== query) {
    root.dataset.rankQuery = query;
    rankData = null;
    rankRows([], "#chess-rankings");
    rankRows([], "#chess-my-ranking");
    $("#chess-rank-more").hidden = true;
  }
  tx("#chess-rank-status", uiMsg("Loading records…"));
  try {
    const { data, error } = await api.client.rpc("get_chess_leaderboard", {
      time_control: $("#chess-rank-clock").value,
      sort_by: $("#chess-rank-sort").value,
      rules_version: CHESS_VERSION,
    });
    if (serial !== rankSerial) return;
    if (error) throw error;
    rankData = data;
    rankRows(data.top.slice(0, top50 ? 50 : 10), "#chess-rankings");
    rankRows(data.me ? [data.me] : [], "#chess-my-ranking");
    $("#chess-rank-more").hidden = data.top.length <= 10;
    tx(
      "#chess-rank-status",
      data.top.length
        ? ""
        : uiMsg(
            $("#chess-rank-sort").value === "rate"
              ? "Win-rate ranking requires 10 completed games."
              : "No verified chess matches yet.",
          ),
    );
    if (!data.me) tx("#chess-my-ranking", uiMsg("Your rank: —"));
  } catch {
    if (serial === rankSerial)
      tx(
        "#chess-rank-status",
        uiMsg("Records could not load. Use Refresh to retry."),
      );
  }
}
$("#chess-rank-refresh").onclick = refreshRank;
$("#chess-rank-more").onclick = () => {
  top50 = !top50;
  rankRows(rankData?.top.slice(0, top50 ? 50 : 10) || [], "#chess-rankings");
  tx("#chess-rank-more", uiMsg(top50 ? "Show Top 10" : "Show Top 50"));
};
$("#chess-rank-clock").onchange = $("#chess-rank-sort").onchange = refreshRank;
function setupChanged() {
  tx("#chess-entry-status", "");
  const online = $("#chess-mode").value === "online";
  if (online && $("#chess-clock").value === "none")
    $("#chess-clock").value = "10+5";
  $("#chess-clock option[value=none]").disabled = online;
  $("#chess-local-entry").hidden = online;
  $("#chess-online-entry").hidden = !online;
  $("#chess-level-label").hidden = $("#chess-mode").value !== "ai";
  $("#chess-side-label").hidden = $("#chess-mode").value === "local";
  if (online) {
    $("#chess-rank-clock").value = setup().clock;
    refreshRank();
  }
  refreshSaves().catch((e) => say(uiError(e)));
  render();
}
for (const select of root.querySelectorAll(".chess-entry select"))
  select.onchange = setupChanged;
async function authChanged() {
  if (identity !== owner()) {
    onlineEpoch++;
    stopAudio();
    cancelAI();
    clearTimeout(saveTimer);
    await disconnect();
    identity = owner();
    state = room = null;
    queued = false;
    pending = null;
    saveId = null;
    selected = candidate = null;
    replayPly = null;
    paused = false;
    audioSnapshot = null;
    for (const d of root.querySelectorAll("dialog[open]")) d.close();
  }
  await refreshSaves().catch((e) => say(uiError(e)));
  refreshRank();
  if (api.user && !state && !room) {
    const epoch = onlineEpoch;
    try {
      const requested = new URLSearchParams(location.search).get("match");
      const data = await rpc("get", requested ? { match_id: requested } : {});
      if (epoch === onlineEpoch && data.id) await acceptRoom(data);
    } catch (e) {
      say(uiError(e));
    }
  }
  if (
    new URLSearchParams(location.search).has("save") &&
    savedRow &&
    !state &&
    !room
  )
    startLocal(true);
  render();
}
store.subscribe(() => tx("#chess-sync", uiFrom(store.saveState())));
window.addEventListener("record-conflict", ({ detail }) => {
  if (detail.kind === "game" && detail.from === saveId) saveId = detail.to;
});
window.addEventListener("workspace-ready", authChanged);
window.addEventListener("locale-change", () => {
  render();
  refreshRank();
});
window.addEventListener("online", poll);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (!room && state?.phase === "playing" && !paused) togglePause();
  } else poll();
});
window.addEventListener("pagehide", () => {
  if (state && !room) saveSoon(true)?.catch(() => {});
  disposed = true;
  cancelAI();
  clearTimeout(saveTimer);
  disconnect();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    disposed = false;
    channelKey = "";
    subscribe();
    poll();
  }
});
setInterval(() => {
  if (!disposed) renderClock();
}, 200);
setInterval(() => {
  if (!disposed) poll();
}, 5000);
const code = new URLSearchParams(location.search).get("code");
if (code) {
  $("#chess-code").value = code;
  $("#chess-mode").value = "online";
}
setupChanged();
if (api.ready) authChanged();
render();
root.dataset.ready = "true";
