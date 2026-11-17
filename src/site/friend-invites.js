import { api } from "/tool-scripts/common.js";
import { uiAttr, uiMsg, uiOption, uiText } from "./ui.js";
import { inviteStatus, profileId, socialRPC } from "./social-api.js";

export function mountFriendInvites(game, getRoom) {
  const actions = document.querySelector("#" + game + "-invite");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button secondary";
  button.hidden = true;
  uiText(button, uiMsg("Invite a friend"));
  actions.append(button);

  let requested = new URLSearchParams(location.search).get("friend");
  if (!profileId(requested)) requested = null;
  const create = document.querySelector("#" + game + "-create");
  if (requested) {
    uiText(create, uiMsg("Create room and invite"));
    queueMicrotask(() => {
      const mode = document.querySelector("#" + game + "-mode");
      if (!mode) return;
      mode.value = "online";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
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
  for (const [node, label, className] of [
    [send, uiMsg("Send invitation"), "button primary"],
    [close, uiMsg("Close"), "button secondary"],
  ]) {
    node.type = "button";
    node.className = className;
    uiText(node, label);
  }
  const footer = document.createElement("div");
  footer.className = "action-row";
  footer.append(send, close);
  dialog.append(title, choice, status, footer);
  document.querySelector("#main").append(dialog);
  let pending = false,
    version = 0;
  const available = (room) =>
    room?.status === "waiting" &&
    room?.controller !== false &&
    (game === "pong" ? room.role === "host" : room.origin === "invite");
  function paint() {
    button.hidden = !api.user || !available(getRoom());
  }
  async function invite(id) {
    const account = api.user?.id,
      room = getRoom();
    if (!account || !room?.id || !profileId(id) || pending) return;
    pending = true;
    send.disabled = true;
    try {
      const data = await socialRPC(
        "send_friend_game_invite",
        {
          game_key: game,
          target_room: room.id,
          target_profile: id,
        },
        account,
      );
      if (api.user?.id !== account || getRoom()?.id !== room.id) return;
      if (data?.status !== "sent") {
        const label = inviteStatus(data?.status);
        uiText(status, label);
        window.KenseiNotify?.(label, { kind: "warning", account });
        return;
      }
      requested = null;
      const url = new URL(location.href);
      url.searchParams.delete("friend");
      history.replaceState(history.state, "", url);
      uiText(create, uiMsg("Create room"));
      if (dialog.open) dialog.close();
      window.KenseiNotify?.(uiMsg("Game invitation sent."), {
        kind: "success",
        account,
      });
    } catch {
      if (api.user?.id === account && getRoom()?.id === room.id) {
        const label = uiMsg(
          "Invitation could not send. Your room is still open.",
        );
        uiText(status, label);
        window.KenseiNotify?.(label, { kind: "error", account });
      }
    } finally {
      pending = false;
      send.disabled = !choice.value;
    }
  }
  async function openPicker() {
    if (!available(getRoom()) || !api.user || dialog.open) return;
    const token = ++version,
      account = api.user.id;
    choice.replaceChildren();
    send.disabled = true;
    uiText(status, uiMsg("Loading friends…"));
    dialog.showModal();
    try {
      const people = await socialRPC("list_friendships", {}, account);
      if (token !== version || account !== api.user?.id) return;
      const friends = (Array.isArray(people) ? people : []).filter(
        (player) => player.state === "friend",
      );
      choice.replaceChildren(
        ...friends.map((person) => uiOption(person.nickname, person.public_id)),
      );
      if (friends.some((person) => person.public_id === requested))
        choice.value = requested;
      send.disabled = !choice.value;
      uiText(status, choice.value ? "" : uiMsg("No friends yet."));
    } catch {
      if (token === version)
        uiText(status, uiMsg("Friends could not load. Try again."));
    }
  }
  button.onclick = openPicker;
  close.onclick = () => dialog.close();
  dialog.onclose = () => {
    version++;
    if (!button.hidden) button.focus({ preventScroll: true });
  };
  send.onclick = () => invite(choice.value);
  window.addEventListener("auth-identity-change", () => {
    if (dialog.open) dialog.close();
    paint();
  });
  return {
    paint,
    created() {
      paint();
      if (requested) void invite(requested);
    },
  };
}
