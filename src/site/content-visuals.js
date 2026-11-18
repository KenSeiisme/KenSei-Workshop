import { uiFrom, uiMsg, uiText } from "./ui.js";
import { gameIcon } from "/game-scripts/game-icons.js";
export function gameEmblem(game) {
  const node = document.createElement("span");
  node.className = "content-game-emblem";
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = gameIcon(game);
  return node;
}

// 與 Python 模板共用建置產生的 SVG；使用者文字不會插進標記。
export function iconMarkup(name) {
  const safe =
    typeof name === "string" && /^[a-z-]+$/.test(name) ? name : "info";
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/assets/ui-icons.svg#${safe}"/></svg>`;
}
export function contentIcon(name) {
  const node = document.createElement("span");
  node.className = "content-icon";
  node.innerHTML = iconMarkup(name);
  node.setAttribute("aria-hidden", "true");
  return node;
}
const games = { go: "Go", chess: "Chess", xiangqi: "Xiangqi", pong: "Pong" };
export function gameArtwork(game) {
  const node = document.createElement("span");
  node.className = "content-game-art";
  node.dataset.game = game;
  node.setAttribute("aria-hidden", "true");
  node.append(gameEmblem(game));
  if (Object.hasOwn(games, game)) {
    const image = new Image();
    image.alt = "";
    image.src = `/assets/account-games/${game}.svg`;
    image.onload = () => node.classList.add("has-artwork");
    image.onerror = () => image.remove();
    node.append(image);
  }
  return node;
}
export function gameChoiceLinks(root, person, localePath) {
  root.replaceChildren(
    ...Object.entries(games).map(([game, name]) => {
      const link = document.createElement("a");
      link.className = "friend-game-card";
      link.href =
        localePath(`/games/${game}/`) +
        "?friend=" +
        encodeURIComponent(person.public_id);
      const title = document.createElement("strong"),
        label = document.createElement("span");
      uiText(title, uiFrom(name));
      uiText(label, uiMsg("Invite to game"));
      link.append(gameArtwork(game), title, label, contentIcon("arrow"));
      return link;
    }),
  );
}
export function medal(def) {
  const node = contentIcon("achievement");
  node.classList.add("content-medal");
  node.dataset.game = def?.game || "all";
  if (def?.game) node.append(gameEmblem(def.game));
  node.dataset.tier = /-[123]$/.test(def?.id || "") ? def.id.slice(-1) : "1";
  return node;
}
export function boardStatCards(row) {
  const grid = document.createElement("div");
  grid.className = "board-stat-cards";
  const played = Number(row.played) || 0;
  const values = [
    ["grid", uiMsg("Games"), played],
    ["win", uiMsg("Wins"), Number(row.wins) || 0],
    ["loss", uiMsg("Losses"), Number(row.losses) || 0],
    ["draw", uiMsg("Draws"), Number(row.draws) || 0],
    [
      "stats",
      uiMsg("Win rate"),
      played ? (Number(row.win_rate) * 100).toFixed(1) + "%" : "—",
    ],
  ];
  for (const [kind, title, value] of values) {
    const tile = document.createElement("div"),
      label = document.createElement("span"),
      number = document.createElement("strong");
    tile.dataset.stat = kind;
    uiText(label, title);
    uiText(number, value);
    tile.append(contentIcon(kind), label, number);
    grid.append(tile);
  }
  return grid;
}
