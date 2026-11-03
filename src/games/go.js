import { api, esc, downloadText } from "/tool-scripts/common.js";
import { ensureProfile, paintAvatar } from "/tool-scripts/profile-service.js";
import { createRecordStore } from "/tool-scripts/record-store.js";
import {
  createGo,
  applyGo,
  replayGo,
  compactGo,
  settings,
  standard,
  GO_RULES,
  GO_VERSION,
  scoreGo,
  groupAt,
  validateGoSave,
  exportSGF,
  createJapaneseConfirmation,
  applyJapaneseConfirmation,
} from "./go-engine.js";
import { formatGoClock } from "./go-clock.js";
import { mountPlayShell } from "./play-shell.js";
import { boardClientId } from "./board-identity.js";
import { mountEffects } from "./effects.js";
import { mountAudio, unlockAudio, playCue } from "./audio.js";
import {
  uiMsg,
  uiFrom,
  uiText,
  uiError,
  uiConfirm,
  uiDate,
  uiHtml,
} from "../site/ui.js";

const $ = (s) => document.querySelector(s),
  root = $("[data-go]"),
  canvas = $("#game-board"),
  ctx = canvas.getContext("2d");
mountEffects();
mountAudio();
const shell = mountPlayShell(root),
  store = createRecordStore("game", validateGoSave, { syncDelay: 500 });
const tab = await boardClientId(),
  owner = () => api.user?.id || "guest";
let identity = owner(),
  state = null,
  mode = "ai",
  level = 1,
  human = 1,
  paused = false,
  busy = false,
  room = null,
  queued = false,
  connected = false,
  peeking = false,
  peeks = 0;
let confirmation = null;
let selectedConfig = settings(),
  setupError = "";
let practiceClock = { 1: 0, "-1": 0 },
  practiceAnchor = performance.now();
