import { DAILY_REWARD, dailyTaskProgress, malaysiaReset } from "./hub-model.js";
import { claimDailyReward, hubOwner } from "./hub-store.js";
import { gameIcon } from "./presentation.js";
import { patchMarkup } from "./dom.js";
import { uiDate, uiError, uiHtml, uiMsg, uiText } from "../site/ui.js";

const checkIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/></svg>';
const exploreIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="11" height="11" rx="2"/><path d="M10 17v2a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"/></svg>';

export function mountDailyChallenge(root, gameName, reload) {
  const $ = (selector) => root.querySelector(selector);
  const list = $("[data-hub-tasks]");
  const clock = $("[data-hub-reset]");
  const status = $("[data-hub-claim-status]");
  const deadline = () => snapshot?.resetAt ?? malaysiaReset(snapshot?.day);
  let snapshot, owner, claim, expiredDay;

  function render() {
    const {
      day,
      featured,
      today = [],
      manualClaims,
      claimedTasks = [],
    } = snapshot || {};
    const expired = Date.now() >= deadline();
    const offline = owner !== "guest" && !navigator.onLine;
    uiText(
      $("[data-hub-day]"),
      day
        ? uiMsg("{0} · Malaysia time", [
            uiDate(day + "T00:00:00Z", { dateStyle: "long", timeZone: "UTC" }),
          ])
        : uiMsg("Resets at midnight in Malaysia."),
    );
    $("[data-hub-claim-note]").hidden = !manualClaims;
    const labels = [
      uiMsg("Complete any game"),
      uiMsg("Complete two different games"),
      uiMsg("Complete {0}", [gameName(featured) || "—"]),
    ];
    const icons = [checkIcon, exploreIcon, gameIcon(featured)];
    patchMarkup(
      list,
      dailyTaskProgress(expired ? [] : today, featured)
        .map(({ id, value, target }, i) => {
          const complete = value === target;
          const claimed =
            !expired &&
            complete &&
            (manualClaims ? claimedTasks.includes(id) : true);
          const available = manualClaims && complete && !claimed && !expired;
          const text = claimed
            ? uiMsg("Claimed")
            : expired
              ? uiMsg("Refreshing tasks…")
              : uiMsg("+{0} coins", [DAILY_REWARD]);
          return uiHtml`<li data-complete="${complete}" data-daily-task="${id}">
        <span class="hub-task-icon">${icons[i]}</span>
        <div class="hub-task-body"><span id="daily-label-${id}">${labels[i]}</span>
          <div class="hub-task-progress"><progress class="hub-progress" value="${value}" max="${target}" aria-labelledby="daily-label-${id}"></progress><small>${value}/${target}</small></div>
        </div>
        ${available ? uiHtml`<button type="button" class="button secondary" data-daily-claim="${id}" ${claim || offline ? "disabled" : ""}>${claim?.task === id ? uiMsg("Claiming…") : uiMsg("Claim +{0} coins", [DAILY_REWARD])}</button>` : uiHtml`<small class="hub-task-state">${text}</small>`}
      </li>`;
        })
        .join(""),
    );
    if (offline && manualClaims && !claim)
      uiText(status, uiMsg("Go online to claim account rewards."));
  }

  function tick() {
    if (document.hidden) return;
    const until = deadline();
    if (!Number.isFinite(until)) {
      if (clock.firstChild) clock.firstChild.nodeValue = "--:--:--";
      return;
    }
    const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    const value = [
      Math.floor(seconds / 3600),
      Math.floor(seconds / 60) % 60,
      seconds % 60,
    ]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
    if (clock.firstChild) clock.firstChild.nodeValue = value;
    if (!seconds && snapshot.day !== expiredDay) {
      expiredDay = snapshot.day;
      uiText(status, "");
      render();
      reload();
    }
  }

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-daily-claim]");
    if (
      !button ||
      claim ||
      !snapshot?.manualClaims ||
      owner !== hubOwner() ||
      Date.now() >= deadline()
    )
      return;
    const pending = {
      owner,
      task: button.dataset.dailyClaim,
      day: snapshot.day,
    };
    claim = pending;
    uiText(status, "");
    render();
    try {
      await claimDailyReward(pending.owner, pending.day, pending.task);
      if (claim === pending && owner === hubOwner())
        uiText(status, uiMsg("Reward added to your balance."));
    } catch (error) {
      if (claim === pending && owner === hubOwner())
        uiText(status, uiError(error));
    } finally {
      if (claim === pending) {
        claim = null;
        reload();
        render();
      }
    }
  });
  setInterval(tick, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
  window.addEventListener("offline", render);
  window.addEventListener("online", () => {
    uiText(status, "");
    render();
  });
  return (value) => {
    if (owner !== hubOwner()) {
      owner = hubOwner();
      claim = null;
      expiredDay = null;
      uiText(status, "");
    }
    snapshot = value;
    render();
    tick();
  };
}
