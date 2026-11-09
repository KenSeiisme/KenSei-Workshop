import { api, esc } from "/tool-scripts/common.js";
import { isRanked, gameVersion } from "./engine.js";
import {
  CATALOG,
  BOARD_GAMES,
  SKINS,
  tasks,
  modesFor,
  timedBoard,
  compareLocal,
} from "./hub-model.js";
import { hubOwner, readHub, syncHub, changeSkin } from "./hub-store.js";
import { patchMarkup } from "./dom.js";
import {
  uiDate,
  uiError,
  uiFrom,
  uiHtml,
  uiMsg,
  uiOption,
  uiText,
} from "../site/ui.js";

const ONLINE_BOARDS = ["go", "chess", "xiangqi"];
const BADGES = [
  ["first-finish", "First finish", "Complete your first game."],
  ["score-1000", "Score chaser", "Score over 1,000 points in a single game."],
  [
    "seven-days",
    "Seven-day streak",
    "Finish every daily task for seven days in a row.",
  ],
];
const verified = (game) => isRanked(game) || ONLINE_BOARDS.includes(game);
const localizedPath = (path) =>
  location.pathname.startsWith("/zh-hant/") ? "/zh-hant" + path : path;
const defaultMode = (game, modes) =>
  ({ snake: "normal", go: "chinese:9", chess: "10+5", xiangqi: "10+5" })[
    game
  ] || Object.keys(modes)[0];
