import { api } from "/tool-scripts/common.js";
import { uiAttr, uiDate, uiFrom, uiMsg, uiText } from "./ui.js";
import {
  SOCIAL_GAMES,
  inviteStatus,
  socialPath,
  socialRPC,
} from "./social-api.js";

const dialog = document.querySelector("#notice-center");
const trigger = document.querySelector("[data-open-notices]");
const $ = (selector) => dialog.querySelector(selector);
const list = $("[data-notice-list]"),
  status = $("[data-notice-status]"),
  badge = trigger.querySelector("[data-notice-count]"),
  moreButton = $("[data-notice-more]"),
  readAll = $("[data-notice-read-all]"),
  retry = $("[data-notice-retry]"),
  signIn = $("[data-notice-sign-in]");
const pageSize = 20;
let owner,
  first = [],
  older = [],
  more = false,
  unread = 0,
  latest = null,
  pending,
  failed = false,
  ready = false,
  lastCheck = -Infinity,
  soundVolume = 25;
const rows = () => [
  ...first,
  ...older.filter((row) => !first.some((newer) => newer.id === row.id)),
];

function noticeText(row) {
  const name = row.actor?.nickname || uiMsg("A Workshop member");
  switch (row.kind) {
    case "friend_request":
      return uiMsg("{0} sent you a friend request.", [name]);
    case "friend_accepted":
      return uiMsg("{0} accepted your friend request.", [name]);
    case "game_invite":
      return uiMsg("{0} invited you to play {1}.", [
        name,
        uiFrom(SOCIAL_GAMES[row.payload?.game] || "Games"),
      ]);
    case "reward":
      if (row.payload?.type === "daily")
        return uiMsg("Daily reward claimed · +{0} coins", [row.payload.amount]);
      if (row.payload?.type === "badge")
        return uiMsg("You earned a lobby badge.");
      return uiMsg("You unlocked a verified milestone.");
    default:
      return uiMsg("You have a new notification.");
  }
}
const textButton = (label, action) => {
  const button = document.createElement("button");
  button.className = "text-link";
  button.type = "button";
  uiText(button, label);
  button.onclick = action;
  return button;
};
function paint() {
  badge.hidden = !unread;
  badge.textContent = unread > 99 ? "99+" : String(unread);
  uiAttr(
    trigger,
    "aria-label",
    unread
      ? uiMsg("Notifications · {0} unread", [unread])
      : uiMsg("Notifications"),
  );
  if (!dialog.open) return;
  const visible = rows();
  signIn.hidden = !!owner || !api.ready;
  readAll.hidden = !owner || !unread;
  moreButton.hidden = !owner || !more;
  moreButton.disabled = !!pending;
  retry.hidden = !failed;
  uiText(
    status,
    !api.ready
      ? uiMsg("Connecting to sign-in…")
      : !owner
        ? uiMsg("Sign in to see your notifications.")
        : failed
          ? uiMsg("Notifications could not load. Retry when connected.")
          : !ready
            ? uiMsg("Loading notifications…")
            : visible.length
              ? ""
              : uiMsg("No notifications yet."),
  );
  const active = list.contains(document.activeElement)
    ? document.activeElement
    : null;
  const signature = JSON.stringify(visible);
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  const activeId = active?.closest("li")?.dataset.id;
  const activeAction = active?.dataset.noticeAction;
  list.replaceChildren(
    ...visible.map((row) => {
      const item = document.createElement("li"),
        body = document.createElement("p"),
        when = document.createElement("time"),
        actions = document.createElement("div"),
        icon = document.createElement("span");
      item.dataset.id = row.id;
      item.dataset.unread = String(!row.read_at);
      item.className = "notice-row";
      icon.className = "notice-marker";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent =
        row.kind === "reward" ? "✦" : row.kind === "game_invite" ? "↗" : "＋";
      when.dateTime = row.created_at;
      actions.className = "notice-row-actions";
      uiText(body, noticeText(row));
      uiText(
        when,
        uiDate(row.created_at, { dateStyle: "medium", timeStyle: "short" }),
      );
      item.append(icon, body, when, actions);
      if (row.kind === "game_invite") {
        const join = textButton(uiMsg("Open invitation"), () =>
          openInvite(row, join),
        );
        join.dataset.noticeAction = "open";
        actions.append(join);
      } else {
        const link = document.createElement("a");
        link.href = socialPath(
          row.kind === "reward" ? "/games/achievements/" : "/friends/",
        );
        link.dataset.noticeAction = "open";
        uiText(
          link,
          row.kind === "reward"
            ? uiMsg("View achievements")
            : uiMsg("View friends"),
        );
        actions.append(link);
      }
      if (!row.read_at) {
        const mark = textButton(uiMsg("Mark as read"), () => markRead(row.id));
        mark.dataset.noticeAction = "read";
        actions.append(mark);
      }
      return item;
    }),
  );
  if (activeId) {
    const saved = [...list.children].find(
      (item) => item.dataset.id === activeId,
    );
    (
      saved?.querySelector('[data-notice-action="' + activeAction + '"]') ||
      saved?.querySelector("[data-notice-action]") ||
      $("[data-close-notices]")
    )?.focus({ preventScroll: true });
  }
}

