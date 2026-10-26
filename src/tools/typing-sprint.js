import { $, api, esc, toast } from "./common.js";
import { practiceTexts } from "./sprint-content.js";
import { practicePassage } from "./typing-content.js";
import { scoreText } from "./sprint-core.js";
import { ready } from "./personal-store.js";
import { ensureProfile, paintAvatar } from "./profile-service.js";
import {
  uiDate,
  uiMsg,
  uiJoin,
  uiError,
  uiText,
  uiHtml,
  uiConfirm,
} from "../site/ui.js";

let run = null,
  interval,
  committed = "",
  composing = false,
  boardToken = 0,
  pending = null,
  submitting = false,
  starting = false,
  expanded = false,
  focused = false,
  epoch = 0;
const root = $("[data-tool='typing-sprint']");
root.dataset.typingState = "ready";
function focus(value) {
  focused = !!value;
  document.body.classList.toggle("typing-is-focused", focused);
  $("#typing-focus").hidden = false;
  $("#typing-focus").setAttribute("aria-pressed", String(focused));
  uiText($("#typing-focus"), focused ? uiMsg("Exit focus") : uiMsg("Focus"));
}
$("#typing-focus").onclick = () => {
  focus(!focused);
  if (run) $("#typing-input").focus({ preventScroll: true });
};
$("#typing-settings-open").onclick = () => $("#typing-settings").showModal();
$("#typing-settings-close").onclick = () => $("#typing-settings").close();
$("#typing-settings").addEventListener("close", () =>
  $("#typing-settings-open").focus({ preventScroll: true }),
);
const localeSelect = $("#typing-settings [data-language-select]");
localeSelect.value = window.KenseiI18n?.getLocale() || "en";
function saveSetup() {
  try {
    sessionStorage.setItem(
      "kensei:typing:setup",
      JSON.stringify({ language: language(), mode: $("#typing-mode").value }),
    );
  } catch {}
}
function showBoardRows() {
  [...$("#leaderboard-rows").rows].forEach((row, index) => {
    row.hidden = !expanded && index >= 10;
  });
  $("#leaderboard-expand").hidden = $("#leaderboard-rows").rows.length <= 10;
  $("#leaderboard-expand").setAttribute("aria-expanded", String(expanded));
  uiText(
    $("#leaderboard-expand"),
    expanded ? uiMsg("Show Top 10") : uiMsg("Show Top 50"),
  );
}
const language = () => $("#typing-language").value,
  actor = () => api.user?.id || "guest";
