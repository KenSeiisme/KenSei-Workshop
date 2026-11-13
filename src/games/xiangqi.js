import { api, downloadText } from "/tool-scripts/common.js";
import { ensureProfile, paintAvatar } from "/tool-scripts/profile-service.js";
import { createRecordStore } from "/tool-scripts/record-store.js";
import {
  createXiangqi,
  applyXiangqi,
  replayXiangqi,
  compactXiangqi,
  validateXiangqiSave,
  xiangqiSettings,
  XiangqiPosition as Xiangqi,
  XIANGQI_VERSION,
  XIANGQI_CLOCKS,
  xiangqiMoves,
  createXiangqiClock,
  chargeXiangqiClock,
  xiangqiClockView,
  exportXiangqiText,
  exportXiangqiJSON,
  importXiangqiRecord,
} from "./xiangqi-engine.js";
import { xiangqiTimeouts } from "./xiangqi-engine.js";
import { createXiangqiAI } from "./xiangqi-ai.js";
import { boardClientId } from "./board-identity.js";
import { trackBoardGame } from "./hub-activity.js";
import { mountPlayShell } from "./play-shell.js";
import {
  boardPodiumDetail,
  boardPodiumResult,
  paintPodium,
  podiumEntries,
} from "./rank-podium.js";
import { gameIcon } from "./presentation.js";
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
  root = $("[data-xiangqi]"),
  board = $("#game-board");
mountEffects();
mountAudio();
const shell = mountPlayShell(root),
  tab = await boardClientId(),
  store = createRecordStore("game", validateXiangqiSave, { syncDelay: 500 });
