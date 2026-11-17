import { api } from "/tool-scripts/common.js";
import { uiFrom, uiMsg } from "./ui.js";
import { socialRPC } from "./social-api.js";

const games = new Set([
  "2048",
  "minesweeper",
  "snake",
  "memory-match",
  "sudoku",
  "nonogram",
  "block-puzzle",
  "brick-breaker",
  "connect-four",
  "reversi",
  "block-drop",
  "go",
  "chess",
  "xiangqi",
  "pong",
]);
const gameNames = {
  2048: "2048",
  minesweeper: "Minesweeper",
  snake: "Snake",
  "memory-match": "Memory Match",
  sudoku: "Sudoku",
  nonogram: "Nonogram",
  "block-puzzle": "Block Puzzle",
  "brick-breaker": "Brick Breaker",
  "connect-four": "Connect Four",
  reversi: "Reversi",
  "block-drop": "Block Drop",
  go: "Go",
  chess: "Chess",
  xiangqi: "Xiangqi",
  pong: "Pong",
};
const client = crypto.randomUUID();
let owner,
  visible = true,
  serial = 0,
  pending,
  visibilityVersion = 0,
  queued = false,
  lastActivity = "",
  lastSent = -Infinity;
let channel;
try {
  channel = new BroadcastChannel("kensei-social-updates");
} catch {}
export function presenceText(presence) {
  if (presence?.status === "playing" && games.has(presence.game))
    return uiMsg("Playing · {0}", [uiFrom(gameNames[presence.game])]);
  return presence?.status === "online" ? uiMsg("Online") : uiMsg("Offline");
}
export function socialVisible() {
  return visible;
}
function announce() {
  window.dispatchEvent(new Event("social-preferences-change"));
}
export async function setSocialVisibility(value) {
  const account = api.user?.id;
  const version = ++visibilityVersion;
  const result = await socialRPC(
    "set_social_visibility",
    { visible: value },
    account,
  );
  if (account !== api.user?.id || version !== visibilityVersion) return;
  if (typeof result?.visible !== "boolean")
    throw Error("Invalid visibility response");
  visible = result.visible;
  announce();
  channel?.postMessage({ owner: account });
  window.dispatchEvent(new Event("social-change"));
}
function activity() {
  const game = location.pathname.replace(/^\/zh-hant/, "").split("/")[2];
  if (!games.has(game)) return null;
  const selector = ["go", "chess", "xiangqi"].includes(game)
    ? "[data-" + game + '-phase="playing"]'
    : '[data-shell-state="playing"]';
  return document.querySelector(selector) ? game : null;
}
async function touch(force = false) {
  const account = api.user?.id;
  if (owner !== account) {
    owner = account;
    serial++;
    visibilityVersion++;
    queued = false;
    pending = null;
    visible = true;
    lastSent = -Infinity;
    announce();
  }
  if (!account || !api.client || !navigator.onLine) return;
  if (pending) {
    queued ||= force;
    return;
  }
  const game = activity(),
    active = !document.hidden,
    signature = JSON.stringify([game, active]);
  if (
    !force &&
    signature === lastActivity &&
    performance.now() - lastSent < 60000
  )
    return;
  const token = ++serial,
    preferenceVersion = visibilityVersion;
  pending = token;
  lastActivity = signature;
  try {
    const result = await socialRPC(
      "touch_social_activity",
      { client_id: client, game_key: game, active },
      account,
    );
    if (serial !== token || account !== api.user?.id) return;
    if (typeof result?.visible !== "boolean")
      throw Error("Invalid activity response");
    lastSent = performance.now();
    if (preferenceVersion === visibilityVersion && visible !== result.visible) {
      visible = result.visible;
      announce();
    }
  } catch {
    if (serial === token) lastSent = -Infinity;
  } finally {
    if (pending === token) {
      pending = null;
      if (queued) {
        queued = false;
        void touch(true);
      } else if (signature !== JSON.stringify([activity(), !document.hidden]))
        void touch();
    }
  }
}
channel?.addEventListener("message", (event) => {
  if (event.data?.owner === api.user?.id) {
    visibilityVersion++;
    window.dispatchEvent(new Event("social-remote-change"));
    if (!document.hidden) void touch(true);
  }
});
window.addEventListener("social-change", () =>
  channel?.postMessage({ owner: api.user?.id }),
);
for (const event of [
  "workspace-ready",
  "auth-identity-change",
  "online",
  "focus",
  "pageshow",
])
  window.addEventListener(event, () => {
    if (!document.hidden) void touch();
  });
document.addEventListener("visibilitychange", () => void touch(true));
new MutationObserver(() => {
  if (!document.hidden) void touch();
}).observe(document.body, {
  subtree: true,
  attributes: true,
  attributeFilter: ["data-shell-state"],
});
setInterval(() => {
  if (!document.hidden) void touch();
}, 60000);
window.addEventListener("pagehide", () => {
  if (api.user?.id === owner && owner && api.client)
    void socialRPC(
      "touch_social_activity",
      { client_id: client, game_key: null, active: false },
      owner,
    ).catch(() => {});
});
if (api.ready) void touch();
