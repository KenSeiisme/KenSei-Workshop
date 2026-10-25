import { api } from "./common.js";
import { uiText } from "../site/ui.js";

let pending = null,
  pendingOwner = null;
export async function profileRPC(name, args) {
  if (!api.client)
    throw new Error("The account service is unavailable. Please retry.");
  const { data, error } = await api.client.rpc(name, args);
  if (error) throw error;
  return data;
}
export function ensureProfile(force = false) {
  const owner = api.user?.id;
  if (!owner) return Promise.reject(new Error("Sign in to open your profile."));
  if (api.profile && !force) return Promise.resolve(api.profile);
  if (pending && pendingOwner === owner) return pending;
  pendingOwner = owner;
  pending = profileRPC("ensure_my_profile", { expected_user: owner })
    .then((data) => {
      if (api.user?.id !== owner)
        throw new Error("Account changed. Please reload.");
      api.setProfile(data, owner);
      return data;
    })
    .finally(() => {
      if (pendingOwner === owner) {
        pending = null;
        pendingOwner = null;
      }
    });
  return pending;
}
export function avatarURL(profile) {
  if (
    profile?.avatar_kind === "google" &&
    /^https:\/\/([a-zA-Z0-9-]+\.)*googleusercontent\.com\//.test(
      profile.google_avatar_url || "",
    )
  )
    return profile.google_avatar_url;
  if (
    profile?.avatar_kind === "upload" &&
    profile.avatar_path &&
    profile.public_id &&
    profile.avatar_path.startsWith(profile.public_id + "/")
  )
    return (
      (window.KENSEI_CONFIG.supabaseUrl || "").replace(/\/$/, "") +
      "/storage/v1/object/public/avatars/" +
      profile.avatar_path.split("/").map(encodeURIComponent).join("/")
    );
  return "";
}
export function paintAvatar(node, profile, preview = "") {
  if (!node) return;
  node.replaceChildren();
  const initials = Array.from(profile?.nickname || "K")
    .slice(0, 1)
    .join("")
    .toUpperCase();
  uiText(node, initials);
  const src = preview || avatarURL(profile);
  node.dataset.source = src;
  if (!src) return;
  const image = new Image();
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.onload = () => {
    if (node.dataset.source === src) node.replaceChildren(image);
  };
  image.onerror = () => {
    if (node.dataset.source === src) uiText(node, initials);
  };
  node.dataset.source = src;
  image.src = src;
}
