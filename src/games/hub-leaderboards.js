import { api, esc } from "/tool-scripts/common.js";
import { compareLocal, localScoreKey } from "./hub-model.js";
import { hubOwner, readHub } from "./hub-store.js";
import {
  boardModes,
  defaultBoardMode,
  hasVerifiedBoard,
  localizedPath,
  modeLabel,
  playerName,
  playTime,
  readVerifiedBoard,
  resultLabel,
} from "./hub-rankings.js";
import { patchMarkup } from "./dom.js";
import { uiHtml, uiMsg, uiText } from "../site/ui.js";

const root = document.querySelector("[data-games-leaderboards]");
const $ = (selector) => root.querySelector(selector);
const cards = new Map(
  [...root.querySelectorAll("[data-rank-game]")].map((card) => [
    card.dataset.rankGame,
    card,
  ]),
);
const section = $("#leaderboard-results");
const title = $("#hub-rank-title");
const status = $("[data-hub-rank-status]");
const more = $("[data-hub-rank-more]");
const refresh = $("[data-hub-rank-refresh]");
const kindLabels = {
  verified: "Verified",
  local: "On this device",
  demo: "Sample leaderboard",
};
let selected,
  owner = hubOwner(),
  board,
  snapshot,
  expanded = false,
  failure = false,
  storageFailure = false,
  request = 0,
  storageRequest = 0;

function selection(game, kind, mode) {
  if (!cards.has(game)) return null;
  const available = hasVerifiedBoard(game)
    ? ["verified", "local", "demo"]
    : ["local", "demo"];
  if (!available.includes(kind)) kind = available[0];
  if (!Object.hasOwn(boardModes(game, kind), mode))
    mode = defaultBoardMode(game, kind);
  return { game, kind, mode, available };
}

function fromURL() {
  const params = new URLSearchParams(location.search);
  return selection(params.get("game"), params.get("board"), params.get("mode"));
}

function sampleRows(game) {
  return ["Pixel Fox", "Lavender Bot", "Arcade Owl", "Nova Demo"].map(
    (nickname, i) => ({
      nickname,
      score: (game === "snake" ? 400 : 1250) - 100 * i,
      wins: 12 - 2 * i,
      elapsed_ms: 25000 + 4400 * i,
      moves: 10 + 2 * i,
      rank: i + 1,
    }),
  );
}

function paint() {
  section.hidden = !selected;
  for (const [id, card] of cards) {
    if (id === selected?.game) card.setAttribute("aria-current", "true");
    else card.removeAttribute("aria-current");
  }
  if (!selected) return;
  const { game, mode, kind, available } = selected;
  uiText(title, cards.get(game).querySelector("strong").textContent);
  patchMarkup(
    $("[data-rank-kinds]"),
    available
      .map(
        (id) =>
          uiHtml`<button type="button" class="filter" data-board-kind="${id}" aria-pressed="${id === kind}">${uiMsg(kindLabels[id])}</button>`,
      )
      .join(""),
  );
  patchMarkup(
    $("[data-rank-modes]"),
    Object.keys(boardModes(game, kind))
      .map(
        (id) =>
          uiHtml`<button type="button" class="filter" data-board-mode="${id}" aria-pressed="${id === mode}">${modeLabel(game, id, kind)}</button>`,
      )
      .join(""),
  );
  const total = snapshot?.stats?.[game];
  uiText(
    $("[data-hub-rank-stats]"),
    snapshot
      ? uiMsg("{0} starts · {1} played", [
          total?.plays || 0,
          playTime(total?.activeMs),
        ])
      : "",
  );
  const rows =
    kind === "verified"
      ? board?.top || []
      : kind === "demo"
        ? sampleRows(game)
        : Object.values(snapshot?.scores?.[localScoreKey(game, mode)] || {})
            .sort((a, b) => compareLocal(game, mode, a, b))
            .map((row, i) => ({ ...row, rank: i + 1 }));
  const me = kind === "verified" ? board?.me : null;
  more.hidden = rows.length <= 10;
  refresh.hidden = kind !== "verified";
  refresh.disabled = kind === "verified" && !board && !failure;
  uiText(more, expanded ? uiMsg("Show Top 10") : uiMsg("Show Top 50"));
  uiText(
    $("[data-hub-rank-me]"),
    me
      ? uiMsg("Your rank: #{0} · {1}", [me.rank, resultLabel(game, mode, me)])
      : kind === "verified" && board && api.user
        ? uiMsg("Your ranked best · No verified result yet.")
        : "",
  );
  uiText(
    status,
    kind === "demo"
      ? uiMsg("Sample data · Fictional players and results.")
      : kind === "local"
        ? storageFailure
          ? uiMsg("Local game storage is unavailable.")
          : !snapshot
            ? uiMsg("Loading leaderboard…")
            : rows.length
              ? uiMsg("Saved on this device.")
              : uiMsg(
                  "No local results. Submit a nickname after completing a game.",
                )
        : failure
          ? uiMsg("Leaderboard unavailable. Refresh to retry.")
          : !board
            ? uiMsg("Loading leaderboard…")
            : !rows.length
              ? uiMsg("No verified results yet.")
              : uiMsg("Server-verified results"),
  );
  patchMarkup(
    $("[data-hub-rank-results]"),
    rows.length
      ? uiHtml`<table><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Result</th></tr></thead><tbody>${rows
          .slice(0, expanded ? 50 : 10)
          .map((row) => {
            const name = esc(playerName(row));
            const player =
              row.public_id && kind === "verified"
                ? `<a href="${localizedPath("/profile/")}?id=${encodeURIComponent(row.public_id)}">${name}</a>`
                : name;
            return uiHtml`<tr><td>${Number(row.rank)}</td><td>${player}</td><td>${resultLabel(game, mode, row)}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : "",
  );
}

