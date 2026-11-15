import { api } from "/tool-scripts/common.js";
import { uiFrom, uiHtml, uiMsg, uiText } from "../site/ui.js";
import { localizedPath, modeLabel } from "./hub-rankings.js";
import { gameIcon } from "./presentation.js";
import { patchMarkup } from "./dom.js";
import { MATCH_ID } from "./match-link.js";

const statuses = {
  waiting: "Waiting for an opponent",
  ready: "Waiting for Ready",
  playing: "In play",
  scoring: "Confirming the score",
  disputed: "Scoring dispute",
  paused: "Waiting to resume",
};
const games = new Set(["go", "chess", "xiangqi", "pong"]);

export function mountLiveGames(root, name) {
  const list = root.querySelector("[data-live-game-list]");
  const status = root.querySelector("[data-live-game-status]");
  const retry = root.querySelector("[data-live-game-retry]");
  let owner,
    clockOffset = 0,
    matches = [],
    request,
    failed = false;

  function paint() {
    const now = Date.now() + clockOffset;
    const visible = matches.filter(
      ({ deadline }) => !deadline || Date.parse(deadline) > now,
    );
    root.hidden = !owner || (!visible.length && !failed);
    retry.hidden = !failed;
    uiText(
      status,
      failed
        ? uiMsg("Online matches could not load. Retry when connected.")
        : "",
    );
    patchMarkup(
      list,
      visible
        .map((match) => {
          const { id, game, status, rule, size, clock, score, deadline } =
            match;
          const detail =
            game === "pong"
              ? uiMsg("Score · {0}–{1}", score)
              : modeLabel(game, game === "go" ? `${rule}:${size}` : clock);
          return uiHtml`<article class="hub-live-match">
        <span class="hub-live-icon">${gameIcon(game)}</span>
        <div><strong>${name(game)}</strong><p class="small muted">${uiFrom(statuses[status])} · ${detail}
        <span data-live-deadline="${deadline || ""}"></span></p></div>
        <a class="button secondary" href="${localizedPath("/games/" + game + "/")}?match=${id}">${uiMsg("Return to match")}</a>
      </article>`;
        })
        .join(""),
    );
    updateCountdowns();
  }

  function updateCountdowns() {
    for (const node of list.querySelectorAll("[data-live-deadline]")) {
      if (!node.dataset.liveDeadline) continue;
      const remaining = Math.ceil(
        (Date.parse(node.dataset.liveDeadline) - Date.now() - clockOffset) /
          1000,
      );
      if (remaining <= 0) {
        paint();
        return;
      }
      uiText(node, uiMsg("· {0} s remaining", [remaining]));
    }
  }

  async function refresh() {
    const nextOwner = api.user?.id;
    if (owner !== nextOwner) {
      owner = nextOwner;
      matches = [];
      request = null;
      failed = false;
      paint();
    }
    if (!owner || document.hidden || request || !api.client) return;
    const pending = {};
    request = pending;
    try {
      const query = api.client.rpc("get_my_live_games");
      const { data, error } = await (query.abortSignal?.(
        AbortSignal.timeout(10000),
      ) ?? query);
      if (request !== pending || owner !== api.user?.id) return;
      if (error) throw error;
      clockOffset = Number(data?.server_now ?? Date.now()) - Date.now();
      matches = (data?.matches || []).filter(
        ({ id, game, status }) =>
          MATCH_ID.test(id) &&
          games.has(game) &&
          Object.hasOwn(statuses, status),
      );
      failed = false;
    } catch {
      if (request !== pending || owner !== api.user?.id) return;
      failed = true;
    } finally {
      if (request === pending) {
        request = null;
        paint();
      }
    }
  }

  retry.onclick = refresh;
  for (const event of ["workspace-ready", "online", "focus", "pageshow"])
    window.addEventListener(event, refresh);
  window.addEventListener("locale-change", paint);
  document.addEventListener("visibilitychange", refresh);
  setInterval(refresh, 15000);
  setInterval(() => {
    if (!document.hidden && !root.hidden) updateCountdowns();
  }, 1000);
  refresh();
}
