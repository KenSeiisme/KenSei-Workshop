import { $, api, esc, toast } from "./common.js";
import { practiceTexts } from "./sprint-content.js";
import { scoreText } from "./sprint-core.js";
import { ready } from "./personal-store.js";
let run = null,
  interval,
  committed = "",
  composing = false,
  nickname = "",
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
          `<div class="saved-row"><strong>${x.language === "zh" ? "中文" : "English"} · ${Number(x.speed).toFixed(1)} ${x.language === "zh" ? "CPM" : "WPM"}</strong><span>${Number(x.accuracy).toFixed(2)}% · ${esc(new Date(x.date).toLocaleString())}</span></div>`,
      )
      .join("") ||
    '<p class="muted small">Complete a practice run to see it here.</p>';
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
        return `<span class="${index < input.length ? (input[index] === c ? "typed-correct" : "typed-error") : index === input.length ? "typing-caret" : ""}">${esc(c)}</span>`;
      })
      .join("");
}
function meter() {
  if (!run) return;
  const s = scoreText(run.text, committed, run.language),
    remaining = Math.max(0, Math.ceil((run.deadline - Date.now()) / 1000));
  $("#typing-time").textContent = remaining;
  $("#typing-speed").textContent = s.speed.toFixed(1);
  $("#typing-accuracy").textContent = s.accuracy.toFixed(2) + "%";
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
  $("#leaderboard-status").textContent = "Loading leaderboard…";
  $("#leaderboard-unit").textContent = lang === "zh" ? "CPM" : "WPM";
  try {
    const data = await rpc("get_typing_leaderboard", { language: lang });
    if (token !== boardToken) return;
    $("#leaderboard-version").textContent =
      `${lang === "zh" ? "中文" : "English"} · text version ${data.version || "—"} · 60 seconds · 95% accuracy required`;
    const row = (x) =>
      `<tr><td>${Number(x.rank)}</td><td>${esc(x.nickname)}</td><td>${Number(x.speed).toFixed(1)}</td><td>${Number(x.accuracy).toFixed(2)}%</td><td>${esc(new Date(x.achieved_at).toLocaleDateString())}</td></tr>`;
    $("#leaderboard-rows").innerHTML = (data.top || []).map(row).join("");
    $("#leaderboard-status").textContent = data.top?.length
      ? ""
      : "No qualifying scores yet. Set the first pace.";
    $("#leaderboard-me").textContent = data.me
      ? `Your rank: #${data.me.rank} · ${data.me.speed} ${lang === "zh" ? "CPM" : "WPM"} · ${data.me.accuracy}%`
      : api.user
        ? "Your rank will appear after a qualifying Ranked test."
        : "Sign in to set a public nickname and join Ranked.";
  } catch {
    if (token === boardToken) {
      $("#leaderboard-rows").innerHTML = "";
      $("#leaderboard-status").textContent =
        "Leaderboard unavailable. Check your connection and refresh; Practice still works.";
      $("#leaderboard-me").textContent = "";
    }
  }
}
async function mode() {
  const ranked = $("#typing-mode").value === "ranked";
  $("#nickname-panel").hidden = !ranked;
  $("#typing-status").textContent = ranked
    ? api.user
      ? nickname
        ? "Playing as " + nickname + ". Only qualifying scores appear publicly."
        : "Choose your public nickname before starting Ranked."
      : "Sign in with Google using the navigation to enter Ranked. Practice needs no account."
    : "Practice is saved only on this device.";
  if (ranked && api.user && !nickname) {
    try {
      const { data, error } = await api.client
        .from("typing_profiles")
        .select("nickname")
        .eq("user_id", api.user.id)
        .maybeSingle();
      if (!error && data) {
        nickname = data.nickname;
        $("#typing-nickname").value = nickname;
        $("#typing-status").textContent =
          "Playing as " +
          nickname +
          ". Only qualifying scores appear publicly.";
      }
    } catch {}
  }
}
$("#typing-save-nickname").addEventListener("click", async () => {
  if (!api.user) {
    toast("Sign in to choose a public nickname.");
    return;
  }
  try {
    nickname = await rpc("set_typing_nickname", {
      nickname: $("#typing-nickname").value.trim(),
    });
    toast("Public nickname saved.");
    mode();
    board();
  } catch (e) {
    toast(e.message || "Nickname could not be saved.");
  }
});
$("#typing-start").addEventListener("click", async () => {
  if (run) return;
  const ranked = $("#typing-mode").value === "ranked",
    lang = language(),
    owner = actor();
  if (ranked && !api.user) {
    toast("Sign in to enter Ranked, or choose Practice.");
    return;
  }
  if (ranked && !nickname) {
    toast("Save a public nickname before starting Ranked.");
    return;
  }
  $("#typing-start").disabled = true;
  $("#typing-status").textContent = ranked
    ? "Starting a server session…"
    : "Starting practice…";
  try {
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
    $("#typing-result").textContent = "";
    lock(true);
    $("#typing-input").focus();
    $("#typing-status").textContent = ranked
      ? "Ranked is running. Keep typing until the timer ends."
      : "Practice is running. Find a steady rhythm.";
    interval = setInterval(meter, 100);
    meter();
  } catch (e) {
    $("#typing-status").textContent =
      e.message || "Test could not start. Please retry.";
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
  $("#typing-time").textContent = "0";
  $("#typing-start").textContent = "Start another 60-second test →";
  const score = scoreText(completed.text, text, completed.language);
  $("#typing-result").textContent =
    `${score.speed.toFixed(1)} ${completed.language === "zh" ? "CPM" : "WPM"} · ${score.accuracy.toFixed(2)}% accuracy · ${score.correct} correct characters.`;
  if (actor() !== completed.owner) {
    $("#typing-status").textContent =
      "Account changed. This run was not submitted.";
    return;
  }
  if (completed.ranked) {
    $("#typing-start").disabled = true;
    $("#typing-status").textContent =
      "Submitting your completed run for server verification…";
    try {
      const result = await rpc("finish_typing_test", {
        sessionId: completed.sessionId,
        typedText: text.normalize("NFC"),
      });
      if (actor() !== completed.owner) return;
      $("#typing-result").textContent =
        `${Number(result.speed).toFixed(1)} ${completed.language === "zh" ? "CPM" : "WPM"} · ${Number(result.accuracy).toFixed(2)}% accuracy.`;
      $("#typing-status").textContent = result.qualified
        ? "Verified. Your best score is eligible for this text version’s board."
        : "Verified, but below 95% accuracy. This score is not on the public board.";
      board();
    } catch (e) {
      $("#typing-status").textContent =
        "Could not confirm submission: " +
        (e.message || "connection failed") +
        ". Refresh the leaderboard to check your best score.";
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
      $("#typing-status").textContent =
        "Practice complete. Saved on this device.";
    } catch {
      $("#typing-status").textContent =
        "Practice complete. Browser storage is unavailable; the result could not be saved.";
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
  $("#typing-status").textContent =
    "Test aborted. No score was saved or submitted.";
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
    toast("Ranked accepts typing only.");
  }
});
for (const name of ["paste", "drop"])
  input.addEventListener(name, (e) => {
    if (run?.ranked) {
      e.preventDefault();
      toast("Pasting and dropping are disabled in Ranked.");
    }
  });
$("#typing-mode").addEventListener("change", mode);
$("#typing-language").addEventListener("change", () => {
  const lang = language();
  $("#typing-unit").textContent = lang === "zh" ? "CPM" : "WPM";
  passage(practiceTexts[lang]);
  board();
});
$("#leaderboard-refresh").addEventListener("click", board);
$("#typing-clear-practice").addEventListener("click", () => {
  try {
    localStorage.removeItem(practiceKey());
    renderHistory();
  } catch {
    toast("Could not clear browser storage.");
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
