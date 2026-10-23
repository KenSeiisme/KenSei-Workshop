import { api, esc } from "/tool-scripts/common.js";
import { ensureProfile, paintAvatar } from "/tool-scripts/profile-service.js";
import {
  createRecordStore,
  recordSignature,
} from "/tool-scripts/record-store.js";
import {
  GAMES,
  VERSION,
  create,
  apply,
  advanceSnake,
  advanceBrick,
  advanceDrop,
  isRanked,
  timeScored,
  needsWin,
  settleMemory,
  metrics,
  rules,
  validateSave,
} from "./engine.js";
import { sessionCall, pendingResult } from "./session-client.js";
import { gameIcon } from "./presentation.js";
import { createExtraUI } from "./new-game-ui.js";
import { createGamePresenter } from "./motion.js";
import { patchMarkup } from "./dom.js";
import { mountEffects, bindCardDemos } from "./effects.js";
import { INPUTS as DROP_INPUTS } from "./block-drop-engine.js";
import { mountAchievements } from "./achievements.js";
mountEffects();

const $ = (s) => document.querySelector(s),
  store = createRecordStore("game", validateSave, { syncDelay: 500 });
const root = $("[data-game]"),
  game = root?.dataset.game;
const owner = () => api.user?.id || "guest";
const clock = (ms) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
const title = (d) =>
  `${GAMES[d.game].name} · ${rules(d.game, d.difficulty).label}`;
let active = null,
  saveTimer,
  lastWritten = "",
  revision = 0,
  activeId = null,
  accumulated = 0,
  started = 0;
let running = false,
  publicSession = null,
  events = [],
  pending = null,
  undo = null,
  frameId = 0,
  lastFrame = 0,
  lastClock = 0,
  busy = false,
  mineMode = "reveal",
  sound = false,
  audio,
  player;
const presenter = game ? createGamePresenter(root, game) : null;
const milestones = mountAchievements(game);
const avatarSignatures = new WeakMap();
const isBoard = () => game && !isRanked(game);
const undoable = () =>
  ["2048", "sudoku", "nonogram", "connect-four", "reversi"].includes(game);
const ui = game
  ? createExtraUI({
      game,
      getState: () => active,
      isRunning: () => running && owner() === player,
      isPublic: () => !!publicSession,
      act: action,
      redraw: draw,
      queueSave,
      announce: statusMessage,
      paintBrick: (canvas, state) => presenter.paintBrick(canvas, state),
    })
  : null;
function statusMessage(message) {
  status(message);
}
const elapsed = () => accumulated + (running ? performance.now() - started : 0);
const status = (message) => {
  if ($("#game-status")) $("#game-status").textContent = message;
};
let directoryBound = false;
const guard =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      $("#game-save-status").textContent =
        e.message +
        " Your current game remains available; retry when storage is ready.";
    }
  };
