import { api } from "/tool-scripts/common.js";
import { uiAttr, uiFrom, uiMsg, uiOption, uiText } from "./ui.js";
import {
  inviteStatus,
  profileId,
  socialRPC,
  SOCIAL_GAMES,
} from "./social-api.js";

export function mountFriendInvites(game, getRoom) {
  const actions = document.querySelector("#" + game + "-invite"),
    create = document.querySelector("#" + game + "-create");
  const button = document.createElement("button"),
    summary = document.createElement("p"),
    inline = document.createElement("p"),
    retry = document.createElement("button");
  const outgoing = document.createElement("div");
  button.type = retry.type = "button";
  button.className = retry.className = "button secondary";
  uiText(button, uiMsg("Invite a friend"));
  uiText(retry, uiMsg("Retry invitation"));
  inline.className = summary.className = "muted small";
  inline.setAttribute("role", "status");
  retry.hidden = true;
  outgoing.className = "friend-sent-invites";
  actions.append(button, inline, retry, outgoing);
  let requested = new URLSearchParams(location.search).get("friend"),
    selected = null,
    pending = false,
    version = 0,
    sentRoom = null,
    lastSentRead = 0;
  if (!profileId(requested)) requested = null;
  if (requested) {
    uiText(create, uiMsg("Create room and invite"));
    queueMicrotask(() => {
      const mode = document.querySelector("#" + game + "-mode");
      if (mode) {
        mode.value = "online";
        mode.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }
  const dialog = document.createElement("dialog"),
    title = document.createElement("h2"),
    choice = document.createElement("select"),
    status = document.createElement("p"),
    send = document.createElement("button"),
    close = document.createElement("button");
  dialog.className = "friend-invite-dialog";
  title.id = "invite-friend-heading";
  dialog.setAttribute("aria-labelledby", title.id);
  uiText(title, uiMsg("Invite a friend"));
  uiAttr(choice, "aria-label", uiMsg("Choose a friend"));
  status.setAttribute("role", "status");
  status.className = "muted small";
  send.type = close.type = "button";
  send.className = "button primary";
  close.className = "button secondary";
  uiText(send, uiMsg("Send invitation"));
  uiText(close, uiMsg("Close"));
  const footer = document.createElement("div");
  footer.className = "action-row";
  footer.append(send, close);
  dialog.append(title, summary, choice, status, footer);
  document.querySelector("#main").append(dialog);
  const available = (room) =>
    room?.status === "waiting" &&
    room?.controller !== false &&
    (game === "pong" ? room.role === "host" : room.origin === "invite");
  const current = () => available(getRoom()) && !!api.user;
  function paintSummary() {
    const person = choice.selectedOptions[0]?.textContent;
    uiText(
      summary,
      uiMsg("{0} · Room {1} · {2}", [
        uiFrom(SOCIAL_GAMES[game]),
        getRoom()?.code || "",
        person || "",
      ]),
    );
  }
  function paint() {
    button.hidden = !current();
    if (sentRoom && sentRoom !== getRoom()?.id) {
      version++;
      sentRoom = null;
      selected = null;
      pending = false;
      retry.hidden = true;
      uiText(inline, "");
      outgoing.replaceChildren();
      if (dialog.open) dialog.close();
    }
    retry.hidden = retry.hidden || !current();
  }
  async function loadSent() {
    const room = getRoom(),
      account = api.user?.id;
    if (!room?.id || !account) return;
    const serial = ++lastSentRead;
    try {
      const rows = await socialRPC(
        "get_room_friend_invites",
        { game_key: game, target_room: room.id },
        account,
      );
      if (
        serial !== lastSentRead ||
        getRoom()?.id !== room.id ||
        api.user?.id !== account
      )
        return;
      outgoing.replaceChildren(
        ...rows.map((item) => {
          const line = document.createElement("div"),
            label = document.createElement("span");
          line.className = "friend-sent-invite";
          const value =
            item.status === "revoked"
              ? uiMsg("Invitation withdrawn")
              : item.status === "ignored"
                ? uiMsg("Invitation ignored")
                : item.status === "available"
                  ? uiMsg("Invitation sent")
                  : inviteStatus(item.status);
          uiText(label, uiMsg("{0} · {1}", [item.profile.nickname, value]));
          line.append(label);
          if (item.status === "available") {
            const revoke = document.createElement("button");
            revoke.type = "button";
            revoke.className = "text-link";
            uiText(revoke, uiMsg("Withdraw"));
            revoke.onclick = async () => {
              revoke.disabled = true;
              try {
                await socialRPC(
                  "change_friend_game_invite",
                  { invitation: item.id, action: "revoke" },
                  account,
                );
                if (account === api.user?.id && getRoom()?.id === room.id) {
                  await loadSent();
                  window.dispatchEvent(new Event("social-change"));
                }
              } catch {
                if (account === api.user?.id)
                  uiText(
                    inline,
                    uiMsg("Invitation could not update. Try again."),
                  );
              } finally {
                revoke.disabled = false;
              }
            };
            line.append(revoke);
          }
          return line;
        }),
      );
    } catch {
      /* Existing room controls remain available during a status refresh. */
    }
  }
  async function invite(id) {
    const account = api.user?.id,
      room = getRoom(),
      token = version;
    if (!account || !room?.id || !current() || !profileId(id) || pending)
      return;
    selected = id;
    sentRoom = room.id;
    pending = true;
    send.disabled = true;
    retry.hidden = true;
    try {
      const data = await socialRPC(
        "send_friend_game_invite",
        { game_key: game, target_room: room.id, target_profile: id },
        account,
      );
      if (
        token !== version ||
        api.user?.id !== account ||
        getRoom()?.id !== room.id
      )
        return;
      if (data?.status !== "sent") {
        const message =
          data.status === "ignored"
            ? uiMsg("Invitation ignored")
            : data.status === "revoked"
              ? uiMsg("Invitation withdrawn")
              : inviteStatus(data.status);
        uiText(inline, message);
        uiText(status, message);
        return;
      }
      requested = null;
      const url = new URL(location.href);
      url.searchParams.delete("friend");
      history.replaceState(history.state, "", url);
      uiText(create, uiMsg("Create room"));
      uiText(inline, uiMsg("Game invitation sent."));
      if (dialog.open) dialog.close();
      window.KenseiNotify?.(uiMsg("Game invitation sent."), {
        kind: "success",
        account,
      });
      void loadSent();
    } catch {
      if (
        token === version &&
        api.user?.id === account &&
        getRoom()?.id === room.id
      ) {
        const message = uiMsg(
          "Invitation could not send. Your room is still open.",
        );
        uiText(inline, message);
        uiText(status, message);
        retry.hidden = false;
        window.KenseiNotify?.(message, { kind: "error", account });
      }
    } finally {
      if (token === version) {
        pending = false;
        send.disabled = !choice.value;
      }
    }
  }
  async function openPicker() {
    if (!current() || dialog.open) return;
    const token = version,
      account = api.user.id;
    choice.replaceChildren();
    send.disabled = true;
    uiText(status, uiMsg("Loading friends…"));
    paintSummary();
    dialog.showModal();
    try {
      const people = await socialRPC("list_friendships", {}, account);
      if (token !== version || account !== api.user?.id || !dialog.open) return;
      const friends = people.filter((p) => p.state === "friend");
      choice.replaceChildren(
        ...friends.map((p) => uiOption(p.nickname, p.public_id)),
      );
      if (friends.some((p) => p.public_id === (requested || selected)))
        choice.value = requested || selected;
      send.disabled = !choice.value;
      uiText(status, choice.value ? "" : uiMsg("No friends yet."));
      paintSummary();
    } catch {
      if (token === version)
        uiText(status, uiMsg("Friends could not load. Try again."));
    }
  }
  button.onclick = openPicker;
  close.onclick = () => dialog.close();
  dialog.onclose = () => {
    if (!button.hidden) button.focus({ preventScroll: true });
  };
  choice.onchange = paintSummary;
  send.onclick = () => invite(choice.value);
  retry.onclick = () => invite(selected);
  window.addEventListener("auth-identity-change", () => {
    version++;
    lastSentRead++;
    pending = false;
    selected = null;
    requested = null;
    sentRoom = null;
    retry.hidden = true;
    outgoing.replaceChildren();
    uiText(inline, "");
    if (dialog.open) dialog.close();
    paint();
  });
  return {
    paint,
    created() {
      paint();
      void loadSent();
      if (requested) void openPicker();
    },
  };
}
