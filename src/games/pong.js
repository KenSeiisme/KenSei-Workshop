import { api, esc } from "/tool-scripts/common.js";
import { ensureProfile, paintAvatar } from "/tool-scripts/profile-service.js";
import { mountEffects, effectsMode } from "./effects.js";
import { mountAudio, unlockAudio, stopAudio, playCue } from "./audio.js";
import { mountPlayShell } from "./play-shell.js";
import {
  createPong,
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
let clientId;
let endCueRound = -1;
try {
  clientId =
    sessionStorage.getItem("kensei-pong-tab-v1") || crypto.randomUUID();
  sessionStorage.setItem("kensei-pong-tab-v1", clientId);
} catch {
  clientId = crypto.randomUUID();
}
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
  authTimer;
const message = (text) => uiText($("#pong-status"), uiFrom(text));
const host = () => room?.role === "host";
const active = () =>
  room?.status === "playing" &&
  connected &&
  !interruptedAt &&
  !document.hidden &&
  state?.status === "playing";
const channelName = (role) => `pong:${room.id}:${room.channel_key}:${role}`;
function overlay(title, note = "") {
  $("#pong-overlay").hidden = !title;
  uiText($("#pong-overlay-title"), uiFrom(title || ""));
  uiText($("#pong-overlay-note"), uiFrom(note));
}
function renderRoom() {
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
  });
  $("#pong-create").disabled = busy || !!live;
  $("#pong-join").disabled = busy || !!live;
  $("#pong-invite").hidden = !live;
  uiText($("#pong-invite-code"), room?.code || "");
  $("#pong-leave").disabled = !live || busy;
  const me = room?.players?.find((p) => p.role === room.role),
    two = room?.players?.length === 2;
  $("#pong-ready").disabled =
    !live ||
    !two ||
    !connected ||
    busy ||
    room.status === "playing" ||
    !!me?.ready;
  uiText(
    $("#pong-ready"),
    room?.status === "finished"
      ? me?.ready
        ? uiMsg("Waiting for rematch…")
        : uiMsg("Ready for rematch →")
      : me?.ready
        ? uiMsg("Waiting for friend…")
        : room?.status === "paused"
          ? uiMsg("Ready to resume →")
          : uiMsg("Ready →"),
  );
  $("#pong-pause").disabled = room?.status !== "playing" || busy;
  uiText(
    $("#pong-room-state"),
    room
      ? uiMsg("Private · {0}", [
          room.status[0].toUpperCase() + room.status.slice(1),
        ])
      : uiMsg("Not connected"),
  );
  for (const role of ["host", "guest"]) {
    const p = room?.players?.find((x) => x.role === role)?.profile;
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
  uiText(
    $("#pong-connection-status"),
    live
      ? connected
        ? uiMsg("Private connection · connected")
        : uiMsg("Reconnecting · game paused")
      : uiMsg("No active online match."),
  );
  uiText(
    $("#pong-latency"),
    latency === null
      ? uiMsg("Latency —")
      : uiMsg("Round trip {0} ms", [Math.round(latency)]),
  );
  const current = host() ? state : remoteState || state;
  uiText($("#pong-left-score"), current?.score[0] ?? 0);
  uiText($("#pong-right-score"), current?.score[1] ?? 0);
  uiText($("#pong-time"), `${clock((current?.ticks || 0) / 120)} / 10:00`);
  if (!room)
    overlay("Bring a friend.", "Create or join a private room to play.");
  else if (room.status === "waiting")
    overlay(
      two ? "Ready for a rally?" : "Waiting for your friend…",
      two
        ? "Both players press Ready."
        : "Share the invitation link or room code.",
    );
  else if (room.status === "paused")
    overlay(
      "Paused",
      "Both players press Ready to resume. Pauses last up to 60 seconds.",
    );
  else if (room.status === "interrupted" || room.status === "closed")
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
    )?.profile.nickname;
    overlay(
      current?.status === "draw"
        ? "An even match"
        : name
          ? `${name} wins`
          : "Match complete",
      "Private casual result · both players can Ready for a rematch.",
    );
  } else if (!connected || interruptedAt)
    overlay(
      "Connection interrupted",
      "Play is paused. Reconnect within 15 seconds.",
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
async function rpc(action, extra = {}) {
  if (!api.user || !api.client)
    throw Error("Sign in with Google to play online.");
  const owner = api.user.id;
  const { data, error } = await api.client.rpc("pong_room", {
    action,
    body: {
      client_id: clientId,
      ...(room ? { room_id: room.id, round: room.round } : {}),
      ...extra,
    },
  });
  if (api.user?.id !== owner)
    throw Error("Account changed. Reopen Pong before joining.");
  if (error || data?.error)
    throw Error(
      data?.error ||
        error?.message ||
        "Room service is unavailable. Retry when connected.",
    );
  return data;
}
function installRoom(next) {
  if (!next || (room && next.id !== room.id)) return;
  const wasRunning = room?.status === "playing",
    oldRound = round;
  room = next;
  if (wasRunning && next.status === "paused") stopAudio();
  roomOwner = api.user?.id;
  if (next.round !== oldRound) {
    endCueRound = -1;
    round = next.round;
    state = round ? createPong(Number(next.seed)) : null;
    remoteState = null;
    previousRemote = null;
    lastRemoteSequence = -1;
    sequence = 0;
    baseTicks = 0;
    runAt = performance.now();
    lastEcho = 0;
  }
  if (next.status === "playing" && !wasRunning) {
    if (next.round !== oldRound) playCue("serve");
    baseTicks = state?.ticks || 0;
    runAt = performance.now();
    interruptedAt = 0;
    lastHeard = performance.now();
  }
  if (next.status !== "playing") {
    keys.clear();
    baseTicks = state?.ticks || 0;
  }
  if (["closed", "interrupted"].includes(next.status)) {
    disconnect();
    keys.clear();
  }
  renderRoom();
}
function tell(kind, payload = {}) {
  if (!room || !connected) return;
  const own = channels.find((c) => c.role === room.role)?.channel;
  if (!own) return;
  own
    .send({
      type: "broadcast",
      event: "pong",
      payload: { kind, round: room.round, seq: ++sequence, ...payload },
    })
    .catch?.(() => connectionLost());
}
async function poll() {
  if (!room || pollBusy || ["closed", "interrupted"].includes(room.status))
    return;
  pollBusy = true;
  try {
    const next = await rpc("heartbeat");
    installRoom(next);
  } catch (e) {
    message(uiError(e));
    connectionLost();
  } finally {
    pollBusy = false;
    pollAt = performance.now();
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
  if (payload.round !== room.round) {
    poll();
    return;
  }
  if (!Number.isSafeInteger(payload.seq) || payload.seq <= lastRemoteSequence)
    return;
  lastRemoteSequence = payload.seq;
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
  if (!room || connecting || stopped) return;
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
            channel.on("broadcast", { event: "pong" }, ({ payload }) =>
              receive(role, payload),
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
    connected = true;
    interruptedAt = 0;
    $("#pong-retry").hidden = true;
    tell("control");
    await poll();
  } catch (e) {
    connected = false;
    message(uiError(e));
    $("#pong-retry").hidden = false;
  } finally {
    connecting = false;
    renderRoom();
  }
}
function disconnect(clear = true) {
  channelGeneration++;
  const old = channels;
  channels = [];
  connected = false;
  for (const { channel } of old)
    api.client?.removeChannel(channel).catch?.(() => {});
  if (clear) lastHeard = 0;
}
function connectionLost() {
  stopAudio();
  if (!room || ["closed", "interrupted"].includes(room.status)) return;
  if (!interruptedAt) interruptedAt = performance.now();
  connected = false;
  keys.clear();
  $("#pong-retry").hidden = false;
  if (room.status === "playing") {
    baseTicks = state?.ticks || 0;
    rpc("pause")
      .then(installRoom)
      .catch(() => {});
  }
  renderRoom();
}
async function operation(action, extra = {}) {
  if (action === "ready") unlockAudio();
  if (["pause", "leave", "interrupt"].includes(action)) stopAudio();
  if (busy) return;
  if (!api.user) {
    api.openAuth(location.pathname + location.search);
    return;
  }
  busy = true;
  renderRoom();
  try {
    await ensureProfile();
    const result = await rpc(action, extra);
    if (action === "create" || action === "join") {
      room = null;
      roomOwner = api.user.id;
      installRoom(result);
      $("#pong-code").value = result.code;
      lastRemoteSequence = -1;
      sequence = 0;
      history.replaceState(
        null,
        "",
        `/games/pong/?room=${encodeURIComponent(result.code)}`,
      );
      await connect();
      message(uiMsg("Share the room link. Both players press Ready to begin."));
    } else {
      installRoom(result);
      tell("control");
      if (action === "ready")
        message(
          room.status === "playing"
            ? uiMsg("Match ready. Move your paddle on the court.")
            : uiMsg("Ready sent. Waiting for your friend."),
        );
      if (action === "leave") {
        history.replaceState(null, "", "/games/pong/");
        room = null;
        state = null;
        remoteState = null;
        round = 0;
        message(uiMsg("You left the room. Create or join a new one."));
      }
    }
  } catch (e) {
    message(uiError(e));
  } finally {
    busy = false;
    renderRoom();
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
      advancePong(state, tick, target, remoteTarget);
      if (
        previousVX * state.ball.vx < 0 &&
        (state.ball.x < 80 || state.ball.x > 880)
      )
        playCue("paddle");
      if (score !== state.score.join()) playCue("point");
      if (score !== state.score.join())
        tell("state", { state, status: room.status, t0: now, echo: lastEcho });
      if (state.status !== "playing") {
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
  if (room && !["closed", "interrupted"].includes(room.status)) {
    if (now - pollAt > 5000) poll();
    if (
      room.players?.length === 2 &&
      connected &&
      lastHeard &&
      now - lastHeard > 2000
    ) {
      if (!interruptedAt) {
        interruptedAt = now;
        keys.clear();
        if (room.status === "playing") operation("pause");
      }
    }
    if (interruptedAt && now - interruptedAt > 15000) {
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
  if (!room || !connected) return;
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
  await poll();
  if (room && !["closed", "interrupted"].includes(room.status)) connect();
};
$("#pong-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(
      `${location.origin}/games/pong/?room=${room.code}`,
    );
    message(
      uiMsg(
        "Invite link copied. Your friend signs in, joins, then presses Ready.",
      ),
    );
  } catch {
    message(
      uiMsg("Copy this invitation: {0}/games/pong/?room={1}", [
        location.origin,
        room.code,
      ]),
    );
  }
};
document.addEventListener("visibilitychange", () => {
  keys.clear();
  if (document.hidden) {
    if (room?.status === "playing") operation("pause");
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
  stopped = true;
  closedByPage = true;
  clearInterval(authTimer);
  clearInterval(heartbeatTimer);
  keys.clear();
  if (room && api.user?.id === roomOwner) rpc("leave").catch(() => {});
  disconnect();
});
const heartbeatTimer = setInterval(() => {
  if (room && !stopped) poll();
}, 5000);
authTimer = setInterval(() => {
  if (roomOwner && api.user?.id !== roomOwner) {
    closedByPage = true;
    disconnect();
    room = null;
    state = null;
    remoteState = null;
    round = 0;
    renderRoom();
    message(uiMsg("Account changed. Create or join a fresh room."));
  }
  if (!room)
    message(
      api.user
        ? uiMsg("Create a room or enter your friend's invitation code.")
        : uiMsg("Sign in with Google to create or join a room."),
    );
}, 1000);
const invitation = new URLSearchParams(location.search).get("room");
if (invitation) {
  $("#pong-code").value = invitation.slice(0, 8).toUpperCase();
  $(".pong-join-fields").hidden = false;
}
root.dataset.ready = "true";
renderRoom();
requestAnimationFrame(frame);
