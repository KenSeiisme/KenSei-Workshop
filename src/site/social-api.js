import { api } from "/tool-scripts/common.js";
import { uiMsg } from "./ui.js";

export const profileId = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value || "",
  );
export const socialPath = (path) => window.KenseiI18n.localePath(path);
export const SOCIAL_GAMES = {
  go: "Go",
  chess: "Chess",
  xiangqi: "Xiangqi",
  pong: "Pong",
};

export async function socialRPC(name, args = {}, owner = api.user?.id) {
  if (!owner || owner !== api.user?.id || !api.client)
    throw Error("Account unavailable");
  const rpc = api.client.rpc(name, { ...args, expected_user: owner });
  const { data, error } = await (rpc.abortSignal?.(AbortSignal.timeout(9000)) ??
    rpc);
  if (owner !== api.user?.id) throw Error("Account changed");
  if (error) throw error;
  return data;
}

export function inviteStatus(status) {
  switch (status) {
    case "closed":
      return uiMsg("This room has closed.");
    case "expired":
      return uiMsg("This invitation has expired.");
    case "full":
      return uiMsg("This room is already full.");
    default:
      return uiMsg("This invitation is unavailable.");
  }
}