const practiceKey = () => "kensei-workshop:typing:v1:" + actor();
function practiceHistory() {
  try {
    return JSON.parse(localStorage.getItem(practiceKey())) || [];
  } catch {
    return [];
  }
}
function renderHistory() {
  $("#typing-practice-history").innerHTML =
    practiceHistory()
      .slice(0, 20)
      .map(
        (x) =>
          uiHtml`<div class="saved-row"><strong>${x.language === "zh" ? "中文" : uiMsg("English")} · ${Number(x.speed).toFixed(1)} ${x.language === "zh" ? "CPM" : "WPM"}</strong><span>${Number(x.accuracy).toFixed(2)}% · ${uiDate(new Date(x.date), { dateStyle: "medium", timeStyle: "short" })}</span></div>`,
      )
      .join("") ||
    uiHtml(
      '<p class="muted small">Complete a practice run to see it here.</p>',
    );
}
function passage(source, typed = "") {
  const chars = Array.from(source),
    input = Array.from(typed),
    start = Math.max(0, input.length - 120),
    end = Math.min(chars.length, Math.max(400, input.length + 300));
  $("#typing-passage").innerHTML =
    (start ? "…" : "") +
    chars
      .slice(start, end)
      .map((c, i) => {
        const index = i + start;
        return uiHtml`<span class="${index < input.length ? (input[index] === c ? "typed-correct" : "typed-error") : index === input.length ? "typing-caret" : ""}">${esc(c)}</span>`;
      })
      .join("");
}
function meter() {
  if (!run) return;
  const s = scoreText(run.text, committed, run.language, run.duration),
    remaining = Math.max(0, Math.ceil((run.deadline - Date.now()) / 1000));
  uiText($("#typing-time"), remaining);
  uiText($("#typing-speed"), s.speed.toFixed(1));
  uiText($("#typing-accuracy"), s.accuracy.toFixed(2) + "%");
  passage(run.text, committed);
  if (!remaining) finish();
}
function lock(locked) {
  $("#typing-language").disabled = locked;
  $("#typing-mode").disabled = locked;
  window.dispatchEvent(new Event("typing-lock-changed"));
  $("#typing-start").disabled = locked;
  $("#typing-abort").hidden = !locked;
  $("#typing-input").disabled = !locked;
}
async function rpc(name, args) {
  if (!api.client)
    throw new Error("The account service is unavailable. Please retry.");
  const { data, error } = await api.client.rpc(name, args);
  if (error) throw error;
  return data;
}
async function board() {
  const token = ++boardToken,
    lang = language();
  uiText($("#leaderboard-status"), uiMsg("Loading leaderboard…"));
  uiText($("#leaderboard-unit"), lang === "zh" ? "CPM" : "WPM");
  try {
    const data = await rpc("get_typing_leaderboard", { language: lang });
    if (token !== boardToken) return;
    uiText(
      $("#leaderboard-version"),
      uiMsg("{0} · board v{1} · 60 seconds · 95% accuracy required", [
        lang === "zh" ? "中文" : uiMsg("English"),
        data.version || "—",
      ]),
    );
    const row = (x) =>
      uiHtml`<tr class="${data.me?.public_id === x.public_id && x.public_id ? "is-me" : ""}"><td>${Number(x.rank)}</td><td>${x.public_id ? uiHtml`<a class="text-link" href="/profile/?id=${encodeURIComponent(x.public_id)}">${esc(x.nickname)}</a>` : esc(x.nickname)}</td><td>${Number(x.speed).toFixed(1)}</td><td>${Number(x.accuracy).toFixed(2)}%</td><td>${uiDate(new Date(x.achieved_at), { month: "short", day: "numeric" })}</td></tr>`;
    $("#leaderboard-rows").innerHTML = (data.top || []).map(row).join("");
    showBoardRows();
    uiText(
      $("#leaderboard-status"),
      data.top?.length
        ? ""
        : uiMsg("No qualifying scores yet. Set the first pace."),
    );
    uiText(
      $("#leaderboard-me"),
      data.me
        ? uiMsg("Your rank: #{0} · {1} {2} · {3}%", [
            data.me.rank,
            data.me.speed,
            lang === "zh" ? "CPM" : "WPM",
            data.me.accuracy,
          ])
        : api.user
          ? uiMsg("Your rank will appear after a qualifying Ranked test.")
          : uiMsg("Sign in to join Public with your Google profile name."),
    );
  } catch {
    if (token === boardToken) {
      $("#leaderboard-rows").innerHTML = "";
      showBoardRows();
      uiText(
        $("#leaderboard-status"),
        uiMsg(
          "Leaderboard unavailable. Check your connection and refresh; Practice still works.",
        ),
      );
      uiText($("#leaderboard-me"), "");
    }
  }
}
function player() {
  $("#typing-account").hidden = !api.user;
  if (api.profile) {
    uiText(
      $("#typing-player"),
      uiJoin([uiMsg("Playing as "), api.profile.nickname]),
    );
    paintAvatar($("#typing-avatar"), api.profile);
  } else uiText($("#typing-player"), uiMsg("Your profile is connecting…"));
}
async function mode() {
  saveSetup();
  const ranked = $("#typing-mode").value === "ranked";
  if (!run)
    uiText(
      $("#typing-start"),
      ranked && !api.user
        ? uiMsg("Sign in to start →")
        : uiMsg("Start 60-second test →"),
    );
  player();
  uiText(
    $("#typing-status"),
    ranked
      ? api.user
        ? uiMsg(
            "Your qualifying best score will appear publicly. Your profile can be changed at any time.",
          )
        : uiMsg(
            "Sign in to join the public leaderboard, or select Practice for a private test.",
          )
      : uiMsg(
          "Practice stays on this device and never enters the public leaderboard.",
        ),
  );
  if (api.user) {
    try {
      await ensureProfile();
      player();
    } catch {
      if (ranked && !run)
        uiText(
          $("#typing-status"),
          uiMsg(
            "Your profile could not connect. Start again to retry, or select Practice.",
          ),
        );
    }
  }
}
window.addEventListener("profile-updated", player);
$("#typing-start").addEventListener("click", async () => {
  if (run || starting || pending) return;
  const ranked = $("#typing-mode").value === "ranked",
    lang = language(),
    owner = actor(),
    token = epoch;
  if (ranked && !api.user) {
    api.openAuth("/tools/typing-sprint/");
    return;
  }
  $("#typing-start").disabled = true;
  starting = true;
  $("#typing-language").disabled = true;
  $("#typing-mode").disabled = true;
  uiText(
    $("#typing-status"),
    ranked ? uiMsg("Starting a server session…") : uiMsg("Starting practice…"),
  );
  try {
    if (ranked) await ensureProfile();
    if (actor() !== owner) throw new Error("Account changed. Please reload.");
    const session = ranked
      ? await rpc("start_typing_test", { language: lang })
      : window.KenseiPractice?.text?.trim()
        ? { duration: 60, text: window.KenseiPractice.text, version: 1 }
        : await practicePassage(lang, owner);
    if (actor() !== owner || token !== epoch) return;
    if ((ranked && session.duration !== 60) || typeof session.text !== "string")
      throw new Error("The test service returned an invalid session.");
    run = {
      ranked,
      owner,
      language: lang,
      text: (!ranked && window.KenseiPractice?.text?.trim()
        ? window.KenseiPractice.text
        : session.text
      ).normalize("NFC"),
      sessionId: session.sessionId,
      version: session.version,
      duration: ranked ? 60 : Number(window.KenseiPractice?.duration || 60),
      deadline:
        Date.now() +
        (ranked ? 60 : Number(window.KenseiPractice?.duration || 60)) * 1000,
    };
    committed = "";
    composing = false;
    $("#typing-input").value = "";
    uiText($("#typing-result"), "");
    $("#typing-result").hidden = true;
    $("#typing-preview-label").hidden = true;
    $("#typing-setup").hidden = true;
    root.dataset.typingState = "running";
    uiText(
      $("#typing-run-label"),
      ranked ? uiMsg("Ranked") : uiMsg("Practice"),
    );
    focus(true);
    lock(true);
    $("#typing-input").focus();
    uiText(
      $("#typing-status"),
      ranked
        ? uiMsg("Ranked is running. Keep typing until the timer ends.")
        : uiMsg("Practice is running. Find a steady rhythm."),
    );
    interval = setInterval(meter, 100);
    meter();
  } catch (e) {
    if (token !== epoch) return;
    uiText(
      $("#typing-status"),
      uiError(e) || uiMsg("Test could not start. Please retry."),
    );
    $("#typing-start").disabled = false;
  } finally {
    if (token === epoch) {
      starting = false;
      if (!run) lock(false);
    }
  }
});
async function finish() {
  if (!run) return;
  const completed = run,
    text = committed;
  run = null;
  clearInterval(interval);
  composing = false;
  lock(false);
  root.dataset.typingState = "finished";
  $("#typing-setup").hidden = false;
  $("#typing-result").hidden = false;
  $("#typing-input").disabled = true;
  $("#typing-input").value = text;
  uiText($("#typing-time"), "0");
  uiText($("#typing-start"), uiMsg("Start another test →"));
  const score = scoreText(
    completed.text,
    text,
    completed.language,
    completed.duration,
  );
  if (!completed.ranked)
    window.dispatchEvent(
      new CustomEvent("practice-completed", {
        detail: {
          source: completed.text,
          typed: text,
          language: completed.language,
          score,
        },
      }),
    );
  uiText(
    $("#typing-result"),
    uiMsg("{0} {1} · {2}% accuracy · {3} correct characters.", [
      score.speed.toFixed(1),
      completed.language === "zh" ? "CPM" : "WPM",
      score.accuracy.toFixed(2),
      score.correct,
    ]),
  );
  if (actor() !== completed.owner) {
    uiText(
      $("#typing-status"),
      uiMsg("Account changed. This run was not submitted."),
    );
    return;
  }
  if (completed.ranked) {
    if (!text.length) {
      uiText($("#typing-run-label"), uiMsg("Not ranked"));
      uiText(
        $("#typing-status"),
        uiMsg("No committed text. This test was not submitted."),
      );
      return;
    }
    pending = { ...completed, typedText: text.normalize("NFC") };
    await submitPending();
  } else {
    try {
      localStorage.setItem(
        practiceKey(),
        JSON.stringify(
          [
            {
              ...score,
              duration: completed.duration,
              language: completed.language,
              date: new Date().toISOString(),
            },
            ...practiceHistory(),
          ].slice(0, 100),
        ),
      );
      uiText(
        $("#typing-status"),
        uiMsg("Practice complete. Saved on this device."),
      );
    } catch {
      uiText(
        $("#typing-status"),
        uiMsg(
          "Practice complete. Browser storage is unavailable; the result could not be saved.",
        ),
      );
    }
    uiText($("#typing-run-label"), uiMsg("Local only"));
    renderHistory();
  }
}
async function submitPending() {
  if (!pending || submitting || actor() !== pending.owner) return;
  const completed = pending,
    token = epoch;
  submitting = true;
  $("#typing-start").disabled = true;
  $("#typing-language").disabled = true;
  $("#typing-mode").disabled = true;
  $("#typing-submit-retry").hidden = true;
  $("#typing-submit-discard").hidden = true;
  uiText($("#typing-run-label"), uiMsg("Verifying"));
  uiText(
    $("#typing-status"),
    uiMsg("Submitting your completed run for server verification…"),
  );
  try {
    const result = await rpc("finish_typing_test", {
      sessionId: completed.sessionId,
      typedText: completed.typedText,
    });
    if (actor() !== completed.owner || token !== epoch) return;
    pending = null;
    uiText(
      $("#typing-run-label"),
      result.qualified ? uiMsg("Verified") : uiMsg("Not ranked"),
    );
    uiText(
      $("#typing-result"),
      uiMsg("{0} {1} · {2}% accuracy.", [
        Number(result.speed).toFixed(1),
        completed.language === "zh" ? "CPM" : "WPM",
        Number(result.accuracy).toFixed(2),
      ]),
    );
    uiText(
      $("#typing-status"),
      result.qualified
        ? uiMsg(
            "Verified. Your best score is eligible for this text version’s board.",
          )
        : uiMsg(
            "Verified, but below 95% accuracy. This score is not on the public board.",
          ),
    );
    board();
  } catch (e) {
    if (actor() !== completed.owner || token !== epoch) return;
    uiText($("#typing-run-label"), uiMsg("Submission pending"));
    $("#typing-submit-retry").hidden = false;
    $("#typing-submit-discard").hidden = false;
    uiText(
      $("#typing-status"),
      uiJoin([
        uiMsg("Could not confirm submission: "),
        uiError(e) || uiMsg("connection failed"),
        uiMsg(". Retry submission or keep the result on this page."),
      ]),
    );
  } finally {
    if (token === epoch) {
      submitting = false;
      $("#typing-start").disabled = !!pending;
      $("#typing-language").disabled = !!pending;
      $("#typing-mode").disabled = !!pending;
    }
  }
}
function abort() {
  if (!run) return;
  run = null;
  clearInterval(interval);
  composing = false;
  lock(false);
  root.dataset.typingState = "finished";
  $("#typing-setup").hidden = false;
  uiText($("#typing-run-label"), uiMsg("Cancelled"));
  $("#typing-input").disabled = true;
  uiText(
    $("#typing-status"),
    uiMsg("Test aborted. No score was saved or submitted."),
  );
}
$("#typing-abort").addEventListener("click", () => {
  if (uiConfirm(uiMsg("Abort this test? No score will be submitted."))) abort();
});
$("#typing-submit-retry").onclick = submitPending;
$("#typing-submit-discard").onclick = () => {
  if (submitting) return;
  pending = null;
  $("#typing-submit-retry").hidden = true;
  $("#typing-submit-discard").hidden = true;
  $("#typing-start").disabled = false;
  $("#typing-language").disabled = false;
  $("#typing-mode").disabled = false;
  uiText($("#typing-run-label"), uiMsg("Local only"));
  uiText(
    $("#typing-status"),
    uiMsg("Result kept on this page without verified ranking."),
  );
};
const input = $("#typing-input");
input.addEventListener("compositionstart", () => {
  composing = true;
});
input.addEventListener("compositionend", () => {
  composing = false;
  if (!run) return;
  if (Date.now() >= run.deadline) {
    finish();
    return;
  }
  committed = input.value.normalize("NFC");
  meter();
});
input.addEventListener("input", (e) => {
  if (!run || composing || e.isComposing) return;
  if (Date.now() >= run.deadline) {
    finish();
    return;
  }
  committed = input.value.normalize("NFC");
  meter();
});
input.addEventListener("beforeinput", (e) => {
  if (
    run?.ranked &&
    ["insertFromPaste", "insertFromDrop", "insertReplacementText"].includes(
      e.inputType,
    )
  ) {
    e.preventDefault();
    toast(uiMsg("Ranked accepts typing only."));
  }
});
for (const name of ["paste", "drop"])
  input.addEventListener(name, (e) => {
    if (run?.ranked) {
      e.preventDefault();
      toast(uiMsg("Pasting and dropping are disabled in Ranked."));
    }
  });
