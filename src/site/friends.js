import { api } from "/tool-scripts/common.js";
import { ensureProfile, paintAvatar } from "/tool-scripts/profile-service.js";
import { uiFrom, uiMsg, uiText } from "./ui.js";
import { paintFriendActions } from "./friend-actions.js";
import {
  profileId,
  SOCIAL_GAMES,
  socialPath,
  socialRPC,
} from "./social-api.js";

const root = document.querySelector("[data-friends-page]");
const $ = (selector) => root.querySelector(selector);
const query = $("[data-friends-query]"),
  results = $("[data-friends-results]"),
  searchStatus = $("[data-friends-search-status]"),
  retry = $("[data-friends-retry]"),
  chooser = $("#friend-game-choice");
let owner,
  records = [],
  matches = [],
  loadToken = 0,
  searchToken = 0,
  delay,
  searchTrigger;

function chooseGame(person, trigger) {
  searchTrigger = trigger;
  const links = $("[data-friend-game-links]");
  links.replaceChildren(
    ...Object.entries(SOCIAL_GAMES).map(([game, name]) => {
      const link = document.createElement("a");
      link.className = "button secondary";
      link.href =
        socialPath("/games/" + game + "/") +
        "?friend=" +
        encodeURIComponent(person.public_id);
      uiText(link, uiFrom(name));
      return link;
    }),
  );
  chooser.showModal();
}

function row(person) {
  const wrapper = document.createElement("article"),
    identity = document.createElement("a"),
    avatar = document.createElement("span"),
    name = document.createElement("strong"),
    buttons = document.createElement("div");
  wrapper.className = "friend-row";
  wrapper.dataset.friendId = person.public_id;
  identity.className = "friend-identity";
  if (profileId(person.public_id))
    identity.href =
      socialPath("/profile/") + "?id=" + encodeURIComponent(person.public_id);
  avatar.className = "avatar-badge avatar-small";
  avatar.setAttribute("aria-hidden", "true");
  paintAvatar(avatar, person);
  uiText(name, person.nickname);
  identity.append(avatar, name);
  buttons.className = "friend-actions";
  wrapper.append(identity, buttons);
  paintFriendActions(buttons, person, (next) => {
    const previous = document.activeElement;
    const edited = { ...person, ...next };
    matches = matches
      .map((peer) => (peer.public_id === person.public_id ? edited : peer))
      .filter((peer) => !["blocked", "unavailable"].includes(peer.state));
    records = records.filter((peer) => peer.public_id !== person.public_id);
    if (["friend", "incoming", "outgoing", "blocked"].includes(edited.state))
      records.push(edited);
    paint(previous);
  });
  if (person.state === "friend") {
    const invite = document.createElement("button");
    invite.type = "button";
    invite.className = "button secondary";
    uiText(invite, uiMsg("Invite to game"));
    invite.onclick = () => chooseGame(person, invite);
    buttons.prepend(invite);
  }
  return wrapper;
}
function paint(focused = document.activeElement) {
  const from = focused?.closest("[data-friend-id]");
  results.replaceChildren(...matches.map(row));
  for (const list of root.querySelectorAll("[data-friend-list]")) {
    const people = records.filter(
      (peer) => peer.state === list.dataset.friendList,
    );
    list.replaceChildren(...people.map(row));
    if (!people.length) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      uiText(
        empty,
        list.dataset.friendList === "friend"
          ? uiMsg("No friends yet.")
          : uiMsg("Nothing to show."),
      );
      list.append(empty);
    }
  }
  if (from && from !== focused && !focused.isConnected) {
    const target = [...root.querySelectorAll("[data-friend-id]")].find(
      (node) => node.dataset.friendId === from.dataset.friendId,
    );
    (target?.querySelector("a[href]") || query).focus({ preventScroll: true });
  }
}
function reset() {
  records = [];
  matches = [];
  query.value = "";
  loadToken++;
  searchToken++;
  clearTimeout(delay);
  if (chooser.open) chooser.close();
  paint();
}
async function load() {
  const account = api.user?.id;
  if (account !== owner) {
    owner = account;
    reset();
  }
  $("[data-friends-login]").hidden = !!owner || !api.ready;
  $("[data-friends-content]").hidden = !owner;
  retry.hidden = true;
  const status = $("[data-friends-status]");
  if (!owner) {
    uiText(status, api.ready ? "" : uiMsg("Connecting to sign-in…"));
    return;
  }
  const token = ++loadToken;
  uiText(status, uiMsg("Loading friends…"));
  try {
    await ensureProfile();
    const data = await socialRPC("list_friendships", {}, owner);
    if (token !== loadToken || account !== api.user?.id) return;
    records = Array.isArray(data) ? data : [];
    paint();
    uiText(status, "");
  } catch {
    if (token !== loadToken || account !== api.user?.id) return;
    retry.hidden = false;
    uiText(status, uiMsg("Friends could not load. Try again."));
  }
}
async function search() {
  const token = ++searchToken;
  const term = query.value.trim();
  if (!owner || [...term].length < 2) {
    matches = [];
    paint();
    uiText(searchStatus, uiMsg("Enter at least two characters."));
    return;
  }
  const account = owner;
  uiText(searchStatus, uiMsg("Searching for players…"));
  try {
    const data = await socialRPC(
      "search_friend_profiles",
      { query: term },
      account,
    );
    if (token !== searchToken || account !== api.user?.id) return;
    matches = Array.isArray(data) ? data : [];
    paint();
    uiText(searchStatus, matches.length ? "" : uiMsg("No matching players."));
  } catch {
    if (token !== searchToken || account !== api.user?.id) return;
    uiText(searchStatus, uiMsg("Search unavailable. Try again."));
  }
}
const schedule = () => {
  clearTimeout(delay);
  searchToken++;
  delay = setTimeout(search, 220);
};
query.addEventListener("input", (event) => {
  if (!event.isComposing) schedule();
});
query.addEventListener("compositionend", schedule);
query.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  clearTimeout(delay);
  void search();
});
retry.onclick = load;
$("[data-friends-sign-in]").onclick = () => api.openAuth();
$("[data-close-friend-game]").onclick = () => chooser.close();
chooser.onclose = () => {
  if (searchTrigger?.isConnected) searchTrigger.focus({ preventScroll: true });
};
for (const event of ["workspace-ready", "auth-identity-change", "focus"])
  window.addEventListener(event, load);
window.addEventListener("locale-change", paint);
load();