const difficulty = () => $("#game-difficulty").value;
function snapshot() {
  return validateSave({
    game,
    difficulty: active.difficulty,
    state: active,
    elapsed: elapsed(),
    best: bestResult(active, elapsed()),
  });
}
function better(a, b, slug) {
  if (!b) return true;
  if (slug === "block-drop") {
    if (a.difficulty === "sprint") return a.elapsed_ms < b.elapsed_ms;
    return (
      a.score > b.score ||
      (a.score === b.score && (a.lines || 0) > (b.lines || 0))
    );
  }
  if (slug === "memory-match")
    return (
      a.moves < b.moves || (a.moves === b.moves && a.elapsed_ms < b.elapsed_ms)
    );
  if (timeScored(slug)) return a.elapsed_ms < b.elapsed_ms;
  if (slug === "brick-breaker" && a.score === b.score)
    return a.elapsed_ms < b.elapsed_ms;
  return (
    a.score > b.score ||
    (slug === "2048" && a.score === b.score && a.max_tile > b.max_tile)
  );
}
function priorBest(slug, mode) {
  return store
    .rows()
    .filter(
      (x) => x.data.game === slug && x.data.difficulty === mode && x.data.best,
    )
    .map((x) => x.data.best)
    .reduce((b, a) => (better(a, b, slug) ? a : b), null);
}
function bestResult(s, time) {
  if (!isRanked(s.game)) return null;
  const old = priorBest(s.game, s.difficulty),
    now = {
      ...metrics(s),
      ...(s.game === "block-drop" ? { difficulty: s.difficulty } : {}),
      elapsed_ms: Math.max(1, Math.round(time)),
    };
  if (
    s.status === "playing" ||
    ((needsWin(s.game) ||
      (s.game === "block-drop" && s.difficulty === "sprint")) &&
      s.status !== "won")
  )
    return old;
  return better(now, old, s.game) ? now : old;
}
function displayResult(row, slug) {
  if (!row) return "—";
  if (slug === "block-drop" && (row.difficulty || difficulty()) === "sprint")
    return `${(row.elapsed_ms / 1000).toFixed(2)} s`;
  if (timeScored(slug)) return `${(row.elapsed_ms / 1000).toFixed(2)} s`;
  if (slug === "memory-match")
    return `${row.moves} attempts · ${(row.elapsed_ms / 1000).toFixed(1)} s`;
  return `${Number(row.score).toLocaleString()} pts`;
}
function saveLine() {
  const el = $("#game-save-status");
  if (el) el.textContent = store.saveState();
  if (activeId && lastWritten) {
    const row = store.rows().find((x) => x.id === activeId);
    if (row && recordSignature(row.data) === lastWritten)
      revision = row.revision;
  }
}
async function persist() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!active || owner() !== player) return;
  const scoped = player;
  try {
    const data = snapshot();
    lastWritten = recordSignature(data);
    await store.put(data, activeId, scoped, revision);
    if (owner() === scoped) saveLine();
  } catch (e) {
    $("#game-save-status").textContent =
      `Save failed · ${e.message} Keep this page open and retry.`;
  }
}
function queueSave() {
  if (!saveTimer) saveTimer = setTimeout(persist, 500);
}
function slotId(slug, mode) {
  const n =
    Object.keys(GAMES).indexOf(slug) * 10 +
    Object.keys(GAMES[slug].modes).indexOf(mode) +
    1;
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}
function readyUI() {
  if ($("#game-human-side"))
    $("#game-human-side").closest("label").hidden = difficulty() === "local";
  if (!active) {
    presenter.reset();
    if ($("#game-setup")) $("#game-setup").open = true;
    root.dataset.runState = "ready";
    $("#game-run-label").textContent = "Ready to play";
  }
  const row = store
    .rows()
    .filter(
      (r) =>
        r.data.game === game &&
        r.data.difficulty === difficulty() &&
        r.data.state.status === "playing",
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  $("#game-restore").hidden = !row || running;
  $("#game-restore").dataset.id = row?.id || "";
  $("#game-best").textContent = displayResult(
    priorBest(game, difficulty()),
    game,
  );
  $("#game-mode-note").textContent =
    $("#game-mode").value === "public"
      ? "Public · sign-in required; completed uninterrupted runs submit automatically."
      : isBoard()
        ? "Private · play a computer opponent or take turns on this device. Progress saves automatically."
        : "Private · pause, undo where available, and continue saved progress.";
}
const SHAPES = [
  '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
  '<circle cx="12" cy="12" r="8"/>',
  '<path d="m12 3 9 9-9 9-9-9z"/>',
  '<path d="M4 19 12 4l8 15z"/>',
  '<rect x="5" y="5" width="14" height="14" rx="3"/>',
  '<path d="M4 8 8 4l4 4 4-4 4 4-8 13z"/>',
  '<path d="M5 5h14v14H5zM5 12h14M12 5v14"/>',
  '<path d="m4 12 4-7h8l4 7-4 7H8z"/>',
  '<path d="M5 19 19 5M5 5l14 14M4 12h16M12 4v16"/>',
  '<path d="M6 20V4h12v16M6 9h12M6 15h12"/>',
  '<path d="M4 17 9 5l6 14 5-12"/>',
  '<path d="M4 12c0-11 16-11 16 0s-16 11-16 0M8 12h8"/>',
];
function draw(reason = "view", event = null) {
  if (!active) return;
  presenter.prepare(active, { running, reason, event });
  const board = $("#game-board"),
    selected = document.activeElement?.dataset.cell,
    hadFocus = board.contains(document.activeElement);
  board.dataset.active = String(running);
  root.dataset.runState = running
    ? "playing"
    : active.status === "playing"
      ? "paused"
      : "complete";
  $("#game-run-label").textContent = running
    ? `${publicSession ? "Public" : "Private"} · Playing`
    : active.status === "playing"
      ? "Private · Paused"
      : "Game complete";
  if (game === "2048") presenter.render2048(board, active);
  if (game === "minesweeper") {
    const m = rules(game, active.difficulty),
      seen = new Set(active.revealed),
      flags = new Set(active.flags);
    $("#mine-count").textContent =
      `${m.mines} mines · ${flags.size} flags · ${m.mines - flags.size} remaining`;
    patchMarkup(
      board,
      `<div class="mines-viewport" tabindex="0" aria-label="Scrollable minefield"><div class="mines-grid" style="grid-template-columns:repeat(${m.w},32px)">${active.board
        .map((n, i) => {
          const open = seen.has(i),
            mine = active.status === "lost" && n === -1;
          return `<button data-cell="${i}" data-number="${open ? n : ""}" tabindex="${i === Number(selected || 0) ? 0 : -1}" class="${open ? "open" : ""} ${mine ? "mine" : ""} ${flags.has(i) ? "flagged" : ""}" aria-label="Row ${Math.floor(i / m.w) + 1}, column ${(i % m.w) + 1}: ${mine ? "mine" : open ? `${n} neighboring mines` : flags.has(i) ? "flagged" : "covered"}">${mine ? "✹" : flags.has(i) ? "⚑" : open ? n || "" : ""}</button>`;
        })
        .join("")}</div></div>`,
    );
  }
  if (game === "snake") {
    if (!board.querySelector("canvas"))
      patchMarkup(
        board,
        '<canvas class="snake-board" width="460" height="460" role="img" aria-label="Snake board. Use direction controls to move."></canvas>',
      );
    if (!presenter.paintSnake(board.querySelector("canvas"), active)) {
      pause("Canvas is unavailable. Enable canvas drawing to play Snake.");
      return;
    }
  }
  if (game === "memory-match") {
    const m = rules(game, active.difficulty);
    patchMarkup(
      board,
      `<div class="memory-grid" style="grid-template-columns:repeat(${m.cols},minmax(0,1fr))">${active.cards
        .map((n, i) => {
          const matched = active.matched.includes(i),
            up = matched || active.faceUp.includes(i);
          return `<button class="memory-card ${matched ? "matched" : up ? "face-up" : ""}" data-cell="${i}" aria-label="Card ${i + 1}: ${up ? `shape ${n + 1}${matched ? ", matched" : ""}` : "face down"}" aria-pressed="${up}"><span class="memory-inner" aria-hidden="true"><span class="memory-face memory-back"><span>✦</span></span><span class="memory-face memory-front"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${SHAPES[n]}</svg><span class="memory-match-check">✓</span></span></span></button>`;
        })
        .join("")}</div>`,
    );
  }
  if (ui && ui.render(board) === false && running) {
    pause("Drawing is unavailable. Try another browser to play this game.");
    return;
  }
  if (hadFocus && selected !== undefined)
    board
      .querySelector(`[data-cell="${selected}"]`)
      ?.focus({ preventScroll: true });
  $("#game-score-label").textContent = isBoard()
    ? "Current turn"
    : game === "sudoku"
      ? "Filled cells"
      : game === "nonogram"
        ? "Filled squares"
        : game === "memory-match"
          ? "Attempts"
          : game === "minesweeper"
            ? "Safe squares"
            : "Score";
  $("#game-score").textContent = isBoard()
    ? active.status === "playing"
      ? `Player ${active.turn}`
      : active.winner === 0
        ? "Draw"
        : `Player ${active.winner}`
    : game === "sudoku"
      ? `${active.board.filter(Boolean).length} / 81`
      : game === "nonogram"
        ? active.board.filter((n) => n === 1).length
        : game === "memory-match"
          ? active.moves
          : game === "minesweeper"
            ? `${active.revealed.filter((i) => active.board[i] !== -1).length} / ${active.board.length - rules(game, active.difficulty).mines}`
            : active.score.toLocaleString();
  if ($("#game-hint")) $("#game-hint").disabled = !!publicSession || !running;
  $("#game-clock").textContent = clock(elapsed());
  $("#game-pause").disabled = !running;
  if ($("#game-undo"))
    $("#game-undo").disabled = !undo || !!publicSession || !running;
  $("#game-start").textContent =
    active.status === "playing" ? "Restart game" : "Play again →";
  $("#game-settings-change").hidden = active.status !== "playing";
  $("#game-mode").disabled = $("#game-difficulty").disabled =
    active.status === "playing";
  if ($("#game-human-side"))
    $("#game-human-side").disabled = active.status === "playing";
  $("#game-best").textContent = displayResult(
    bestResult(active, elapsed()),
    game,
  );
  presenter.commit(active);
  milestones.update(active, !!publicSession);
}
function beep() {
  if (!sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.frequency.value = 520;
    g.gain.setValueAtTime(0.035, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.08);
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.08);
  } catch {}
}
function downgrade(reason) {
  if (!publicSession) return;
  const id = publicSession.id;
  publicSession = null;
  events = [];
  $("#game-mode").value = "private";
  sessionCall("abandon", { session_id: id }).catch(() => {});
  status(`${reason} This run is now Private and can continue.`);
}
function pause(reason = "Paused.") {
  if (!running) return;
  accumulated = elapsed();
  running = false;
  cancelAnimationFrame(frameId);
  ui?.stop();
  presenter.reset(active);
  const wasPublic = !!publicSession;
  downgrade(reason);
  $("#game-overlay").hidden = false;
  $("#game-overlay-title").textContent = "Paused";
  $("#game-overlay-note").textContent = wasPublic
    ? `${reason} Public qualification ended. Continue as a Private game.`
    : `${reason} Progress is kept for Private play.`;
  status(
    wasPublic
      ? "Paused · now Private. Continue when ready."
      : "Paused · Private progress retained.",
  );
  draw();
  persist();
}
function resume() {
  if (!active || active.status !== "playing" || running) return;
  presenter.reset(active);
  $("#game-overlay").hidden = true;
  started = performance.now();
  lastFrame = started;
  running = true;
  status("Private game in progress.");
  draw();
  $("#game-board").focus();
  frameId = requestAnimationFrame(frame);
}
async function submit() {
  if (!pending || busy || pending.owner !== owner()) return;
  busy = true;
  $("#game-submit-retry").hidden = true;
  status("Verifying your completed Public run…");
  presenter.setSubmission("verifying", "Verifying Public result…");
  const submitted = pending;
  try {
    const result = await sessionCall("finish", submitted.body);
    await pendingResult(game, null, true).catch(() => {});
    if (pending === submitted) pending = null;
    $("#game-submit-discard").hidden = true;
    status(
      result.qualified
        ? `Public result verified · ${displayResult(result, game)}. Best results appear on the board.`
        : result.reason ||
            "Game complete. This result did not qualify for the public board.",
    );
    presenter.setSubmission(
      result.qualified ? "verified" : "unqualified",
      result.qualified
        ? "Verified · Public result accepted"
        : result.reason || "Not eligible for the public board",
    );
    await leaderboard();
    await milestones.accepted(result, submitted.body.session_id);
  } catch (e) {
    status(
      e.message +
        " Your result is retained; retry submission or keep it Private.",
    );
    presenter.setSubmission(
      "failed",
      "Submission failed · result retained for retry",
    );
    $("#game-submit-retry").hidden = false;
    $("#game-submit-discard").hidden = false;
  } finally {
    busy = false;
  }
}
async function finish() {
  accumulated = elapsed();
  running = false;
  cancelAnimationFrame(frameId);
  ui?.stop();
  draw();
  beep();
  status(
    isBoard()
      ? ui.resultText()
      : active.status === "won"
        ? "Complete. Nicely played."
        : game === "2048"
          ? "No moves remain. Your game is complete."
          : "Game over. Ready for another try?",
  );
  // 先锁定本局提交，防止本机写入期间重新开局丢失已完成的 Public 结果。
  let completed = null;
  if (publicSession && player === owner()) {
    completed = pending = {
      game,
      owner: owner(),
      body: {
        session_id: publicSession.id,
        events,
        final_tick: active.ticks || 0,
        ...(game === "brick-breaker" ? { events_format: "paddle-v1" } : {}),
        ...(game === "block-drop" ? { events_format: "block-drop-v1" } : {}),
      },
    };
    publicSession = null;
    presenter.setSubmission("verifying", "Verifying Public result…");
  }
  await persist();
  if (completed && pending === completed && owner() === completed.owner) {
    await pendingResult(game, completed).catch((e) => status(e.message));
    await submit();
  }
}
function frame(now) {
  if (!running) return;
  if (now - lastFrame > 1500) {
    pause("The game was interrupted.");
    return;
  }
  lastFrame = now;
  if (publicSession && elapsed() > 7199000) {
    pause("Public session time limit reached.");
    return;
  }
  ui?.frame?.(now);
  if (game === "block-drop") {
    const tick = Math.floor((elapsed() * 60) / 1000);
    if (tick > active.ticks) {
      advanceDrop(active, tick);
      draw();
      queueSave();
    }
  } else if (game === "brick-breaker") {
    const tick = Math.min(18000, Math.floor((elapsed() * 60) / 1000));
    if (tick > active.ticks) {
      advanceBrick(active, tick);
      draw();
      queueSave();
    }
  } else if (game === "snake") {
    const tick = Math.floor(
      (elapsed() * rules(game, active.difficulty).rate) / 1000,
    );
    if (tick > active.ticks) {
      const oldScore = active.score;
      advanceSnake(active, tick);
      draw();
      queueSave();
      if (active.score > oldScore) beep();
    }
  } else if (
    game === "memory-match" &&
    active.holdUntil &&
    elapsed() >= active.holdUntil
  ) {
    settleMemory(active, elapsed());
    draw();
    queueSave();
  }
  presenter.frame(now);
  if (now - lastClock > 200) {
    $("#game-clock").textContent = clock(elapsed());
    lastClock = now;
  }
  if (active.status !== "playing") {
    finish();
    return;
  }
  frameId = requestAnimationFrame(frame);
}
function action(event) {
  if (!running || busy || !active || owner() !== player) return false;
  if (
    isBoard() &&
    active.difficulty !== "local" &&
    !event.computer &&
    active.turn !== (active.humanSide || 1)
  )
    return false;
  const priorMax = game === "2048" ? Math.max(...active.board) : 0;
  const old =
    undoable() && !publicSession && !event.computer
      ? structuredClone(active)
      : null;
  const e = {
    ...event,
    t: Math.floor(elapsed()),
    ...(game === "snake" ? { tick: active.ticks } : {}),
  };
  if (!apply(active, e)) return false;
  if (publicSession) {
    events.push(
      game === "block-drop"
        ? [e.tick, DROP_INPUTS.indexOf(e.input)]
        : game === "brick-breaker"
          ? [e.tick, e.type === "launch" ? -1 : e.x]
          : e,
    );
    if (events.length >= 20000) downgrade("The replay limit was reached.");
  }
  if (!event.computer) undo = old;
  draw("action", e);
  queueSave();
  if (game !== "snake") beep();
  if (game === "2048" && Math.max(...active.board) >= 2048 && priorMax < 2048)
    status("2048 reached! Keep playing until no moves remain.");
  if (active.status !== "playing") finish();
  return true;
}
async function start() {
  if (busy) return;
  if (pending) {
    status("Retry the pending Public result before starting another run.");
    $("#game-submit-retry").hidden = false;
    return;
  }
  if (
    active?.status === "playing" &&
    !confirm("Restart this game? Your current position will be replaced.")
  )
    return;
  if (running) {
    accumulated = elapsed();
    running = false;
    cancelAnimationFrame(frameId);
  }
  ui?.reset();
  presenter.reset();
  const mode = isBoard() ? "private" : $("#game-mode").value,
    diff = difficulty();
  downgrade("The previous run was restarted.");
  $("#game-mode").value = mode;
  if (mode === "public" && !api.user) {
    api.openAuth(location.pathname);
    return;
  }
  busy = true;
  $("#game-start").disabled = true;
  try {
    let seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1,
      nextSession = null;
    if (mode === "public") {
      await ensureProfile();
      status("Starting a verified Public session…");
      nextSession = await sessionCall("start", { game, difficulty: diff });
      if (nextSession.version !== VERSION)
        throw Error("Game rules changed. Reload this page before starting.");
      seed = Number(nextSession.seed);
    }
    active = create(game, diff, seed);
    if (isBoard()) active.humanSide = Number($("#game-human-side").value);
    publicSession = nextSession;
    events = [];
    undo = null;
    accumulated = 0;
    activeId = slotId(game, diff);
    revision = store.rows().find((r) => r.id === activeId)?.revision || 0;
    started = performance.now();
    lastFrame = started;
    running = true;
    $("#game-overlay").hidden = true;
    $("#game-restore").hidden = true;
    status(
      mode === "public"
        ? "Public game in progress. Stay on this page to remain eligible."
        : "Private game in progress. Progress saves automatically.",
    );
    draw();
    queueSave();
    $("#game-board").focus();
    frameId = requestAnimationFrame(frame);
  } catch (e) {
    status(e.message);
    if (active?.status === "playing") {
      publicSession = null;
      $("#game-mode").value = "private";
      $("#game-overlay").hidden = false;
      $("#game-overlay-title").textContent = "Previous game kept";
      $("#game-overlay-note").textContent =
        "The new game could not start. Retry, or continue your previous position privately.";
      draw();
    }
  } finally {
    busy = false;
    $("#game-start").disabled = false;
  }
}
async function restore() {
  if (busy || running) return;
  try {
    const row = await store.get($("#game-restore").dataset.id);
    if (!row) throw Error("That save was removed. Refresh saves to try again.");
    const data = validateSave(row.data);
    active = data.state;
    activeId = row.id;
    revision = row.revision;
    accumulated = data.elapsed;
    publicSession = null;
    events = [];
    undo = null;
    ui?.reset();
    presenter.reset(active);
    if ($("#game-human-side"))
      $("#game-human-side").value = String(active.humanSide || 1);
    $("#game-difficulty").value = data.difficulty;
    $("#game-mode").value = "private";
    $("#game-restore").hidden = true;
    resume();
    draw();
  } catch (e) {
    status(e.message);
  }
}
async function leaderboard() {
  if (!game || !isRanked(game)) return;
  const mode = difficulty(),
    dest = $("#game-leaderboard"),
    note = $("#game-leaderboard-status");
  note.textContent = "Loading leaderboard…";
  $("#game-board-note").textContent =
    game === "memory-match"
      ? "Fewer attempts, then faster completion."
      : timeScored(game)
        ? "Completed puzzles · fastest time first."
        : game === "2048"
          ? "Highest score, then largest tile."
          : game === "brick-breaker"
            ? "Most points, then faster completion."
            : game === "block-puzzle"
              ? "Most points · each cleared line adds 10."
              : "Highest score for this speed.";
  try {
    if (!api.client)
      throw Error("Leaderboard service unavailable. Private play still works.");
    const { data, error } = await api.client.rpc("get_game_leaderboard", {
      game,
      difficulty: mode,
    });
    if (error) throw error;
    if (difficulty() !== mode) return;
    patchMarkup(
      dest,
      data.top.length
        ? `<table><caption>${esc(rules(game, mode).label)} · rules v${Number(data.version)}</caption><thead><tr><th>#</th><th>Player</th><th>Result</th></tr></thead><tbody>${data.top.map((r) => `<tr data-player-id="${esc(r.public_id)}" data-rank="${Number(r.rank)}" class="${data.me?.public_id === r.public_id ? "is-me" : ""}"><td>${Number(r.rank)}</td><td><a class="game-player" href="/profile/?id=${encodeURIComponent(r.public_id)}"><span class="avatar-badge" data-game-avatar="${esc(r.public_id)}" data-preserve aria-hidden="true"></span>${esc(r.nickname)}</a><small>${esc(new Date(r.achieved_at).toLocaleDateString())}</small></td><td>${esc(displayResult(r, game))}</td></tr>`).join("")}</tbody></table>`
        : `<div class="game-empty-state">${gameIcon(game)}<strong>A spot for your first best.</strong><p>No verified results yet. Complete a Public game to make the first little mark.</p></div>`,
    );
    for (const row of data.top) {
      const avatar = dest.querySelector(
        `[data-game-avatar="${CSS.escape(row.public_id)}"]`,
      );
      const signature = JSON.stringify(row.profile);
      if (avatarSignatures.get(avatar) !== signature) {
        paintAvatar(avatar, row.profile);
        avatarSignatures.set(avatar, signature);
      }
    }
    $("#game-my-rank").innerHTML = data.me
      ? `<p class="game-my-result">Your rank: #${Number(data.me.rank)} · ${esc(displayResult(data.me, game))}</p>`
      : '<p class="muted">No qualifying Public result for this difficulty yet.</p>';
    note.textContent = "Current rules · Top 50 · one best result per player.";
  } catch {
    note.textContent =
      "Leaderboard could not load. Use Refresh to retry; Private play is available.";
  }
}
async function renderSaves() {
  const node = $("#game-saves");
  if (!node) return;
  const rows = store.rows().filter((r) => r.data.state?.status === "playing");
  node.innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            `<div class="saved-game-row"><div><strong>${esc(r.data.name || title(r.data))}${r.conflict ? " · conflict copy" : ""}</strong><small>Private · ${esc(new Date(r.updated_at).toLocaleString())} · ${clock(r.data.elapsed)}</small></div><div><a class="button secondary" href="/games/${encodeURIComponent(r.data.game)}/?save=${encodeURIComponent(r.id)}">Continue</a><button class="text-link" data-delete-save="${esc(r.id)}">Delete</button></div></div>`,
        )
        .join("")
    : '<div class="game-empty-state"><strong>A fresh start is a good start.</strong><p>No unfinished games yet. Pick a game above; your Private progress will appear here.</p></div>';
  $("#games-more").hidden = !store.hasMore();
  saveLine();
  $("#games-copy-guest").hidden =
    !api.user || !(await store.guestRows()).length;
}
async function initDirectory() {
  if (directoryBound) return;
  directoryBound = true;
  bindCardDemos();
  let category = "all";
  const filter = () => {
    let count = 0;
    for (const c of document.querySelectorAll("[data-game-card]")) {
      c.hidden =
        !(category === "all" || c.dataset.category === category) ||
        !c.dataset.search.includes($("#game-search").value.toLowerCase());
      if (!c.hidden) count++;
    }
    $("#games-empty").hidden = !!count;
  };
  $("#game-search").addEventListener("input", filter);
  $("#game-filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-game-filter]");
    if (!b) return;
    category = b.dataset.gameFilter;
    for (const x of $("#game-filters").children) {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    }
    filter();
  });
  // 载入模块前已经输入的搜索词也要生效；目录筛选不依赖 IndexedDB。
  filter();
  $("[data-games-directory]").dataset.ready = "true";
  $("#games-sync").onclick = guard(async () => {
    await store.flush();
    await store.load(true);
    renderSaves();
  });
  $("#games-more").onclick = guard(async () => {
    await store.load();
    renderSaves();
  });
  $("#games-clear").onclick = guard(async () => {
    if (
      !confirm(
        "Clear all Private progress and local bests for this identity? Public leaderboard results remain.",
      )
    )
      return;
    await store.clear();
    renderSaves();
  });
  $("#game-saves").onclick = guard(async (e) => {
    const b = e.target.closest("[data-delete-save]");
    if (b && confirm("Delete this private game save?")) {
      await store.remove(b.dataset.deleteSave);
      renderSaves();
    }
  });
  $("#games-copy-guest").onclick = async () => {
    if (
      !confirm(
        "Copy guest saves into your account? Guest originals remain on this device.",
      )
    )
      return;
    try {
      for (const row of await store.guestRows())
        await store.put(validateSave(row.data), row.id, owner(), 0);
      renderSaves();
    } catch (e) {
      $("#game-save-status").textContent = e.message;
    }
  };
  store.subscribe(guard(renderSaves));
  await renderSaves();
}
function bindGame() {
  player = owner();
  $("#game-difficulty").innerHTML = Object.entries(GAMES[game].modes)
    .map(([id, m]) => `<option value="${id}">${esc(m.label)}</option>`)
    .join("");
  $("#game-difficulty").value = GAMES[game].default;
  $("#game-mode").value = api.user && isRanked(game) ? "public" : "private";
  $("#game-best").parentElement.hidden = isBoard();
  if ($("#game-hint")) $("#game-hint").onclick = () => ui?.hint();
  $("#game-start").onclick = start;
  $("#game-pause").onclick = () => pause();
  $("#game-resume").onclick = resume;
  $("#game-settings-change").onclick = async () => {
    if (busy) return;
    if (
      publicSession &&
      !confirm(
        "Changing settings ends Public qualification. Keep this position Private and choose new settings?",
      )
    )
      return;
    pause("Game settings were opened.");
    await persist();
    ui?.reset();
    presenter.reset();
    active = null;
    activeId = null;
    undo = null;
    lastWritten = "";
    $("#game-overlay").hidden = true;
    $("#game-mode").disabled = $("#game-difficulty").disabled = false;
    if ($("#game-human-side")) $("#game-human-side").disabled = false;
    $("#game-settings-change").hidden = true;
    $("#game-start").textContent = "Start game →";
    $("#game-board").innerHTML =
      '<p class="game-board-empty">Choose your settings, then start a new game.<br>Your previous position remains in Games.</p>';
    status("Position saved privately. Choose settings for your next game.");
    readyUI();
  };
  $("#game-restore").onclick = restore;
  $("#game-submit-retry").onclick = submit;
  $("#game-submit-discard").onclick = async () => {
    if (
      busy ||
      !confirm(
        "Keep this result Private and discard the pending Public submission?",
      )
    )
      return;
    await pendingResult(game, null, true);
    pending = null;
    presenter.setSubmission(
      "private",
      "Public submission discarded · kept Private",
    );
    $("#game-submit-retry").hidden = $("#game-submit-discard").hidden = true;
    status("Public submission discarded. Your Private result remains saved.");
  };
  $("#game-save-retry").onclick = async () => {
    await persist();
    await store.flush();
    saveLine();
  };
  $("#game-board-refresh").onclick = leaderboard;
  const narrow = matchMedia("(max-width: 760px)");
  const rankPanel = $("#game-rank-panel");
  const fitSide = () => {
    if (rankPanel) rankPanel.open = !narrow.matches;
  };
  fitSide();
  narrow.addEventListener("change", fitSide);
  $("#game-difficulty").onchange = () => {
    readyUI();
    leaderboard();
  };
  $("#game-mode").onchange = readyUI;
  $("#game-help").onclick = () => {
    pause("Help was opened.");
    $("#game-help-dialog").showModal();
  };
  $("#game-help-dialog .dialog-close").onclick = () =>
    $("#game-help-dialog").close();
  $("#game-sound").onclick = () => {
    sound = !sound;
    $("#game-sound").textContent = sound ? "Sound on" : "Sound off";
    $("#game-sound").setAttribute("aria-pressed", String(sound));
    if (sound) beep();
  };
  if ($("#game-undo"))
    $("#game-undo").onclick = () => {
      if (!undo || publicSession || !running) return;
      ui?.stop();
      active = undo;
      presenter.reset(active);
      undo = null;
      draw();
      queueSave();
      status("One move undone · Private.");
    };
  for (const b of document.querySelectorAll("[data-dir]"))
    b.onclick = () => {
      action({
        type: game === "snake" ? "turn" : "move",
        dir: Number(b.dataset.dir),
      });
      $("#game-board").focus();
    };
  for (const b of document.querySelectorAll("[data-mine-mode]"))
    b.onclick = () => {
      mineMode = b.dataset.mineMode;
      for (const x of document.querySelectorAll("[data-mine-mode]"))
        x.setAttribute("aria-pressed", String(x === b));
      $("#game-board").focus();
    };
  const board = $("#game-board");
  board.onclick = (e) => {
    if (ui?.handleClick(e)) return;
    if (!["memory-match", "minesweeper"].includes(game)) return;
    const b = e.target.closest("[data-cell]");
    if (!b) return;
    const index = Number(b.dataset.cell);
    action({
      type:
        game === "memory-match"
          ? "flip"
          : active?.revealed.includes(index)
            ? "chord"
            : mineMode,
      index,
    });
  };
  board.oncontextmenu = (e) => {
    if (game === "minesweeper" && e.target.closest("[data-cell]")) {
      e.preventDefault();
      action({
        type: "flag",
        index: Number(e.target.closest("[data-cell]").dataset.cell),
      });
    }
  };
  board.onkeydown = (e) => {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (ui?.handleKey(e)) return;
    if (e.key === "Escape" && running) {
      e.preventDefault();
      pause();
      return;
    }
    const dir = {
      ArrowUp: 0,
      w: 0,
      W: 0,
      ArrowRight: 1,
      d: 1,
      D: 1,
      ArrowDown: 2,
      s: 2,
      S: 2,
      ArrowLeft: 3,
      a: 3,
      A: 3,
    }[e.key];
    if (dir !== undefined && ["2048", "snake"].includes(game)) {
      e.preventDefault();
      action({ type: game === "snake" ? "turn" : "move", dir });
    } else if (game === "minesweeper" && active) {
      const cell = Number(document.activeElement.dataset.cell || 0),
        m = rules(game, active.difficulty);
      if (dir !== undefined) {
        e.preventDefault();
        const next = Math.max(
          0,
          Math.min(active.board.length - 1, cell + [-m.w, 1, m.w, -1][dir]),
        );
        board.querySelector(`[data-cell="${next}"]`)?.focus();
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        action({ type: "flag", index: cell });
      }
    }
  };
  let pointer;
  board.addEventListener("pointerdown", (e) => {
    if (["2048", "snake"].includes(game) && running) {
      pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
      board.setPointerCapture(e.pointerId);
    }
  });
  board.addEventListener("pointerup", (e) => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const dx = e.clientX - pointer.x,
      dy = e.clientY - pointer.y;
    pointer = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    action({
      type: game === "snake" ? "turn" : "move",
      dir: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0,
    });
  });
  board.addEventListener("pointercancel", () => (pointer = null));
  ui?.bind?.(board);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause("The page went into the background.");
  });
  window.addEventListener("pagehide", () => {
    pause("The game page was left.");
    persist();
    audio?.close().catch(() => {});
  });
  window.addEventListener("offline", () => {
    if (publicSession) pause("The connection was interrupted.");
  });
  window.addEventListener("record-conflict", (e) => {
    if (e.detail.kind === "game" && e.detail.from === activeId) {
      activeId = e.detail.to;
      revision = store.rows().find((r) => r.id === activeId)?.revision || 1;
      status("A newer save exists. Your position was kept as a conflict copy.");
    }
  });
  store.subscribe(() => {
    saveLine();
    if (!active) readyUI();
  });
}
try {
  await store.ready();
  if (game) {
    bindGame();
    readyUI();
    pending = await pendingResult(game).catch(() => null);
    if (pending) {
      $("#game-submit-retry").hidden = $("#game-submit-discard").hidden = false;
      status(
        "A completed Public result is waiting. Retry submission or keep it Private before a new game.",
      );
    }
    root.dataset.ready = "true";
    leaderboard();
  } else await initDirectory();
  await store.load(true);
  await store.flush();
  if (game) {
    readyUI();
    const requested = new URLSearchParams(location.search).get("save");
    if (requested) {
      const r = await store.get(requested);
      if (r?.data.game === game) {
        $("#game-difficulty").value = r.data.difficulty;
        $("#game-restore").dataset.id = r.id;
        $("#game-restore").hidden = false;
        status(
          "Saved game ready. Choose Continue saved game to play privately.",
        );
      }
    }
  } else renderSaves();
} catch (e) {
  if (game && !root.dataset.ready) {
    bindGame();
    readyUI();
    root.dataset.ready = "true";
    leaderboard();
  }
  if (!game) await initDirectory().catch(() => {});
  $("#game-save-status").textContent =
    `Local storage unavailable · ${e.message} You can play, but this browser cannot preserve progress.`;
}
