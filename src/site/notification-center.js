import { api } from "/tool-scripts/common.js";
import { paintAvatar } from "/tool-scripts/profile-service.js";
import { ACHIEVEMENTS } from "/game-scripts/achievement-catalog.js";
import { paintFriendActions } from "./friend-actions.js";
import { uiAttr, uiDate, uiFrom, uiMsg, uiText } from "./ui.js";
import {
  SOCIAL_GAMES,
  inviteStatus,
  socialPath,
  socialRPC,
} from "./social-api.js";

const dialog = document.querySelector("#notice-center"),
  trigger = document.querySelector("[data-open-notices]");
const $ = (selector) => dialog.querySelector(selector);
const list = $("[data-notice-list]"),
  status = $("[data-notice-status]"),
  badge = trigger.querySelector("[data-notice-count]");
const moreButton = $("[data-notice-more]"),
  readAll = $("[data-notice-read-all]"),
  retry = $("[data-notice-retry]"),
  signIn = $("[data-notice-sign-in]");
const filter = $("[data-notice-filter]"),
  pageSize = 20;
let owner,
  epoch = 0,
  revision = 0,
  category = "all",
  records = [],
  cursor = null,
  more = false,
  unread = 0;
let pending,
  mutations = 0,
  queued = false,
  failed = false,
  ready = false,
  watermark = null,
  soundVolume = 25,
  lastCheck = -Infinity,
  quietReturn = false;
const badges = {
  "first-finish": "First finish",
  "score-1000": "Score chaser",
  "seven-days": "Seven-day streak",
};
const tasks = {
  "warm-up": "Complete any game",
  explorer: "Complete two different games",
  featured: "Complete today's featured game",
};
const order = (a, b) =>
  b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
const later = (row, mark) =>
  !mark ||
  row.created_at > mark.created_at ||
  (row.created_at === mark.created_at && row.id > mark.id);
function textButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-link";
  uiText(button, label);
  button.onclick = action;
  return button;
}
function noticeText(row) {
  const name = row.actor?.nickname || uiMsg("A Workshop member"),
    detail = row.payload || {};
  if (row.kind === "friend_request")
    return uiMsg("{0} sent you a friend request.", [name]);
  if (row.kind === "friend_accepted")
    return uiMsg("{0} accepted your friend request.", [name]);
  if (row.kind === "game_invite")
    return uiMsg("{0} invited you to play {1}.", [
      name,
      uiFrom(SOCIAL_GAMES[detail.game] || "Games"),
    ]);
  if (detail.type === "daily")
    return uiMsg("Daily reward claimed · +{0} coins", [detail.amount]);
  const title =
    detail.type === "badge"
      ? badges[detail.id]
      : ACHIEVEMENTS.find((a) => a.id === detail.id)?.name;
  if (title) return uiMsg("Unlocked · {0}", [uiFrom(title)]);
  return detail.type === "badge"
    ? uiMsg("You earned a lobby badge.")
    : uiMsg("You unlocked a verified milestone.");
}
function inviteLabel(value) {
  if (value === "ignored") return uiMsg("Invitation ignored");
  if (value === "revoked") return uiMsg("Invitation withdrawn");
  return inviteStatus(value);
}
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
  signIn.hidden = !!owner || !api.ready;
  readAll.hidden = !owner || !unread;
  readAll.disabled = mutations > 0;
  moreButton.hidden = !owner || !more;
  moreButton.disabled = !!pending || mutations > 0;
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
            : records.length
              ? ""
              : uiMsg("No notifications yet."),
  );
  const signature = JSON.stringify(records);
  if (list.dataset.signature === signature) return;
  const active = list.contains(document.activeElement)
    ? document.activeElement
    : null;
  const activeId = active?.closest("li")?.dataset.id,
    activeAction = active?.dataset.noticeAction || active?.dataset.friendAction;
  list.dataset.signature = signature;
  list.replaceChildren(
    ...records.map((row) => {
      const item = document.createElement("li"),
        body = document.createElement("p"),
        when = document.createElement("time");
      const actions = document.createElement("div"),
        icon = document.createElement("span");
      item.className = "notice-row";
      item.dataset.id = row.id;
      item.dataset.unread = String(!row.read_at);
      icon.className = "notice-marker";
      if (row.actor) {
        icon.classList.add("avatar-badge");
        paintAvatar(icon, row.actor);
        icon.setAttribute("aria-hidden", "true");
      } else {
        icon.textContent = "✦";
        icon.setAttribute("aria-hidden", "true");
      }
      when.dateTime = row.created_at;
      uiText(
        when,
        uiDate(row.created_at, { dateStyle: "medium", timeStyle: "short" }),
      );
      uiText(body, noticeText(row));
      actions.className = "notice-row-actions";
      item.append(icon, body, when);
      if (row.payload?.type === "daily" && row.payload.task_day) {
        const detail = document.createElement("small");
        uiText(
          detail,
          uiMsg("{0} · {1}", [
            row.payload.task_day,
            uiFrom(tasks[row.payload.task_id] || "Daily reward"),
          ]),
        );
        item.append(detail);
      }
      item.append(actions);
      if (
        row.kind === "friend_request" &&
        row.payload?.relationship?.state === "incoming" &&
        row.source === "request:" + row.payload.relationship.id
      ) {
        paintFriendActions(
          actions,
          { ...row.actor, ...row.payload.relationship },
          (next) => {
            row.payload.relationship = next;
            if (next.state !== "incoming") void markRead(row.id);
            list.dataset.signature = "";
            paint();
          },
        );
      } else if (row.kind === "game_invite") {
        const current = row.payload?.status;
        if (!current || current === "available") {
          const open = textButton(uiMsg("Open invitation"), () =>
            openInvite(row, open),
          );
          open.dataset.noticeAction = "open";
          const ignore = textButton(uiMsg("Ignore invitation"), () =>
            changeInvite(row, ignore),
          );
          ignore.dataset.noticeAction = "ignore";
          actions.append(open, ignore);
        } else {
          const state = document.createElement("span");
          state.className = "small-tag";
          uiText(state, inviteLabel(current));
          actions.append(state);
        }
      } else {
        if (row.kind === "friend_request" && row.payload?.relationship) {
          const state = document.createElement("span");
          state.className = "small-tag";
          uiText(
            state,
            row.payload.relationship.state === "friend"
              ? uiMsg("Already friends")
              : uiMsg("Request no longer pending"),
          );
          actions.append(state);
        }
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
    const node = [...list.children].find((x) => x.dataset.id === activeId);
    (
      node?.querySelector(
        '[data-notice-action="' +
          activeAction +
          '"],[data-friend-action="' +
          activeAction +
          '"]',
      ) ||
      node?.querySelector("button,a") ||
      $("[data-close-notices]")
    )?.focus({ preventScroll: true });
  }
}
function reset(nextOwner) {
  owner = nextOwner;
  epoch++;
  revision++;
  records = [];
  cursor = null;
  more = false;
  unread = 0;
  watermark = null;
  pending = null;
  mutations = 0;
  queued = false;
  ready = failed = false;
  lastCheck = -Infinity;
  window.KenseiNotify?.clearAccount();
  paint();
}
async function load({ append = false, force = false } = {}) {
  if (api.user?.id !== owner) reset(api.user?.id);
  if (!owner || document.hidden) {
    paint();
    return;
  }
  if (pending || mutations) {
    queued ||= force;
    return;
  }
  if (!force && performance.now() - lastCheck < 1000) return;
  const ticket = {},
    account = owner,
    generation = epoch,
    version = revision,
    selected = category;
  pending = ticket;
  lastCheck = performance.now();
  paint();
  try {
    // 最新全類別頁用於未讀數和新事件，分類切換不重播舊獎勵。
    const all = await socialRPC(
      "get_site_notifications",
      { before_id: null },
      account,
    );
    const snapshot =
      selected === "all" && !append
        ? all
        : await socialRPC(
            "get_site_notifications_page",
            { before_id: append ? cursor : null, category: selected },
            account,
          );
    if (
      generation !== epoch ||
      version !== revision ||
      selected !== category ||
      api.user?.id !== account
    )
      return;
    if (!Array.isArray(snapshot?.rows) || !Array.isArray(all?.rows))
      throw Error("Invalid notification feed");
    const fresh = all.rows.filter(
      (row) => !row.read_at && later(row, watermark),
    );
    if (watermark && !quietReturn && fresh.length) {
      window.KenseiNotify?.(
        fresh.length === 1
          ? noticeText(fresh[0])
          : uiMsg("{0} new notifications", [fresh.length]),
        {
          kind: fresh.some((row) => row.kind === "reward")
            ? "reward"
            : "social",
          account,
          events: fresh.map(
            (row) =>
              account +
              ":" +
              (row.kind === "reward"
                ? "reward:" + row.source
                : "inbox:" + row.id),
          ),
        },
      );
    }
    if (all.rows[0])
      watermark = { created_at: all.rows[0].created_at, id: all.rows[0].id };
    quietReturn = false;
    unread = Number(all.unread) || 0;
    let incoming = snapshot.rows.slice(0, pageSize),
      nextCursor = incoming.at(-1)?.id || null,
      hasMore = snapshot.rows.length > pageSize;
    const target = append ? 0 : dialog.open ? records.length : 0;
    while (!append && incoming.length < target && hasMore) {
      const extra = await socialRPC(
        "get_site_notifications_page",
        { before_id: nextCursor, category: selected },
        account,
      );
      if (
        generation !== epoch ||
        version !== revision ||
        category !== selected ||
        account !== api.user?.id
      )
        return;
      const page = extra.rows.slice(0, pageSize);
      incoming.push(...page);
      nextCursor = page.at(-1)?.id || nextCursor;
      hasMore = extra.rows.length > pageSize;
      if (!page.length) break;
    }
    if (append) {
      const merged = new Map(records.map((row) => [row.id, row]));
      incoming.forEach((row) => merged.set(row.id, row));
      records = [...merged.values()].sort(order);
    } else records = incoming.sort(order);
    cursor = nextCursor;
    more = hasMore;
    ready = true;
    failed = false;
  } catch {
    if (
      generation === epoch &&
      version === revision &&
      account === api.user?.id
    )
      failed = true;
  } finally {
    if (pending === ticket) {
      pending = null;
      paint();
      if (queued && !mutations) {
        queued = false;
        void load({ force: true });
      }
    }
  }
}
async function markRead(id) {
  const account = owner,
    generation = epoch;
  revision++;
  mutations++;
  try {
    await socialRPC(
      "read_site_notifications",
      { notification: id, read_all: !id },
      account,
    );
    if (generation !== epoch || account !== api.user?.id) return;
    records = records.map((row) =>
      !id || row.id === id
        ? { ...row, read_at: row.read_at || new Date().toISOString() }
        : row,
    );
    window.dispatchEvent(new Event("social-change"));
  } catch {
    if (generation === epoch)
      window.KenseiNotify?.(uiMsg("Could not mark notifications as read."), {
        kind: "error",
        account,
      });
  } finally {
    if (generation === epoch) {
      mutations--;
      queued = true;
      paint();
      if (!pending && !mutations) {
        queued = false;
        void load({ force: true });
      }
    }
  }
}
async function changeInvite(row, button) {
  const account = owner;
  button.disabled = true;
  try {
    const result = await socialRPC(
      "change_friend_game_invite",
      { invitation: row.payload.id, action: "ignore" },
      account,
    );
    if (account !== api.user?.id) return;
    row.payload.status = result.status;
    list.dataset.signature = "";
    paint();
    await markRead(row.id);
  } catch {
    if (account === api.user?.id)
      window.KenseiNotify?.(uiMsg("Invitation could not update. Try again."), {
        kind: "error",
        account,
      });
  } finally {
    button.disabled = false;
  }
}
async function openInvite(row, button) {
  const account = owner;
  button.disabled = true;
  try {
    const result = await socialRPC(
      "open_friend_game_invite",
      { invitation: row.payload.id },
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
      row.payload.status = result?.status || "unavailable";
      list.dataset.signature = "";
      paint();
      window.KenseiNotify?.(inviteLabel(result?.status), {
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
volume.onchange = () => window.KenseiNoticeSettings.set(Number(volume.value));
mute.onclick = () => {
  const value = window.KenseiNoticeSettings.volume;
  if (value) soundVolume = value;
  window.KenseiNoticeSettings.set(value ? 0 : soundVolume);
};
$("[data-test-notice-sound]").onclick = () =>
  window.KenseiNoticeSettings.preview();
filter.onchange = () => {
  category = filter.value;
  revision++;
  records = [];
  cursor = null;
  more = false;
  ready = false;
  queued = true;
  paint();
  if (!pending) {
    queued = false;
    void load({ force: true });
  }
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
for (const event of [
  "workspace-ready",
  "focus",
  "online",
  "social-change",
  "social-remote-change",
])
  window.addEventListener(event, () =>
    load({ force: event.includes("social") }),
  );
document.addEventListener("visibilitychange", () => {
  if (document.hidden) quietReturn = true;
  else void load();
});
setInterval(() => {
  if (!document.hidden) void load();
}, 30000);
window.addEventListener("pageshow", () => load());
window.addEventListener("auth-identity-change", () => reset(api.user?.id));
window.addEventListener("locale-change", () => {
  list.dataset.signature = "";
  paint();
  paintSound();
});
if (api.ready) void load();