async function loadBoard() {
  const id = ++request;
  const identity = hubOwner();
  const choice = selected;
  board = null;
  failure = false;
  expanded = false;
  paint();
  if (choice?.kind !== "verified" || !api.ready) return;
  const valid = () =>
    id === request && identity === hubOwner() && selected === choice;
  try {
    const result = await readVerifiedBoard(choice.game, choice.mode);
    if (valid()) board = result;
  } catch {
    if (valid()) failure = true;
  } finally {
    if (valid()) paint();
  }
}

async function loadLocal() {
  if (!api.ready) return;
  const identity = hubOwner();
  const id = ++storageRequest;
  storageFailure = false;
  try {
    const value = await readHub(identity);
    if (id !== storageRequest || identity !== hubOwner()) return;
    snapshot = value;
  } catch {
    if (id !== storageRequest || identity !== hubOwner()) return;
    storageFailure = true;
  }
  paint();
}

function choose(choice, focus = false) {
  if (!choice) return;
  const url = new URL(location.href);
  url.searchParams.set("game", choice.game);
  url.searchParams.set("mode", choice.mode);
  url.searchParams.set("board", choice.kind);
  url.hash = "";
  if (url.href !== location.href) history.pushState(history.state, "", url);
  if (
    choice.game !== selected?.game ||
    choice.kind !== selected.kind ||
    choice.mode !== selected.mode
  ) {
    selected = choice;
    loadBoard();
  }
  if (focus) {
    title.focus({ preventScroll: true });
    section.scrollIntoView({ block: "start" });
  }
}

root.addEventListener("click", (event) => {
  const card = event.target.closest("[data-rank-game]");
  if (card) {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    choose(selection(card.dataset.rankGame), true);
    return;
  }
  const kind = event.target.closest("[data-board-kind]");
  const mode = event.target.closest("[data-board-mode]");
  if (kind)
    choose(selection(selected.game, kind.dataset.boardKind, selected.mode));
  if (mode)
    choose(selection(selected.game, selected.kind, mode.dataset.boardMode));
});
refresh.addEventListener("click", loadBoard);
more.addEventListener("click", () => {
  expanded = !expanded;
  paint();
});
window.addEventListener("popstate", () => {
  selected = fromURL();
  loadBoard();
});
window.addEventListener("workspace-ready", () => {
  const changed = owner !== hubOwner();
  owner = hubOwner();
  if (changed) snapshot = null;
  if (changed || (!board && selected?.kind === "verified")) loadBoard();
  loadLocal();
});
window.addEventListener("game-hub-update", (event) => {
  if (event.detail === hubOwner()) loadLocal();
});
window.addEventListener("focus", loadLocal);
window.addEventListener("locale-change", paint);
selected = fromURL();
loadBoard();
loadLocal();
root.dataset.ready = "true";
