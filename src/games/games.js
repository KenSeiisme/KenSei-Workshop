import { mountAudio, unlockAudio, stopAudio, observeAudio } from "./audio.js";
import { api, esc } from "/tool-scripts/common.js";
import { ensureProfile } from "/tool-scripts/profile-service.js";
import {
  createRecordStore,
  recordSignature,
} from "/tool-scripts/record-store.js";
import {
  GAMES,
  gameVersion,
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
import { mountPlayShell } from "./play-shell.js";
import { mountLeaderboard } from "./leaderboard.js";
import {
  uiDate,
  uiSource,
  uiMsg,
  uiJoin,
  uiFrom,
  uiError,
  uiText,
  uiHtml,
  uiConfirm,
} from "../site/ui.js";

mountEffects();
mountAudio();

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
  audioSnapshot = null,
  player,
  localFallbackAvailable = false,
  startFailed = false,
  submissionStatus = "local";
const presenter = game ? createGamePresenter(root, game) : null;
const milestones = mountAchievements(game);
const rankedBoard = mountLeaderboard(root, game, displayResult);
const newRunIsRanked = () => !!api.user && isRanked(game);
const currentRunIsRanked = () =>
  !!publicSession || !!pending || submissionStatus === "verified";
const eligibilityLabel = () => {
  if (!active) return newRunIsRanked() ? "Ranked" : "Local only";
  if (pending)
    return submissionStatus === "failed" ? "Submission pending" : "Verifying";
  if (submissionStatus === "verified") return "Verified";
  if (submissionStatus === "unqualified") return "Not ranked";
  return publicSession ? "Ranked" : "Local only";
};
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
const shell = mountPlayShell(root, { beforeCover: coverGame });
function coverGame() {
  if (
    running &&
    publicSession &&
    !uiConfirm(
      uiMsg(
        "Opening this panel pauses your ranked run. It will continue locally without ranking. Continue?",
      ),
    )
  )
    return false;
  pause("A game panel was opened.");
  return true;
}
function syncShell() {
  if (!game || !$("#game-difficulty").value) return;
  const saved =
    !active &&
    store.rows().find((row) => row.id === $("#game-restore").dataset.id);
  root.dataset.runEligibility = (
    active ? currentRunIsRanked() : newRunIsRanked()
  )
    ? "ranked"
    : "local";
  shell?.update({
    state: !active
      ? "ready"
      : running
        ? "playing"
        : active.status === "playing"
          ? "paused"
          : "complete",
    label: uiMsg("{0} · {1}", [
      uiFrom(eligibilityLabel()),
      uiFrom(rules(game, difficulty()).label),
    ]),
    startFailed,
    localFallback: localFallbackAvailable,
    saveInfo: saved
      ? `${rules(game, saved.data.difficulty).label} · ${uiDate(new Date(saved.updated_at), { dateStyle: "medium", timeStyle: "short" })} · Local only`
      : "",
    busy,
    pending: !!pending,
    saveId: $("#game-restore").hidden ? "" : $("#game-restore").dataset.id,
    legacy: saved?.data?.state?.version === 1 && game === "brick-breaker",
  });
}
function statusMessage(message) {
  status(uiFrom(message));
}
const elapsed = () => accumulated + (running ? performance.now() - started : 0);
const status = (message) => {
  if ($("#game-status")) uiText($("#game-status"), uiFrom(message));
};
let directoryBound = false;
const guard =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      uiText(
        $("#game-save-status"),
        uiJoin([
          uiError(e),
          uiMsg(
            " Your current game remains available; retry when storage is ready.",
          ),
        ]),
      );
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
function priorBest(slug, mode, version = active?.version || gameVersion(slug)) {
  return store
    .rows()
    .filter(
      (x) =>
        x.data.game === slug &&
        x.data.difficulty === mode &&
        x.data.state.version === version &&
        x.data.best,
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
    return uiMsg("{0} attempts · {1} s", [
      row.moves,
      (row.elapsed_ms / 1000).toFixed(1),
    ]);
  return uiMsg("{0} pts", [Number(row.score).toLocaleString()]);
}
function saveLine() {
  const el = $("#game-save-status");
  if (el) uiText(el, uiFrom(store.saveState()));
  if (game) {
    const failed = /fail|error|unavailable/i.test(uiSource(el));
    $("#game-save-retry").hidden = !failed;
    $("#game-save-line").hidden =
      !active && $("#game-restore").hidden && !failed;
  }
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
    uiText(
      $("#game-save-status"),
      uiMsg("Save failed · {0} Keep this page open and retry.", [uiError(e)]),
    );
    $("#game-save-retry").hidden = false;
    $("#game-save-line").hidden = false;
  }
}
function queueSave() {
  if (!saveTimer) saveTimer = setTimeout(persist, 500);
}
function slotId(slug, mode, version = gameVersion(slug)) {
  const n =
    (version === 2 ? 1000 : 0) +
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
    shell?.restorePreview();
    root.dataset.runState = "ready";
    uiText($("#game-run-label"), uiMsg("Ready to play"));
    if (uiSource($("#game-status")).trim() === "Loading game…")
      status(uiMsg("Ready when you are."));
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
  uiText($("#game-best"), displayResult(priorBest(game, difficulty()), game));
  uiText(
    $("#game-eligibility-note"),
    newRunIsRanked()
      ? uiMsg("New games rank automatically after verification.")
      : isBoard()
        ? uiMsg("Play locally. Progress saves automatically.")
        : uiMsg("Local best on this device. Sign in for ranked results."),
  );
  const setup = $("#game-setup");
  const oneOption = $("#game-difficulty").options.length === 1;
  setup.classList.toggle("has-one-option", oneOption);
  $("#game-sign-in").hidden = !!api.user || isBoard();
  if (row) $("#game-save-line").hidden = false;
  saveLine();
  syncShell();
}
const SHAPES = [
  uiHtml('<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>'),
  uiHtml('<circle cx="12" cy="12" r="8"/>'),
  uiHtml('<path d="m12 3 9 9-9 9-9-9z"/>'),
  uiHtml('<path d="M4 19 12 4l8 15z"/>'),
  uiHtml('<rect x="5" y="5" width="14" height="14" rx="3"/>'),
  uiHtml('<path d="M4 8 8 4l4 4 4-4 4 4-8 13z"/>'),
  uiHtml('<path d="M5 5h14v14H5zM5 12h14M12 5v14"/>'),
  uiHtml('<path d="m4 12 4-7h8l4 7-4 7H8z"/>'),
  uiHtml('<path d="M5 19 19 5M5 5l14 14M4 12h16M12 4v16"/>'),
  uiHtml('<path d="M6 20V4h12v16M6 9h12M6 15h12"/>'),
  uiHtml('<path d="M4 17 9 5l6 14 5-12"/>'),
  uiHtml('<path d="M4 12c0-11 16-11 16 0s-16 11-16 0M8 12h8"/>'),
];
function draw(reason = "view", event = null) {
  if (!active) return;
  root.dataset.runEligibility = currentRunIsRanked() ? "ranked" : "local";
  observeAudio(audioSnapshot, active, event || {});
  audioSnapshot = structuredClone(active);
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
  uiText(
    $("#game-run-label"),
    running
      ? uiMsg("{0} · Playing", [
          publicSession ? uiMsg("Ranked") : uiMsg("Local only"),
        ])
      : active.status === "playing"
        ? uiMsg("Local only · Paused")
        : uiMsg("Game complete"),
  );
  if (game === "2048") presenter.render2048(board, active);
  if (game === "minesweeper") {
    const m = rules(game, active.difficulty),
      seen = new Set(active.revealed),
      flags = new Set(active.flags);
    uiText(
      $("#mine-count"),
      uiMsg("{0} mines · {1} flags · {2} remaining", [
        m.mines,
        flags.size,
        m.mines - flags.size,
      ]),
    );
    patchMarkup(
      board,
      uiHtml`<div class="mines-viewport" tabindex="0" aria-label="Scrollable minefield"><div class="mines-grid" style="grid-template-columns:repeat(${m.w},32px)">${active.board
        .map((n, i) => {
          const open = seen.has(i),
            mine = active.status === "lost" && n === -1;
          return uiHtml`<button data-cell="${i}" data-number="${open ? n : ""}" tabindex="${i === Number(selected || 0) ? 0 : -1}" class="${open ? "open" : ""} ${mine ? "mine" : ""} ${flags.has(i) ? "flagged" : ""}" aria-label="Row ${Math.floor(i / m.w) + 1}, column ${(i % m.w) + 1}: ${mine ? "mine" : open ? uiMsg("{0} neighboring mines", [n]) : flags.has(i) ? "flagged" : "covered"}">${mine ? "✹" : flags.has(i) ? "⚑" : open ? n || "" : ""}</button>`;
        })
        .join("")}</div></div>`,
    );
  }
  if (game === "snake") {
    if (!board.querySelector("canvas"))
      patchMarkup(
        board,
        uiHtml(
          '<canvas class="snake-board" width="460" height="460" role="img" aria-label="Snake board. Use direction controls to move."></canvas>',
        ),
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
      uiHtml`<div class="memory-grid" style="grid-template-columns:repeat(${m.cols},minmax(0,1fr));--memory-ratio:${(m.cols * m.cols * 0.82) / (m.pairs * 2)}">${active.cards
        .map((n, i) => {
          const matched = active.matched.includes(i),
            up = matched || active.faceUp.includes(i);
          return uiHtml`<button class="memory-card ${matched ? "matched" : up ? "face-up" : ""}" data-cell="${i}" aria-label="Card ${i + 1}: ${up ? uiMsg("shape {0}{1}", [n + 1, matched ? uiMsg(", matched") : ""]) : uiMsg("face down")}" aria-pressed="${up}"><span class="memory-inner" aria-hidden="true"><span class="memory-face memory-back"><span>✦</span></span><span class="memory-face memory-front"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${SHAPES[n]}</svg><span class="memory-match-check">✓</span></span></span></button>`;
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
  uiText(
    $("#game-score-label"),
    isBoard()
      ? uiMsg("Current turn")
      : game === "sudoku"
        ? uiMsg("Filled cells")
        : game === "nonogram"
          ? uiMsg("Filled squares")
          : game === "memory-match"
            ? uiMsg("Attempts")
            : game === "minesweeper"
              ? uiMsg("Safe squares")
              : uiMsg("Score"),
  );
  uiText(
    $("#game-score"),
    isBoard()
      ? active.status === "playing"
        ? uiMsg("Player {0}", [active.turn])
        : active.winner === 0
          ? uiMsg("Draw")
          : uiMsg("Player {0}", [active.winner])
      : game === "sudoku"
        ? `${active.board.filter(Boolean).length} / 81`
        : game === "nonogram"
          ? active.board.filter((n) => n === 1).length
          : game === "memory-match"
            ? active.moves
            : game === "minesweeper"
              ? `${active.revealed.filter((i) => active.board[i] !== -1).length} / ${active.board.length - rules(game, active.difficulty).mines}`
              : active.score.toLocaleString(),
  );
  if ($("#game-hint")) $("#game-hint").disabled = !!publicSession || !running;
  uiText(
    $("#game-clock"),
    clock(
      game === "brick-breaker" ? Math.max(0, 300000 - elapsed()) : elapsed(),
    ),
  );
  $("#game-pause").disabled = !running;
  if ($("#game-undo"))
    $("#game-undo").disabled = !undo || !!publicSession || !running;
  uiText(
    $("#game-start"),
    active.status === "playing" ? uiMsg("Restart") : uiMsg("Play again →"),
  );
  $("#game-start").classList.toggle("primary", active.status !== "playing");
  $("#game-start").classList.toggle("secondary", active.status === "playing");
  $("#game-run-label").dataset.rulesVersion = String(active.version);
  if (game === "brick-breaker")
    uiText($("#game-clock").previousElementSibling, uiMsg("Time left"));
  $("#game-settings-change").hidden = false;
  $("#game-settings-change").disabled = !!pending || busy;
  $("#game-difficulty").disabled = active.status === "playing";
  if ($("#game-human-side"))
    $("#game-human-side").disabled = active.status === "playing";
  uiText($("#game-best"), displayResult(bestResult(active, elapsed()), game));
  presenter.commit(active);
  milestones.update(active, !!publicSession);
  syncShell();
}
function downgrade(reason) {
  if (!publicSession) return;
  const id = publicSession.id;
  publicSession = null;
  submissionStatus = "local";
  events = [];
  sessionCall("abandon", { session_id: id }).catch(() => {});
  status(
    uiMsg("{0} This run is now local only and can continue.", [uiFrom(reason)]),
  );
}
function pause(reason = "Paused.") {
  stopAudio();
  if (!running) return;
  accumulated = elapsed();
  running = false;
  cancelAnimationFrame(frameId);
  ui?.stop();
  presenter.reset(active);
  const wasPublic = !!publicSession;
  downgrade(reason);
  $("#game-overlay").hidden = false;
  uiText($("#game-overlay-title"), uiMsg("Paused"));
  uiText(
    $("#game-overlay-note"),
    wasPublic
      ? uiMsg("{0} Ranking eligibility ended. Continue locally.", [
          uiFrom(reason),
        ])
      : uiMsg("{0} Progress is kept for local play.", [uiFrom(reason)]),
  );
  status(
    wasPublic
      ? uiMsg("Paused · Local only. Continue when ready.")
      : uiMsg("Paused · Progress retained."),
  );
  draw();
  persist();
}
function resume() {
  unlockAudio();
  audioSnapshot = null;
  if (!active || active.status !== "playing" || running) return;
  presenter.reset(active);
  $("#game-overlay").hidden = true;
  started = performance.now();
  lastFrame = started;
  running = true;
  status(uiMsg("Local only · Game in progress."));
  draw();
  $("#game-board").focus({ preventScroll: true });
  frameId = requestAnimationFrame(frame);
}
async function submit() {
  if (!pending || busy || pending.owner !== owner()) return;
  busy = true;
  $("#game-submit-retry").hidden = true;
  submissionStatus = "verifying";
  status(uiMsg("Verifying your completed run…"));
  presenter.setSubmission("verifying", uiMsg("Verifying result…"));
  const submitted = pending;
  try {
    const result = await sessionCall("finish", submitted.body);
    submissionStatus = result.qualified ? "verified" : "unqualified";
    await pendingResult(game, null, true).catch(() => {});
    if (pending === submitted) pending = null;
    $("#game-submit-discard").hidden = true;
    status(
      result.qualified
        ? uiMsg(
            "Verified result accepted · {0}. Best results appear on the board.",
            [displayResult(result, game)],
          )
        : result.reason ||
            uiMsg(
              "Game complete. This result did not qualify for the public board.",
            ),
    );
    presenter.setSubmission(
      result.qualified ? "verified" : "unqualified",
      result.qualified
        ? uiMsg("Verified · Ranked result accepted")
        : result.reason || uiMsg("Not eligible for the public board"),
    );
    await leaderboard();
    await milestones.accepted(result, submitted.body.session_id);
  } catch (e) {
    submissionStatus = "failed";
    status(
      uiJoin([
        uiError(e),
        uiMsg(" Your result is retained; retry submission or keep it locally."),
      ]),
    );
    presenter.setSubmission(
      "failed",
      uiMsg("Submission failed · result retained for retry"),
    );
    $("#game-submit-retry").hidden = false;
    $("#game-submit-discard").hidden = false;
  } finally {
    busy = false;
    syncShell();
  }
}
async function finish() {
  accumulated = elapsed();
  running = false;
  cancelAnimationFrame(frameId);
  ui?.stop();
  draw();
  status(
    isBoard()
      ? ui.resultText()
      : active.status === "won"
        ? uiMsg("Complete. Nicely played.")
        : game === "2048"
          ? uiMsg("No moves remain. Your game is complete.")
          : uiMsg("Game over. Ready for another try?"),
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
        ...(game === "brick-breaker"
          ? { events_format: active.version === 2 ? "paddle-v2" : "paddle-v1" }
          : {}),
        ...(game === "block-drop" ? { events_format: "block-drop-v1" } : {}),
      },
    };
    publicSession = null;
    presenter.setSubmission("verifying", uiMsg("Verifying result…"));
  }
  await persist();
  if (completed && pending === completed && owner() === completed.owner) {
    await pendingResult(game, completed).catch((e) => status(uiError(e)));
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
    uiText(
      $("#game-clock"),
      clock(
        game === "brick-breaker" ? Math.max(0, 300000 - elapsed()) : elapsed(),
      ),
    );
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

  if (game === "2048" && Math.max(...active.board) >= 2048 && priorMax < 2048)
    status(uiMsg("2048 reached! Keep playing until no moves remain."));
  if (active.status !== "playing") finish();
  return true;
}
async function start({ localOnly = false } = {}) {
  unlockAudio();
  if (busy) return;
  if (pending) {
    status(
      uiMsg("Retry the pending ranked result before starting another run."),
    );
    $("#game-submit-retry").hidden = false;
    return;
  }
  if (
    !active &&
    !$("#game-restore").hidden &&
    !uiConfirm(
      uiMsg(
        "Start a new game and replace the saved position for this difficulty?",
      ),
    )
  )
    return;
  if (
    active?.status === "playing" &&
    !uiConfirm(
      uiMsg("Restart this game? Your current position will be replaced."),
    )
  )
    return;
  if (running) {
    accumulated = elapsed();
    running = false;
    cancelAnimationFrame(frameId);
  }
  ui?.reset();
  presenter.reset();
  const mode = !localOnly && newRunIsRanked() ? "public" : "private",
    diff = difficulty();
  downgrade("The previous run was restarted.");
  busy = true;
  $("#game-start").disabled = true;
  localFallbackAvailable = false;
  startFailed = false;
  syncShell();
  try {
    let seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1,
      nextSession = null;
    if (mode === "public") {
      await ensureProfile();
      status(uiMsg("Starting a verified ranked session…"));
      nextSession = await sessionCall("start", {
        game,
        difficulty: diff,
        rules_version: gameVersion(game),
      });
      if (nextSession.version !== gameVersion(game))
        throw Error("Game rules changed. Reload this page before starting.");
      seed = Number(nextSession.seed);
    }
    audioSnapshot = null;
    active = create(game, diff, seed);
    if (isBoard()) active.humanSide = Number($("#game-human-side").value);
    publicSession = nextSession;
    submissionStatus = nextSession ? "ranked" : "local";
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
        ? uiMsg(
            "Ranked game in progress. Stay on this page to remain eligible.",
          )
        : uiMsg("Local only · Game in progress. Progress saves automatically."),
    );
    draw();
    queueSave();
    $("#game-board").focus({ preventScroll: true });
    frameId = requestAnimationFrame(frame);
  } catch (e) {
    startFailed = true;
    localFallbackAvailable = mode === "public";
    status(
      uiJoin([
        uiError(e),
        localFallbackAvailable
          ? uiMsg(" Retry, or choose Play locally without ranking.")
          : uiMsg(" Retry when ready."),
      ]),
    );
    if (active?.status === "playing") {
      publicSession = null;
      $("#game-overlay").hidden = false;
      uiText($("#game-overlay-title"), uiMsg("Previous game kept"));
      uiText(
        $("#game-overlay-note"),
        uiMsg(
          "The new game could not start. Retry, or continue your previous position locally.",
        ),
      );
      draw();
    }
  } finally {
    busy = false;
    $("#game-start").disabled = false;
    syncShell();
  }
}
async function restore() {
  if (busy || running) return;
  busy = true;
  syncShell();
  try {
    const row = await store.get($("#game-restore").dataset.id);
    if (!row) throw Error("That save was removed. Refresh saves to try again.");
    const data = validateSave(row.data);
    active = data.state;
    activeId = row.id;
    revision = row.revision;
    accumulated = data.elapsed;
    publicSession = null;
    submissionStatus = "local";
    events = [];
    undo = null;
    ui?.reset();
    presenter.reset(active);
    if ($("#game-human-side"))
      $("#game-human-side").value = String(active.humanSide || 1);
    $("#game-difficulty").value = data.difficulty;
    $("#game-restore").hidden = true;
    resume();
    draw();
  } catch (e) {
    status(uiError(e));
  } finally {
    busy = false;
    syncShell();
  }
}
async function leaderboard() {
  return rankedBoard.refresh();
}
async function renderSaves() {
  const node = $("#game-saves");
  if (!node) return;
  const rows = store.rows().filter((r) => r.data.state?.status === "playing");
  node.innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            uiHtml`<div class="saved-game-row"><div><strong>${esc(r.data.name || title(r.data))}${r.conflict ? uiMsg(" · conflict copy") : ""}</strong><small>${r.data.game === "brick-breaker" && r.data.state.version === 1 ? uiMsg("Legacy rules · v1 · ") : ""}Local only · ${uiDate(new Date(r.updated_at), { dateStyle: "medium", timeStyle: "short" })} · ${clock(r.data.elapsed)}</small></div><div><a class="button secondary" href="/games/${encodeURIComponent(r.data.game)}/?save=${encodeURIComponent(r.id)}">Continue</a><button class="text-link" data-delete-save="${esc(r.id)}">Delete</button></div></div>`,
        )
        .join("")
    : uiHtml(
        '<div class="game-empty-state"><strong>A fresh start is a good start.</strong><p>No unfinished games yet. Pick a game above; your saved games will appear here.</p></div>',
      );
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
      !uiConfirm(
        uiMsg(
          "Clear all saved games and local bests for this identity? Public leaderboard results remain.",
        ),
      )
    )
      return;
    await store.clear();
    renderSaves();
  });
  $("#game-saves").onclick = guard(async (e) => {
    const b = e.target.closest("[data-delete-save]");
    if (b && uiConfirm(uiMsg("Delete this private game save?"))) {
      await store.remove(b.dataset.deleteSave);
      renderSaves();
    }
  });
  $("#games-copy-guest").onclick = async () => {
    if (
      !uiConfirm(
        uiMsg(
          "Copy guest saves into your account? Guest originals remain on this device.",
        ),
      )
    )
      return;
    try {
      for (const row of await store.guestRows())
        await store.put(validateSave(row.data), row.id, owner(), 0);
      renderSaves();
    } catch (e) {
      uiText($("#game-save-status"), uiError(e));
    }
  };
  store.subscribe(guard(renderSaves));
  await renderSaves();
}
function bindGame() {
  player = owner();
  $("#game-difficulty").innerHTML = Object.entries(GAMES[game].modes)
    .map(([id, m]) => uiHtml`<option value="${id}">${uiFrom(m.label)}</option>`)
    .join("");
  $("#game-difficulty").value = GAMES[game].default;
  $("#game-best").parentElement.hidden = isBoard();
  if ($("#game-hint")) $("#game-hint").onclick = () => ui?.hint();
  $("#game-start").onclick = () => start();
  $("#game-start-local").onclick = () => {
    if (localFallbackAvailable) start({ localOnly: true });
  };
  $("#game-sign-in").onclick = () => api.openAuth(location.pathname);
  $("#game-pause").onclick = () => pause();
  $("#game-resume").onclick = resume;
  $("#game-settings-change").onclick = async () => {
    if (busy || pending) return;
    if (
      publicSession &&
      !uiConfirm(
        uiMsg(
          "Changing setup ends ranking eligibility. Keep this position saved and choose new settings?",
        ),
      )
    )
      return;
    pause("Game settings were opened.");
    await persist();
    ui?.reset();
    presenter.reset();
    active = null;
    localFallbackAvailable = false;
    startFailed = false;
    activeId = null;
    undo = null;
    lastWritten = "";
    $("#game-overlay").hidden = true;
    $("#game-difficulty").disabled = false;
    if ($("#game-human-side")) $("#game-human-side").disabled = false;
    $("#game-settings-change").hidden = true;
    uiText($("#game-start"), uiMsg("Start game →"));
    shell?.restorePreview();
    status(uiMsg("Position saved. Choose settings for your next game."));
    readyUI();
    shell?.closeDialogs();
    shell?.focusSetup();
  };
  $("#game-restore").onclick = restore;
  $("#game-submit-retry").onclick = submit;
  $("#game-submit-discard").onclick = async () => {
    if (
      busy ||
      !uiConfirm(
        uiMsg(
          "Keep this result locally and discard its pending ranked submission?",
        ),
      )
    )
      return;
    await pendingResult(game, null, true);
    pending = null;
    submissionStatus = "local";
    presenter.setSubmission(
      "private",
      uiMsg("Ranked submission discarded · Local only"),
    );
    $("#game-submit-retry").hidden = $("#game-submit-discard").hidden = true;
    status(uiMsg("Submission discarded. Your result remains saved locally."));
    syncShell();
  };
  $("#game-save-retry").onclick = async () => {
    await persist();
    await store.flush();
    saveLine();
  };
  const report = $("#game-result");
  if (report) $(".game-board-shell").append(report);
  $("#game-difficulty").onchange = () => {
    localFallbackAvailable = false;
    startFailed = false;
    readyUI();
    leaderboard();
  };
  $("#game-help").onclick = () => {
    if (!coverGame()) return;
    shell?.closeDialogs();
    $("#game-help-dialog").showModal();
  };
  $("#game-help-dialog .dialog-close").onclick = () =>
    $("#game-help-dialog").close();
  if ($("#game-undo"))
    $("#game-undo").onclick = () => {
      if (!undo || publicSession || !running) return;
      ui?.stop();
      active = undo;
      presenter.reset(active);
      undo = null;
      draw();
      queueSave();
      status(uiMsg("One move undone · Local only."));
    };
  for (const b of document.querySelectorAll("[data-dir]"))
    b.onclick = () => {
      action({
        type: game === "snake" ? "turn" : "move",
        dir: Number(b.dataset.dir),
      });
      $("#game-board").focus({ preventScroll: true });
    };
  for (const b of document.querySelectorAll("[data-mine-mode]"))
    b.onclick = () => {
      mineMode = b.dataset.mineMode;
      for (const x of document.querySelectorAll("[data-mine-mode]"))
        x.setAttribute("aria-pressed", String(x === b));
      $("#game-board").focus({ preventScroll: true });
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
    stopAudio();
  });
  window.addEventListener("offline", () => {
    if (publicSession) pause("The connection was interrupted.");
  });
  window.addEventListener("record-conflict", (e) => {
    if (e.detail.kind === "game" && e.detail.from === activeId) {
      activeId = e.detail.to;
      revision = store.rows().find((r) => r.id === activeId)?.revision || 1;
      status(
        uiMsg(
          "A newer save exists. Your position was kept as a conflict copy.",
        ),
      );
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
        uiMsg(
          "A completed ranked result is waiting. Retry submission or keep it locally before a new game.",
        ),
      );
    }
    syncShell();
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
          uiMsg("Saved game ready. Continue locally, or start a new game."),
        );
        syncShell();
        leaderboard();
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
  uiText(
    $("#game-save-status"),
    uiMsg(
      "Local storage unavailable · {0} You can play, but this browser cannot preserve progress.",
      [uiError(e)],
    ),
  );
}