$("#typing-mode").addEventListener("change", mode);
$("#typing-language").addEventListener("change", () => {
  const lang = language();
  uiText($("#typing-unit"), lang === "zh" ? "CPM" : "WPM");
  passage(practiceTexts[lang]);
  saveSetup();
  $("#typing-preview-label").hidden = false;
  board();
});
$("#leaderboard-refresh").addEventListener("click", board);
$("#leaderboard-expand").onclick = () => {
  expanded = !expanded;
  showBoardRows();
};
$("#typing-clear-practice").addEventListener("click", () => {
  try {
    localStorage.removeItem(practiceKey());
    renderHistory();
  } catch {
    toast(uiMsg("Could not clear browser storage."));
  }
});
document.addEventListener("visibilitychange", () => {
  if (run) meter();
});
window.addEventListener("pagehide", () => {
  epoch++;
  abort();
  lock(false);
  pending = null;
  starting = false;
  submitting = false;
  $("#typing-submit-retry").hidden = true;
  $("#typing-submit-discard").hidden = true;
  $("#typing-start").disabled = false;
  document.body.classList.remove("typing-is-focused");
});
try {
  const setup = JSON.parse(sessionStorage.getItem("kensei:typing:setup"));
  if (["en", "zh"].includes(setup?.language))
    $("#typing-language").value = setup.language;
  // Every page visit still defaults to Public; only the selected test language survives login.
} catch {}
passage(practiceTexts[language()]);
uiText($("#typing-unit"), language() === "zh" ? "CPM" : "WPM");
await ready;
$("#typing-start").disabled = false;
renderHistory();
mode();
board();
let previousOwner = actor();
window.addEventListener("workspace-ready", () => {
  if (actor() === previousOwner) return;
  previousOwner = actor();
  epoch++;
  starting = false;
  submitting = false;
  abort();
  lock(false);
  pending = null;
  $("#typing-submit-retry").hidden = true;
  $("#typing-submit-discard").hidden = true;
  $("#typing-start").disabled = false;
  renderHistory();
  mode();
  board();
});
