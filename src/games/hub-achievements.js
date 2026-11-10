import { api } from "/tool-scripts/common.js";
import { mountAchievements } from "./achievements.js";
import { patchMarkup } from "./dom.js";
import { LOBBY_BADGES } from "./hub-model.js";
import { hubOwner, readHub, syncHub } from "./hub-store.js";
import { uiFrom, uiHtml, uiMsg } from "../site/ui.js";

const page = document.querySelector("[data-games-achievements]");
const list = page.querySelector("[data-hub-badges]");
const guestNotice = page.querySelector("[data-achievements-guest]");
let snapshot;
let owner = hubOwner();
let generation = 0;

mountAchievements();

function paint() {
  guestNotice.hidden = !api.ready || owner !== "guest";
  patchMarkup(
    list,
    LOBBY_BADGES.map(([id, title, description]) => {
      const unlocked = snapshot?.badges?.includes(id);
      return uiHtml`<article><span aria-hidden="true">${unlocked ? "✦" : "◇"}</span><strong>${uiFrom(title)}</strong><p>${uiFrom(description)}</p><small>${snapshot ? (unlocked ? uiMsg("Unlocked") : uiMsg("Locked")) : "—"}</small></article>`;
    }).join(""),
  );
}

async function read() {
  const expected = hubOwner();
  const request = ++generation;
  if (expected !== owner) {
    owner = expected;
    snapshot = null;
    paint();
  }
  try {
    const next = await readHub(expected);
    if (request !== generation || expected !== hubOwner()) return;
    snapshot = next;
  } finally {
    if (request === generation && expected === hubOwner()) paint();
  }
}

async function refresh() {
  await read().catch(() => {});
  await syncHub(hubOwner(), true).catch(() => {});
  await read().catch(() => {});
}
window.addEventListener("game-hub-update", (event) => {
  if (event.detail === hubOwner()) read().catch(() => {});
});
for (const event of ["workspace-ready", "focus", "online"])
  window.addEventListener(event, refresh);
window.addEventListener("locale-change", paint);
refresh();
