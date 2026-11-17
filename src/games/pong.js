import { copyRoomInvite, readyLabel } from "./room-lobby.js";
import { MATCH_ID, mountMatchLink, requestedMatch } from "./match-link.js";
import { api, esc } from "/tool-scripts/common.js";
import { ensureProfile, paintAvatar } from "/tool-scripts/profile-service.js";
import { mountEffects, effectsMode } from "./effects.js";
import {
  mountAudio,
  unlockAudio,
  stopAudio,
  pauseAudio,
  playCue,
  setAudioState,
} from "./audio.js";
import { mountPlayShell } from "./play-shell.js";
import { trackGame } from "./hub-activity.js";
import {
  createPong,
  restorePong,
  advancePong,
  validPongState,
  pongTickAt,
  PONG,
} from "./pong-engine.js";
import { uiMsg, uiFrom, uiError, uiText, uiConfirm } from "../site/ui.js";

mountEffects();
mountAudio();
const $ = (s) => document.querySelector(s),
  root = $("[data-pong]"),
  canvas = $(".pong-canvas");
const showMatchLink = mountMatchLink(root);
const shell = mountPlayShell(root, {
  beforeCover: () => {
    if (room?.status === "playing") operation("pause");
    return true;
  },
});
const clock = (t) =>
  `${Math.floor(t / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(t % 60)
    .toString()
    .padStart(2, "0")}`;
// Every page starts with a fresh controller token, including duplicated tabs.
const clientId = crypto.randomUUID();
let endCueRound = -1;
let reconnectCuePending = false;
let room = null,
  roomOwner = null,
  channels = [],
  connected = false,
  connecting = false,
  busy = false,
  stopped = false;
let state = null,
  round = 0,
  target = 512,
  remoteTarget = 512,
  keys = new Set(),
  lastFrame = 0,
  runAt = 0,
  baseTicks = 0;
let remoteState = null,
  remoteAt = 0,
  previousRemote = null,
  previousAt = 0,
  sendAt = 0,
  lastHeard = 0,
  sequence = 0,
  lastRemoteSequence = -1,
  lastEcho = 0;
let pollAt = 0,
  pollBusy = false,
  lastPing = 0,
  latency = null,
  interruptedAt = 0,
  channelGeneration = 0,
  profileSignatures = new Map(),
  closedByPage = false,
  heartbeatTimer,
  roomEpoch = 0,
  readSerial = 0,
  requestedOwner,
  pendingPoint = null,
  savingPoint = false,
  clockOffset = 0,
  peerSeen = false,
  confirmingReady = false,
  checkingDeadline = null;
const message = (text) => uiText($("#pong-status"), uiFrom(text));
const host = () => room?.role === "host";
const recoverable = (match = room) => match?.protocol_version === 2;
const controls = () => !!room && room.controller !== false;
const ended = () => ["closed", "interrupted"].includes(room?.status);
const active = () =>
  room?.status === "playing" &&
  connected &&
  controls() &&
  !pendingPoint &&
  (!recoverable() || peerSeen) &&
  !interruptedAt &&
  !document.hidden &&
  state?.status === "playing";
