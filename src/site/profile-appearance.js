import { medal } from "./content-visuals.js";
import { ACHIEVEMENTS } from "/game-scripts/achievement-catalog.js";
import { uiFrom, uiText } from "./ui.js";
export const COVERS = ["orchid", "rose", "mist", "mint", "dusk", "aurora"];
export const ACCENTS = ["lavender", "rose", "ice", "mint", "amber"];
export function appearance(value) {
  return {
    cover: COVERS.includes(value?.cover) ? value.cover : "orchid",
    accent: ACCENTS.includes(value?.accent) ? value.accent : "lavender",
    featured: Array.isArray(value?.featured)
      ? [...new Set(value.featured)].slice(0, 3)
      : [],
  };
}
export function paintAppearance(surface, value) {
  if (!surface) return;
  const look = appearance(value);
  surface.dataset.profileCover = look.cover;
  surface.dataset.profileAccent = look.accent;
}
export function paintFeatured(node, ids, unlocks) {
  node.replaceChildren();
  for (const id of ids) {
    const def = ACHIEVEMENTS.find((a) => a.id === id),
      earned = unlocks.find((a) => a.achievement_id === id);
    if (!def || !earned) continue;
    const badge = document.createElement("span");
    badge.className = "profile-featured-badge";
    const label = document.createElement("span");
    uiText(label, uiFrom(def.name));
    badge.append(medal(def), label);
    node.append(badge);
  }
}
