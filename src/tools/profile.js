import {
  contentIcon,
  gameEmblem,
  medal,
  boardStatCards,
} from "../site/content-visuals.js";
import { mountPublicFriendActions } from "../site/friend-actions.js";
import { socialPath } from "../site/social-api.js";
import {
  appearance,
  paintAppearance,
  paintFeatured,
} from "../site/profile-appearance.js";
import { ACHIEVEMENTS } from "/game-scripts/achievement-catalog.js";
import { patchMarkup } from "/game-scripts/dom.js";
import { mountEffects, revealGameCards } from "/game-scripts/effects.js";
import { renderPublicAchievements } from "/game-scripts/achievements.js";
import { gameVersion, retiredArcade } from "/game-scripts/engine.js";
mountEffects();
import { $, api, esc, canvasBlob } from "./common.js";
import { ready } from "./personal-store.js";
import { ensureProfile, profileRPC, paintAvatar } from "./profile-service.js";
import {
  GAMES,
  gameIcon,
  scoreParts,
  scoreDetail,
  scoreDate,
} from "/game-scripts/presentation.js";
import { uiMsg, uiJoin, uiFrom, uiError, uiText, uiHtml } from "../site/ui.js";

const requested = new URLSearchParams(location.search).get("id");
let original = null,
  owner = null,
  dirty = false,
  avatarBlob = null,
  previewURL = "",
  avatarKind = null,
  working = false,
  selection = 0,
  uploadedPath = null;
let profileLoad = 0,
  milestoneLoad = 0,
  ownMilestones = [],
  featured = [];
