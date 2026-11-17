import { api } from "/tool-scripts/common.js";
import { uiAttr, uiConfirm, uiMsg, uiText } from "./ui.js";
import { socialRPC, SOCIAL_GAMES, socialPath } from "./social-api.js";
import { presenceText } from "./social-presence.js";
import { uiFrom } from "./ui.js";

const actions = {
  none: ["request", "block"],
  outgoing: ["cancel", "block"],
  incoming: ["accept", "decline", "block"],
  friend: ["remove", "block"],
  blocked: ["unblock"],
};
const text = {
  request: "Add friend",
  block: "Block player",
  cancel: "Cancel request",
  accept: "Accept request",
  decline: "Decline request",
  remove: "Remove friend",
  unblock: "Unblock player",
};
const confirmations = {
  block:
    "Block this player and cancel pending friend requests and invitations?",
  remove: "Remove this friend?",
};
function button(label, handler, primary) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "button " + (primary ? "primary" : "secondary");
  uiText(node, label);
  node.onclick = handler;
  return node;
}
export function paintFriendActions(root, peer, update) {
  const { public_id, nickname, state, id } = peer;
  const owner = api.user?.id;
  root.replaceChildren();
  for (const action of actions[state] || []) {
    const node = button(
      uiMsg(text[action]),
      async () => {
        if (confirmations[action] && !uiConfirm(uiMsg(confirmations[action])))
          return;
        const buttons = [...root.querySelectorAll("button")];
        buttons.forEach((item) => (item.disabled = true));
        try {
          const next = await socialRPC(
            "change_friendship",
            {
              target_profile: public_id,
              action,
              request: id || null,
            },
            owner,
          );
          if (owner !== api.user?.id) return;
          if (next?.state === "unavailable") {
            window.KenseiNotify?.(uiMsg("This player is unavailable."), {
              kind: "warning",
              account: owner,
            });
          } else {
            const expected = {
              request: "outgoing",
              accept: "friend",
              decline: "none",
              cancel: "none",
              remove: "none",
              block: "blocked",
              unblock: "none",
            }[action];
            const changed = next?.state === expected;
            window.KenseiNotify?.(
              changed
                ? uiMsg("Friend status updated.")
                : uiMsg(
                    "This request has changed. The current status is shown.",
                  ),
              {
                kind: changed ? "success" : "warning",
                account: owner,
              },
            );
          }
          update(next || { state: "unavailable" });
          window.dispatchEvent(new Event("social-change"));
        } catch {
          if (owner === api.user?.id)
            window.KenseiNotify?.(
              uiMsg("Could not update this friendship. Try again."),
              { kind: "error", account: owner },
            );
        } finally {
          buttons.forEach((item) => (item.disabled = false));
        }
      },
      action === "request" || action === "accept",
    );
    node.dataset.friendAction = action;
    if (nickname)
      uiAttr(
        node,
        "aria-label",
        uiMsg("{0} · {1}", [uiMsg(text[action]), nickname]),
      );
    root.append(node);
  }
}

export function openFriendGameChoice(person, trigger) {
  let dialog = document.querySelector("#public-friend-game-choice");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "public-friend-game-choice";
    dialog.className = "friend-invite-dialog";
    document.querySelector("#main").append(dialog);
  }
  dialog.replaceChildren();
  const title = document.createElement("h2"),
    links = document.createElement("div");
  title.id = "public-friend-game-heading";
  uiText(title, uiMsg("Invite {0}", [person.nickname]));
  dialog.setAttribute("aria-labelledby", title.id);
  links.className = "friend-game-links";
  for (const [game, name] of Object.entries(SOCIAL_GAMES)) {
    const link = document.createElement("a");
    link.className = "button secondary";
    link.href =
      socialPath("/games/" + game + "/") +
      "?friend=" +
      encodeURIComponent(person.public_id);
    uiText(link, uiFrom(name));
    links.append(link);
  }
  dialog.append(
    title,
    links,
    button(uiMsg("Close"), () => dialog.close(), false),
  );
  dialog.onclose = () => {
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
  dialog.showModal();
}
export async function mountPublicFriendActions(root, person) {
  root.replaceChildren();
  if (!api.user) {
    root.append(
      button(
        uiMsg("Sign in to add a friend"),
        () => api.openAuth(location.pathname + location.search),
        false,
      ),
    );
    return;
  }
  const owner = api.user.id;
  const show = (relation) => {
    if (api.user?.id !== owner) return;
    paintFriendActions(root, { ...person, ...relation }, show);
    if (relation.state === "friend") {
      const label = document.createElement("span");
      label.className = "small-tag";
      uiText(label, uiMsg("Friend"));
      root.prepend(label);
      const presence = document.createElement("span");
      presence.className = "friend-presence";
      uiText(presence, presenceText(relation.presence));
      root.append(
        presence,
        button(
          uiMsg("Invite to game"),
          (event) => openFriendGameChoice(person, event.currentTarget),
          false,
        ),
      );
    }
  };
  try {
    show(
      await socialRPC(
        "get_friendship",
        { target_profile: person.public_id },
        owner,
      ),
    );
  } catch {
    if (api.user?.id === owner)
      root.append(
        button(
          uiMsg("Retry friend status"),
          () => mountPublicFriendActions(root, person),
          false,
        ),
      );
  }
}
