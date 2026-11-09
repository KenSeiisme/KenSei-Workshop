import {
  hubOwner,
  recordActivity,
  saveLocalScore,
  syncHub,
} from "./hub-store.js";
import { uiError, uiMsg, uiText } from "../site/ui.js";

export function trackGame(game, panel) {
  let run, request, form;
  const now = () => performance.now();
  function sample() {
    if (run?.anchor !== null && run?.anchor !== undefined) {
      const time = now();
      run.activeMs += time - run.anchor;
      run.anchor = time;
    }
  }
  function flush() {
    if (!run) return Promise.resolve();
    sample();
    const { owner, id, segmentId, mode, finished, score, started, activeMs } =
      run;
    return recordActivity(owner, {
      id,
      segmentId,
      game,
      mode,
      started,
      finished: !!finished,
      score,
      activeMs: Math.min(86400000, Math.round(activeMs)),
    });
  }
  function checkpoint() {
    flush().catch(() => {});
  }
  function setActive(active) {
    if (!run || active === (run.anchor !== null)) return;
    sample();
    run.anchor = active ? now() : null;
    if (!active) checkpoint();
  }
  function mountScore(data) {
    if (!panel || !data || form) return;
    form = document.createElement("form");
    form.className = "hub-local-score";
    const label = document.createElement("label"),
      input = document.createElement("input"),
      save = document.createElement("button"),
      status = document.createElement("span");
    const labelText = document.createElement("span");
    uiText(labelText, uiMsg("Local leaderboard nickname"));
    input.required = true;
    input.autocomplete = "off";
    input.maxLength = 48;
    label.append(labelText, input);
    save.className = "button secondary";
    uiText(save, uiMsg("Save to local board"));
    status.setAttribute("role", "status");
    form.append(label, save, status);
    const resultRun = run;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (hubOwner() !== resultRun.owner || run !== resultRun) return;
      save.disabled = true;
      try {
        await saveLocalScore(
          resultRun.owner,
          { ...resultRun, game },
          input.value,
          data,
        );
        input.disabled = true;
        uiText(status, uiMsg("Saved on this device."));
      } catch (error) {
        uiText(status, uiError(error));
        save.disabled = false;
      }
    });
    panel.append(form);
  }
  function update(value) {
    request = value;
    if (!value?.id || value.owner !== hubOwner()) {
      setActive(false);
      run = null;
      form?.remove();
      form = null;
      return;
    }
    if (run?.id !== value.id || run.owner !== value.owner) {
      setActive(false);
      form?.remove();
      form = null;
      run = {
        id: value.id,
        owner: value.owner,
        mode: value.mode,
        started: value.started !== false,
        segmentId: crypto.randomUUID(),
        activeMs: 0,
        anchor: null,
      };
      checkpoint();
    }
    setActive(value.active && !document.hidden);
    if (value.finished && !run.finished) {
      run.finished = true;
      run.score = value.points ?? value.score?.score ?? 0;
      checkpoint();
      mountScore(value.score);
    }
  }
  function refresh() {
    update(request);
    syncHub().catch(() => {});
  }
  setInterval(() => {
    if (run?.anchor != null && !document.hidden) checkpoint();
  }, 15000);
  window.addEventListener("online", refresh);
  window.addEventListener("workspace-ready", refresh);
  window.addEventListener("pagehide", () => setActive(false));
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setActive(false);
    else refresh();
  });
  return update;
}

export function trackBoardGame(game, panel) {
  const update = trackGame(game, panel);
  return ({ state, room, saveId, identity, paused, mode, human, started }) => {
    const phase = state?.phase;
    const played =
      phase &&
      (!room ||
        [
          "playing",
          "scoring",
          "disputed",
          "finished",
          "interrupted",
          "unresolved",
        ].includes(room.status));
    if (!played) return update(null);
    const result = state.result;
    const finished =
      phase === "finished" &&
      ([1, -1, 0].includes(result?.winner) || result?.reason === "both-lose") &&
      !["interrupted", "unresolved", "no-result"].includes(result.reason);
    const side =
      room?.color ?? room?.side ?? (mode === "ai" ? human : result?.winner);
    update({
      id: room?.id || saveId,
      owner: identity,
      started: room ? true : started,
      mode:
        game === "go"
          ? `${state.config.rule}:${state.config.size}`
          : state.config.clock,
      active:
        !paused && phase !== "finished" && (!room || room.controller !== false),
      finished,
      score: finished
        ? { wins: Number(result.winner !== 0 && result.winner === side) }
        : null,
    });
  };
}