function reset(nextOwner) {
  owner = nextOwner;
  first = [];
  older = [];
  more = false;
  unread = 0;
  latest = null;
  lastCheck = -Infinity;
  ready = failed = false;
  pending = null;
  window.KenseiNotify?.clearAccount();
  paint();
}
async function load({ append = false, force = false } = {}) {
  const nextOwner = api.user?.id;
  if (nextOwner !== owner) reset(nextOwner);
  if (
    !owner ||
    pending ||
    (document.hidden && !force) ||
    (!force && performance.now() - lastCheck < 1000)
  ) {
    paint();
    return;
  }
  const ticket = {},
    account = owner;
  lastCheck = performance.now();
  pending = ticket;
  paint();
  try {
    const result = await socialRPC(
      "get_site_notifications",
      {
        before_id: append ? rows().at(-1)?.id || null : null,
      },
      account,
    );
    if (pending !== ticket || account !== api.user?.id) return;
    if (!Array.isArray(result?.rows)) throw Error("Invalid notice feed");
    const page = result.rows.slice(0, pageSize);
    unread = Number(result.unread) || 0;
    if (append) {
      older.push(...page);
      more = result.rows.length > pageSize;
    } else {
      if (!older.length) more = result.rows.length > pageSize;
      const since = latest;
      if (page[0]) latest = page[0].created_at;
      if (ready && !document.hidden) {
        const fresh = page.filter(
          (row) => !row.read_at && (!since || row.created_at > since),
        );
        if (fresh.length) {
          const event = (row) =>
            row.kind === "reward" ? "reward:" + row.source : "inbox:" + row.id;
          window.KenseiNotify?.(
            fresh.length === 1
              ? noticeText(fresh[0])
              : uiMsg("{0} new notifications", [fresh.length]),
            {
              kind: fresh.some((row) => row.kind === "reward")
                ? "reward"
                : "social",
              account,
              events: fresh.map((row) => account + ":" + event(row)),
            },
          );
        }
      }
      const nowById = new Map(page.map((row) => [row.id, row]));
      older = older.map((row) => nowById.get(row.id) || row);
      first = page;
    }
    ready = true;
    failed = false;
  } catch {
    if (pending === ticket && account === api.user?.id) failed = true;
  } finally {
    if (pending === ticket) {
      pending = null;
      paint();
    }
  }
}
async function markRead(id) {
  const account = owner;
  try {
    const remaining = await socialRPC(
      "read_site_notifications",
      {
        notification: id,
        read_all: !id,
      },
      account,
    );
    if (account !== api.user?.id) return;
    pending = null;
    unread = Number(remaining) || 0;
    for (const row of rows())
      if ((!id || row.id === id) && !row.read_at)
        row.read_at = new Date().toISOString();
    paint();
  } catch {
    if (account === api.user?.id)
      window.KenseiNotify?.(uiMsg("Could not mark notifications as read."), {
        kind: "error",
        account,
      });
  }
}
async function openInvite(row, button) {
  const account = owner;
  button.disabled = true;
  try {
    const result = await socialRPC(
      "open_friend_game_invite",
      { invitation: row.payload?.id },
      account,
    );
    if (account !== api.user?.id) return;
    await markRead(row.id);
    if (account !== api.user?.id) return;
    if (
      result?.status !== "available" ||
      !Object.hasOwn(SOCIAL_GAMES, result.game) ||
      !/^[a-z0-9-]{1,24}$/i.test(result.code || "")
    ) {
      window.KenseiNotify?.(inviteStatus(result?.status), {
        kind: "warning",
        account,
      });
      return;
    }
    const target = new URL(
      socialPath("/games/" + result.game + "/"),
      location.origin,
    );
    target.searchParams.set(
      result.game === "pong" ? "room" : "code",
      result.code,
    );
    location.assign(target);
  } catch {
    if (account === api.user?.id)
      window.KenseiNotify?.(
        uiMsg("Could not open the invitation. Try again."),
        { kind: "error", account },
      );
  } finally {
    button.disabled = false;
  }
}

const volume = $("[data-notice-volume]"),
  volumeValue = $("[data-notice-volume-value]"),
  mute = $("[data-mute-notices]");
function paintSound() {
  const current = window.KenseiNoticeSettings.volume;
  volume.value = current;
  uiText(volumeValue, current + "%");
  uiText(
    mute,
    current ? uiMsg("Mute notifications") : uiMsg("Unmute notifications"),
  );
}
volume.oninput = () => uiText(volumeValue, volume.value + "%");
volume.onchange = () => {
  window.KenseiNoticeSettings.set(Number(volume.value));
};
mute.onclick = () => {
  const current = window.KenseiNoticeSettings.volume;
  if (current) soundVolume = current;
  window.KenseiNoticeSettings.set(current ? 0 : soundVolume);
};
trigger.onclick = () => {
  if (dialog.open) return;
  trigger.setAttribute("aria-expanded", "true");
  dialog.showModal();
  paint();
  paintSound();
  void load({ force: true });
};
trigger.hidden = false;
dialog.onclose = () => {
  trigger.setAttribute("aria-expanded", "false");
  if (trigger.getClientRects().length) trigger.focus({ preventScroll: true });
};
$("[data-close-notices]").onclick = () => dialog.close();
signIn.onclick = () => {
  dialog.close();
  api.openAuth();
};
readAll.onclick = () => markRead(null);
moreButton.onclick = () => load({ append: true, force: true });
retry.onclick = () => load({ force: true });
window.addEventListener("notice-volume-change", paintSound);
for (const event of ["workspace-ready", "focus", "online", "social-change"])
  window.addEventListener(event, () =>
    load({ force: event === "social-change" }),
  );
document.addEventListener("visibilitychange", () => load());
const interval = setInterval(() => load(), 30000);
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) clearInterval(interval);
});
window.addEventListener("pageshow", () => load());
window.addEventListener("auth-identity-change", () => reset(api.user?.id));
window.addEventListener("locale-change", () => {
  paint();
  paintSound();
});
if (api.ready) void load();