function resultLabel(game, mode, row) {
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
function sampleRows(game, mode) {
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
function requestFor(game, mode) {
  if (game === "go") {
    const [rule_name, size] = mode.split(":");
    return [
      "get_board_game_leaderboard",
      {
        game_name: "go",
        rule_name,
        board_size: Number(size),
        sort_by: "wins",
        rules_version: 1,
      },
    ];
  }
  if (ONLINE_BOARDS.includes(game))
    return [
      `get_${game}_leaderboard`,
      { time_control: mode, sort_by: "wins", rules_version: 1 },
    ];
  return ["get_game_leaderboard", { game, difficulty: mode }];
}
function playTime(ms = 0) {
  const minutes = Math.floor(ms / 60000);
  return minutes < 1
    ? uiMsg("{0} s", [Math.floor(ms / 1000)])
    : uiMsg("{0} h {1} min", [Math.floor(minutes / 60), minutes % 60]);
}
export function mountGameHub() {
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
    gameSelect = $("[data-hub-rank-game]"),
    modeSelect = $("[data-hub-rank-mode]"),
    kindSelect = $("[data-hub-rank-kind]"),
    more = $("[data-hub-rank-more]"),
    refresh = $("[data-hub-rank-refresh]"),
    stats = $("[data-hub-rank-stats]"),
    table = $("[data-hub-rank-results]"),
    myRank = $("[data-hub-rank-me]"),
    rankStatus = $("[data-hub-rank-status]");
  let current,
    owner = hubOwner(),
    rank = null,
    rankSerial = 0,
    expanded = false,
    storageSerial = 0,
    shopBusy = false,
    syncError = false;

  const theme = $("[data-hub-theme]");
  function setTheme(value) {
    document.body.classList.toggle("hub-light", value === "light");
    theme.setAttribute("aria-pressed", String(value === "light"));
    uiText(theme, uiFrom(value === "light" ? "Dark theme" : "Light theme"));
  }
  try {
    setTheme(localStorage.getItem("kensei-game-hub-theme"));
  } catch {}
  theme.onclick = () => {
    const value =
      theme.getAttribute("aria-pressed") === "true" ? "dark" : "light";
    setTheme(value);
    try {
      localStorage.setItem("kensei-game-hub-theme", value);
    } catch {}
  };
  const slides = [...hub.querySelectorAll("[data-hub-featured]")];
  const carousel = $(".hub-feature");
  let index = 0,
    touch = null;
  function moveSlide(delta) {
    index = (index + delta + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.hidden = i !== index;
    });
    uiText($("[data-hub-slide-count]"), `${index + 1} / ${slides.length}`);
  }
  for (const button of hub.querySelectorAll("[data-hub-slide]"))
    button.onclick = () => moveSlide(Number(button.dataset.hubSlide));
  carousel.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    moveSlide(event.key === "ArrowLeft" ? -1 : 1);
  };
  carousel.addEventListener(
    "touchstart",
    (event) => {
      touch = event.touches.length === 1 ? event.touches[0] : null;
    },
    { passive: true },
  );
  carousel.addEventListener(
    "touchend",
    (event) => {
      if (!touch) return;
      const dx = event.changedTouches[0].clientX - touch.clientX,
        dy = event.changedTouches[0].clientY - touch.clientY;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5)
        moveSlide(dx > 0 ? -1 : 1);
      touch = null;
    },
    { passive: true },
  );

  function paintRank() {
    const game = gameSelect.value,
      mode = modeSelect.value,
      kind = kindSelect.value;
    const total = current?.stats?.[game];
    uiText(
      stats,
      game
        ? uiMsg("{0} starts · {1} played", [
            total?.plays || 0,
            playTime(total?.activeMs),
          ])
        : "",
    );
    const local = Object.values(current?.scores?.[`${game}:${mode}`] || {})
      .sort((a, b) => compareLocal(game, mode, a, b))
      .map((row, i) => ({ ...row, rank: i + 1 }));
    const rows = !game
      ? []
      : kind === "demo"
        ? sampleRows(game, mode)
        : kind === "local"
          ? local
          : rank?.top || [];
    const me = kind === "verified" ? rank?.me : null;
    more.hidden = rows.length <= 10;
    refresh.hidden = !game || kind !== "verified" || !verified(game);
    uiText(more, expanded ? uiMsg("Show Top 10") : uiMsg("Show Top 50"));
    patchMarkup(
      table,
      rows.length
        ? uiHtml`<table><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Result</th></tr></thead><tbody>${rows
            .slice(0, expanded ? 50 : 10)
            .map((row) => {
              const label = esc(row.nickname || row.profile?.nickname || "—");
              const player = row.public_id
                ? `<a href="${localizedPath("/profile/")}?id=${encodeURIComponent(row.public_id)}">${label}</a>`
                : label;
              return uiHtml`<tr><td>${row.rank}</td><td>${player}</td><td>${resultLabel(game, mode, row)}</td></tr>`;
            })
            .join("")}</tbody></table>`
        : "",
    );
    uiText(
      myRank,
      me
        ? uiMsg("Your rank: #{0} · {1}", [me.rank, resultLabel(game, mode, me)])
        : "",
    );
    uiText(
      rankStatus,
      !game
        ? uiMsg("Choose a game to see its leaderboard.")
        : kind === "demo"
          ? uiMsg("Sample data · Fictional players and results.")
          : kind === "local"
            ? rows.length
              ? uiMsg("Saved on this device.")
              : uiMsg(
                  "No local results. Submit a nickname after completing a game.",
                )
            : !verified(game)
              ? uiMsg(
                  "This game has no verified leaderboard. Choose local or sample results.",
                )
              : rank?.error
                ? uiMsg("Leaderboard unavailable. Refresh to retry.")
                : !rank
                  ? uiMsg("Loading leaderboard…")
                  : !rows.length
                    ? uiMsg("No verified results yet.")
                    : uiMsg("Server-verified results"),
    );
  }
  async function loadRank() {
    const game = gameSelect.value,
      mode = modeSelect.value,
      id = ++rankSerial;
    rank = null;
    expanded = false;
    paintRank();
    if (!game || !verified(game) || kindSelect.value !== "verified") return;
    refresh.disabled = true;
    try {
      const [rpc, args] = requestFor(game, mode);
      const { data, error } = await api.client.rpc(rpc, args);
      if (id !== rankSerial) return;
      if (error || !Array.isArray(data?.top))
        throw error || Error("Invalid leaderboard response.");
      rank =
        ["snake", "brick-breaker"].includes(game) &&
        data.version !== gameVersion(game)
          ? { top: [], me: null }
          : data;
    } catch {
      if (id !== rankSerial) return;
      rank = { error: true };
    } finally {
      if (id === rankSerial) {
        refresh.disabled = false;
        paintRank();
      }
    }
  }
  function fillGameSelect() {
    const selected = gameSelect.value;
    gameSelect.replaceChildren(
      uiOption(uiMsg("Choose a game"), ""),
      ...CATALOG.map((game) => uiOption(name(game), game)),
    );
    gameSelect.value = selected;
  }
  function fillModes() {
    const game = gameSelect.value;
    const selected = modeSelect.value;
    const modes = {
      ...(kindSelect.value === "local" && ["chess", "xiangqi"].includes(game)
        ? { none: { label: "Untimed" } }
        : {}),
      ...modesFor(game),
    };
    modeSelect.replaceChildren(
      ...Object.entries(modes).map(([key, item]) => {
        const [rule, size] = key.split(":");
        const label =
          game === "go"
            ? uiMsg("{0} · {1}×{1}", [
                uiFrom(
                  { chinese: "Chinese", japanese: "Japanese", aga: "AGA" }[
                    rule
                  ],
                ),
                size,
              ])
            : uiFrom(item.label);
        return uiOption(label, key);
      }),
    );
    modeSelect.value = Object.hasOwn(modes, selected)
      ? selected
      : Object.hasOwn(modes, "none")
        ? "none"
        : defaultMode(game, modes) || "";
    modeSelect.disabled = !game || Object.keys(modes).length < 2;
  }
  fillGameSelect();
  fillModes();
  gameSelect.onchange = () => {
    modeSelect.value = "";
    fillModes();
    loadRank();
  };
  kindSelect.onchange = () => {
    fillModes();
    loadRank();
  };
  modeSelect.onchange = refresh.onclick = loadRank;
  more.onclick = () => {
    expanded = !expanded;
    paintRank();
  };

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
    paintRank();
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
      loadRank();
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
  window.addEventListener("locale-change", () => {
    fillGameSelect();
    paintProgress();
  });
  setInterval(sync, 30000);
  paintProgress();
  sync();
}