const channelName = (role) => `pong:${room.id}:${room.channel_key}:${role}`;
function overlay(title, note = "") {
  $("#pong-overlay").hidden = !title;
  uiText($("#pong-overlay-title"), uiFrom(title || ""));
  uiText($("#pong-overlay-note"), uiFrom(note));
}
const activity = trackGame("pong", $("#pong-overlay"));
function renderRoom() {
  syncPongAudio();
  root.dataset.pongState = room?.status || "ready";
  const live = room && !["closed", "interrupted"].includes(room.status);
  shell?.update({
    state: room
      ? room.status === "playing"
        ? "playing"
        : room.status
      : "ready",
    label: room ? `Private · ${room.status}` : "Online · Friends",
    session: live ? room.id : null,
    metric: room ? `${room.score_host}:${room.score_guest}` : undefined,
  });
  $("#pong-create").disabled = busy || !!live;
  $("#pong-join").disabled = busy || !!live;
  $("#pong-invite").hidden = !live || !controls();
  uiText($("#pong-invite-code"), room?.code || "");
  $("#pong-leave").disabled = !live || !controls() || busy;
  $("#pong-takeover").hidden = !live || controls();
  $("#pong-takeover").disabled = busy;
  $("#pong-retry").hidden =
    !live ||
    !controls() ||
    (connected && !interruptedAt && (!pendingPoint || savingPoint));
  const me = room?.players?.find((p) => p.role === room.role),
    two = room?.players?.length === 2;
  const deadline = Date.parse(
    room?.status === "paused"
      ? room.resume_until
      : room?.status === "waiting"
        ? room.expires_at
        : undefined,
  );
  const atDeadline =
    recoverable() &&
    Number.isFinite(deadline) &&
    deadline <= Date.now() + clockOffset;
  if (atDeadline && checkingDeadline !== deadline) {
    checkingDeadline = deadline;
    queueMicrotask(poll);
  }
  $("#pong-ready").disabled =
    !live ||
    !two ||
    atDeadline ||
    !connected ||
    !controls() ||
    busy ||
    room.status === "playing" ||
    !!me?.ready;
  uiText(
    $("#pong-ready"),
    confirmingReady
      ? uiMsg("Confirming Ready…")
      : room?.status === "finished"
        ? me?.ready
          ? uiMsg("Waiting for rematch…")
          : uiMsg("Ready for rematch →")
        : me?.ready
          ? uiMsg("Waiting for friend…")
          : room?.status === "paused"
            ? uiMsg("Ready to resume →")
            : uiMsg("Ready →"),
  );
  $("#pong-pause").disabled = room?.status !== "playing" || !controls() || busy;
  uiText(
    $("#pong-room-state"),
    room
      ? uiMsg("Private · {0}", [
          room.status[0].toUpperCase() + room.status.slice(1),
        ])
      : uiMsg("Not connected"),
  );
  for (const role of ["host", "guest"]) {
    const player = room?.players?.find((x) => x.role === role);
    const p = player?.profile;
    const readiness = $("#pong-" + role + "-ready");
    readiness.hidden = !player || !live || room.status === "playing";
    uiText(readiness, readyLabel(role === room?.role, !!player?.ready));
    uiText(
      $(`#pong-${role}-name`),
      p?.nickname ||
        (role === "host" ? uiMsg("Player one") : uiMsg("Waiting for a friend")),
    );
    const signature = JSON.stringify(p || null);
    if (profileSignatures.get(role) !== signature) {
      profileSignatures.set(role, signature);
      const node = $(`#pong-${role}-avatar`);
      if (p) paintAvatar(node, p);
      else uiText(node, "?");
    }
  }
  const connectionStatus =
    live && !controls()
      ? uiMsg("Read-only tab. Take control here to play.")
      : pendingPoint
        ? uiMsg("Confirming the score…")
        : room?.status === "interrupted"
          ? uiMsg("Match interrupted. Create a new room to play again.")
          : !live
            ? uiMsg("No active online match.")
            : connecting || !connected || interruptedAt
              ? uiMsg("Reconnecting… Use Retry connection if needed.")
              : room.status === "paused"
                ? uiMsg("Connected · Both players must press Ready to resume.")
                : uiMsg("Private connection · connected");
  uiText($("#pong-connection-status"), connectionStatus);
  uiText(
    $("#pong-latency"),
    latency === null
      ? uiMsg("Latency —")
      : uiMsg("Round trip {0} ms", [Math.round(latency)]),
  );
  const current = host() ? state : remoteState || state;
  const finished =
    room?.status === "finished" && ["won", "draw"].includes(current?.status);
  activity(
    room && (room.status === "playing" || room.status === "paused" || finished)
      ? {
          id: `${room.id}:${room.round}`,
          owner: roomOwner,
          mode: "normal",
          active: active(),
          finished,
          score: finished
            ? { wins: Number(current.winner === (host() ? 1 : 2)) }
            : null,
        }
      : null,
  );
  const displayedScore =
    current?.ticks >= (room?.ticks || 0) ? current?.score : room?.score;
  uiText($("#pong-left-score"), displayedScore?.[0] ?? 0);
  uiText($("#pong-right-score"), displayedScore?.[1] ?? 0);
  uiText($("#pong-time"), `${clock((current?.ticks || 0) / 120)} / 10:00`);
  if (!room)
    overlay("Bring a friend.", "Create or join a private room to play.");
  else if (live && !controls())
    overlay("Read-only tab", "Take control in this tab to play.");
  else if (room.status === "waiting")
    overlay(
      two ? "Ready for a rally?" : "Waiting for your friend…",
      two
        ? "Both players press Ready."
        : "Share the invitation link or room code.",
    );
  else if (room.status === "paused") {
    const remaining = Math.max(
      0,
      Math.ceil(
        (Date.parse(room.resume_until) - Date.now() - clockOffset) / 1000,
      ),
    );
    overlay(
      "Paused",
      atDeadline
        ? uiMsg("Checking room status…")
        : recoverable()
          ? uiMsg("Both players must press Ready within {0} s.", [remaining])
          : connecting || !connected
            ? "Play is paused. Reconnect within 15 seconds."
            : "Both players press Ready to resume. Pauses last up to 60 seconds.",
    );
  } else if (room.status === "interrupted" || room.status === "closed")
    overlay(
      room.status === "interrupted" ? "Interrupted" : "Room closed",
      "Create a fresh invitation when you are ready.",
    );
  else if (
    room.status === "finished" ||
    (current && current.status !== "playing")
  ) {
    const winner = current?.winner;
    const name = room.players?.find(
      (p) => p.role === (winner === 1 ? "host" : "guest"),
    )?.profile?.nickname;
    overlay(
      current?.status === "draw"
        ? "An even match"
        : name
          ? `${name} wins`
          : "Match complete",
      "Private casual result · both players can Ready for a rematch.",
    );
  } else if (pendingPoint)
    overlay(
      "Confirming the score…",
      savingPoint ? "" : "Use Retry connection to confirm the point.",
    );
  else if (connecting || !connected || interruptedAt)
    overlay(
      "Reconnecting…",
      recoverable()
        ? "Restoring the room connection."
        : "Play is paused. Reconnect within 15 seconds.",
    );
  else if (current && current.ticks < current.serveAt)
    overlay(
      current.ticks < 360
        ? String(
            Math.max(1, Math.ceil((current.serveAt - current.ticks) / 120)),
          )
        : "Next serve…",
    );
  else overlay(null);
}
function syncPongAudio() {
  const snapshot = host() ? state : remoteState;
  setAudioState({
    game: "pong",
    runId: room ? `${room.id}:${room.round}` : "",
    phase:
      room?.status === "playing" && snapshot?.status !== "playing" && snapshot
        ? "complete"
        : room?.status === "playing" && connected && !stopped && !interruptedAt
          ? "playing"
          : room
            ? "paused"
            : "ready",
  });
}
async function rpc(action, extra = {}) {
  if (!api.user || !api.client)
    throw Error("Sign in with Google to play online.");
  const owner = api.user.id,
    epoch = roomEpoch;
  const query = api.client.rpc("pong_room", {
    action,
    body: {
      client_id: clientId,
      protocol_version: 2,
      ...(room
        ? { room_id: room.id, round: room.round, generation: room.generation }
        : {}),
      ...extra,
    },
  });
  const { data, error } = await (query.abortSignal?.(
    AbortSignal.timeout(10000),
  ) ?? query);
  if (api.user?.id !== owner || epoch !== roomEpoch || stopped)
    throw Object.assign(new Error(), { stale: true });
  if (error || data?.error)
    throw Object.assign(
      Error(
        data?.error ||
          error?.message ||
          "Room service is unavailable. Retry when connected.",
      ),
      { unavailable: error?.code === "42501" || error?.code === "22P02" },
    );
  return data;
}
function installRoom(next) {
  if (!next?.id || (room && next.id !== room.id)) return;
  if (recoverable(next) && room?.revision > next.revision) return;
  const wasRunning = room?.status === "playing",
    oldRound = round;
  const changedChannel = !!room && room.channel_key !== next.channel_key;
  const restore =
    recoverable(next) &&
    (!room ||
      next.round !== round ||
      (changedChannel && next.restart_serve) ||
      (next.status === "finished" && state?.status === "playing") ||
      (next.status === "paused" &&
        pendingPoint &&
        next.score.join() !== state?.score.join()));
  if (!room) reconnectCuePending = false;
  room = next;
  roomOwner = api.user?.id;
  if (recoverable()) clockOffset = Number(next.server_now) - Date.now();
  if (next.round !== oldRound || restore) {
    if (next.round !== oldRound) endCueRound = -1;
    round = next.round;
    state = round
      ? recoverable()
        ? restorePong(next)
        : createPong(Number(next.seed))
      : null;
    remoteState = previousRemote = null;
    baseTicks = state?.ticks || 0;
    runAt = performance.now();
    lastEcho = 0;
  }
  if (changedChannel || next.round !== oldRound) {
    lastRemoteSequence = -1;
    sequence = 0;
  }
  if (next.status !== "playing" || changedChannel) pendingPoint = null;
  if (wasRunning && next.status === "paused") pauseAudio();
  if (next.status === "playing" && (!wasRunning || changedChannel)) {
    syncPongAudio();
    if (next.round !== oldRound)
      playCue("serve", 1, { id: `${next.id}:${next.round}:serve` });
    baseTicks = state?.ticks || 0;
    runAt = performance.now();
    interruptedAt = 0;
    lastHeard = performance.now();
  }
  if (next.status !== "playing") {
    keys.clear();
    baseTicks = state?.ticks || 0;
  }
  if (ended() || !controls() || changedChannel) disconnect();
  if (changedChannel && controls() && !ended()) queueMicrotask(() => connect());
  renderRoom();
}
function tell(kind, payload = {}) {
  if (!controls() || !connected) return;
  const own = channels.find((c) => c.role === room.role)?.channel;
  if (!own) return;
  own
    .send({
      type: "broadcast",
      event: "pong",
      payload: {
        kind,
        round: room.round,
        generation: room.generation,
        seq: ++sequence,
        ...payload,
      },
    })
    .catch?.(() => connectionLost());
}
async function poll() {
  if (!room || pollBusy || ended() || stopped || document.hidden) return;
  const epoch = roomEpoch;
  pollBusy = true;
  try {
    const clock =
      recoverable() &&
      host() &&
      state?.status === "playing" &&
      room.status === "playing"
        ? { ticks: Math.min(state.ticks, PONG.maxTicks - 1) }
        : {};
    const next = controls() ? await rpc("heartbeat", clock) : await rpc("get");
    installRoom(next);
  } catch (e) {
    if (e.stale) return;
    message(uiError(e));
    connectionLost();
  } finally {
    if (epoch === roomEpoch) {
      pollBusy = false;
      pollAt = performance.now();
    }
  }
}
function receive(role, payload) {
  if (
    !room ||
    role === room.role ||
    !payload ||
    typeof payload !== "object" ||
    JSON.stringify(payload).length > 4096
  )
    return;
  const now = performance.now();
  // 先隔离比赛编号，再检查本局序号；旧局的大序号不能锁死重赛消息。
  if (
    payload.round !== room.round ||
    (recoverable() && payload.generation !== room.generation)
  ) {
    poll();
    return;
  }
  if (!Number.isSafeInteger(payload.seq) || payload.seq <= lastRemoteSequence)
    return;
  lastRemoteSequence = payload.seq;
  if (!peerSeen && recoverable()) {
    peerSeen = true;
    baseTicks = state?.ticks || 0;
    runAt = now;
  }
  lastHeard = now;
  interruptedAt = 0;
  if (payload.kind === "control") {
    poll();
    return;
  }
  if (payload.kind === "input" && host()) {
    if (Number.isFinite(payload.target))
      remoteTarget = Math.max(0, Math.min(1024, payload.target));
    if (Number.isFinite(payload.t0)) lastEcho = payload.t0;
    if (Number.isFinite(payload.echo) && payload.echo > 0) {
      const sample = now - payload.echo;
      if (sample >= 0 && sample < 10000)
        latency = latency === null ? sample : latency * 0.8 + sample * 0.2;
    }
  }
  if (payload.kind === "state" && !host() && validPongState(payload.state)) {
    if (remoteState && remoteState.score.join() !== payload.state.score.join())
      playCue("point");
    if (payload.state.status !== "playing" && endCueRound !== room.round) {
      endCueRound = room.round;
      playCue(
        payload.state.status === "draw"
          ? "draw"
          : payload.state.winner === 2
            ? "win"
            : "loss",
      );
    } else if (
      remoteState &&
      remoteState.ball.vx * payload.state.ball.vx < 0 &&
      (payload.state.ball.x < 80 || payload.state.ball.x > 880)
    )
      playCue("paddle");
    previousRemote = remoteState;
    previousAt = remoteAt;
    remoteState = payload.state;
    syncPongAudio();
    remoteAt = now;
    if (Number.isFinite(payload.t0)) lastEcho = payload.t0;
    if (Number.isFinite(payload.echo) && payload.echo > 0) {
      const sample = now - payload.echo;
      if (sample >= 0 && sample < 10000)
        latency = latency === null ? sample : latency * 0.8 + sample * 0.2;
    }
    if (payload.status !== room.status) poll();
    if (interruptedAt) {
      interruptedAt = 0;
      if (room.status === "playing") runAt = now;
    }
  }
}
async function connect() {
  if (
    !controls() ||
    connecting ||
    stopped ||
    ["closed", "interrupted"].includes(room.status)
  )
    return;
  connecting = true;
  disconnect(false);
  lastHeard = performance.now();
  const generation = channelGeneration;
  try {
    await Promise.all(
      ["host", "guest"].map(
        (role) =>
          new Promise((resolve, reject) => {
            const channel = api.client.channel(channelName(role), {
              config: { private: true, broadcast: { self: false, ack: false } },
            });
            channels.push({ role, channel });
            const timeout = setTimeout(
              () =>
                reject(
                  Error(
                    "The private connection timed out. Retry to reconnect.",
                  ),
                ),
              10000,
            );
            let settled = false;
            channel.on(
              "broadcast",
              { event: "pong" },
              ({ payload }) =>
                generation === channelGeneration && receive(role, payload),
            );
            channel.subscribe((status) => {
              if (generation !== channelGeneration) return;
              if (status === "SUBSCRIBED") {
                clearTimeout(timeout);
                if (!settled) {
                  settled = true;
                  resolve();
                }
                return;
              }
              if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
                clearTimeout(timeout);
                if (!settled) {
                  settled = true;
                  reject(Error("The room connection was interrupted."));
                } else if (!closedByPage) connectionLost();
              }
            });
          }),
      ),
    );
    if (generation !== channelGeneration || stopped) return;
    connected = true;
    if (room.status === "playing") {
      baseTicks = state?.ticks || 0;
      runAt = performance.now();
    }
    interruptedAt = 0;
    tell("control");
    await poll();
    if (reconnectCuePending && connected) {
      reconnectCuePending = false;
      playCue("reconnect");
    }
  } catch (e) {
    if (generation === channelGeneration && !stopped) {
      connected = false;
      message(uiError(e));
    }
  } finally {
    connecting = false;
    if (generation !== channelGeneration && controls() && !ended() && !stopped)
      queueMicrotask(connect);
    renderRoom();
  }
}
function disconnect(clear = true) {
  channelGeneration++;
  peerSeen = false;
  const old = channels;
  channels = [];
  connected = false;
  for (const { channel } of old)
    api.client?.removeChannel(channel).catch?.(() => {});
  if (clear) lastHeard = 0;
}
function connectionLost() {
  stopAudio();
  if (!controls() || ended()) return;
  reconnectCuePending = true;
  if (!interruptedAt) interruptedAt = performance.now();
  connected = false;
  keys.clear();
  $("#pong-retry").hidden = false;
  if (room.status === "playing") {
    baseTicks = state?.ticks || 0;
    rpc("pause", { recovery: recoverable() })
      .then(installRoom)
      .catch(() => {});
  }
  renderRoom();
}
function updateMatchUrl(match) {
  const url = new URL(location.href);
  url.searchParams.delete("room");
  url.searchParams.delete("match");
  if (recoverable(match)) url.searchParams.set("match", match.id);
  else if (match) url.searchParams.set("room", match.code);
  history.replaceState(null, "", url);
}
async function operation(action, extra = {}) {
  if (action === "ready") unlockAudio();
  if (action === "pause") pauseAudio();
  else if (["leave", "interrupt"].includes(action)) stopAudio();
  if (busy) return;
  if (!api.user) {
    api.openAuth(location.pathname + location.search);
    return;
  }
  const owner = api.user.id,
    epoch = roomEpoch;
  if (action === "create" || action === "join") readSerial++;
  busy = true;
  confirmingReady = action === "ready";
  renderRoom();
  try {
    await ensureProfile();
    if (owner !== api.user?.id || epoch !== roomEpoch || stopped) return;
    if (action === "ready" && recoverable()) {
      // A teammate can take control while this tab is between room polls.
      const previousRound = room.round;
      installRoom(await rpc("get"));
      if (
        !controls() ||
        ended() ||
        room.round !== previousRound ||
        room.status === "playing"
      )
        return;
    }
    const payload =
      action === "pause" &&
      recoverable() &&
      host() &&
      state?.status === "playing"
        ? { ticks: state.ticks, ...extra }
        : extra;
    const result = await rpc(action, payload);
    if (action === "create" || action === "join") {
      room = null;
      roomOwner = api.user.id;
      installRoom(result);
      $("#pong-code").value = result.code || "";
      showMatchLink("");
      lastRemoteSequence = -1;
      sequence = 0;
      updateMatchUrl(result);
      await connect();
      if (epoch === roomEpoch && owner === api.user?.id)
        message(
          result.controller === false
            ? uiMsg("Read-only tab. Take control here to play.")
            : uiMsg("Share the room link. Both players press Ready to begin."),
        );
    } else {
      tell("control");
      installRoom(result);
      tell("control");
      if (action === "ready")
        message(
          room.status === "playing"
            ? uiMsg("Match ready. Move your paddle on the court.")
            : uiMsg("Ready sent. Waiting for your friend."),
        );
      if (action === "leave") {
        roomEpoch++;
        busy = confirmingReady = savingPoint = pollBusy = false;
        updateMatchUrl(null);
        showMatchLink("");
        room = null;
        state = null;
        remoteState = null;
        round = 0;
        renderRoom();
        message(uiMsg("You left the room. Create or join a new one."));
      }
    }
  } catch (e) {
    if (!e.stale && epoch === roomEpoch) {
      message(uiError(e));
      if (room) poll();
    }
  } finally {
    if (epoch === roomEpoch) {
      busy = confirmingReady = false;
      renderRoom();
    }
  }
}

