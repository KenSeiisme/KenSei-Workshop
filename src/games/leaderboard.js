import { api, esc } from "/tool-scripts/common.js";
import { paintAvatar } from "/tool-scripts/profile-service.js";
import { rules, isRanked, timeScored } from "./engine.js";
import { gameIcon } from "./presentation.js";
import { patchMarkup } from "./dom.js";

// 只读取已验证成绩；榜单控件不调用游戏的暂停、开局或保存逻辑。
export function mountLeaderboard(root, game, formatResult) {
  const panel = root?.querySelector("#game-rank-panel");
  if (!panel || !isRanked(game)) return { refresh: async () => {} };
  const $ = (selector) => panel.querySelector(selector),
    destination = $("#game-leaderboard"),
    note = $("#game-leaderboard-status"),
    more = $("#game-board-more"),
    refreshButton = $("#game-board-refresh"),
    signatures = new WeakMap();
  let requestId = 0,
    expanded = false,
    loadedKey = "",
    data = null,
    disposed = false;
  const selection = () => ({
    difficulty: root.querySelector("#game-difficulty").value,
    version: $("#game-board-version").value,
    owner: api.user?.id || "guest",
  });
  const keyOf = (value) => JSON.stringify(value);
  function showRows() {
    for (const [index, row] of [
      ...destination.querySelectorAll("tbody tr"),
    ].entries())
      row.hidden = !expanded && index >= 10;
    more.hidden = !data || data.top.length <= 10;
    more.textContent = expanded ? "Show Top 10" : "Show Top 50";
    more.setAttribute("aria-expanded", String(expanded));
  }
  more.onclick = () => {
    expanded = !expanded;
    showRows();
  };
  $("#game-board-collapse").onclick = (event) => {
    const content = $("#game-leaderboard-content"),
      button = event.currentTarget;
    content.hidden = !content.hidden;
    button.textContent = content.hidden ? "Show" : "Hide";
    button.setAttribute("aria-expanded", String(!content.hidden));
  };
  async function refresh() {
    const selected = selection();
    if (!selected.difficulty || disposed) return;
    const id = ++requestId,
      key = keyOf(selected);
    if (key !== loadedKey) {
      data = null;
      expanded = false;
      patchMarkup(destination, "");
      $("#game-my-rank").textContent = "";
      more.hidden = true;
    }
    $("#game-board-difficulty").textContent = rules(
      game,
      selected.difficulty,
    ).label;
    $("#game-board-note").textContent =
      game === "memory-match"
        ? "Fewer attempts, then faster completion."
        : timeScored(game) ||
            (game === "block-drop" && selected.difficulty === "sprint")
          ? "Completed runs · fastest time first."
          : game === "2048"
            ? "Highest score, then largest tile."
            : game === "block-drop"
              ? "Highest score, then lines cleared."
              : game === "brick-breaker"
                ? "Most points, then faster completion."
                : "Highest score · one best per player.";
    note.textContent = "Loading leaderboard…";
    refreshButton.disabled = true;
    const current = () =>
      !disposed && id === requestId && keyOf(selection()) === key;
    try {
      if (!api.client) throw Error("Leaderboard service unavailable.");
      const { data: result, error } = await api.client.rpc(
        selected.version === "current"
          ? "get_game_leaderboard"
          : "get_game_leaderboard_history",
        {
          game,
          difficulty: selected.difficulty,
          ...(selected.version === "current"
            ? {}
            : { rules_version: Number(selected.version) }),
        },
      );
      if (!current()) return;
      if (error) throw error;
      if (!Array.isArray(result?.top))
        throw Error("Invalid leaderboard response.");
      data = result;
      loadedKey = key;
      patchMarkup(
        destination,
        data.top.length
          ? `<table><caption>${esc(rules(game, selected.difficulty).label)} · rules v${Number(data.version)}</caption><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Result</th></tr></thead><tbody>${data.top.map((row, index) => `<tr data-player-id="${esc(row.public_id)}" data-rank="${Number(row.rank)}" class="${data.me?.public_id === row.public_id ? "is-me" : ""}"${!expanded && index >= 10 ? " hidden" : ""}><td>${Number(row.rank)}</td><td><a class="game-player" href="/profile/?id=${encodeURIComponent(row.public_id)}"><span class="avatar-badge" data-game-avatar="${esc(row.public_id)}" data-preserve aria-hidden="true"></span>${esc(row.nickname)}</a><small>${esc(new Date(row.achieved_at).toLocaleDateString())}</small></td><td>${esc(formatResult({ ...row, difficulty: selected.difficulty }, game))}</td></tr>`).join("")}</tbody></table>`
          : `<div class="game-empty-state">${gameIcon(game)}<strong>Your next run could be the first.</strong><p>No verified results yet. Sign in and complete a new game.</p></div>`,
      );
      for (const row of data.top) {
        const avatar = destination.querySelector(
          `[data-game-avatar="${CSS.escape(row.public_id)}"]`,
        );
        const signature = JSON.stringify(row.profile);
        if (avatar && signatures.get(avatar) !== signature) {
          paintAvatar(avatar, row.profile);
          signatures.set(avatar, signature);
        }
      }
      $("#game-my-rank").innerHTML = data.me
        ? `<p class="game-my-result">Your rank: <strong>#${Number(data.me.rank)}</strong><br>${esc(formatResult({ ...data.me, difficulty: selected.difficulty }, game))}</p>`
        : `<p class="muted small">${api.user ? "Your ranked best · No verified result yet." : "Sign in to record your ranked best."}</p>`;
      note.textContent = `${selected.version === "current" ? "Current rules" : "Previous rules · archived"} · ${Math.min(50, data.top.length)} ranked players.`;
      showRows();
    } catch {
      if (!current()) return;
      note.textContent =
        "Leaderboard unavailable. Refresh to retry; you can still play.";
      if (!data) $("#game-my-rank").textContent = "Rank unavailable";
    } finally {
      if (current()) refreshButton.disabled = false;
    }
  }
  refreshButton.onclick = refresh;
  $("#game-board-version").onchange = refresh;
  let lastOwner = api.user?.id || "guest";
  window.addEventListener("workspace-ready", () => {
    const nextOwner = api.user?.id || "guest";
    if (nextOwner !== lastOwner) {
      lastOwner = nextOwner;
      refresh();
    }
  });
  window.addEventListener("pagehide", () => {
    disposed = true;
    requestId++;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      disposed = false;
      refresh();
    }
  });
  return { refresh };
}
