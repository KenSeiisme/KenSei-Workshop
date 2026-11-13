import { esc } from "/tool-scripts/common.js";
import { avatarURL, paintAvatar } from "/tool-scripts/profile-service.js";
import { uiDate, uiHtml, uiJoin, uiMsg } from "../site/ui.js";
import { patchMarkup } from "./dom.js";

const faces = new WeakMap();

export function boardPodiumResult(row) {
  return uiMsg("{0} wins · {1}", [
    row.wins,
    row.played ? `${(row.win_rate * 100).toFixed(1)}%` : "—",
  ]);
}

export function boardPodiumDetail(
  row,
  pattern = "{0} games · {1} losses · {2} draws",
) {
  const stats = uiMsg(pattern, [row.played, row.losses, row.draws]);
  return row.achieved_at
    ? uiJoin([stats, " · ", uiDate(row.achieved_at, { dateStyle: "medium" })])
    : stats;
}

export function podiumEntries(rows) {
  return rows
    .filter(
      ({ rank }) => Number.isInteger(Number(rank)) && rank >= 1 && rank <= 3,
    )
    .sort((a, b) => a.rank - b.rank);
}

export function paintPodium(
  node,
  rows,
  { result, linked = true, mine, detail } = {},
) {
  const podium = podiumEntries(rows);
  node.hidden = !podium.length;
  const profiles = podium.map((row) => ({
    ...(linked ? row.profile || row : {}),
    nickname: row.nickname || row.profile?.nickname || "—",
    public_id: linked ? row.public_id || row.profile?.public_id : null,
  }));
  const prefix = location.pathname.startsWith("/zh-hant/") ? "/zh-hant" : "";
  patchMarkup(
    node,
    podium
      .map((row, index) => {
        const profile = profiles[index];
        const name = esc(profile.nickname);
        const player = profile.public_id
          ? uiHtml`<a href="${prefix}/profile/?id=${encodeURIComponent(profile.public_id)}">${name}</a>`
          : uiHtml`<span>${name}</span>`;
        const extra = detail?.(row);
        const isMine =
          !!mine?.public_id && mine.public_id === profile.public_id;
        return uiHtml`<li class="rank-podium-card${isMine ? " is-me" : ""}" data-rank="${Number(row.rank)}">
          <span class="rank-medal" role="img" aria-label="${uiMsg("Rank {0}", [row.rank])}">#${Number(row.rank)}</span>
          <span class="avatar-badge rank-podium-avatar" data-source="${esc(avatarURL(profile))}" data-preserve aria-hidden="true"></span>
          <div class="rank-podium-copy">${player}<strong>${result(row)}</strong>${extra ? uiHtml`<small>${extra}</small>` : ""}</div>
        </li>`;
      })
      .join(""),
  );
  [...node.querySelectorAll(".rank-podium-avatar")].forEach((avatar, index) => {
    const profile = profiles[index];
    const signature = JSON.stringify([profile.nickname, avatarURL(profile)]);
    if (faces.get(avatar) === signature) return;
    faces.set(avatar, signature);
    paintAvatar(avatar, profile);
  });
}