async function confirmPoint() {
  if (!pendingPoint || savingPoint) return;
  const point = pendingPoint,
    version = room.generation,
    epoch = roomEpoch;
  savingPoint = true;
  renderRoom();
  try {
    const snapshot = await rpc("checkpoint", {
      ticks: point.ticks,
      score_host: point.score[0],
      score_guest: point.score[1],
    });
    if (
      point !== pendingPoint ||
      epoch !== roomEpoch ||
      version !== room?.generation
    )
      return;
    pendingPoint = null;
    if (
      snapshot.generation === version &&
      snapshot.score?.join() === point.score.join() &&
      snapshot.ticks >= point.ticks
    ) {
      const scored = state.score.join() !== point.score.join();
      state = point;
      baseTicks = state.ticks;
      runAt = performance.now();
      if (scored) playCue("point");
      if (snapshot.status === "finished" && endCueRound !== round) {
        endCueRound = round;
        playCue(
          state.status === "draw"
            ? "draw"
            : state.winner === 1
              ? "win"
              : "loss",
        );
      }
      tell("state", {
        state,
        status: snapshot.status,
        t0: runAt,
        echo: lastEcho,
      });
    }
    installRoom(snapshot);
  } catch (e) {
    if (!e.stale && point === pendingPoint) message(uiError(e));
  } finally {
    if (epoch === roomEpoch) {
      savingPoint = false;
      renderRoom();
    }
  }
}
function paint(now) {
  const g = canvas.getContext("2d");
  if (!g) {
    overlay("Canvas unavailable", "Enable drawing or try another browser.");
    return;
  }
  let s = host() ? state : remoteState || state;
  if (
    s &&
    !host() &&
    previousRemote &&
    previousRemote.status === "playing" &&
    s.status === "playing" &&
    previousRemote.score.join() === s.score.join()
  ) {
    const t = Math.max(
      0,
      Math.min(1, (now - remoteAt) / Math.max(60, remoteAt - previousAt)),
    );
    s = {
      ...s,
      left: previousRemote.left + (s.left - previousRemote.left) * t,
      right: (target / 1024) * 540,
      ball: {
        ...s.ball,
        x: previousRemote.ball.x + (s.ball.x - previousRemote.ball.x) * t,
        y: previousRemote.ball.y + (s.ball.y - previousRemote.ball.y) * t,
      },
    };
  }
  g.clearRect(0, 0, 960, 540);
  g.fillStyle = "#11111c";
  g.fillRect(0, 0, 960, 540);
  g.strokeStyle = "#ffffff18";
  g.setLineDash([9, 14]);
  g.beginPath();
  g.moveTo(480, 20);
  g.lineTo(480, 520);
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = "#ffffff08";
  for (let x = 0; x < 960; x += 48) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 540);
    g.stroke();
  }
  const left = s?.left ?? 270,
    right = s?.right ?? 270;
  g.shadowBlur = effectsMode() === "full" ? 20 : 0;
  g.shadowColor = "#b8a2ef";
  g.fillStyle = "#cdb4ee";
  g.fillRect(36, left - 48, 14, 96);
  g.shadowColor = "#f2c68c";
  g.fillStyle = "#f2c68c";
  g.fillRect(910, right - 48, 14, 96);
  g.shadowBlur = 0;
  const ball = s?.ball || { x: 480, y: 270, vx: 0, vy: 0 };
  if (effectsMode() === "full" && s?.ticks >= s?.serveAt) {
    const gradient = g.createLinearGradient(
      ball.x - ball.vx * 0.06,
      ball.y - ball.vy * 0.06,
      ball.x,
      ball.y,
    );
    gradient.addColorStop(0, "#ffffff00");
    gradient.addColorStop(1, "#f2e4d955");
    g.strokeStyle = gradient;
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(ball.x - ball.vx * 0.06, ball.y - ball.vy * 0.06);
    g.lineTo(ball.x, ball.y);
    g.stroke();
  }
  g.shadowBlur = effectsMode() === "full" ? 15 : 0;
  g.shadowColor = "#fff0df";
  g.fillStyle = "#fff0df";
  g.beginPath();
  g.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
}
function frame(now) {
  if (stopped) return;
  const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  if (active()) {
    const dir = (keys.has("down") ? 1 : 0) - (keys.has("up") ? 1 : 0);
    target = Math.max(0, Math.min(1024, target + dir * 1250 * dt));
    if (host()) {
      const tick = pongTickAt(state.ticks, baseTicks, runAt, now),
        score = state.score.join(),
        previousVX = state.ball.vx;
      const next = recoverable()
        ? { ...state, score: [...state.score], ball: { ...state.ball } }
        : state;
      advancePong(
        next,
        recoverable() ? Math.min(tick, state.ticks + PONG.fps) : tick,
        target,
        remoteTarget,
      );
      if (
        recoverable() &&
        (score !== next.score.join() || next.status !== "playing")
      ) {
        pendingPoint = next;
        confirmPoint();
      } else state = next;
      if (
        previousVX * state.ball.vx < 0 &&
        (state.ball.x < 80 || state.ball.x > 880)
      )
        playCue("paddle");
      if (score !== state.score.join()) playCue("point");
      if (score !== state.score.join())
        tell("state", { state, status: room.status, t0: now, echo: lastEcho });
      if (state.status !== "playing") {
        syncPongAudio();
        if (endCueRound !== room.round) {
          endCueRound = room.round;
          playCue(
            state.status === "draw"
              ? "draw"
              : state.winner === 1
                ? "win"
                : "loss",
          );
        }
        tell("state", { state, status: "finished", t0: now, echo: lastEcho });
        operation("finish");
      }
    }
  }
  if (
    room &&
    connected &&
    !["closed", "interrupted"].includes(room.status) &&
    now - sendAt >= (room.status === "playing" ? 100 : 1000)
  ) {
    sendAt = now;
    if (host())
      tell("state", {
        state: state || createPong(Number(room.seed)),
        status: room.status,
        t0: now,
        echo: lastEcho,
      });
    else tell("input", { target, t0: now, echo: lastEcho });
  }
  if (room && !ended() && !document.hidden) {
    if (now - pollAt > 5000) poll();
    if (
      room.players?.length === 2 &&
      connected &&
      lastHeard &&
      now - lastHeard > (recoverable() && !peerSeen ? 8000 : 2000)
    ) {
      if (!interruptedAt) {
        interruptedAt = now;
        keys.clear();
        if (room.status === "playing")
          operation("pause", { recovery: recoverable() });
      }
    }
    if (!recoverable() && interruptedAt && now - interruptedAt > 15000) {
      operation("interrupt");
      interruptedAt = 0;
    }
  }
  if (!document.hidden && (active() || now - lastPing > 150)) paint(now);
  if (now - lastPing > 150) {
    renderRoom();
    lastPing = now;
  }
  requestAnimationFrame(frame);
}
function move(e) {
  if (!controls() || !connected) return;
  const rect = canvas.getBoundingClientRect();
  target = Math.max(
    0,
    Math.min(1024, ((e.clientY - rect.top) / rect.height) * 1024),
  );
}
canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(e.pointerId);
  move(e);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse" || canvas.hasPointerCapture(e.pointerId))
    move(e);
});
canvas.addEventListener("keydown", (e) => {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = {
    ArrowUp: "up",
    w: "up",
    W: "up",
    ArrowDown: "down",
    s: "down",
    S: "down",
  }[e.key];
  if (key) {
    e.preventDefault();
    keys.add(key);
  }
  if (e.key === "Escape" && room?.status === "playing") operation("pause");
});
window.addEventListener("keyup", (e) => {
  const key = {
    ArrowUp: "up",
    w: "up",
    W: "up",
    ArrowDown: "down",
    s: "down",
    S: "down",
  }[e.key];
  if (key) keys.delete(key);
});
canvas.addEventListener("blur", () => keys.clear());
$("#pong-create").onclick = () => operation("create");
$("[data-pong-join-open]").onclick = () => {
  $(".pong-join-fields").hidden = !$(".pong-join-fields").hidden;
  if (!$(".pong-join-fields").hidden)
    $("#pong-code").focus({ preventScroll: true });
  shell?.requestSize();
};
$("#pong-join").onclick = () =>
  operation("join", { code: $("#pong-code").value });
