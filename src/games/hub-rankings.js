import { api, esc } from "/tool-scripts/common.js";
import { isRanked, gameVersion } from "./engine.js";
import { BOARD_GAMES, modesFor, timedBoard } from "./hub-model.js";
import { patchMarkup } from "./dom.js";
import { uiFrom, uiHtml, uiMsg, uiText } from "../site/ui.js";

const onlineBoards = ["go", "chess", "xiangqi"];
export const hasVerifiedBoard = (game) =>
  isRanked(game) || onlineBoards.includes(game);
export const localizedPath = (path) =>
  location.pathname.startsWith("/zh-hant/") ? "/zh-hant" + path : path;
export const boardModes = (game, kind) => ({
  ...(kind === "local" && ["chess", "xiangqi"].includes(game)
    ? { none: { label: "Untimed" } }
    : {}),
  ...modesFor(game),
});
export function defaultBoardMode(game, kind = "verified") {
  if (kind === "local" && ["chess", "xiangqi"].includes(game)) return "none";
  return (
    { snake: "normal", go: "chinese:9", chess: "10+5", xiangqi: "10+5" }[
      game
    ] || Object.keys(boardModes(game, kind))[0]
  );
}
export function modeLabel(game, mode, kind) {
  if (game === "go") {
    const [rule, size] = mode.split(":");
    return uiMsg("{0} · {1}×{1}", [
      uiFrom({ chinese: "Chinese", japanese: "Japanese", aga: "AGA" }[rule]),
      size,
    ]);
  }
  return uiFrom(boardModes(game, kind)[mode]?.label || mode);
}
export function resultLabel(game, mode, row) {
  if (BOARD_GAMES.includes(game)) return uiMsg("{0} wins", [row.wins || 0]);
  if (game === "memory-match")
    return uiMsg("{0} attempts · {1} s", [
      row.moves,
      (row.elapsed_ms / 1000).toFixed(2),
    ]);
  if (timedBoard(game, mode))
    return uiMsg("{0} s", [(row.elapsed_ms / 1000).toFixed(2)]);
  return uiMsg("{0} pts", [row.score]);
}
export function playTime(ms = 0) {
  const minutes = Math.floor(ms / 60000);
  return minutes < 1
    ? uiMsg("{0} s", [Math.floor(ms / 1000)])
    : uiMsg("{0} h {1} min", [Math.floor(minutes / 60), minutes % 60]);
}
export const playerName = (row) => row.nickname || row.profile?.nickname || "—";

export async function readVerifiedBoard(game, mode) {
  if (!api.client || !hasVerifiedBoard(game))
    throw Error("Leaderboard unavailable");
  let rpc = "get_game_leaderboard";
  let args = { game, difficulty: mode };
  if (game === "go") {
    const [rule_name, size] = mode.split(":");
    rpc = "get_board_game_leaderboard";
    args = {
      game_name: game,
      rule_name,
      board_size: Number(size),
      sort_by: "wins",
      rules_version: 1,
    };
  } else if (onlineBoards.includes(game)) {
    rpc = `get_${game}_leaderboard`;
    args = { time_control: mode, sort_by: "wins", rules_version: 1 };
  }
  const { data, error } = await api.client.rpc(rpc, args);
  if (error || !Array.isArray(data?.top))
    throw error || Error("Invalid leaderboard response.");
  if (
    ["snake", "brick-breaker"].includes(game) &&
    data.version !== gameVersion(game)
  )
    return { top: [], me: null };
  return data;
}

export function mountRankPreviews(root) {
  const cards = [...root.querySelectorAll("[data-rank-preview]")];
  for (const card of cards) {
    const game = card.dataset.rankPreview;
    const mode = defaultBoardMode(game);
    const status = card.querySelector("[data-preview-status]");
    const rows = card.querySelector("[data-preview-rows]");
    const retry = card.querySelector("[data-preview-retry]");
    let wanted = false,
      generation = 0,
      owner,
      loading = false,
      current,
      failed = false;

    function render() {
      uiText(
        card.querySelector("[data-preview-mode]"),
        modeLabel(game, mode, "verified"),
      );
      const leaders = current?.top.slice(0, 3) || [];
      uiText(
        status,
        failed
          ? uiMsg("Leaderboard unavailable.")
          : !current
            ? uiMsg("Loading leaderboard…")
            : !leaders.length
              ? uiMsg("No verified results yet.")
              : "",
      );
      patchMarkup(
        rows,
        leaders
          .map(
            (row) =>
              uiHtml`<li><span class="hub-rank-number">${Number(row.rank)}</span><span>${esc(playerName(row))}</span><strong>${resultLabel(game, mode, row)}</strong></li>`,
          )
          .join(""),
      );
      retry.hidden = !failed;
    }
    async function load(force = false) {
      const identity = api.user?.id || "guest";
      if (identity !== owner) {
        owner = identity;
        current = null;
        failed = loading = false;
        generation++;
      }
      if (!wanted || loading || (!force && current)) return;
      if (!api.ready) return;
      const request = ++generation;
      loading = true;
      failed = false;
      render();
      const valid = () =>
        request === generation && identity === (api.user?.id || "guest");
      try {
        const board = await readVerifiedBoard(game, mode);
        if (valid()) current = board;
      } catch {
        if (valid()) failed = true;
      } finally {
        if (valid()) {
          loading = false;
          render();
        }
      }
    }
    retry.addEventListener("click", () => load(true));
    window.addEventListener("workspace-ready", () => load());
    window.addEventListener("online", () => {
      if (failed) load();
    });
    window.addEventListener("locale-change", render);
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          observer.disconnect();
          wanted = true;
          load();
        },
        { rootMargin: "160px" },
      );
      observer.observe(card);
    } else {
      wanted = true;
      load();
    }
    render();
  }
}