const owner = () => api.user?.id || "guest",
  tx = (id, value) => uiText($(id), value),
  say = (value) => tx("#xiangqi-status", value);
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
  cursor = "e3",
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
  p: "Soldier",
  n: "Horse",
  b: "Elephant",
  r: "Chariot",
  a: "Advisor",
  c: "Cannon",
  k: "General",
};
const glyphs = {
  w: { p: "兵", n: "馬", b: "相", r: "車", a: "仕", c: "炮", k: "帥" },
  b: { p: "卒", n: "馬", b: "象", r: "車", a: "士", c: "砲", k: "將" },
};
function pieceSvg(piece) {
  const label =
    $("#xiangqi-piece-labels")?.value === "letters"
      ? { p: "P", n: "H", b: "E", r: "R", a: "A", c: "C", k: "K" }[piece.type]
      : glyphs[piece.color][piece.type];
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="piece-rim" cx="24" cy="24" r="21"/><circle class="piece-inner" cx="24" cy="24" r="17.5"/><text x="24" y="25" text-anchor="middle" dominant-baseline="central" class="piece-letter ${piece.color === "w" ? "red" : "black"}">${label}</text></svg>`;
}
for (let rank = 9; rank >= 0; rank--)
  for (let f = 0; f < 9; f++) {
    const square = String.fromCharCode(97 + f) + rank,
      button = document.createElement("button");
    button.type = "button";
    button.id = `xiangqi-square-${square}`;
    button.className = `xiangqi-square ${(f + rank) % 2 === 0 ? "dark" : ""}`;
    button.dataset.square = square;
    button.tabIndex = -1;
    button.setAttribute("role", "gridcell");
    const icon = document.createElement("span");
    icon.className = "xiangqi-piece";
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
  return xiangqiSettings({ clock: $("#xiangqi-clock").value });
}
function configLabel(config = state?.config || room?.config || setup()) {
  return uiMsg("WXF 2018 · 9 × 10 · {0}", [
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
    return replayXiangqi(
      compactXiangqi(state),
      replayPly ? reviewSteps()[replayPly - 1] : 0,
    );
  return state || createXiangqi(setup());
}
const reviewSteps = () =>
  state?.log.flatMap((action, index) =>
    action.type === "move" ? [index + 1] : [],
  ) || [];
function draw() {
  const s = shownState(),
    c = new Xiangqi(s.fen),
    moves = selected ? c.moves({ square: selected, verbose: true }) : [],
    legal = new Set(moves.map((m) => m.to));
  const squares = [...cells.keys()];
  if (flipped) squares.reverse();
  for (let i = 0; i < squares.length; i++) {
    const square = squares[i],
      cell = cells.get(square),
      piece = c.get(square),
      code = piece
        ? piece.color + piece.type + $("#xiangqi-piece-labels").value
        : "";
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
            uiFrom(piece.color === "w" ? "Red" : "Black"),
            uiFrom(names[piece.type]),
          ])
        : uiMsg("{0} · empty", [square]),
    );
    cell.button.setAttribute("aria-selected", String(square === selected));
  }
  board.setAttribute("aria-activedescendant", `xiangqi-square-${cursor}`);
}
const reasonText = {
  checkmate: "Checkmate",
  "stalemate-loss": "No legal move · loss",
  "no-attacking-material": "Neither side has attacking pieces",
  "natural-limit": "Natural move limit · 100 qualifying plies",
  "lawful-repetition": "Lawful repetition",
  "perpetual-check": "Refused to vary perpetual check",
  "perpetual-chase": "Refused to vary perpetual chase",
  agreement: "Draw agreed",
  resignation: "Resignation",
  timeout: "Time expired",
  disconnect: "Disconnection",
  interrupted: "Interrupted · no public result",
  imported: "Result declared in imported record",
};
function syncAudio() {
  const id = room?.id || saveId || "",
    playable =
      state?.phase === "playing" &&
      !paused &&
      replayPly === null &&
      (!room || (connected && room.controller));
  setAudioState({
    game: "xiangqi",
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
          a.captured
            ? "capture"
            : new Xiangqi(state.fen).inCheck()
              ? "turn"
              : "move",
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
    [1, "red"],
    [-1, "black"],
  ]) {
    const remaining = xiangqiClockView(
      activeClock,
      color,
      now,
      state?.turn,
      !paused && state?.phase === "playing",
    ).remaining;
    const sec = Math.ceil(remaining / 1000);
    tx(
      `#xiangqi-${id}-clock`,
      Number.isFinite(sec)
        ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`
        : "—",
    );
    $(`#xiangqi-${id}-clock`).parentElement.classList.toggle(
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
      const result = xiangqiTimeouts(state)[color];
      state = { ...state, phase: "finished", result };
      cancelAI();
      saveSoon();
      render();
      return;
    }
  }
  if (room?.status === "ready")
    tx(
      "#xiangqi-ready-time",
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
const activity = trackBoardGame("xiangqi", $("#xiangqi-result"));
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
    "#xiangqi-start,#xiangqi-continue,#xiangqi-create,#xiangqi-find,#xiangqi-join,.xiangqi-entry select",
  ))
    node.disabled = busy;
  if (busy && !state && !room && !queued)
    tx("#xiangqi-entry-status", uiMsg("Preparing game…"));
  root.dataset.xiangqiPhase = state?.phase || "ready";
  const waiting =
    queued || (!!room && ["waiting", "ready"].includes(room.status));
  $("#xiangqi-entry").hidden = !!state || waiting;
  $("#xiangqi-room").hidden = !waiting;
  $("#xiangqi-paused").hidden = !paused || !state || state.phase !== "playing";
  $("#xiangqi-result").hidden =
    !state || state.phase !== "finished" || replayPly !== null;
  $("#xiangqi-replay").hidden = replayPly === null;
  $("#xiangqi-confirm").hidden = !candidate;
  $("#xiangqi-confirm").disabled = !canPlay();
  for (const id of ["#xiangqi-pause", "#xiangqi-undo"])
    $(id).disabled = !state || !!room || busy || state.phase !== "playing";
  $("#xiangqi-undo").disabled ||= !state?.log.some(
    (a) => a.type === "move" && (mode !== "ai" || a.actor === human),
  );
  $("#xiangqi-resign").disabled =
    !state ||
    state.phase !== "playing" ||
    busy ||
    !!pending ||
    (!!room && (!connected || !room.controller));
  $("#xiangqi-draw").disabled =
    !state ||
    !!pending ||
    busy ||
    (!!room && (!connected || !room.controller)) ||
    (state.phase === "finished" && !isUnresolved());
  $("#xiangqi-takeover").hidden = !room || room.controller;
  $("#xiangqi-retry").hidden =
    (!pending && !room && !thinking) || (!pending && connected && !!room);
  if (!room)
    $("#xiangqi-retry").hidden =
      !state ||
      state.phase !== "playing" ||
      !$("#xiangqi-status").dataset.retry;
  for (const [color, id] of [
    [1, "red"],
    [-1, "black"],
  ]) {
    const member = room?.members?.find((m) => m.color === color);
    tx(
      `#xiangqi-${id}-name`,
      member?.nickname || uiFrom(color === 1 ? "Red" : "Black"),
    );
  }
  tx(
    "#xiangqi-turn",
    !state
      ? uiMsg("Ready preview")
      : state.phase === "finished"
        ? uiFrom(reasonText[state.result.reason] || "Game complete")
        : uiMsg("{0} to move{1}", [
            uiFrom(state.turn === 1 ? "Red" : "Black"),
            new Xiangqi(state.fen).inCheck() ? uiMsg(" · Check") : "",
          ]),
  );
  tx(
    "#xiangqi-qualification",
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
  tx("#xiangqi-setup-summary", configLabel(setup()));
  $("#xiangqi-warning").hidden = !state?.warning;
  tx(
    "#xiangqi-warning",
    state?.warning
      ? uiMsg(
          "{0} must vary this repetition. Repeating the prohibited move loses the game.",
          [uiFrom(state.warning.offender === 1 ? "Red" : "Black")],
        )
      : "",
  );
  tx("#xiangqi-pause", uiFrom(paused ? "Continue" : "Pause"));
  $("#xiangqi-draw-offer").hidden = !state?.offer;
  tx(
    "#xiangqi-offer-text",
    state?.offer
      ? uiMsg("{0} offers a draw", [
          uiFrom(state.offer === 1 ? "Red" : "Black"),
        ])
      : "",
  );
  const mayRespond =
    !!state?.offer &&
    (!room || (room.controller && connected)) &&
    (mode === "local" || state.offer !== actor());
  $("#xiangqi-accept").hidden = $("#xiangqi-decline").hidden = !mayRespond;
  if (waiting) {
    tx(
      "#xiangqi-room-title",
      uiFrom(queued ? "Finding an opponent…" : "Waiting for your opponent"),
    );
    tx(
      "#xiangqi-room-summary",
      configLabel(room?.config || queueConfig || setup()),
    );
    $("#xiangqi-invite").hidden = !room || room.origin !== "invite";
    tx("#xiangqi-invite-code", room?.code || "");
    $("#xiangqi-ready").hidden = !room;
    $("#xiangqi-ready").disabled =
      busy ||
      room?.status !== "ready" ||
      !room?.controller ||
      !!room?.members.find((m) => m.color === room.color)?.ready;
    const list = $("#xiangqi-members");
    list.replaceChildren();
    for (const m of room?.members || []) {
      const row = document.createElement("div"),
        avatar = document.createElement("span"),
        label = document.createElement("span");
      row.className = "xiangqi-member";
      avatar.className = "avatar-badge";
      paintAvatar(avatar, m);
      uiText(
        label,
        uiMsg("{0} · {1} · {2}", [
          m.nickname,
          uiFrom(m.color === 1 ? "Red" : "Black"),
          uiFrom(m.ready ? "Ready" : "Not ready"),
        ]),
      );
      row.append(avatar, label);
      list.append(row);
    }
  }
  if (state?.phase === "finished") {
    if (!isUnresolved()) $("#xiangqi-draw-dialog").close();
    const result = state.result;
    tx(
      "#xiangqi-result-title",
      result.winner === null
        ? uiMsg("Unresolved / interrupted")
        : result.winner === 0
          ? uiMsg("Draw")
          : uiMsg("{0} wins", [uiFrom(result.winner === 1 ? "Red" : "Black")]),
    );
    tx(
      "#xiangqi-result-detail",
      uiFrom(reasonText[result.reason] || "Game complete"),
    );
    if (!endRead) {
      endRead = true;
      refreshRank();
    }
  }
  const history = $("#xiangqi-moves"),
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
    tx("#xiangqi-entry-status", uiError(e));
    if ($("#xiangqi-draw-dialog").open) tx("#xiangqi-draw-status", uiError(e));
  } finally {
    busy = false;
    if (!failed && !state && !room && !queued) tx("#xiangqi-entry-status", "");
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
    savedClock.remaining[state.turn] = xiangqiClockView(
      clock,
      state.turn,
      Date.now(),
      state.turn,
    ).remaining;
    savedClock.anchor = Date.now();
  }
  const data = {
    game: "xiangqi",
    difficulty: state.config.clock,
    name: "Xiangqi · " + state.config.clock,
    state: compactXiangqi(state),
    mode,
    level,
    human,
    clock: savedClock,
    elapsed: 0,
    best: null,
  };
  const write = async () => {
    await store.put(data, id, expected);
    if (identity === expected) tx("#xiangqi-sync", uiFrom(store.saveState()));
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
        (record) => record.data.game === "xiangqi" && !record.data.state.result,
      );
  const row = id
    ? await store.get(id)
    : unfinished.find(
        (record) => record.data.state.config.clock === setup().clock,
      ) || unfinished[0];
  if (serial !== savesSerial || expected !== owner()) return;
  savedRow = row?.data.game === "xiangqi" ? row : null;
  $("#xiangqi-continue").hidden = !savedRow;
  tx(
    "#xiangqi-save-info",
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
  tx("#xiangqi-entry-status", "");
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
    const data = validateXiangqiSave(savedRow.data);
    state = replayXiangqi(data.state);
    mode = data.mode;
    level = data.level;
    human = data.human;
    saveId = savedRow.id;
    clock = structuredClone(
      data.clock || createXiangqiClock(state.config.clock, Date.now()),
    );
    if (clock) clock.anchor = Date.now();
  } else {
    mode = $("#xiangqi-mode").value === "local" ? "local" : "ai";
    level = Number($("#xiangqi-level").value);
    human =
      Number($("#xiangqi-side").value) ||
      (crypto.getRandomValues(new Uint32Array(1))[0] % 2 ? 1 : -1);
    state = imported || createXiangqi(setup());
    saveId = crypto.randomUUID();
    clock = createXiangqiClock(state.config.clock, Date.now());
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
    engine ||= createXiangqiAI((message) => {
      if (generation === epoch) say(uiFrom(message));
    });
    const move = await engine.move(
      state,
      level,
      xiangqiClockView(clock, state.turn, Date.now(), state.turn).remaining,
    );
    if (generation !== epoch || paused || room || disposed) return;
    if (!move || move === "(none)")
      throw Error("Fairy-Stockfish returned no legal move. Retry the engine.");
    const before = state,
      next = applyXiangqi(state, { type: "move", uci: move });
    clock = chargeXiangqiClock(clock, before.turn, Date.now(), true);
    state = next;
    say(uiMsg("Your turn."));
    delete $("#xiangqi-status").dataset.retry;
    saveSoon();
  } catch (e) {
    if (generation === epoch) {
      say(uiError(e));
      $("#xiangqi-status").dataset.retry = "true";
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
    throw Error("Sign in to play online xiangqi.");
  }
  const expected = owner();
  let timer, result;
  try {
    result = await Promise.race([
      api.client.functions.invoke(`board-match/${action}`, {
        body: { ...body, game: "xiangqi", client_id: tab },
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
  if (next.game !== "xiangqi")
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
  }
  const address = new URL(location.href);
  address.searchParams.set("match", room.id);
  history.replaceState(null, "", address);
  if (newRoom) {
    $("#xiangqi-rank-clock").value = room.config.clock;
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
    throw Error("Choose a supported xiangqi time control.");
  const data = await rpc(action, {
    config,
    rules_version: XIANGQI_VERSION,
    code: $("#xiangqi-code").value,
    preferred_color: Number($("#xiangqi-side").value),
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
        ? { config: queueConfig, rules_version: XIANGQI_VERSION }
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
      next = applyXiangqi(
        state,
        action,
        localActor ?? (mode === "ai" ? human : state.turn),
      );
    if (state.phase === "playing")
      clock = chargeXiangqiClock(
        clock,
        before.turn,
        Date.now(),
        action.type === "move",
      );
    state = next;
    if (mode === "ai" && action.type === "offer-draw") {
      // 引擎不擔任判分者；本機人機的協議和棋需明確確認。
      if (uiConfirm(uiMsg("End this private computer game as a draw?")))
        state = applyXiangqi(state, { type: "accept-draw" }, -human);
      else state = applyXiangqi(state, { type: "decline-draw" }, -human);
    }
    saveSoon();
  }
  selected = candidate = null;
  render();
  maybeAI();
}
async function moveTo(from, to) {
  if (!canPlay()) return;
  const moves = xiangqiMoves(state, from).filter((m) => m.to === to);
  if (!moves.length) throw Error("That move is not legal.");
  await act({ type: "move", uci: from + to });
}
function squareAt(event) {
  const r = board.getBoundingClientRect(),
    f = Math.floor(((event.clientX - r.left) / r.width) * 9),
    rank = Math.floor(((event.clientY - r.top) / r.height) * 10);
  return f < 0 || f > 8 || rank < 0 || rank > 9
    ? null
    : String.fromCharCode(97 + (flipped ? 8 - f : f)) +
        (flipped ? rank : 9 - rank);
}
async function choose(square, touch = false) {
  if (!canPlay() || !square) return;
  cursor = square;
  const c = new Xiangqi(state.fen),
    piece = c.get(square);
  if (piece && piece.color === c.turn()) {
    selected = square;
    candidate = null;
    draw();
    return;
  }
  if (!selected) return;
  if (!xiangqiMoves(state, selected).some((m) => m.to === square)) {
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
    new Xiangqi(state.fen).get(p.square)?.color ===
      new Xiangqi(state.fen).turn()
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
            Math.min(8, cursor.charCodeAt(0) - 97 + delta[0] * direction),
          ),
      ) + Math.max(0, Math.min(9, Number(cursor[1]) + delta[1] * direction));
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
    if (clock) clock = chargeXiangqiClock(clock, state.turn, Date.now());
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
function exportICCS() {
  if (!state) throw Error("Start a game before exporting.");
  downloadText(
    exportXiangqiText(state, {
      red:
        room?.members.find((m) => m.color === 1)?.nickname ||
        (mode === "ai" && human !== 1
          ? `Fairy-Stockfish Level ${level}`
          : "Red"),
      black:
        room?.members.find((m) => m.color === -1)?.nickname ||
        (mode === "ai" && human !== -1
          ? `Fairy-Stockfish Level ${level}`
          : "Black"),
    }),
    "kensei-xiangqi.txt",
    "text/plain;charset=utf-8",
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
  const node = $(id);
  if (node) node.onclick = () => guarded(fn);
}
click("#xiangqi-start", () => startLocal());
click("#xiangqi-continue", () => startLocal(true));
click("#xiangqi-create", () => onlineStart("create"));
click("#xiangqi-find", () => onlineStart("queue"));
click("#xiangqi-join", () => onlineStart("join"));
click("#xiangqi-ready", async () => {
  unlockAudio();
  await acceptRoom(await rpc("ready", { match_id: room.id }));
});
click("#xiangqi-cancel", async () => {
  if (queued) await rpc("cancel");
  else if (room) await rpc("leave", { match_id: room.id });
  queued = false;
  room = null;
  state = null;
  await disconnect();
  render();
});
click("#xiangqi-copy-invite", () =>
  copy(`${location.origin}${location.pathname}?code=${room.code}`),
);
click("#xiangqi-pause", () => togglePause());
click("#xiangqi-resume", () => togglePause());
click("#xiangqi-undo", () => {
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
  state = replayXiangqi(compactXiangqi(state), count);
  selected = candidate = null;
  paused = false;
  if (clock) clock.anchor = Date.now();
  saveSoon();
  render();
  maybeAI();
});
click("#xiangqi-flip", () => {
  flipped = !flipped;
  draw();
});
click(
  "#xiangqi-confirm",
  () => candidate && moveTo(candidate.from, candidate.to),
);
click("#xiangqi-draw", () => {
  tx("#xiangqi-draw-status", "");
  $("#xiangqi-draw-dialog").showModal();
});
$("#xiangqi-draw-close").onclick = () => {
  $("#xiangqi-draw-dialog").close();
  board.focus({ preventScroll: true });
};
for (const [id, action] of [
  ["#xiangqi-offer", "offer-draw"],
  ["#xiangqi-accept", "accept-draw"],
  ["#xiangqi-decline", "decline-draw"],
])
  click(id, async () => {
    const who =
      mode === "local" && ["accept-draw", "decline-draw"].includes(action)
        ? -state.offer
        : undefined;
    await act({ type: action }, who);
    $("#xiangqi-draw-dialog").close();
  });
click("#xiangqi-resign", async () => {
  if (uiConfirm(uiMsg("Resign this game?"))) await act({ type: "resign" });
});
click("#xiangqi-leave", async () => {
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
click("#xiangqi-takeover", async () =>
  acceptRoom(await rpc("takeover", { match_id: room.id })),
);
click("#xiangqi-retry", async () => {
  if (pending) {
    const data = await rpc("command", pending);
    pending = null;
    await acceptRoom(data);
  } else if (room) await poll();
  else {
    cancelAI();
    delete $("#xiangqi-status").dataset.retry;
    await maybeAI();
  }
});
click("#xiangqi-again", newSetup);
click("#xiangqi-new-setup", newSetup);
click("#xiangqi-export", exportICCS);
click("#xiangqi-result-pgn", exportICCS);
click("#xiangqi-export-json", () => {
  if (!state) throw Error("Start a game before exporting.");
  downloadText(
    exportXiangqiJSON(state),
    "kensei-xiangqi.json",
    "application/json",
  );
});
click("#xiangqi-fen-copy", () =>
  copy(state?.fen || createXiangqi(setup()).fen),
);
click("#xiangqi-import", () => {
  if (room) throw Error("Leave the online match before starting practice.");
  if (
    state?.phase === "playing" &&
    !uiConfirm(uiMsg("Replace the current practice position?"))
  )
    return;
  const value = $("#xiangqi-import-text").value.trim(),
    imported = importXiangqiRecord(value, setup());
  startLocal(false, imported);
  shell.closeDialogs();
});
click("#xiangqi-review", () => {
  replayPly = reviewSteps().length;
  $("#xiangqi-ply").max = replayPly;
  $("#xiangqi-ply").value = replayPly;
  render();
});
$("#xiangqi-ply").oninput = () => {
  replayPly = Number($("#xiangqi-ply").value);
  tx("#xiangqi-ply-label", `${replayPly} / ${reviewSteps().length}`);
  draw();
};
click("#xiangqi-close-review", () => {
  replayPly = null;
  render();
});
function rankRows(rows, target) {
  const list = $(target);
  if (target === "#xiangqi-rankings") {
    const podium = new Set(podiumEntries(rows));
    paintPodium($("#xiangqi-podium"), rows, {
      result: boardPodiumResult,
      detail: boardPodiumDetail,
    });
    rows = rows.filter((row) => !podium.has(row));
    $("#xiangqi-rank-empty").hidden = rows.length > 0 || podium.size > 0;
  }
  list.replaceChildren();
  for (const r of rows) {
    const row = document.createElement("div"),
      rank = document.createElement("b"),
      avatar = document.createElement("span"),
      link = document.createElement("a"),
      stats = document.createElement("span"),
      detail = document.createElement("small");
    row.className = "xiangqi-rank-row";
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
  const query = `${owner()}:${$("#xiangqi-rank-clock").value}:${$("#xiangqi-rank-sort").value}`;
  if (root.dataset.rankQuery !== query) {
    root.dataset.rankQuery = query;
    rankData = null;
    rankRows([], "#xiangqi-rankings");
    rankRows([], "#xiangqi-my-ranking");
    $("#xiangqi-rank-more").hidden = true;
  }
  $("#xiangqi-rank-empty").hidden = true;
  tx("#xiangqi-rank-status", uiMsg("Loading records…"));
  try {
    const { data, error } = await api.client.rpc("get_xiangqi_leaderboard", {
      time_control: $("#xiangqi-rank-clock").value,
      sort_by: $("#xiangqi-rank-sort").value,
      rules_version: XIANGQI_VERSION,
    });
    if (serial !== rankSerial) return;
    if (error) throw error;
    rankData = data;
    rankRows(data.top.slice(0, top50 ? 50 : 10), "#xiangqi-rankings");
    const empty = $("#xiangqi-rank-empty");
    empty.hidden = data.top.length > 0;
    if (!empty.hidden) empty.innerHTML = gameIcon("xiangqi");
    rankRows(data.me ? [data.me] : [], "#xiangqi-my-ranking");
    $("#xiangqi-rank-more").hidden = data.top.length <= 10;
    tx(
      "#xiangqi-rank-status",
      data.top.length
        ? ""
        : uiMsg(
            $("#xiangqi-rank-sort").value === "rate"
              ? "Win-rate ranking requires 10 completed games."
              : "No verified xiangqi matches yet.",
          ),
    );
    if (!data.me) tx("#xiangqi-my-ranking", uiMsg("Your rank: —"));
  } catch {
    if (serial === rankSerial)
      tx(
        "#xiangqi-rank-status",
        uiMsg("Records could not load. Use Refresh to retry."),
      );
  }
}
$("#xiangqi-rank-refresh").onclick = refreshRank;
$("#xiangqi-rank-more").onclick = () => {
  top50 = !top50;
  rankRows(rankData?.top.slice(0, top50 ? 50 : 10) || [], "#xiangqi-rankings");
  tx("#xiangqi-rank-more", uiMsg(top50 ? "Show Top 10" : "Show Top 50"));
};
$("#xiangqi-rank-clock").onchange = $("#xiangqi-rank-sort").onchange =
  refreshRank;
function setupChanged() {
  tx("#xiangqi-entry-status", "");
  const online = $("#xiangqi-mode").value === "online";
  if (online && $("#xiangqi-clock").value === "none")
    $("#xiangqi-clock").value = "10+5";
  $("#xiangqi-clock option[value=none]").disabled = online;
  $("#xiangqi-local-entry").hidden = online;
  $("#xiangqi-online-entry").hidden = !online;
  $("#xiangqi-level-label").hidden = $("#xiangqi-mode").value !== "ai";
  $("#xiangqi-side-label").hidden = $("#xiangqi-mode").value === "local";
  if (online) {
    $("#xiangqi-rank-clock").value = setup().clock;
    refreshRank();
  }
  refreshSaves().catch((e) => say(uiError(e)));
  render();
}
for (const select of root.querySelectorAll(".xiangqi-entry select"))
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
store.subscribe(() => tx("#xiangqi-sync", uiFrom(store.saveState())));
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
function loadPieceLabels() {
  try {
    $("#xiangqi-piece-labels").value =
      localStorage.getItem(`kensei:xiangqi:labels:${owner()}`) === "letters"
        ? "letters"
        : "hanzi";
  } catch {
    $("#xiangqi-piece-labels").value = "hanzi";
  }
}
loadPieceLabels();
$("#xiangqi-piece-labels").onchange = () => {
  try {
    localStorage.setItem(
      `kensei:xiangqi:labels:${owner()}`,
      $("#xiangqi-piece-labels").value,
    );
  } catch {}
  draw();
};
window.addEventListener("workspace-ready", loadPieceLabels);
const code = new URLSearchParams(location.search).get("code");
if (code) {
  $("#xiangqi-code").value = code;
  $("#xiangqi-mode").value = "online";
}
setupChanged();
if (api.ready) authChanged();
render();
root.dataset.ready = "true";