$("#pong-ready").onclick = () => operation("ready");
$("#pong-takeover").onclick = () => {
  if (uiConfirm(uiMsg("Take control of this match in this tab?")))
    operation("takeover");
};
$("#pong-pause").onclick = () => operation("pause");
$("#pong-leave").onclick = () => {
  if (
    uiConfirm(
      uiMsg(
        "Leave this online room? The current match will close for both players.",
      ),
    )
  )
    operation("leave");
};
$("#pong-retry").onclick = async () => {
  unlockAudio();
  if (pendingPoint) await confirmPoint();
  await poll();
  if (controls() && !ended() && !connected) connect();
};
$("#pong-copy").onclick = () => {
  if (room?.code)
    void copyRoomInvite($("#pong-copy"), "room", room.code, message);
};
document.addEventListener("visibilitychange", () => {
  keys.clear();
  if (document.hidden) {
    if (controls() && room.status === "playing") operation("pause");
  } else {
    lastFrame = 0;
    poll();
  }
});
window.addEventListener("offline", connectionLost);
window.addEventListener("online", () => {
  if (room) {
    poll().then(() => connect());
  }
});
window.addEventListener("pagehide", () => {
  if (controls() && api.user?.id === roomOwner && !ended()) {
    if (!recoverable()) rpc("leave").catch(() => {});
    else if (room.status === "playing")
      rpc("pause", { recovery: true }).catch(() => {});
  }
  stopped = true;
  closedByPage = true;
  roomEpoch++;
  readSerial++;
  clearInterval(heartbeatTimer);
  keys.clear();
  disconnect();
});
function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (room && !stopped && !document.hidden) poll();
  }, 5000);
}

