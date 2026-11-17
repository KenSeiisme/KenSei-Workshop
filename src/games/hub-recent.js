import { api, esc } from "/tool-scripts/common.js";
import { uiDate, uiFrom, uiHtml, uiMsg, uiText } from "../site/ui.js";
import { localizedPath, modeLabel } from "./hub-rankings.js";
import { boardResult } from "./board-result.js";
import { gameIcon } from "./presentation.js";
import { patchMarkup } from "./dom.js";
import { MATCH_ID } from "./match-link.js";

export const reviewGames = ["go", "chess", "xiangqi"];
const pageSize = 20;
const goClocks = {
  9: "5 min + 3 × 20 sec",
  13: "10 min + 3 × 30 sec",
  19: "20 min + 5 × 30 sec",
};

export function mountRecentMatches(root, name) {
  const $ = (selector) => root.querySelector(selector);
  const game = $("[data-recent-game]");
  const status = $("[data-recent-status]");
  const list = $("[data-recent-list]");
  const next = $("[data-recent-more]");
  const retry = $("[data-recent-retry]");
  let rows = [],
    owner,
    request,
    failed = false,
    more = false,
    scrollToHistory = false;

  function paint() {
    root.hidden = !owner;
    if (scrollToHistory && !root.hidden) {
      scrollToHistory = false;
      requestAnimationFrame(() =>
        root.scrollIntoView({ block: "start", behavior: "instant" }),
      );
    }
    next.hidden = !more || failed;
    next.disabled = !!request;
    retry.hidden = !failed;
    uiText(
      status,
      request
        ? uiMsg("Loading recent matches…")
        : failed
          ? uiMsg("Recent matches could not load. Retry when connected.")
          : rows.length
            ? ""
            : uiMsg("No completed online matches yet."),
    );
    patchMarkup(
      list,
      rows
        .map((row) => {
          const setting =
            row.game === "go" ? row.rule + ":" + row.size : row.clock;
          const clock = row.game === "go" && goClocks[row.clock];
          const link =
            localizedPath("/games/" + row.game + "/") + "?review=" + row.id;
          return uiHtml`<article class="hub-live-match">
        <span class="hub-live-icon">${gameIcon(row.game)}</span>
        <div><strong>${name(row.game)} · ${boardResult(row)}</strong>
        <p class="small muted">${row.opponent ? esc(row.opponent) : uiMsg("Opponent")} · ${modeLabel(row.game, setting)}
        ${clock ? uiHtml` · ${uiFrom(clock)}` : ""} ·
        ${uiDate(new Date(row.ended_at), { dateStyle: "medium", timeStyle: "short" })}</p></div>
        <a class="button secondary" href="${link}">${uiMsg("Review game")}</a>
      </article>`;
        })
        .join(""),
    );
  }

  async function load(append = false) {
    const nextOwner = api.user?.id;
    if (!append || owner !== nextOwner) {
      owner = nextOwner;
      rows = [];
      more = false;
      request = null;
    }
    if (!owner || !api.client || request) return paint();
    const pending = {};
    request = pending;
    failed = false;
    const last = rows.at(-1);
    paint();
    try {
      const query = api.client.rpc("get_my_board_match_history", {
        game_filter: game.value || null,
        before_time: last?.ended_at ?? null,
        before_id: last?.id ?? null,
      });
      const { data, error } = await (query.abortSignal?.(
        AbortSignal.timeout(10000),
      ) ?? query);
      if (request !== pending || owner !== api.user?.id) return;
      if (error || !Array.isArray(data))
        throw error || Error("Invalid match history");
      more = data.length > pageSize;
      rows.push(
        ...data
          .slice(0, pageSize)
          .filter(
            (row) =>
              MATCH_ID.test(row.id) &&
              reviewGames.includes(row.game) &&
              Number.isFinite(Date.parse(row.ended_at)),
          ),
      );
    } catch {
      if (request === pending) failed = true;
    } finally {
      if (request === pending) {
        request = null;
        paint();
      }
    }
  }
  function revealHistory() {
    if (location.hash !== "#hub-recent-title") return;
    root.open = true;
    scrollToHistory = true;
    paint();
  }
  window.addEventListener("hashchange", revealHistory);
  revealHistory();
  game.onchange = () => load();
  next.onclick = () => load(true);
  retry.onclick = () => load(!!rows.length);
  window.addEventListener("online", () => {
    if (failed) load();
  });
  window.addEventListener("workspace-ready", () => load());
  window.addEventListener("locale-change", paint);
  load();
}
