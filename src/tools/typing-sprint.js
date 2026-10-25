import { $, api, esc, toast } from "./common.js";
import { practiceTexts } from "./sprint-content.js";
import { scoreText } from "./sprint-core.js";
import { ready } from "./personal-store.js";
import { ensureProfile, paintAvatar } from "./profile-service.js";
import { uiDate, uiMsg, uiJoin, uiError, uiText, uiHtml } from "../site/ui.js";

let run = null,
  interval,
  committed = "",
  composing = false,
  boardToken = 0;
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
  const s = scoreText(run.text, committed, run.language),
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
      uiMsg("{0} · text version {1} · 60 seconds · 95% accuracy required", [
        lang === "zh" ? "中文" : uiMsg("English"),
        data.version || "—",
      ]),
    );
    const row = (x) =>
      uiHtml`<tr><td>${Number(x.rank)}</td><td>${x.public_id ? uiHtml`<a class="text-link" href="/profile/?id=${encodeURIComponent(x.public_id)}">${esc(x.nickname)}</a>` : esc(x.nickname)}</td><td>${Number(x.speed).toFixed(1)}</td><td>${Number(x.accuracy).toFixed(2)}%</td><td>${uiDate(new Date(x.achieved_at), { year: "numeric", month: "short", day: "numeric" })}</td></tr>`;
    $("#leaderboard-rows").innerHTML = (data.top || []).map(row).join("");
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
  if (run) return;
  const ranked = $("#typing-mode").value === "ranked",
    lang = language(),
    owner = actor();
  if (ranked && !api.user) {
    api.openAuth("/tools/typing-sprint/");
    return;
  }
  $("#typing-start").disabled = true;
  uiText(
    $("#typing-status"),
    ranked ? uiMsg("Starting a server session…") : uiMsg("Starting practice…"),
  );
  try {
    if (ranked) await ensureProfile();
    if (actor() !== owner) throw new Error("Account changed. Please reload.");
    const session = ranked
      ? await rpc("start_typing_test", { language: lang })
      : { text: practiceTexts[lang], duration: 60 };
    if (actor() !== owner) return;
    if (session.duration !== 60 || typeof session.text !== "string")
      throw new Error("The test service returned an invalid session.");
    run = {
      ranked,
      owner,
      language: lang,
      text: session.text.normalize("NFC"),
      sessionId: session.sessionId,
      version: session.version,
      deadline: Date.now() + 60000,
    };
    committed = "";
    composing = false;
    $("#typing-input").value = "";
    uiText($("#typing-result"), "");
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
    uiText(
      $("#typing-status"),
      uiError(e) || uiMsg("Test could not start. Please retry."),
    );
    $("#typing-start").disabled = false;
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
  $("#typing-input").disabled = true;
  $("#typing-input").value = text;
  uiText($("#typing-time"), "0");
  uiText($("#typing-start"), uiMsg("Start another 60-second test →"));
  const score = scoreText(completed.text, text, completed.language);
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
    $("#typing-start").disabled = true;
    uiText(
      $("#typing-status"),
      uiMsg("Submitting your completed run for server verification…"),
    );
    try {
      const result = await rpc("finish_typing_test", {
        sessionId: completed.sessionId,
        typedText: text.normalize("NFC"),
      });
      if (actor() !== completed.owner) return;
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
      uiText(
        $("#typing-status"),
        uiJoin([
          uiMsg("Could not confirm submission: "),
          uiError(e) || uiMsg("connection failed"),
          ". Refresh the leaderboard to check your best score.",
        ]),
      );
    } finally {
      $("#typing-start").disabled = false;
    }
  } else {
    try {
      localStorage.setItem(
        practiceKey(),
        JSON.stringify(
          [
            {
              ...score,
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
    renderHistory();
  }
}
function abort() {
  if (!run) return;
  run = null;
  clearInterval(interval);
  composing = false;
  lock(false);
  $("#typing-input").disabled = true;
  uiText(
    $("#typing-status"),
    uiMsg("Test aborted. No score was saved or submitted."),
  );
}
$("#typing-abort").addEventListener("click", abort);
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
  board();
});
$("#leaderboard-refresh").addEventListener("click", board);
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
window.addEventListener("pagehide", abort);
passage(practiceTexts.en);
await ready;
$("#typing-start").disabled = false;
renderHistory();
mode();
board();