async function openPongMatch() {
  const id = requestedMatch(),
    owner = api.user?.id,
    serial = ++readSerial;
  if (id === null) return;
  if (!MATCH_ID.test(id)) return showMatchLink("unavailable");
  if (!owner) return showMatchLink("guest");
  showMatchLink("loading");
  try {
    const next = await rpc("get", { room_id: id });
    if (serial !== readSerial || (room && room.id !== id)) return;
    if (!next?.id) return showMatchLink("unavailable");
    installRoom(next);
    showMatchLink(ended() ? "unavailable" : "");
    if (controls() && !ended()) connect();
  } catch (e) {
    if (!e.stale && serial === readSerial)
      showMatchLink(e.unavailable ? "unavailable" : "retry", openPongMatch);
  }
}
function authChanged() {
  const owner = api.user?.id;
  if (owner === requestedOwner && room) return;
  if (requestedOwner !== owner || (roomOwner && roomOwner !== owner)) {
    requestedOwner = owner;
    roomEpoch++;
    disconnect();
    room = state = remoteState = previousRemote = pendingPoint = null;
    round = 0;
    roomOwner = null;
    busy = confirmingReady = savingPoint = pollBusy = false;
    renderRoom();
  }
  if (!room && requestedMatch() !== null) openPongMatch();
  else if (!room)
    message(
      owner
        ? uiMsg("Create a room or enter your friend's invitation code.")
        : uiMsg("Sign in with Google to create or join a room."),
    );
}
window.addEventListener("workspace-ready", authChanged);
window.addEventListener("locale-change", renderRoom);
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  stopped = closedByPage = false;
  lastFrame = 0;
  startHeartbeat();
  authChanged();
  pollBusy = savingPoint = busy = false;
  if (room && recoverable()) poll().then(() => connect());
  else if (room) poll();
  requestAnimationFrame(frame);
});
startHeartbeat();
const invitation = new URLSearchParams(location.search).get("room");
if (invitation) {
  $("#pong-code").value = invitation.slice(0, 8).toUpperCase();
  $(".pong-join-fields").hidden = false;
}
root.dataset.ready = "true";
authChanged();
renderRoom();
requestAnimationFrame(frame);
