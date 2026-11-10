import { mountHubTheme } from "./hub-theme.js";
import { mountHubCarousel } from "./hub-carousel.js";
import { mountHubProfile } from "./hub-profile.js";
import { mountRankPreviews, playTime } from "./hub-rankings.js";
import { SKINS } from "./hub-model.js";
import { mountDailyChallenge } from "./hub-daily.js";
import { hubOwner, readHub, syncHub, changeSkin } from "./hub-store.js";
import { patchMarkup } from "./dom.js";
import { uiError, uiFrom, uiHtml, uiMsg, uiText } from "../site/ui.js";

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

  const updateDaily = mountDailyChallenge($(".hub-daily"), name, sync);
  function paintProgress() {
    const { balance, owned, skin, pending } = current || {};
    uiText($("[data-hub-coins]"), balance ?? "—");
    updateDaily(current);
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
      paintProgress();
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
