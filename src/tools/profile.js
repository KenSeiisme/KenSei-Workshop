import { patchMarkup } from "/game-scripts/dom.js";
import { mountEffects, revealGameCards } from "/game-scripts/effects.js";
import { renderPublicAchievements } from "/game-scripts/achievements.js";
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
const message = (text) => uiText($("#profile-status"), text);
function markDirty() {
  dirty = true;
  message(uiMsg("Unsaved changes. Save when you are ready."));
  uiText($("#profile-bio-count"), Array.from($("#profile-bio").value).length);
}
function releasePreview() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = "";
}
function fill(profile) {
  original = profile;
  owner = api.user?.id;
  $("#profile-name").value = profile.nickname;
  $("#profile-bio").value = profile.bio;
  uiText($("#profile-bio-count"), Array.from(profile.bio).length);
  $("#profile-view-public").href =
    "/profile/?id=" + encodeURIComponent(profile.public_id);
  avatarKind = profile.avatar_kind;
  paintAvatar($("#profile-avatar"), profile);
}
function renderPublicScores(profile) {
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
    (r) => GAMES[r.game]?.ranked && GAMES[r.game]?.modes[r.difficulty],
  );
  const legacy = (profile.game_legacy_best_scores || []).filter(
    (r) => GAMES[r.game]?.ranked && GAMES[r.game]?.modes[r.difficulty],
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
        return uiHtml`<article class="profile-game-card ${featured ? "has-score" : "no-score"}" data-game-theme="${slug}"><header><span class="profile-game-icon">${gameIcon(slug)}</span><div><span class="eyebrow">${uiFrom(game.category)}</span><h3>${uiFrom(game.name)}</h3></div><span class="profile-record-mark">${featured ? uiMsg("Verified best") : uiMsg("No ranked result")}</span></header>${featured ? uiHtml`<div class="profile-featured-score"><div class="profile-game-emblem" aria-hidden="true">${gameIcon(slug)}</div><span class="profile-difficulty">${uiFrom(game.modes[featured.difficulty].label)}</span><div class="profile-score-value"><strong>${esc(result.value)}</strong><span>${uiFrom(result.unit)}</span></div><p>${uiFrom(scoreDetail(featured, slug))}</p><time datetime="${esc(featured.achieved_at)}">${scoreDate(featured.achieved_at)}</time></div>${extra ? uiHtml`<details class="profile-game-modes" data-preserve-open><summary>Other modes · ${rows.length - 1}<span aria-hidden="true">⌄</span></summary><div class="profile-game-other-scores">${extra}</div></details>` : ""}` : uiHtml`<div class="profile-score-empty"><span aria-hidden="true">—</span><strong>Your next high score starts here.</strong><p>No qualifying Public result yet.</p></div>`}${archive}<footer><span>${featured ? uiMsg("{0} ranked {1} · rules v{2}", [rows.length, rows.length === 1 ? "mode" : "modes", Number(featured.version)]) : uiMsg("A new challenge is waiting")}</span><a href="/games/${slug}/" aria-label="Play ${uiFrom(game.name)}">Play game <span aria-hidden="true">↗</span></a></footer></article>`;
      })
      .join(""),
  );
  revealGameCards($("#public-game-scores"));
  $("#public-best-scores").innerHTML = ["en", "zh"]
    .map((lang) => {
      const score = profile.best_scores?.find((x) => x.language === lang);
      return uiHtml`<section class="profile-typing-card"><div class="profile-typing-language"><span>${lang === "en" ? uiMsg("Aa") : "字"}</span><div><span class="eyebrow">60-SECOND PUBLIC SPRINT</span><h3>${lang === "en" ? uiMsg("English") : "中文"}</h3></div></div><div class="profile-score-value"><strong>${score ? Number(score.speed).toFixed(1) : "—"}</strong><span>${lang === "en" ? "WPM" : "CPM"}</span></div><p>${score ? uiHtml`<b>${Number(score.accuracy).toFixed(2)}% accuracy</b> · ${scoreDate(score.achieved_at)} · text v${Number(score.version)}` : uiMsg("No qualifying current-version score yet.")}</p></section>`;
    })
    .join("");
}
async function load() {
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
      $("#profile-page").classList.add("is-public-profile");
      $("#profile-heading").closest(".page-intro").hidden = true;
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
      fill(await ensureProfile(true));
      $("#profile-form").hidden = false;
      message(
        uiMsg(
          "Your public profile is ready. Changes are saved only when you click Save changes.",
        ),
      );
    }
  } catch {
    message(uiMsg("Profile could not load. Check your connection and retry."));
    $("#profile-retry").hidden = false;
  }
}
$("#profile-sign-in").addEventListener("click", () =>
  api.openAuth("/profile/"),
);
$("#profile-retry").addEventListener("click", load);
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
  if (nickname !== original.nickname) patch.nickname = nickname;
  if (bio !== original.bio) patch.bio = bio;
  working = true;
  $("#profile-form")
    .querySelectorAll("input,textarea,button")
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
      uploadedPath = path;
    }
    if (avatarKind !== original.avatar_kind || avatarBlob) {
      patch.avatar_kind = avatarKind;
      patch.avatar_path = avatarKind === "upload" ? uploadedPath : null;
    }
    const saved = await profileRPC("update_my_profile", {
      patch,
      expected_user: owner,
    });
    if (api.user?.id !== owner)
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
    message(
      uiJoin([
        uiMsg("Save failed. Your changes are still here. "),
        uiError(error) || uiMsg("Please retry."),
      ]),
    );
  } finally {
    working = false;
    $("#profile-form")
      .querySelectorAll("input,textarea,button")
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
window.addEventListener("pagehide", releasePreview);
await ready;
await load();
$("#profile-page").dataset.ready = "true";
