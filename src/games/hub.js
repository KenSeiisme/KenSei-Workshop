import { mountHubTheme } from "./hub-theme.js";
import { mountHubCarousel } from "./hub-carousel.js";
import { mountHubProfile } from "./hub-profile.js";
import { mountRankPreviews, playTime } from "./hub-rankings.js";
import { SKINS, tasks } from "./hub-model.js";
import { hubOwner, readHub, syncHub, changeSkin } from "./hub-store.js";
import { patchMarkup } from "./dom.js";
import { uiDate, uiError, uiFrom, uiHtml, uiMsg, uiText } from "../site/ui.js";

const BADGES = [
  ["first-finish", "First finish", "Complete your first game."],
  ["score-1000", "Score chaser", "Score over 1,000 points in a single game."],
  [
    "seven-days",
    "Seven-day streak",
    "Finish every daily task for seven days in a row.",
  ],
];
export function mountGameHub(saves) {
  const hub = document.querySelector("[data-games-directory]");
  if (!hub) return;
  const $ = (selector) => hub.querySelector(selector),
    cards = new Map(
      [...hub.querySelectorAll("[data-game-card]")].map((card) => [
        card.dataset.gameTheme,
        card,
      ]),
    ),
    name = (game) =>
      cards.get(game)?.querySelector("h2 a")?.textContent || game,
    updateProfile = mountHubProfile(hub, saves);
  let current,
    owner = hubOwner(),
    storageSerial = 0,
    shopBusy = false,
    syncError = false;

  mountHubTheme($("[data-hub-theme]"));
  mountHubCarousel($(".hub-feature"));
  mountRankPreviews(hub);

  function paintProgress() {
    const { day, featured, balance, today, badges, owned, skin, pending } =
      current || {};
    uiText($("[data-hub-coins]"), balance ?? "—");
    uiText(
      $("[data-hub-day]"),
      day
        ? uiMsg("{0} · Malaysia time", [
            uiDate(day + "T00:00:00Z", { dateStyle: "long", timeZone: "UTC" }),
          ])
        : uiMsg("Resets at midnight in Malaysia."),
    );
    const daily = [
      uiMsg("Complete any game"),
      uiMsg("Complete two different games"),
      uiMsg("Complete {0}", [name(featured) || "—"]),
    ];
    patchMarkup(
      $("[data-hub-tasks]"),
      tasks(today || [], featured)
        .map(
          ([, done], i) =>
            uiHtml`<li data-complete="${done}"><span aria-hidden="true">${done ? "✓" : "○"}</span><span>${daily[i]}</span><small>${done ? uiMsg("Done") : "+10"}</small></li>`,
        )
        .join(""),
    );
    uiText(
      $("[data-hub-sync]"),
      syncError
        ? uiMsg("Sync unavailable. Your activity is queued on this device.")
        : pending
          ? uiMsg("Activity waiting to sync")
          : owner === "guest"
            ? uiMsg("Guest progress · This device")
            : uiMsg("Account progress"),
    );
    for (const [game, card] of cards) {
      const total = current?.stats?.[game];
      uiText(
        card.querySelector("[data-hub-card-stats]"),
        uiMsg("{0} starts · {1} played", [
          total?.plays || 0,
          playTime(total?.activeMs),
        ]),
      );
    }
    patchMarkup(
      $("[data-hub-badges]"),
      BADGES.map(
        ([id, title, description]) =>
          uiHtml`<article><span aria-hidden="true">${badges?.includes(id) ? "✦" : "◇"}</span><strong>${uiFrom(title)}</strong><p>${uiFrom(description)}</p><small>${badges?.includes(id) ? uiMsg("Unlocked") : uiMsg("Locked")}</small></article>`,
      ).join(""),
    );
    patchMarkup(
      $("[data-hub-skins]"),
      Object.entries(SKINS)
        .map(([key, item]) => {
          const has = owned?.includes(key) || key === "classic",
            equipped = skin === key;
          const disabled =
            shopBusy ||
            equipped ||
            (!has && (balance == null || balance < item.price));
          return uiHtml`<article data-skin="${key}"><div class="hub-skin-preview" style="--snake-hue:${item.hue}" aria-hidden="true"><i></i><i></i><i></i><i></i></div><strong>${uiFrom(item.name)}</strong><button class="button secondary" type="button" data-skin-action="${has ? "equip" : "buy"}" ${disabled ? "disabled" : ""}>${equipped ? uiMsg("Equipped") : has ? uiMsg("Equip") : uiMsg("Buy · {0} coins", [item.price])}</button></article>`;
        })
        .join(""),
    );
    updateProfile(current);
  }
  $("[data-hub-skins]").onclick = async (event) => {
    const button = event.target.closest("[data-skin-action]");
    if (!button || shopBusy) return;
    const expected = owner,
      status = $("[data-hub-shop-status]");
    shopBusy = true;
    paintProgress();
    try {
      const buy = button.dataset.skinAction === "buy";
      await changeSkin(
        expected,
        button.closest("[data-skin]").dataset.skin,
        buy,
      );
      if (owner === expected)
        uiText(
          status,
          buy
            ? uiMsg("Skin purchased. Equip it whenever you are ready.")
            : uiMsg("Skin equipped."),
        );
    } catch (error) {
      if (owner === expected) uiText(status, uiError(error));
    } finally {
      shopBusy = false;
      await refreshLocal();
    }
  };
  async function refreshLocal() {
    const expected = hubOwner(),
      id = ++storageSerial;
    if (owner !== expected) {
      owner = expected;
      current = null;
      uiText($("[data-hub-shop-status]"), "");
      syncError = false;
      updateProfile(null);
    }
    try {
      const next = await readHub(expected);
      if (id !== storageSerial || hubOwner() !== expected) return;
      current = next;
      paintProgress();
    } catch {
      if (id === storageSerial)
        uiText(
          $("[data-hub-sync]"),
          uiMsg("Local game storage is unavailable."),
        );
    }
  }
  async function sync() {
    if (document.hidden) return;
    const expected = hubOwner();
    await refreshLocal();
    try {
      await syncHub(expected, true);
      if (hubOwner() === expected) syncError = false;
    } catch {
      if (hubOwner() === expected) syncError = true;
    }
    await refreshLocal();
  }
  window.addEventListener("game-hub-update", (event) => {
    if (event.detail === hubOwner()) refreshLocal();
  });
  window.addEventListener("workspace-ready", sync);
  window.addEventListener("online", sync);
  window.addEventListener("focus", sync);
  window.addEventListener("locale-change", paintProgress);
  setInterval(sync, 30000);
  paintProgress();
  sync();
}
