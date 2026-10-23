import { api, esc } from "/tool-scripts/common.js";
import { ACHIEVEMENTS, liveValue } from "./achievement-catalog.js";
import { patchMarkup } from "./dom.js";
import { playCue } from "./audio.js";
export { ACHIEVEMENTS };
export function achievementCard(def, unlocked, progress = 0, live = 0) {
  const date = unlocked?.unlocked_at;
  return `<article class="milestone-card${unlocked ? " is-unlocked" : ""}" data-achievement="${esc(def.id)}"><span class="milestone-badge" aria-hidden="true">${unlocked ? "✦" : "◇"}</span><div><h3>${esc(def.name)}</h3><p>${esc(def.description)}</p>${date ? `<time datetime="${esc(date)}">Unlocked · ${esc(new Date(date).toLocaleDateString())}</time>` : `<progress max="${def.target}" value="${Math.min(def.target, progress)}" aria-label="${esc(def.name)} verified progress"></progress><small>${Math.min(def.target, progress)} / ${def.target} verified</small>${live >= def.target ? '<p class="milestone-live">Target reached · finish and submit Public to verify.</p>' : ""}`}</div></article>`;
}
export function renderPublicAchievements(node, rows = []) {
  if (!node) return;
  const safe = rows.filter((r) =>
    ACHIEVEMENTS.some((d) => d.id === r.achievement_id),
  );
  patchMarkup(
    node,
    safe.length
      ? safe
          .map((row) =>
            achievementCard(
              ACHIEVEMENTS.find((d) => d.id === row.achievement_id),
              row,
            ),
          )
          .join("")
      : '<p class="muted">No verified milestones yet. A first Public result is a good start.</p>',
  );
}
export function mountAchievements(game = null) {
  const panel = document.querySelector("#game-milestones"),
    progressPanel = document.querySelector("#games-progress");
  if (!panel && !progressPanel)
    return { update() {}, refresh: async () => {}, accepted: async () => {} };
  let record = null,
    account = null,
    loadId = 0,
    current = null,
    publicRun = false,
    visualSignature = "";
  const shown = new Set();
  function render() {
    const signed = !!api.user;
    if (progressPanel) progressPanel.hidden = !signed;
    if (panel) {
      const defs = ACHIEVEMENTS.filter((d) => d.game === game);
      const list = panel.querySelector(".milestone-list");
      patchMarkup(
        list,
        defs
          .map((d) =>
            achievementCard(
              d,
              record?.unlocks?.find((u) => u.achievement_id === d.id),
              record?.progress?.[d.id] || 0,
              publicRun ? liveValue(d, current) : 0,
            ),
          )
          .join(""),
      );
      panel.querySelector(".game-progress-status").textContent = !signed
        ? "Sign in and complete Public runs to unlock milestones."
        : record
          ? "Only qualifying, server-verified Public results count."
          : "Verified progress could not load. Retry to refresh.";
    }
    if (progressPanel && signed) {
      progressPanel.querySelector("#progress-results").textContent =
        record?.result_count ?? "—";
      progressPanel.querySelector("#progress-games").textContent = record
        ? `${record.game_count} / 9`
        : "—";
      progressPanel.querySelector("#progress-achievements").textContent = record
        ? `${record.unlocks.length} / 30`
        : "—";
      progressPanel.querySelector(".game-progress-status").textContent = record
        ? "Verified Public results · Private runs are excluded."
        : "Progress could not load. Retry when connected.";
      const rows = record?.unlocks || [];
      renderPublicAchievements(
        progressPanel.querySelector("#progress-recent"),
        rows.slice(0, 6),
      );
      patchMarkup(
        progressPanel.querySelector("#progress-all"),
        ACHIEVEMENTS.map((d) =>
          achievementCard(
            d,
            rows.find((r) => r.achievement_id === d.id),
            record?.progress?.[d.id] || 0,
          ),
        ).join(""),
      );
    }
  }
  async function refresh() {
    const owner = api.user?.id,
      id = ++loadId;
    account = owner;
    record = null;
    render();
    if (!owner || !api.client) return;
    const { data, error } = await api.client.rpc("get_my_game_progress", {});
    if (id !== loadId || api.user?.id !== owner) return;
    if (!error && data) record = data;
    render();
  }
  for (const b of document.querySelectorAll("[data-progress-refresh]"))
    b.addEventListener("click", () => refresh().catch(() => render()));
  const checkAccount = () => {
    if (account !== api.user?.id) {
      current = null;
      publicRun = false;
      refresh().catch(() => render());
    }
  };
  window.addEventListener("workspace-ready", checkAccount);
  window.addEventListener("profile-updated", checkAccount);
  const accountTimer = setInterval(checkAccount, 500);
  window.addEventListener(
    "pagehide",
    () => {
      clearInterval(accountTimer);
      loadId++;
    },
    { once: true },
  );
  refresh().catch(() => render());
  return {
    update(state, isPublic) {
      current = state;
      publicRun = isPublic;
      const signature = JSON.stringify([
        isPublic,
        ...ACHIEVEMENTS.filter((d) => d.game === game).map((d) =>
          liveValue(d, state),
        ),
      ]);
      if (panel && signature !== visualSignature) {
        visualSignature = signature;
        render();
      }
    },
    refresh,
    async accepted(result, sessionId) {
      if (!result.qualified || account !== api.user?.id) return;
      const unlocked = (result.new_achievements || []).filter(
        (r) => !shown.has(`${sessionId}:${r.achievement_id}`),
      );
      for (const r of unlocked) shown.add(`${sessionId}:${r.achievement_id}`);
      if (unlocked.length && panel) {
        playCue("milestone");
        let note = panel.querySelector(".achievement-notice");
        if (!note) {
          note = document.createElement("p");
          note.className = "achievement-notice";
          note.setAttribute("role", "status");
          panel.append(note);
        }
        note.textContent = `Milestone unlocked · ${unlocked
          .map((r) => ACHIEVEMENTS.find((d) => d.id === r.achievement_id)?.name)
          .filter(Boolean)
          .join(" · ")}`;
      }
      await refresh();
    },
  };
}