const message = (text) => uiText($("#profile-status"), text);
function paintSelections() {
  for (const [id, selector] of [
    ["profile-cover", "[data-cover-choices]"],
    ["profile-accent", "[data-accent-choices]"],
  ]) {
    for (const input of $(selector).querySelectorAll("input"))
      input.checked = input.value === $("#" + id).value;
  }
  uiText(
    $("[data-featured-count]"),
    uiMsg("{0} / 3 selected", [featured.length]),
  );
}
function mountAppearanceChoices(id, selector, type) {
  const select = $("#" + id),
    root = $(selector);
  for (const option of select.options) {
    const label = document.createElement("label"),
      input = document.createElement("input"),
      sample = document.createElement("span"),
      name = document.createElement("span");
    input.type = "radio";
    input.name = id + "-visual";
    input.value = option.value;
    label.className = "profile-choice";
    label.dataset[type === "cover" ? "profileCover" : "profileAccent"] =
      option.value;
    sample.className = "profile-choice-sample";
    sample.setAttribute("aria-hidden", "true");
    const names = {
      orchid: "Orchid",
      rose: "Rose",
      mist: "Mist",
      mint: "Mint",
      dusk: "Dusk",
      aurora: "Aurora",
      lavender: "Lavender",
      ice: "Ice blue",
      amber: "Amber",
    };
    uiText(name, uiFrom(names[option.value]));
    input.onchange = () => {
      if (input.checked) {
        select.value = input.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    label.append(input, sample, name, contentIcon("tick"));
    root.append(label);
  }
  select.hidden = true;
}
mountAppearanceChoices("profile-cover", "[data-cover-choices]", "cover");
mountAppearanceChoices("profile-accent", "[data-accent-choices]", "accent");
function markDirty() {
  dirty = true;
  message(uiMsg("Unsaved changes. Save when you are ready."));
  uiText($("#profile-bio-count"), Array.from($("#profile-bio").value).length);
  paintPreview();
}
function releasePreview() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = "";
}
let previewAvatar = "";
function paintPreview() {
  const nickname = $("#profile-name").value.trim();
  const bio = $("#profile-bio").value;
  uiText($("#profile-preview-name"), nickname || uiMsg("Public name"));
  uiText($("#profile-preview-bio"), bio);
  paintAppearance($(".profile-preview-card"), editedAppearance());
  paintAppearance($("#profile-preview"), editedAppearance());
  paintFeatured($("[data-preview-featured]"), featured, ownMilestones);
  paintSelections();
  const key = [
    nickname[0],
    avatarKind,
    previewURL,
    original?.avatar_path,
    original?.google_avatar_url,
  ].join(":");
  if (key !== previewAvatar) {
    previewAvatar = key;
    paintAvatar(
      $("#profile-preview-avatar"),
      { ...original, nickname, avatar_kind: avatarKind },
      previewURL,
    );
  }
}
function editedAppearance() {
  return appearance({
    cover: $("#profile-cover").value,
    accent: $("#profile-accent").value,
    featured,
  });
}
async function loadMilestoneChoices() {
  if (!original || requested) return;
  const account = owner,
    id = original.public_id,
    ticket = ++milestoneLoad;
  const root = $("[data-profile-milestone-options]"),
    note = $("[data-profile-milestone-status]");
  $("[data-profile-milestone-retry]").hidden = true;
  uiText(note, uiMsg("Loading milestones…"));
  try {
    const data = await profileRPC("get_public_profile", { profile_id: id });
    if (
      account !== api.user?.id ||
      ticket !== milestoneLoad ||
      original?.public_id !== id
    )
      return;
    ownMilestones = data?.game_achievements || [];
    root.replaceChildren();
    for (const earned of ownMilestones) {
      const def = ACHIEVEMENTS.find((a) => a.id === earned.achievement_id);
      if (!def) continue;
      const label = document.createElement("label"),
        checkbox = document.createElement("input"),
        text = document.createElement("span");
      checkbox.type = "checkbox";
      checkbox.value = def.id;
      checkbox.checked = featured.includes(def.id);
      uiText(text, uiFrom(def.name));
      checkbox.onchange = () => {
        if (checkbox.checked && featured.length >= 3) {
          checkbox.checked = false;
          uiText(note, uiMsg("Choose up to three milestones."));
          return;
        }
        featured = checkbox.checked
          ? [...featured, def.id]
          : featured.filter((id) => id !== def.id);
        uiText(note, "");
        markDirty();
      };
      label.className = "profile-milestone-choice";
      label.append(checkbox, medal(def), text, contentIcon("tick"));
      root.append(label);
    }
    uiText(
      note,
      ownMilestones.length
        ? ""
        : uiMsg("Unlock verified milestones to feature them here."),
    );
    paintPreview();
  } catch {
    if (account === api.user?.id && ticket === milestoneLoad) {
      uiText(
        note,
        uiMsg("Milestones could not load. Your selection is preserved."),
      );
      $("[data-profile-milestone-retry]").hidden = false;
    }
  }
}
$("#profile-cover").onchange = markDirty;
$("#profile-accent").onchange = markDirty;
$("[data-profile-milestone-retry]").onclick = loadMilestoneChoices;
function fill(profile) {
  const look = appearance(profile.appearance);
  $("#profile-cover").value = look.cover;
  $("#profile-accent").value = look.accent;
  featured = [...look.featured];
  original = profile;
  owner = api.user?.id;
  $("#profile-name").value = profile.nickname;
  $("#profile-bio").value = profile.bio;
  uiText($("#profile-bio-count"), Array.from(profile.bio).length);
  $("#profile-view-public").href =
    socialPath("/profile/") + "?id=" + encodeURIComponent(profile.public_id);
  avatarKind = profile.avatar_kind;
  paintAvatar($("#profile-avatar"), profile);
  $("#profile-preview").hidden = false;
  paintPreview();
}
function renderPublicScores(profile) {
  uiText(
    $("#public-milestone-total"),
    (profile.game_achievements || []).length,
  );
  renderPublicAchievements(
    $("#public-game-achievements"),
    profile.game_achievements || [],
  );
  if ($("#public-achievements-count"))
    uiText(
      $("#public-achievements-count"),
      `${(profile.game_achievements || []).length} / 30`,
    );
  const games = (profile.game_best_scores || []).filter(
    (r) =>
      GAMES[r.game]?.ranked &&
      GAMES[r.game]?.modes[r.difficulty] &&
      (!retiredArcade(r.game) || r.version === gameVersion(r.game)),
  );
  const legacy = (profile.game_legacy_best_scores || []).filter(
    (r) =>
      GAMES[r.game]?.ranked &&
      GAMES[r.game]?.modes[r.difficulty] &&
      !retiredArcade(r.game),
  );
  uiText(
    $("#public-game-count"),
    `${new Set([...games, ...legacy].map((r) => r.game)).size} / ${Object.values(GAMES).filter((g) => g.ranked).length}`,
  );
  uiText(
    $("#public-typing-count"),
    `${["en", "zh"].filter((lang) => profile.best_scores?.some((r) => r.language === lang)).length} / 2`,
  );
  // 固定容器每次替换，重试不会重复追加成绩；不同难度各自展示。
  patchMarkup(
    $("#public-game-scores"),
    Object.entries(GAMES)
      .filter(([, game]) => game.ranked)
      .map(([slug, game]) => {
        const rows = Object.keys(game.modes)
          .map((d) => games.find((r) => r.game === slug && r.difficulty === d))
          .filter(Boolean);
        const featured =
          rows.find((r) => r.difficulty === game.default) || rows[0];
        const result = featured && scoreParts(featured, slug);
        const previous = legacy.filter((r) => r.game === slug);
        const archive = previous.length
          ? uiHtml`<details class="profile-legacy-scores" data-preserve-open><summary>Previous rules · ${previous.length}</summary>${previous
              .map((r) => {
                const p = scoreParts(r, slug);
                return uiHtml`<p><strong>${esc(p.value)} ${esc(p.unit)}</strong> · ${esc(game.modes[r.difficulty].label)} · v${Number(r.version)}<br><time datetime="${esc(r.achieved_at)}">${scoreDate(r.achieved_at)}</time></p>`;
              })
              .join("")}</details>`
          : "";
        const extra = rows
          .filter((r) => r !== featured)
          .map((r) => {
            const parts = scoreParts(r, slug);
            return uiHtml`<div class="profile-game-extra"><div><span>${esc(game.modes[r.difficulty].label)}</span><small>${esc(scoreDetail(r, slug))} · ${scoreDate(r.achieved_at)}</small></div><strong>${esc(parts.value)} <span>${parts.unit}</span></strong></div>`;
          })
          .join("");
        return uiHtml`<article class="profile-game-card ${featured ? "has-score" : "no-score"}" data-game-theme="${slug}"><header><span class="profile-game-icon">${gameIcon(slug)}</span><div><span class="eyebrow">${uiFrom(game.category)}</span><h3>${uiFrom(game.name)}</h3></div><span class="profile-record-mark">${featured ? uiMsg("Verified best") : uiMsg("No ranked result")}</span></header>${featured ? uiHtml`<div class="profile-featured-score"><div class="profile-game-emblem" aria-hidden="true">${gameIcon(slug)}</div><span class="profile-difficulty">${uiFrom(game.modes[featured.difficulty].label)}</span><div class="profile-score-value"><strong>${esc(result.value)}</strong><span>${uiFrom(result.unit)}</span></div><p>${uiFrom(scoreDetail(featured, slug))}</p><time datetime="${esc(featured.achieved_at)}">${scoreDate(featured.achieved_at)}</time></div>${extra ? uiHtml`<details class="profile-game-modes" data-preserve-open><summary>Other modes · ${rows.length - 1}<span aria-hidden="true">⌄</span></summary><div class="profile-game-other-scores">${extra}</div></details>` : ""}` : uiHtml`<div class="profile-score-empty"><span aria-hidden="true">—</span><strong>Your next high score starts here.</strong><p>No qualifying Public result yet.</p></div>`}${archive}<footer><span>${featured ? uiMsg("{0} ranked {1} · rules v{2}", [rows.length, uiFrom(rows.length === 1 ? "mode" : "modes"), Number(featured.version)]) : uiMsg("A new challenge is waiting")}</span><a href="/games/${slug}/" aria-label="Play ${uiFrom(game.name)}">Play game <span aria-hidden="true">↗</span></a></footer></article>`;
      })
      .join(""),
  );
  revealGameCards($("#public-game-scores"));
  renderGoStats(profile.board_game_stats || []);
  renderClockBoardStats(profile.chess_stats || [], "chess");
  renderClockBoardStats(profile.xiangqi_stats || [], "xiangqi");
  $("#public-best-scores").innerHTML = ["en", "zh"]
    .map((lang) => {
      const score = profile.best_scores?.find((x) => x.language === lang);
      return uiHtml`<section class="profile-typing-card"><div class="profile-typing-language"><span>${lang === "en" ? uiMsg("Aa") : "字"}</span><div><span class="eyebrow">60-SECOND PUBLIC SPRINT</span><h3>${lang === "en" ? uiMsg("English") : "中文"}</h3></div></div><div class="profile-score-value"><strong>${score ? Number(score.speed).toFixed(1) : "—"}</strong><span>${lang === "en" ? "WPM" : "CPM"}</span></div><p>${score ? uiHtml`<b>${Number(score.accuracy).toFixed(2)}% accuracy</b> · ${scoreDate(score.achieved_at)} · text v${Number(score.version)}` : uiMsg("No qualifying current-version score yet.")}</p></section>`;
    })
    .join("");
}
function renderClockBoardStats(stats, game) {
  let section = $(`#public-${game}-records`);
  if (!section) {
    section = document.createElement("section");
    section.id = `public-${game}-records`;
    section.className = "panel profile-go-records";
    $("#public-go-records").after(section);
  }
  section.replaceChildren();
  const heading = document.createElement("h2");
  uiText(
    heading,
    uiMsg(
      game === "chess" ? "Chess · online records" : "Xiangqi · online records",
    ),
  );
  section.append(heading);
  if (!stats.length) {
    const empty = document.createElement("p");
    uiText(
      empty,
      uiMsg(
        game === "chess"
          ? "No verified chess matches yet."
          : "No verified xiangqi matches yet.",
      ),
    );
    section.append(empty);
  }
  for (const r of stats) {
    const row = document.createElement("article"),
      name = document.createElement("strong");
    row.className = "profile-go-stat";
    uiText(
      name,
      uiMsg(
        game === "chess"
          ? "Chess rules v{0} · {1}"
          : "Xiangqi rules v{0} · {1}",
        [Number(r.rules_version), r.time_control],
      ),
    );
    row.append(gameEmblem(game), name, boardStatCards(r));
    section.append(row);
  }
  const link = document.createElement("a");
  link.href = `${location.pathname.startsWith("/zh-hant/") ? "/zh-hant" : ""}/games/${game}/`;
  uiText(link, uiMsg(game === "chess" ? "Play Chess →" : "Play Xiangqi →"));
  section.append(link);
}
function renderGoStats(stats) {
  let section = $("#public-go-records");
  if (!section) {
    section = document.createElement("section");
    section.id = "public-go-records";
    section.className = "panel profile-go-records";
    $("#public-game-scores").after(section);
  }
  section.replaceChildren();
  const heading = document.createElement("h2");
  uiText(heading, uiMsg("Go · online records"));
  section.append(heading);
  const note = document.createElement("p");
  note.className = "muted small";
  uiText(
    note,
    uiMsg(
      "Verified standard human matches. Local, computer and memory training are excluded.",
    ),
  );
  section.append(note);
  if (!stats.length) {
    const empty = document.createElement("p");
    uiText(empty, uiMsg("No verified Go matches yet."));
    section.append(empty);
  }
  for (const r of stats) {
    const row = document.createElement("article");
    row.className = "profile-go-stat";
    const name = document.createElement("strong");
    uiText(
      name,
      uiMsg("{0} · {1} × {1}", [
        uiFrom(
          { chinese: "Chinese", japanese: "Japanese 1989", aga: "AGA" }[
            r.rule
          ] || r.rule,
        ),
        Number(r.size),
      ]),
    );
    row.append(gameEmblem("go"), name, boardStatCards(r));
    section.append(row);
  }
  const link = document.createElement("a");
  link.href = location.pathname.startsWith("/zh-hant/")
    ? "/zh-hant/games/go/"
    : "/games/go/";
  uiText(link, uiMsg("Play Go →"));
  section.append(link);
}
async function load() {
  const ticket = ++profileLoad,
    account = api.user?.id;
  $("#profile-retry").hidden = true;
  message(uiMsg("Loading profile…"));
  try {
    if (requested) {
      uiText($("#profile-heading"), uiMsg("A little about this person."));
      uiText($("#profile-intro"), uiMsg("A public corner of the Workshop."));
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          requested,
        )
      ) {
        message(uiMsg("Profile not found."));
        return;
      }
      const p = await profileRPC("get_public_profile", {
        profile_id: requested,
      });
      if (ticket !== profileLoad || account !== api.user?.id) return;
      if (!p) {
        message(uiMsg("Profile not found."));
        return;
      }
      $("#public-profile").hidden = false;
      uiText($("#public-name"), p.nickname);
      uiText(
        $("#public-bio"),
        p.bio || uiMsg("A little room for a new story."),
      );
      paintAvatar($("#public-avatar"), p);
      renderPublicScores(p);
      paintAppearance($(".public-profile-hero"), p.appearance);
      paintFeatured(
        $("[data-public-featured]"),
        appearance(p.appearance).featured,
        p.game_achievements || [],
      );
      void mountPublicFriendActions($("#public-friend-actions"), p);
      $("#profile-page").classList.add("is-public-profile");
      $("#profile-heading").closest(".account-hero").hidden = true;
      if (api.user) {
        ensureProfile()
          .then(
            (me) =>
              ($("#public-edit-profile").hidden = me.public_id !== p.public_id),
          )
          .catch(() => {});
      }
      message("");
    } else if (!api.user) {
      $("#profile-login").hidden = false;
      message(uiMsg("Sign in to edit your profile."));
    } else {
      const me = await ensureProfile(true);
      if (ticket !== profileLoad || account !== api.user?.id) return;
      fill(me);
      void loadMilestoneChoices();
      $("#profile-form").hidden = false;
      message(
        uiMsg(
          "Your public profile is ready. Changes are saved only when you click Save changes.",
        ),
      );
    }
  } catch {
    if (ticket !== profileLoad || account !== api.user?.id) return;
    message(uiMsg("Profile could not load. Check your connection and retry."));
    $("#profile-retry").hidden = false;
  }
}
$("#profile-sign-in").addEventListener("click", () =>
  api.openAuth("/profile/"),
);
$("#profile-retry").addEventListener("click", load);
$("#copy-profile-link").onclick = async () => {
  const link = $("#profile-view-public").href;
  try {
    await navigator.clipboard.writeText(link);
    $("#profile-link-fallback").hidden = true;
    window.KenseiNotify?.(uiMsg("Public profile link copied."), {
      kind: "success",
    });
  } catch {
    $("#profile-link-fallback").hidden = false;
    $("#profile-link-text").value = link;
    $("#profile-link-text").select();
    window.KenseiNotify?.(uiMsg("Copy the selected link manually."), {
      kind: "warning",
    });
  }
};
$("#profile-name").addEventListener("input", markDirty);
$("#profile-bio").addEventListener("input", markDirty);
$("#profile-avatar-file").addEventListener("change", async (e) => {
  const file = e.target.files[0],
    token = ++selection;
  if (!file) return;
  let image, url;
  working = true;
  $("#profile-save").disabled = true;
  try {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1048576
    )
      throw new Error("Choose a JPG, PNG or WebP image up to 5 MB.");
    url = URL.createObjectURL(file);
    image = new Image();
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      image.naturalWidth * image.naturalHeight > 40000000
    )
      throw new Error("Choose an image up to 40 megapixels.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Avatar preview is unavailable in this browser.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      512,
      512,
    );
    const blob = await canvasBlob(canvas, "image/webp", 0.85);
    canvas.width = canvas.height = 0;
    if (!blob || blob.type !== "image/webp" || blob.size > 2 * 1048576)
      throw new Error(
        "This browser could not prepare the avatar. Try another image.",
      );
    if (token !== selection) return;
    releasePreview();
    avatarBlob = blob;
    avatarKind = "upload";
    uploadedPath = null;
    previewURL = URL.createObjectURL(blob);
    paintAvatar($("#profile-avatar"), original, previewURL);
    markDirty();
  } catch (error) {
    if (token === selection)
      message(
        uiError(error) ||
          uiMsg("That image could not be read. Please choose another."),
      );
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (token === selection) {
      working = false;
      $("#profile-save").disabled = false;
    }
  }
});
$("#profile-remove-avatar").addEventListener("click", () => {
  selection++;
  working = false;
  $("#profile-save").disabled = false;
  avatarBlob = null;
  avatarKind = "none";
  uploadedPath = null;
  releasePreview();
  $("#profile-avatar-file").value = "";
  paintAvatar($("#profile-avatar"), {
    nickname: $("#profile-name").value,
    avatar_kind: "none",
  });
  markDirty();
});
$("#profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (working || !original) return;
  if (api.user?.id !== owner) {
    message(uiMsg("Account changed. Reload before saving."));
    return;
  }
  const saveOwner = owner,
    saveEpoch = profileLoad;
  const nickname = $("#profile-name")
      .value.normalize("NFC")
      .trim()
      .replace(/\s+/gu, " "),
    bio = $("#profile-bio").value;
  if (
    Array.from(nickname).length < 2 ||
    Array.from(nickname).length > 32 ||
    Array.from(bio).length > 300
  ) {
    message(
      uiMsg(
        "Use a public name of 2–32 characters and a biography of at most 300 characters.",
      ),
    );
    return;
  }
  const patch = {};
  const look = editedAppearance();
  if (JSON.stringify(look) !== JSON.stringify(appearance(original.appearance)))
    patch.appearance = look;
  if (nickname !== original.nickname) patch.nickname = nickname;
  if (bio !== original.bio) patch.bio = bio;
  working = true;
  $("#profile-form")
    .querySelectorAll("input,textarea,button,select")
    .forEach((node) => (node.disabled = true));
  $("#profile-form").setAttribute("aria-busy", "true");
  message(uiMsg("Saving your profile…"));
  const snapshot = { ...original };
  try {
    if (avatarBlob && !uploadedPath) {
      const path = original.public_id + "/" + crypto.randomUUID() + ".webp";
      const { error } = await api.client.storage
        .from("avatars")
        .upload(path, avatarBlob, { contentType: "image/webp", upsert: false });
      if (error) throw error;
      if (saveOwner !== api.user?.id || saveEpoch !== profileLoad) return;
      uploadedPath = path;
    }
    if (avatarKind !== original.avatar_kind || avatarBlob) {
      patch.avatar_kind = avatarKind;
      patch.avatar_path = avatarKind === "upload" ? uploadedPath : null;
    }
    const saved = await profileRPC("update_my_profile", {
      patch,
      expected_user: saveOwner,
    });
    if (api.user?.id !== saveOwner || saveEpoch !== profileLoad)
      throw new Error("Account changed. Please reload.");
    api.setProfile(saved, owner);
    dirty = false;
    avatarBlob = null;
    uploadedPath = null;
    releasePreview();
    fill(saved);
    message(
      uiMsg(
        "Profile saved. Your public name and leaderboard links are up to date.",
      ),
    );
    window.KenseiNotify?.(uiMsg("Profile saved."), {
      kind: "success",
      account: owner,
    });
    // 先更新资料，再尽力清理本人目录下已不再使用的头像。
    try {
      if (
        snapshot.avatar_kind === "upload" &&
        snapshot.avatar_path &&
        snapshot.avatar_path !== saved.avatar_path
      )
        await api.client.storage.from("avatars").remove([snapshot.avatar_path]);
    } catch {}
  } catch (error) {
    if (saveOwner !== api.user?.id || saveEpoch !== profileLoad) return;
    window.KenseiNotify?.(uiMsg("Could not save your profile. Try again."), {
      kind: "error",
      account: owner,
    });
    message(
      uiJoin([
        uiMsg("Save failed. Your changes are still here. "),
        uiError(error) || uiMsg("Please retry."),
      ]),
    );
  } finally {
    if (saveOwner !== api.user?.id || saveEpoch !== profileLoad) return;
    working = false;
    $("#profile-form")
      .querySelectorAll("input,textarea,button,select")
      .forEach((node) => (node.disabled = false));
    $("#profile-form").removeAttribute("aria-busy");
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("auth-identity-change", () => {
  profileLoad++;
  milestoneLoad++;
  selection++;
  dirty = false;
  working = false;
  original = null;
  avatarBlob = null;
  uploadedPath = null;
  ownMilestones = [];
  featured = [];
  releasePreview();
  for (const node of document.querySelectorAll(
    "#profile-form input,#profile-form textarea",
  )) {
    if (node.type !== "checkbox") node.value = "";
  }
  $("#profile-form").hidden = true;
  $("#profile-preview").hidden = true;
  $("#profile-form")
    .querySelectorAll("input,textarea,button,select")
    .forEach((node) => (node.disabled = false));
  $("#profile-form").removeAttribute("aria-busy");
  void load();
});
window.addEventListener("pagehide", releasePreview);
await ready;
await load();
$("#profile-page").dataset.ready = "true";
