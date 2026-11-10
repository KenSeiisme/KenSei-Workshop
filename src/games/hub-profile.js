import { api } from "/tool-scripts/common.js";
import {
  ensureProfile,
  paintAvatar,
  profileRPC,
} from "/tool-scripts/profile-service.js";
import { ACHIEVEMENTS } from "./achievement-catalog.js";
import { gameVersion } from "./engine.js";
import { XIANGQI_START, XIANGQI_VERSION } from "./xiangqi-engine.js";
import {
  defaultBoardMode,
  localizedPath,
  resultLabel,
} from "./hub-rankings.js";
import { uiFrom, uiMsg, uiText } from "../site/ui.js";

const scoreBadges = ACHIEVEMENTS.filter((item) => item.field === "score").sort(
  (a, b) => b.target - a.target || a.id.localeCompare(b.id),
);

function guestBest(game, rows) {
  if (game === "xiangqi") {
    const wins = rows
      .map((row) => row.data)
      .filter(
        (data) =>
          data.game === game &&
          data.state?.version === XIANGQI_VERSION &&
          data.mode === "ai" &&
          data.state.initialFen === XIANGQI_START &&
          data.state.status === "finished" &&
          data.state.result?.winner === data.human &&
          data.state.result.reason !== "imported",
      );
    const level = Math.max(0, ...wins.map((data) => data.level || 0));
    return level ? uiMsg("AI level {0} defeated", [level]) : null;
  }
  const mode = defaultBoardMode(game);
  const records = rows
    .map((row) => row.data)
    .filter(
      (data) =>
        data.game === game &&
        data.difficulty === mode &&
        data.state?.version === gameVersion(game) &&
        Number.isFinite(data.best?.score),
    );
  const score = records.reduce(
    (max, data) => Math.max(max, data.best.score),
    -1,
  );
  return score >= 0 ? resultLabel(game, mode, { score }) : null;
}

function verifiedBest(game, profile) {
  const mode = defaultBoardMode(game);
  if (game === "xiangqi") {
    const record = profile.xiangqi_stats?.find(
      (row) =>
        row.rules_version === XIANGQI_VERSION &&
        row.time_control === mode &&
        row.played > 0,
    );
    return record ? uiMsg("{0} wins · {1}", [record.wins, mode]) : null;
  }
  const record = profile.game_best_scores?.find(
    (row) =>
      row.game === game &&
      row.version === gameVersion(game) &&
      row.difficulty === mode,
  );
  return record ? resultLabel(game, mode, record) : null;
}

