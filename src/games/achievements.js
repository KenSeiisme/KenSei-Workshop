import { api, esc } from "/tool-scripts/common.js";
import { ACHIEVEMENTS, liveValue } from "./achievement-catalog.js";
import { patchMarkup } from "./dom.js";
import { playCue } from "./audio.js";
import { uiDate, uiMsg, uiFrom, uiText, uiHtml } from "../site/ui.js";

export { ACHIEVEMENTS };
export function achievementCard(def, unlocked, progress = 0, live = 0) {
  const date = unlocked?.unlocked_at;
  return uiHtml`<article class="milestone-card${unlocked ? uiMsg(" is-unlocked") : ""}" data-achievement="${esc(def.id)}"><span class="milestone-badge" aria-hidden="true">${unlocked ? "✦" : "◇"}</span><div><h3>${uiFrom(def.name)}</h3><p>${uiFrom(def.description)}</p>${date ? uiHtml`<time datetime="${esc(date)}">Unlocked · ${uiDate(new Date(date), { year: "numeric", month: "short", day: "numeric" })}</time>` : uiHtml`<progress max="${def.target}" value="${Math.min(def.target, progress)}" aria-label="${uiFrom(def.name)} verified progress"></progress><small>${Math.min(def.target, progress)} / ${def.target} verified</small>${live >= def.target ? uiHtml('<p class="milestone-live">Target reached · finish and submit Public to verify.</p>') : ""}`}</div></article>`;
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
      : uiHtml(
          '<p class="muted">No verified milestones yet. A first Public result is a good start.</p>',
        ),
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
      uiText(
        panel.querySelector(".game-progress-status"),
        !signed
          ? uiMsg("Sign in and complete Public runs to unlock milestones.")
          : record
            ? uiMsg("Only qualifying, server-verified Public results count.")
            : uiMsg("Verified progress could not load. Retry to refresh."),
      );
    }
    if (progressPanel && signed) {
      uiText(
        progressPanel.querySelector("#progress-results"),
        record?.result_count ?? "—",
      );
      uiText(
        progressPanel.querySelector("#progress-games"),
        record ? `${record.game_count} / 9` : "—",
      );
      uiText(
        progressPanel.querySelector("#progress-achievements"),
        record ? `${record.unlocks.length} / 30` : "—",
      );
      uiText(
        progressPanel.querySelector(".game-progress-status"),
        record
          ? uiMsg("Verified Public results · Private runs are excluded.")
          : uiMsg("Progress could not load. Retry when connected."),
      );
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
        uiText(
          note,
          uiMsg("Milestone unlocked · {0}", [
            unlocked
              .map(
                (r) =>
                  ACHIEVEMENTS.find((d) => d.id === r.achievement_id)?.name,
              )
              .filter(Boolean)
              .join(" · "),
          ]),
        );
      }
      await refresh();
    },
  };
}
