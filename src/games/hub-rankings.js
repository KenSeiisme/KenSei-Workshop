import { api } from "/tool-scripts/common.js";
import { isRanked, gameVersion } from "./engine.js";
import { BOARD_GAMES, modesFor, timedBoard } from "./hub-model.js";
import { gameIcon } from "./presentation.js";
import { paintPodium } from "./rank-podium.js";
import { patchMarkup } from "./dom.js";
import { uiFrom, uiMsg, uiText } from "../site/ui.js";

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
  const tabs = [...root.querySelectorAll("[data-rank-preview]")];
  const panel = root.querySelector("#hub-rank-panel");
  const status = panel.querySelector("[data-preview-status]");
  const rows = panel.querySelector("[data-preview-rows]");
  const empty = panel.querySelector("[data-preview-empty]");
  const retry = panel.querySelector("[data-preview-retry]");
  const full = panel.querySelector("[data-preview-full]");
  const boards = new Map();
  const identity = () => api.user?.id || "guest";
  let owner = identity();
  let selected = tabs[0];
  let visible = false;

  function render() {
    const game = selected.dataset.rankPreview;
    const mode = defaultBoardMode(game);
    const board = boards.get(game);
    const leaders = board?.data?.top || [];
    panel.setAttribute("aria-labelledby", selected.id);
    panel.dataset.gameTheme = game;
    full.href =
      localizedPath("/games/leaderboards/") +
      "?game=" +
      encodeURIComponent(game) +
      "&mode=" +
      encodeURIComponent(mode);
    uiText(
      panel.querySelector("[data-preview-mode]"),
      modeLabel(game, mode, "verified"),
    );
    uiText(
      status,
      board?.failed
        ? uiMsg("Leaderboard unavailable.")
        : !board?.data
          ? uiMsg("Loading leaderboard…")
          : leaders.length
            ? ""
            : uiMsg("No verified results yet."),
    );
    empty.hidden = !board?.data || leaders.length > 0;
    if (!empty.hidden) patchMarkup(empty, gameIcon(game));
    paintPodium(rows, leaders, {
      result: (row) => resultLabel(game, mode, row),
      mine: board?.data?.me,
    });
    retry.hidden = !board?.failed;
  }

  async function load(force = false) {
    const expected = identity();
    if (owner !== expected) {
      owner = expected;
      boards.clear();
    }
    const game = selected.dataset.rankPreview;
    const previous = boards.get(game);
    render();
    if (
      !visible ||
      !api.ready ||
      previous?.loading ||
      (previous?.data && !force)
    )
      return;
    const board = { loading: true };
    boards.set(game, board);
    render();
    try {
      board.data = await readVerifiedBoard(game, defaultBoardMode(game));
    } catch {
      board.failed = true;
    } finally {
      board.loading = false;
      if (
        owner === expected &&
        identity() === expected &&
        boards.get(game) === board &&
        selected.dataset.rankPreview === game
      )
        render();
    }
  }

  function focusTab(next) {
    for (const tab of tabs) tab.tabIndex = tab === next ? 0 : -1;
    next.focus();
  }
  for (const [index, tab] of tabs.entries()) {
    patchMarkup(
      tab.querySelector("[data-preview-icon]"),
      gameIcon(tab.dataset.rankPreview),
    );
    tab.addEventListener("click", () => {
      selected = tab;
      focusTab(tab);
      for (const item of tabs)
        item.setAttribute("aria-selected", String(item === tab));
      visible = true;
      load();
    });
    tab.addEventListener("keydown", (event) => {
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next === undefined || event.altKey || event.ctrlKey || event.metaKey)
        return;
      event.preventDefault();
      focusTab(tabs[next]);
    });
  }
  tabs[0].parentElement.addEventListener("focusout", (event) => {
    if (!tabs.includes(event.relatedTarget))
      for (const tab of tabs) tab.tabIndex = tab === selected ? 0 : -1;
  });
  retry.addEventListener("click", () => load(true));
  window.addEventListener("workspace-ready", () => load());
  window.addEventListener("online", () => {
    if (boards.get(selected.dataset.rankPreview)?.failed) load();
  });
  window.addEventListener("locale-change", render);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        visible = true;
        load();
      },
      { rootMargin: "160px" },
    );
    observer.observe(panel);
  } else {
    visible = true;
    load();
  }
  render();
}