export function mountHubProfile(hub, saves) {
  const $ = (selector) => hub.querySelector(selector);
  const slides = [...hub.querySelectorAll("[data-hub-featured]")];
  const avatar = $("[data-hub-avatar]");
  const retry = $("[data-hub-profile-retry]");
  let snapshot,
    snapshotOwner,
    profile,
    owner,
    loading = false,
    failed = false,
    request = 0,
    avatarKey;

  function render() {
    const signed = !!api.user;
    const waiting = !api.ready;
    const ownProfile = signed && owner === api.user.id ? profile : null;
    const identity = ownProfile || (signed ? api.profile : null);
    const badgeIds =
      ownProfile?.game_achievements?.map((entry) => entry.achievement_id) || [];
    const progress =
      snapshotOwner === (api.user?.id || "guest") ? snapshot : null;
    const localBadges = progress?.badges || [];
    const highlight = signed
      ? scoreBadges.find((item) => badgeIds.includes(item.id))
      : localBadges.includes("score-1000")
        ? {
            name: "Score chaser",
            description: "Score over 1,000 points in a single game.",
          }
        : null;
    const nick =
      identity?.nickname ||
      uiMsg(
        waiting
          ? "Loading player profile…"
          : signed
            ? "Player profile"
            : "Guest player",
      );
    const key = JSON.stringify([
      api.user?.id,
      identity?.nickname,
      identity?.avatar_kind,
      identity?.avatar_path,
      identity?.google_avatar_url,
    ]);
    if (avatarKey !== key) {
      avatarKey = key;
      paintAvatar(avatar, identity || { nickname: signed ? "P" : "G" });
    }
    uiText($("[data-hub-player-name]"), nick);
    uiText(
      $("[data-hub-player-source]"),
      waiting
        ? ""
        : uiMsg(signed ? "Account progress" : "Guest progress · This device"),
    );
    uiText(
      $("[data-hub-lobby-count]"),
      progress ? `${localBadges.length} / 3` : "—",
    );
    $("[data-hub-lobby-progress]").value = localBadges.length;
    $("[data-hub-verified-count-group]").hidden = !signed;
    const verifiedCount = ACHIEVEMENTS.filter((item) =>
      badgeIds.includes(item.id),
    ).length;
    uiText(
      $("[data-hub-verified-count]"),
      ownProfile ? `${verifiedCount} / ${ACHIEVEMENTS.length}` : "—",
    );
    $("[data-hub-verified-progress]").value = verifiedCount;
    uiText(
      $("[data-hub-highlight]"),
      highlight ? uiFrom(highlight.name) : uiMsg("Top scoring badge"),
    );
    uiText(
      $("[data-hub-highlight-detail]"),
      highlight
        ? uiFrom(highlight.description)
        : waiting || (signed && !ownProfile) || (!signed && !progress)
          ? "—"
          : uiMsg("No scoring badge unlocked yet."),
    );
    uiText(
      $("[data-hub-profile-status]"),
      failed
        ? uiMsg("Profile could not load. Check your connection and retry.")
        : loading && !ownProfile
          ? uiMsg("Loading player profile…")
          : "",
    );
    retry.hidden = !failed;
    $("[data-hub-profile-sign-in]").hidden = signed || waiting;
    const link = $("[data-hub-profile-link]");
    const publicId = signed ? identity?.public_id : null;
    link.hidden = !publicId;
    if (publicId)
      link.href =
        localizedPath("/profile/") + "?id=" + encodeURIComponent(publicId);
    else link.removeAttribute("href");

    const rows = signed || waiting ? [] : saves.rows();
    for (const slide of slides) {
      const game = slide.dataset.hubFeatured;
      const best = waiting
        ? null
        : signed
          ? ownProfile && verifiedBest(game, ownProfile)
          : guestBest(game, rows);
      uiText(
        slide.querySelector("[data-hub-best-label]"),
        uiMsg(
          waiting
            ? "My best"
            : signed
              ? "My verified best"
              : "My best on this device",
        ),
      );
      uiText(
        slide.querySelector("[data-hub-best]"),
        best ??
          (waiting || (signed && !ownProfile)
            ? "—"
            : uiMsg(signed ? "No verified record yet" : "No saved best yet")),
      );
      uiText(
        slide.querySelector("[data-hub-plays]"),
        progress ? progress.stats?.[game]?.plays || 0 : "—",
      );
    }
  }

  async function refresh(force = false) {
    const expected = api.user?.id;
    if (owner !== expected) {
      owner = expected;
      profile = null;
      loading = failed = false;
      request++;
    }
    if (!expected || loading || (!force && profile)) {
      render();
      return;
    }
    const id = ++request;
    const valid = () => id === request && api.user?.id === expected;
    loading = true;
    failed = false;
    render();
    try {
      const { public_id } = await ensureProfile();
      if (!valid()) return;
      const result = await profileRPC("get_public_profile", {
        profile_id: public_id,
      });
      if (!result || result.public_id !== public_id)
        throw Error("Profile not available");
      if (valid()) profile = result;
    } catch {
      if (valid()) failed = true;
    } finally {
      if (valid()) {
        loading = false;
        render();
      }
    }
  }
  retry.addEventListener("click", () => refresh(true));
  window.addEventListener("workspace-ready", () => refresh());
  window.addEventListener("profile-updated", () => refresh(true));
  window.addEventListener("focus", () => refresh(true));
  window.addEventListener("online", () => {
    if (failed) refresh(true);
  });
  window.addEventListener("locale-change", render);
  saves.subscribe(render);
  refresh();
  return (value) => {
    snapshot = value;
    snapshotOwner = api.user?.id || "guest";
    render();
  };
}