function chargePracticeClock() {
  const now = performance.now();
  if (state && !room && !paused && state.phase === "playing")
    practiceClock[state.turn] += Math.max(0, now - practiceAnchor);
  practiceAnchor = now;
}
function practiceClockLabel(color) {
  if (!state) return "—";
  const ms =
      practiceClock[color] +
      (!room && !paused && state.phase === "playing" && state.turn === color
        ? Math.max(0, performance.now() - practiceAnchor)
        : 0),
    seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
const reviewSteps = () =>
  state?.log.flatMap((a, i) =>
    ["move", "pass"].includes(a.type) ? [i + 1] : [],
  ) || [];
let cursor = 40,
  candidate = null,
  saveId = null,
  saveTimer,
  savedRow = null,
  aiWorker = null,
  aiToken = 0,
  channel = null,
  channelKey = "",
  channelEpoch = 0,
  pollTimer = null,
  polling = false,
  pendingCommand = null,
  clockOffset = 0,
  replayPly = null,
  resultShown = false,
  rankedSerial = 0,
  rankData = null,
  top50 = false,
  closed = false,
  generation = 0;
const localActor = () =>
  room
    ? room.color
    : mode === "ai"
      ? human
      : Number($("#go-local-actor").value);
const readSetup = () =>
  settings({
    rule: $("#go-rule").value,
    size: $("#go-size").value,
    komi: $("#go-komi").value,
    handicap: $("#go-handicap").value,
    clock: $("#go-clock").value,
    training: $("#go-training").checked,
  });
const setup = () => selectedConfig;
const active = () => !!state && !["finished"].includes(state.phase);
const locked = () =>
  busy ||
  !!pendingCommand ||
  paused ||
  !state ||
  state.phase !== "playing" ||
  replayPly !== null ||
  (!!room && (!connected || !room.controller)) ||
  (mode === "ai" && !room && state.turn !== human);
const text = (id, message) => uiText($(id), message);
const say = (message) => text("#go-status", uiFrom(message));
function cancelAI() {
  aiToken++;
  aiWorker?.terminate();
  aiWorker = null;
}
function boardState() {
  if (confirmation) return confirmation;
  if (replayPly !== null && state)
    return replayGo(
      state.config,
      state.log.slice(0, replayPly ? reviewSteps()[replayPly - 1] : 0),
    );
  return state || createGo(room?.config || setup());
}
function draw() {
  const s = boardState(),
    n = s.config.size,
    dim = 760,
    pad = 44,
    step = (dim - 2 * pad) / (n - 1),
    training =
      s.config.training &&
      s.phase !== "finished" &&
      replayPly === null &&
      !peeking;
  ctx.clearRect(0, 0, dim, dim);
  const gradient = ctx.createLinearGradient(0, 0, dim, dim);
  gradient.addColorStop(0, "#36283f");
  gradient.addColorStop(1, "#221b2b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, dim, dim);
  ctx.strokeStyle = "#a997ae99";
  ctx.lineWidth = 1.25;
  for (let i = 0; i < n; i++) {
    const p = pad + i * step;
    ctx.beginPath();
    ctx.moveTo(pad, p);
    ctx.lineTo(dim - pad, p);
    ctx.moveTo(p, pad);
    ctx.lineTo(p, dim - pad);
    ctx.stroke();
  }
  const stars = n === 9 ? [2, 4, 6] : [3, (n - 1) / 2, n - 4];
  for (const x of stars)
    for (const y of stars) {
      if (n === 9 && (x === 4) !== (y === 4)) continue;
      ctx.fillStyle = "#c3abcf";
      ctx.beginPath();
      ctx.arc(pad + x * step, pad + y * step, 3.8, 0, 2 * Math.PI);
      ctx.fill();
    }
  ctx.font = `${n === 19 ? 14 : 17}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#c4adc9";
  const letters = "ABCDEFGHJKLMNOPQRST";
  for (let i = 0; i < n; i++) {
    ctx.fillText(letters[i], pad + i * step, 20);
    ctx.fillText(String(n - i), 18, pad + i * step);
  }
  const dead = new Set(s.proposal.dead),
    seki = new Set(s.proposal.seki);
  for (let i = 0; i < s.board.length; i++)
    if (s.board[i]) {
      const x = pad + (i % n) * step,
        y = pad + Math.floor(i / n) * step,
        radius = step * 0.45,
        color = s.board[i];
      ctx.globalAlpha = dead.has(i) ? 0.42 : 1;
      ctx.shadowColor = "#09040dbb";
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 4;
      const stone = ctx.createRadialGradient(
        x - radius * 0.3,
        y - radius * 0.4,
        1,
        x,
        y,
        radius,
      );
      stone.addColorStop(
        0,
        training ? "#d9bcf5" : color === 1 ? "#58515f" : "#fff9ff",
      );
      stone.addColorStop(
        1,
        training ? "#8b5eaf" : color === 1 ? "#100d15" : "#bcb0c8",
      );
      ctx.fillStyle = stone;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.globalAlpha = 1;
      if (dead.has(i) || seki.has(i)) {
        ctx.strokeStyle = dead.has(i) ? "#ff97af" : "#99e5d2";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          x - radius * 0.4,
          y - radius * 0.4,
          radius * 0.8,
          radius * 0.8,
        );
      }
      if (s.last === i && !training) {
        ctx.strokeStyle = color === 1 ? "#e8bbff" : "#8253a4";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.32, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  const point = candidate ?? cursor;
  if (state && !s.board[point] && replayPly === null && s.phase === "playing") {
    const x = pad + (point % n) * step,
      y = pad + Math.floor(point / n) * step;
    ctx.strokeStyle = "#f2ccff";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x - step * 0.3, y - step * 0.3, step * 0.6, step * 0.6);
  }
  const zoom = Number($("#go-zoom").value);
  canvas.style.width = canvas.style.height = `${zoom * 100}%`;
  const pointName = `${letters[cursor % n]}${n - Math.floor(cursor / n)}`;
  const pointState = s.board[cursor]
    ? training
      ? uiMsg("Stone")
      : uiMsg("{0} stone", [uiFrom(s.board[cursor] === 1 ? "Black" : "White")])
    : uiMsg("Empty intersection");
  text(
    "#go-cursor-note",
    state
      ? uiMsg("Selected point: {0} · {1}", [pointName, pointState])
      : uiMsg("Ready preview"),
  );
  // 训练时不把实际黑白归属写入悬停、ARIA 或历史文字。
  canvas.setAttribute(
    "aria-label",
    String(
      uiMsg("Go board · {0} × {0} · selected {1} · {2}", [
        n,
        pointName,
        pointState,
      ]),
    ),
  );
}
function summary(config) {
  return `${String(uiFrom(GO_RULES[config.rule].name))} · ${config.size} × ${config.size} · ${config.komi} ${String(uiMsg("points"))}${config.handicap ? ` · ${String(uiMsg("Handicap"))} ${config.handicap}` : ""}${config.training ? " · " + String(uiMsg("Single-color memory")) : ""}`;
}
function clockLabel(color) {
  if (!room?.clock) return "—";
  return formatGoClock(
    room.clock,
    color,
    Date.now() + clockOffset,
    room.status === "playing" && state.turn === color,
    state.result?.reason === "timeout" && state.turn === color,
  );
}
function renderClock() {
  for (const color of [1, -1])
    text(
      color === 1 ? "#go-black-clock" : "#go-white-clock",
      room ? clockLabel(color) : practiceClockLabel(color),
    );
  if (room?.ready_deadline) {
    const left = Math.max(
      0,
      Math.ceil(
        (Date.parse(room.ready_deadline) - Date.now() - clockOffset) / 1000,
      ),
    );
    text(
      "#go-ready-time",
      room.status === "ready" ? uiMsg("Ready within {0} seconds", [left]) : "",
    );
  }
}
function render() {
  const phase = state?.phase,
    training = state?.config.training && phase !== "finished",
    online = !!room;
  for (const id of ["#go-start", "#go-create", "#go-find"])
    $(id).disabled = busy || !!setupError;
  $("#go-join").disabled = busy;
  $("#go-continue").disabled = busy;
  root.dataset.goPhase = phase || "ready";
  $("#go-entry").hidden = !!state || queued || !!room;
  const waitingRoom = room && ["waiting", "ready"].includes(room.status);
  $("#go-room-panel").hidden = !waitingRoom && !queued;
  $("#go-result").hidden = phase !== "finished" || replayPly !== null;
  $("#go-scoring").hidden = !["scoring", "disputed"].includes(phase);
  $("#go-local-actor-label").hidden = !!room || mode === "ai";
  $("#go-no-result").hidden = !state?.cycle;
  $("#go-confirmation").hidden =
    state?.config.rule !== "japanese" ||
    !["scoring", "disputed"].includes(phase);
  $("#go-confirmation-open").hidden = !!confirmation;
  for (const id of [
    "#go-confirmation-close",
    "#go-confirmation-pass",
    "#go-confirmation-ko-label",
  ])
    $(id).hidden = !confirmation;
  $("#go-both-lose").hidden =
    state?.config.rule !== "japanese" || phase !== "disputed";
  if (confirmation) {
    const ko = $("#go-confirmation-ko");
    ko.replaceChildren();
    for (const index of confirmation.blockedKo[confirmation.turn])
      ko.add(new Option(String(index + 1), String(index)));
    $("#go-confirmation-pass").disabled = !ko.options.length;
  }
  $("#go-cycle-review").hidden =
    !state || state.config.rule !== "chinese" || phase !== "playing";
  $("#go-pass").disabled = locked();
  $("#go-resign").disabled =
    !active() ||
    busy ||
    !!pendingCommand ||
    (online && (!connected || !room.controller));
  $("#go-pause").hidden = online;
  $("#go-undo").hidden = online;
  $("#go-pause").disabled = !active() || busy;
  $("#go-undo").disabled = !state?.log.length || busy || phase === "finished";
  text("#go-pause", paused ? uiMsg("Continue") : uiMsg("Pause"));
  $("#go-peek").hidden = !training;
  $("#go-peek").disabled = busy || (!!room && (!connected || !room.controller));
  text(
    "#go-peek",
    uiMsg("Hold to reveal colors · {0} peeks", [
      room ? state?.peeks?.[room.color] || 0 : peeks,
    ]),
  );
  $("#go-takeover").hidden = !room || room.controller;
  $("#go-retry").hidden = !room || (connected && !pendingCommand);
  $("#go-confirm-place").hidden = candidate === null || locked();
  $("#go-score-confirm").disabled =
    phase !== "scoring" || busy || (!!room && (!connected || !room.controller));
  $("#go-score-dispute").disabled = phase !== "scoring" || busy;
  text(
    "#go-turn",
    !state
      ? uiMsg("Ready preview")
      : paused
        ? uiMsg("Paused")
        : phase === "playing"
          ? uiMsg("{0} to move", [uiFrom(state.turn === 1 ? "Black" : "White")])
          : uiFrom(
              phase === "scoring"
                ? "Scoring review"
                : phase === "disputed"
                  ? "Unresolved dispute"
                  : "Game complete",
            ),
  );
  text(
    "#go-qualification",
    room
      ? room.started_at
        ? phase === "finished" &&
          (!room.ranked ||
            ["no-result", "unresolved", "interrupted"].includes(
              state.result?.reason,
            ))
          ? uiMsg("Completed · not in public records")
          : room.ranked
            ? phase === "finished" && room.status === "finished"
              ? uiMsg("Verified online result")
              : uiMsg("Online · standard")
            : uiMsg("Online · not ranked")
        : uiMsg("Invitation · waiting")
      : uiMsg(training ? "Memory training · private" : "Local practice"),
  );
  for (const color of [1, -1]) {
    const name = room?.members?.find((m) => m.color === color)?.nickname;
    text(
      color === 1 ? "#go-black-name" : "#go-white-name",
      name || uiFrom(color === 1 ? "Black" : "White"),
    );
    text(
      color === 1 ? "#go-black-captures" : "#go-white-captures",
      uiMsg("{0} captured", [state?.captures[color] || 0]),
    );
  }
  if (waitingRoom || queued) {
    text(
      "#go-room-title",
      queued
        ? uiMsg("Waiting for an opponent")
        : uiMsg("Room {0}", [room.code]),
    );
    const config = room?.config || setup();
    text(
      "#go-room-summary",
      uiMsg("{0} · {1}", [
        summary(config),
        uiFrom(
          config.clock === 9
            ? "5 min + 3 × 20 sec"
            : config.clock === 13
              ? "10 min + 3 × 30 sec"
              : "20 min + 5 × 30 sec",
        ),
      ]),
    );
    $("#go-invite").hidden = !room || room.origin !== "invite";
    text("#go-invite-code", room?.code || "");
    $("#go-ready").hidden = !room;
    $("#go-ready").disabled =
      busy ||
      room?.status !== "ready" ||
      !room?.controller ||
      !!room?.members?.find((m) => m.color === room.color)?.ready;
    $("#go-training-consent").hidden = !room?.config.training;
    const list = $("#go-members");
    list.replaceChildren();
    for (const m of room?.members || []) {
      const div = document.createElement("div");
      div.className = "go-member";
      const avatar = document.createElement("span");
      avatar.className = "avatar-badge";
      paintAvatar(avatar, m);
      const label = document.createElement("span");
      label.textContent = `${m.nickname} · ${String(uiFrom(m.ready ? "Ready" : "Not ready"))}`;
      div.append(avatar, label);
      list.append(div);
    }
  }
  if (["scoring", "disputed"].includes(phase)) {
    const score = scoreGo(state);
    $("#go-score-detail").innerHTML =
      uiHtml`<div class="go-score-grid"><div>${uiMsg("Black")}: <b>${score.black}</b><p>${uiMsg("Territory: {0} · Stones: {1} · Prisoners: {2}", [score.territory[1], score.stones[1], score.prisoners[1]])}</p></div><div>${uiMsg("White")}: <b>${score.white}</b><p>${uiMsg("Territory: {0} · Stones: {1} · Prisoners: {2}", [score.territory[-1], score.stones[-1], score.prisoners[-1]])}</p><p>${uiMsg("Komi: {0} · Handicap compensation: {1}", [score.komi, score.handicapCompensation])}</p></div></div><p>${uiMsg("{0} / 2 confirmations", [state.proposal.confirmations.length])}</p>`;
  }
  if (phase === "finished") {
    const result = state.result;
    text(
      "#go-result-title",
      result.reason === "both-lose"
        ? uiMsg("Both players lose")
        : result.winner === null
          ? uiMsg("No result")
          : result.winner === 0
            ? uiMsg("Draw")
            : uiMsg("{0} wins", [
                uiFrom(result.winner === 1 ? "Black" : "White"),
              ]),
    );
    text(
      "#go-result-detail",
      uiMsg("{0}{1}", [
        uiFrom(
          {
            agreement: "Agreed score",
            resignation: "Resignation",
            timeout: "Time expired",
            disconnect: "Disconnection",
            interrupted: "Interrupted · no public result",
            "no-result": "Cycle · no result",
          }[result.reason] || "Game complete",
        ),
        result.reason === "agreement"
          ? ` · ${result.black} / ${result.white}`
          : "",
      ]),
    );
    if (!resultShown) {
      resultShown = true;
      playCue(result.winner === null ? "end" : "win");
      refreshRank();
    }
  }
  shell.update({
    state:
      !state && !room && !queued
        ? "ready"
        : phase === "finished"
          ? "finished"
          : paused
            ? "paused"
            : "playing",
    label: summary(state?.config || room?.config || setup()),
    session: room?.id || saveId,
  });
  renderClock();
  draw();
}
async function guarded(fn) {
  if (busy) return;
  busy = true;
  render();
  try {
    await fn();
  } catch (e) {
    say(uiError(e));
  } finally {
    busy = false;
    render();
  }
}
function scheduleSave() {
  if (!state || room) return;
  chargePracticeClock();
  clearTimeout(saveTimer);
  const snapshot = structuredClone(state),
    expectedOwner = identity,
    id = saveId,
    p = peeks,
    m = mode,
    l = level,
    h = human,
    timing = { ...practiceClock };
  saveTimer = setTimeout(async () => {
    try {
      await store.put(
        {
          game: "go",
          difficulty: `${snapshot.config.rule}-${snapshot.config.size}`,
          name: `Go · ${summary(snapshot.config)}`,
          state: compactGo(snapshot),
          mode: m,
          level: l,
          human: h,
          peeks: p,
          elapsed: timing[1] + timing[-1],
          practice_clock: timing,
          best: null,
        },
        id,
        expectedOwner,
      );
      if (expectedOwner === identity) {
        text("#go-save-info", uiFrom(store.saveState()));
        refreshPrivateRecords();
      }
    } catch (e) {
      if (expectedOwner === identity) say(uiError(e));
    }
  }, 500);
}
async function refreshSaves() {
  await store.ready();
  await store.load(true);
  if (identity !== owner()) return;
  const c = setup(),
    id = new URLSearchParams(location.search).get("save");
  savedRow = id
    ? await store.get(id)
    : store
        .rows()
        .find(
          (r) =>
            r.data.game === "go" &&
            r.data.state.config.rule === c.rule &&
            r.data.state.config.size === c.size &&
            r.data.state.status === "playing",
        );
  $("#go-continue").hidden = !savedRow;
  text(
    "#go-save-info",
    savedRow
      ? uiMsg("{0} · {1}", [
          savedRow.data.name,
          uiDate(new Date(savedRow.updated_at), {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        ])
      : "",
  );
  refreshPrivateRecords();
}
function refreshPrivateRecords() {
  const rows = store.rows().filter((r) => r.data.game === "go"),
    finished = rows.filter((r) => r.data.state.status !== "playing");
  text(
    "#go-practice-records",
    uiMsg(
      "Local: {0} · Computer: {1} · Memory training: {2}. These are private completed records, not verified online wins.",
      [
        finished.filter(
          (r) => r.data.mode === "local" && !r.data.state.config.training,
        ).length,
        finished.filter(
          (r) => r.data.mode === "ai" && !r.data.state.config.training,
        ).length,
        finished.filter((r) => r.data.state.config.training).length,
      ],
    ),
  );
}
function startLocal(restore = false) {
  confirmation = null;
  cancelAI();
  room = null;
  resultShown = false;
  candidate = null;
  replayPly = null;
  paused = false;
  peeking = false;
  if (restore && savedRow) {
    const d = validateGoSave(savedRow.data);
    state = replayGo(d.state.config, d.state.log);
    mode = d.mode;
    level = d.level;
    human = d.human;
    peeks = d.peeks;
    practiceClock = { ...d.practice_clock };
    saveId = savedRow.id;
  } else {
    state = createGo(setup());
    mode = $("#go-mode").value === "local" ? "local" : "ai";
    level = Number($("#go-level").value);
    human = Number($("#go-human").value);
    peeks = 0;
    practiceClock = { 1: 0, "-1": 0 };
    saveId = crypto.randomUUID();
  }
  cursor = Math.floor(state.board.length / 2);
  practiceAnchor = performance.now();
  unlockAudio();
  render();
  scheduleSave();
  maybeAI();
  say(uiMsg("Place a stone, or pass when you are ready to score."));
}
function maybeAI() {
  if (
    room ||
    mode !== "ai" ||
    paused ||
    !state ||
    state.phase !== "playing" ||
    state.turn === human
  )
    return;
  cancelAI();
  const id = ++aiToken,
    epoch = generation;
  aiWorker = new Worker("/game-scripts/go-ai-worker.js", { type: "module" });
  say(uiMsg("Computer is thinking…"));
  aiWorker.onmessage = ({ data }) => {
    if (id !== aiToken || epoch !== generation || room || paused) return;
    cancelAI();
    if (data.error) {
      say(uiFrom(data.error));
      return;
    }
    chargePracticeClock();
    state = applyGo(state, data.action);
    practiceAnchor = performance.now();
    render();
    scheduleSave();
    say(uiMsg("Your turn."));
  };
  aiWorker.onerror = () => {
    cancelAI();
    say(
      uiMsg(
        "Computer could not finish this move. Pause and continue to retry.",
      ),
    );
  };
  aiWorker.postMessage({
    id,
    state,
    level,
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
  });
}
async function rpc(action, body = {}) {
  if (!api.user) {
    api.openAuth(location.pathname + location.search);
    throw Error("Sign in to play online Go.");
  }
  const expected = owner(),
    result = await api.client.functions.invoke(`board-match/${action}`, {
      body: { ...body, client_id: tab },
    });
  if (expected !== owner()) throw Error("Account changed. Reopen this game.");
  let data = result.data;
  if (result.error?.context?.json) {
    try {
      data = await result.error.context.json();
    } catch {}
  }
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
          (data?.error ? 400 : undefined),
        code: data?.code,
      },
    );
  }
  return data;
}
async function subscribeRoom() {
  const key = room ? `board:${room.id}:${room.channel_key}` : "";
  if (!key || key === channelKey) return;
  const epoch = ++channelEpoch;
  if (channel) await api.client.removeChannel(channel);
  channel = null;
  channelKey = key;
  if (epoch !== channelEpoch || closed) return;
  channel = api.client
    .channel(key, { config: { private: true } })
    .on("broadcast", { event: "version" }, () => poll())
    .subscribe((status) => {
      if (epoch !== channelEpoch) return;
      if (status === "SUBSCRIBED") poll();
    });
}
async function acceptRoom(next) {
  if (!next?.id) return;
  if (room?.id === next.id && next.revision < room.revision) return;
  const changed = room?.id !== next.id || room?.revision !== next.revision;
  room = next;
  clockOffset = next.server_now - Date.now();
  mode = "online";
  queued = false;
  connected = true;
  paused = false;
  cancelAI();
  state = ["waiting", "ready", "closed"].includes(room.status)
    ? null
    : room.state;
  saveId = null;
  if (changed) {
    replayPly = null;
    candidate = null;
    confirmation = null;
  }
  if (room.status === "closed") {
    state = null;
    confirmation = null;
    room = null;
    say(uiMsg("The room closed before play started. No result was recorded."));
  }
  await subscribeRoom();
  render();
}
async function onlineStart(action) {
  if (!api.user) {
    api.openAuth(location.pathname + location.search);
    return;
  }
  if (
    active() &&
    !uiConfirm(uiMsg("Leave the current practice game and open online play?"))
  )
    return;
  await ensureProfile();
  cancelAI();
  const config = setup();
  if (action === "queue" && (!standard(config) || config.clock !== config.size))
    throw Error("Matchmaking requires standard settings and normal colors.");
  const data = await rpc(action, {
    config,
    rules_version: GO_VERSION,
    code: $("#go-code").value,
  });
  if (data.waiting) {
    queued = true;
    state = null;
    room = null;
    say(
      uiMsg(
        data.capacity
          ? "Waiting for a free online room and an opponent. You can cancel at any time."
          : "Waiting for an opponent with the same rules and board size.",
      ),
    );
  } else await acceptRoom(data);
  unlockAudio();
  render();
}
async function poll() {
  if (polling || closed || !api.user || (!room && !queued)) return;
  polling = true;
  try {
    if (queued) {
      const data = await rpc("queue", {
        config: setup(),
        rules_version: GO_VERSION,
      });
      if (data.id) await acceptRoom(data);
    } else {
      const data = await rpc("get", { match_id: room.id });
      await acceptRoom(data);
    }
  } catch (e) {
    connected = false;
    say(uiError(e));
    render();
  } finally {
    polling = false;
  }
}
function reconcileFailure(error) {
  const rejected =
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 429].includes(error.status);
  if (rejected) pendingCommand = null;
  connected = rejected && error.status !== 401 && error.status !== 403;
}
async function act(action, actor) {
  if (!state || paused) return;
  confirmation = null;
  if (room) {
    if (!connected || !room.controller)
      throw Error("Reconnect or take control before playing.");
    pendingCommand ||= {
      match_id: room.id,
      expected_version: room.revision,
      request_id: crypto.randomUUID(),
      action,
    };
    try {
      const data = await rpc("command", pendingCommand);
      pendingCommand = null;
      await acceptRoom(data);
    } catch (e) {
      reconcileFailure(e);
      throw e;
    }
  } else {
    chargePracticeClock();
    state = applyGo(
      state,
      action,
      actor ??
        (action.type === "move" || action.type === "pass"
          ? state.turn
          : localActor()),
    );
    if (action.type === "confirm" && mode === "ai" && state.phase === "scoring")
      state = applyGo(state, { type: "confirm" }, -human);
    candidate = null;
    render();
    scheduleSave();
    maybeAI();
  }
  if (action.type === "move") playCue("move");
  else if (action.type === "pass") playCue("tap");
}
function pointAt(event) {
  const rect = canvas.getBoundingClientRect(),
    s = boardState(),
    n = s.config.size,
    x = Math.round(
      (((event.clientX - rect.left) / rect.width) * 760 - 44) / (672 / (n - 1)),
    ),
    y = Math.round(
      (((event.clientY - rect.top) / rect.height) * 760 - 44) / (672 / (n - 1)),
    );
  return x >= 0 && y >= 0 && x < n && y < n ? y * n + x : null;
}
async function selectPoint(index, confirm = true) {
  if (!state || index === null || busy || pendingCommand) return;
  cursor = index;
  if (confirmation) {
    try {
      confirmation = applyJapaneseConfirmation(confirmation, {
        type: "move",
        index,
      });
      render();
    } catch (e) {
      say(uiError(e));
    }
    return;
  }
  if (["scoring", "disputed"].includes(state.phase)) {
    const group = groupAt(state, index);
    if (!group.length) return;
    const kind = $("#go-mark-mode").value,
      dead = new Set(state.proposal.dead),
      seki = new Set(state.proposal.seki);
    const list = kind === "seki" ? seki : dead,
      remove = group.every((i) => list.has(i));
    for (const i of group) {
      dead.delete(i);
      seki.delete(i);
      if (kind !== "clear" && !remove) list.add(i);
    }
    await guarded(() =>
      act({ type: "mark", dead: [...dead], seki: [...seki] }),
    );
    return;
  }
  if (locked()) return;
  if (!confirm) {
    candidate = index;
    draw();
    render();
    return;
  }
  await guarded(() => act({ type: "move", index }));
}
let pointerStart = null;
canvas.addEventListener("pointerdown", (e) => {
  pointerStart = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", (e) => {
  if (
    !pointerStart ||
    Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 10
  )
    return;
  pointerStart = null;
  canvas.focus({ preventScroll: true });
  selectPoint(pointAt(e), e.pointerType === "mouse");
});
canvas.addEventListener("keydown", (e) => {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  const n = boardState().config.size;
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n }[
    e.key
  ];
  if (delta) {
    e.preventDefault();
    cursor = Math.max(0, Math.min(n * n - 1, cursor + delta));
    draw();
  }
  if (["Enter", " "].includes(e.key)) {
    e.preventDefault();
    selectPoint(cursor);
  }
  if (
    e.key === "Escape" &&
    !room &&
    active() &&
    !root.querySelector("dialog[open]")
  ) {
    e.preventDefault();
    togglePause();
  }
});
function togglePause() {
  if (!state || room || !active()) return;
  chargePracticeClock();
  paused = !paused;
  practiceAnchor = performance.now();
  cancelAI();
  render();
  if (!paused) maybeAI();
  say(
    paused
      ? uiMsg("Paused · practice saved locally")
      : uiMsg("Play continued."),
  );
  scheduleSave();
}
function newSetup() {
  if (
    (active() ||
      (room && !["finished", "closed", "interrupted"].includes(room.status))) &&
    !uiConfirm(
      uiMsg(
        room
          ? "An online match in progress will be resigned. Continue?"
          : "Start a new game? The current practice save will remain available.",
      ),
    )
  )
    return;
  guarded(async () => {
    if (room && !["finished", "closed", "interrupted"].includes(room.status))
      await rpc("leave", { match_id: room.id });
    if (queued) await rpc("cancel");
    queued = false;
    room = null;
    state = null;
    pendingCommand = null;
    confirmation = null;
    cancelAI();
    saveId = null;
    replayPly = null;
    resultShown = false;
    shell.closeDialogs();
    await refreshSaves();
  });
}
function reveal(value) {
  if (!state?.config.training || state.phase === "finished") return;
  if (value && !peeking) {
    if (busy || (room && (!connected || !room.controller))) return;
    peeks++;
    if (room) guarded(() => act({ type: "peek" }));
    else scheduleSave();
  }
  peeking = value;
  draw();
}
$("#go-peek").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  $("#go-peek").setPointerCapture(e.pointerId);
  reveal(true);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"])
  $("#go-peek").addEventListener(type, () => reveal(false));
$("#go-peek").addEventListener("keydown", (e) => {
  if ([" ", "Enter"].includes(e.key) && !e.repeat) {
    e.preventDefault();
    reveal(true);
  }
});
$("#go-peek").addEventListener("keyup", () => reveal(false));
$("#go-start").onclick = () => guarded(() => startLocal());
$("#go-continue").onclick = () => guarded(() => startLocal(true));
$("#go-create").onclick = () => guarded(() => onlineStart("create"));
$("#go-find").onclick = () => guarded(() => onlineStart("queue"));
$("#go-join").onclick = () => guarded(() => onlineStart("join"));
$("#go-ready").onclick = () =>
  guarded(async () => {
    unlockAudio();
    await acceptRoom(
      await rpc("ready", {
        match_id: room.id,
        accept_training: $("#go-accept-training").checked,
      }),
    );
  });
$("#go-pass").onclick = () => guarded(() => act({ type: "pass" }));
$("#go-confirm-place").onclick = () => selectPoint(candidate);
$("#go-resign").onclick = () => {
  if (uiConfirm(uiMsg("Resign this game?")))
    guarded(() =>
      act(
        { type: "resign" },
        room?.color ?? (mode === "ai" ? human : state.turn),
      ),
    );
};
$("#go-pause").onclick = togglePause;
$("#go-undo").onclick = () => {
  if (!state || room) return;
  chargePracticeClock();
  cancelAI();
  let end = state.log.length - 1;
  if (mode === "ai") {
    while (
      end > 0 &&
      !(
        state.log[end].actor === human &&
        ["move", "pass"].includes(state.log[end].type)
      )
    )
      end--;
  }
  state = replayGo(state.config, state.log.slice(0, Math.max(0, end)));
  paused = false;
  render();
  scheduleSave();
  maybeAI();
};
$("#go-score-confirm").onclick = () =>
  guarded(async () => {
    await act({ type: "confirm" }, localActor());
    if (!room && mode === "local")
      $("#go-local-actor").value = String(-localActor());
  });
$("#go-score-dispute").onclick = () =>
  guarded(() => act({ type: "dispute" }, localActor()));
$("#go-resume").onclick = () =>
  guarded(() => act({ type: "resume" }, localActor()));
$("#go-no-result").onclick = () =>
  guarded(() => act({ type: "no-result" }, localActor()));
$("#go-confirmation-open").onclick = () => {
  confirmation = createJapaneseConfirmation(state, localActor());
  render();
  say(uiMsg("Hypothetical confirmation · the real match is unchanged."));
};
$("#go-confirmation-close").onclick = () => {
  confirmation = null;
  render();
};
$("#go-confirmation-pass").onclick = () => {
  confirmation = applyJapaneseConfirmation(confirmation, {
    type: "pass-ko",
    index: Number($("#go-confirmation-ko").value),
  });
  render();
};
$("#go-both-lose").onclick = () => {
  if (
    uiConfirm(
      uiMsg(
        "Both players lose under Japanese Article 13. Confirm only for an unresolved effective move affecting the result.",
      ),
    )
  )
    guarded(() => act({ type: "both-lose" }, localActor()));
};
$("#go-cycle-review").onclick = () =>
  guarded(async () => {
    await act({ type: "claim-cycle", index: cursor });
    shell.closeDialogs();
  });
$("#go-takeover").onclick = () =>
  guarded(async () => {
    if (
      uiConfirm(
        uiMsg("Take control in this tab? The other tab becomes read-only."),
      )
    )
      await acceptRoom(await rpc("takeover", { match_id: room.id }));
  });
$("#go-retry").onclick = () =>
  guarded(async () => {
    if (pendingCommand) {
      try {
        const data = await rpc("command", pendingCommand);
        pendingCommand = null;
        await acceptRoom(data);
      } catch (e) {
        reconcileFailure(e);
        throw e;
      }
    } else await poll();
  });
$("#go-cancel-wait").onclick = () =>
  guarded(async () => {
    if (queued) await rpc("cancel");
    else if (room) await rpc("leave", { match_id: room.id });
    room = null;
    queued = false;
    state = null;
  });
for (const id of ["#go-new-setup", "#go-again"]) $(id).onclick = newSetup;
$("#go-leave").onclick = newSetup;
for (const id of ["#go-export", "#go-export-result"])
  $(id).onclick = () => {
    if (state)
      downloadText(
        exportSGF(state, {
          black: room?.members.find((m) => m.color === 1)?.nickname,
          white: room?.members.find((m) => m.color === -1)?.nickname,
        }),
        "kensei-go.sgf",
        "application/x-go-sgf;charset=utf-8",
      );
  };
$("#go-review").onclick = () => {
  replayPly = 0;
  $("#go-replay").hidden = false;
  $("#go-review-ply").max = reviewSteps().length;
  $("#go-review-ply").value = "0";
  render();
};
$("#go-review-ply").oninput = (e) => {
  replayPly = Number(e.target.value);
  text(
    "#go-review-number",
    uiMsg("Move {0} / {1}", [replayPly, reviewSteps().length]),
  );
  draw();
};
$("#go-review-close").onclick = () => {
  replayPly = null;
  $("#go-replay").hidden = true;
  render();
};
$("#go-zoom").oninput = draw;
$("#go-copy-invite").onclick = () =>
  guarded(async () => {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("code", room.code);
    url.hash = "";
    await navigator.clipboard.writeText(url.href);
    say(uiMsg("Invite link copied."));
  });
async function setupChanged(event) {
  if (state || room || queued) return;
  if (["go-rule", "go-handicap"].includes(event?.target.id))
    $("#go-komi").value =
      $("#go-handicap").value === "0"
        ? GO_RULES[$("#go-rule").value].komi
        : "0";
  if (event?.target.id === "go-size")
    $("#go-clock").value = $("#go-size").value;
  try {
    if (!$("#go-komi").value)
      throw Error("Enter a komi value in half-point steps.");
    selectedConfig = readSetup();
    setupError = "";
  } catch (e) {
    setupError = e.message;
    say(uiError(e));
    render();
    return;
  }
  const c = setup(),
    m = $("#go-mode").value;
  $("#go-online-entry").hidden = m !== "online";
  $("#go-start").hidden = m === "online";
  $("#go-ai-label").hidden = m !== "ai";
  $("#go-color-label").hidden = m !== "ai";
  text(
    "#go-setup-summary",
    uiMsg("{0} · {1}", [
      summary(c),
      uiFrom(
        standard(c) ? "Standard settings" : "Custom / training · not ranked",
      ),
    ]),
  );
  $("#go-rank-rule").value = c.rule;
  $("#go-rank-size").value = String(c.size);
  cursor = Math.floor((c.size * c.size) / 2);
  draw();
  refreshRank();
  refreshSaves().catch((e) => say(uiError(e)));
}
for (const node of $("#go-entry").querySelectorAll(
  "select,input[type=checkbox],input[type=number]",
))
  node.addEventListener("change", setupChanged);
function rankRows(rows, target, mine = false) {
  const node = $(target);
  node.replaceChildren();
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "go-rank-row" + (mine ? " mine" : "");
    const rank = document.createElement("b");
    rank.textContent = row.rank;
    const link = document.createElement("a");
    link.href = `${location.pathname.startsWith("/zh-hant/") ? "/zh-hant" : ""}/profile/?id=${encodeURIComponent(row.public_id)}`;
    const avatar = document.createElement("span");
    avatar.className = "avatar-badge";
    paintAvatar(avatar, row);
    const name = document.createElement("span");
    name.textContent = row.nickname;
    link.append(avatar, name);
    const numbers = document.createElement("div");
    const top = document.createElement("b");
    top.textContent = `${row.wins} ${String(uiMsg("wins"))} · ${(row.win_rate * 100).toFixed(1)}%`;
    const bottom = document.createElement("small");
    bottom.textContent = `${row.played} ${String(uiMsg("games"))} · ${row.losses} L / ${row.draws} D`;
    numbers.append(top, document.createElement("br"), bottom);
    line.append(rank, link, numbers);
    node.append(line);
  }
}
async function refreshRank() {
  const id = ++rankedSerial;
  if (!api.client?.rpc) return;
  text("#go-board-status", uiMsg("Loading records…"));
  try {
    const { data, error } = await api.client.rpc("get_board_game_leaderboard", {
      game_name: "go",
      rule_name: $("#go-rank-rule").value,
      board_size: Number($("#go-rank-size").value),
      sort_by: $("#go-rank-sort").value,
      rules_version: GO_VERSION,
    });
    if (id !== rankedSerial) return;
    if (error) throw error;
    rankData = data;
    rankRows(data.top.slice(0, top50 ? 50 : 10), "#go-rankings");
    rankRows(data.me ? [data.me] : [], "#go-my-ranking", true);
    if (!data.me) text("#go-my-ranking", uiMsg("Your rank: —"));
    text(
      "#go-board-status",
      data.top.length
        ? uiMsg(
            "Wins / completed games. Win-rate ranking requires 10 completed games.",
          )
        : uiMsg("No verified matches in this board yet."),
    );
    $("#go-board-more").hidden = data.top.length <= 10;
    text("#go-board-more", top50 ? uiMsg("Show Top 10") : uiMsg("Show Top 50"));
  } catch {
    if (id === rankedSerial)
      text(
        "#go-board-status",
        uiMsg("Records could not load. Use Refresh to retry."),
      );
  }
}
$("#go-board-refresh").onclick = refreshRank;
$("#go-board-more").onclick = () => {
  top50 = !top50;
  rankRows(rankData?.top.slice(0, top50 ? 50 : 10) || [], "#go-rankings");
  text("#go-board-more", top50 ? uiMsg("Show Top 10") : uiMsg("Show Top 50"));
};
for (const node of $(".go-leaderboard-filters").querySelectorAll("select"))
  node.onchange = refreshRank;
async function authChanged() {
  const next = owner();
  if (next !== identity) {
    generation++;
    cancelAI();
    clearTimeout(saveTimer);
    channelEpoch++;
    if (channel) api.client.removeChannel(channel);
    channel = null;
    channelKey = "";
    state = null;
    room = null;
    queued = false;
    pendingCommand = null;
    identity = next;
    confirmation = null;
    saveId = null;
    peeking = false;
  }
  await refreshSaves().catch((e) => say(uiError(e)));
  refreshRank();
  if (api.user && !state && !room) {
    try {
      const data = await rpc("get");
      if (data?.id) await acceptRoom(data);
    } catch (e) {
      say(uiError(e));
    }
  }
  const requested = new URLSearchParams(location.search).get("save");
  if (requested && savedRow && !state && !room) startLocal(true);
  render();
}
window.addEventListener("workspace-ready", authChanged);
window.addEventListener("locale-change", () => {
  render();
  refreshRank();
});
window.addEventListener("online", poll);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    reveal(false);
    if (!room && active()) {
      chargePracticeClock();
      paused = true;
      cancelAI();
      render();
      scheduleSave();
    }
  } else poll();
});
window.addEventListener("pagehide", () => {
  closed = true;
  generation++;
  cancelAI();
  clearInterval(pollTimer);
  channelEpoch++;
  if (channel) api.client.removeChannel(channel);
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    closed = false;
    channelKey = "";
    subscribeRoom();
    pollTimer = setInterval(poll, 5000);
    poll();
  }
});
setInterval(renderClock, 250);
pollTimer = setInterval(poll, 5000);
const code = new URLSearchParams(location.search).get("code");
if (code) {
  $("#go-code").value = code;
  $("#go-mode").value = "online";
}
$("#go-advanced .go-setup").append($("#go-ai-label"), $("#go-color-label"));
$("#go-advanced").before($(".go-start-actions"));
setupChanged();
if (api.ready) authChanged();
render();
root.dataset.ready = "true";
