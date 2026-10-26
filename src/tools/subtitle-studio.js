import { $, status, downloadText } from "./common.js";
import {
  parseSubtitles,
  serialize,
  timestamp,
  formatTime,
  validateCue,
  shiftCues,
} from "./subtitle-core.js";
import { uiMsg, uiJoin, uiError, uiText } from "../site/ui.js";

let cues = [],
  selected = null,
  page = 0,
  url = null,
  dirty = false;
const video = $("#sub-video"),
  pageSize = 50;
function draw() {
  window.dispatchEvent(new Event("tool-content-changed"));
  const list = $("#sub-list");
  list.replaceChildren();
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  for (const c of sorted.slice(page * pageSize, (page + 1) * pageSize)) {
    const b = document.createElement("button");
    b.className = "saved-row sub-cue";
    uiText(b, formatTime(c.start) + " → " + formatTime(c.end) + " · " + c.text);
    b.dataset.cueId = c.id;
    b.setAttribute("aria-current", String(selected === c.id));
    b.onclick = () => {
      document
        .querySelectorAll(".sub-cue")
        .forEach((n) => n.setAttribute("aria-current", String(n === b)));
      selected = c.id;
      $("#sub-start").value = formatTime(c.start);
      $("#sub-end").value = formatTime(c.end);
      $("#sub-text").value = c.text;
      if (url) video.currentTime = c.start / 1000;
    };
    list.append(b);
  }
  uiText(
    $("#sub-page"),
    uiJoin([
      page +
        1 +
        " / " +
        Math.max(1, Math.ceil(cues.length / pageSize)) +
        " · " +
        cues.length,
      uiMsg(" cues"),
    ]),
  );
  $("#sub-prev").disabled = page === 0;
  $("#sub-next").disabled = (page + 1) * pageSize >= cues.length;
  $("#sub-download").disabled = !cues.length;
  const overlap = sorted.some((c, i) => i > 0 && c.start < sorted[i - 1].end);
  uiText(
    $("#sub-warning"),
    overlap
      ? uiMsg(
          "Some cues overlap. This can be intentional; export is still available.",
        )
      : "",
  );
  overlay();
}
function overlay() {
  const now = video.currentTime * 1000;
  uiText(
    $("#sub-overlay"),
    cues
      .filter((c) => c.start <= now && c.end > now)
      .map((c) => c.text)
      .join("\n"),
  );
}
$("#sub-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 5000000) throw Error("Subtitle file exceeds 5 MB.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      ),
      next = parseSubtitles(text);
    cues = next;
    selected = null;
    page = 0;
    dirty = false;
    draw();
    status(
      uiMsg("Subtitles loaded. Edits stay on this page; download your result."),
    );
  } catch (e) {
    status(
      e instanceof TypeError
        ? uiMsg("Use a valid UTF-8 subtitle file.")
        : uiError(e),
      true,
    );
  }
};
$("#sub-save").onclick = () => {
  try {
    const c = validateCue({
      id: selected || crypto.randomUUID(),
      start: timestamp($("#sub-start").value),
      end: timestamp($("#sub-end").value),
      text: $("#sub-text").value,
    });
    if (!selected && cues.length >= 5000)
      throw Error("Use at most 5,000 cues.");
    const next = cues.filter((x) => x.id !== c.id).concat(c);
    serialize(next, "vtt");
    cues = next;
    selected = c.id;
    dirty = true;
    draw();
    status(uiMsg("Cue updated. Download to keep your changes."));
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#sub-new").onclick = () => {
  selected = null;
  $("#sub-start").value = formatTime(Math.round(video.currentTime * 1000) || 0);
  $("#sub-end").value = formatTime(
    (Math.round(video.currentTime * 1000) || 0) + 2000,
  );
  $("#sub-text").value = "";
  $("#sub-text").focus();
};
$("#sub-delete").onclick = () => {
  if (!selected) return;
  cues = cues.filter((c) => c.id !== selected);
  selected = null;
  page = Math.min(page, Math.max(0, Math.ceil(cues.length / pageSize) - 1));
  dirty = true;
  draw();
  status(uiMsg("Cue removed."));
};
$("#sub-shift").onclick = () => {
  try {
    cues = shiftCues(cues, Number($("#sub-offset").value));
    dirty = true;
    draw();
    status(
      uiJoin([
        uiMsg("Timing shifted by "),
        $("#sub-offset").value,
        uiMsg(" ms."),
      ]),
    );
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#sub-download").onclick = () => {
  try {
    const f = $("#sub-format").value;
    downloadText(
      serialize(cues, f),
      "kensei-subtitles." + f,
      f === "vtt" ? "text/vtt;charset=utf-8" : "text/plain;charset=utf-8",
    );
    dirty = false;
    status(uiMsg("Subtitle download ready."));
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#sub-prev").onclick = () => {
  page--;
  draw();
};
$("#sub-next").onclick = () => {
  page++;
  draw();
};
$("#sub-video-file").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 500000000)
    return status(uiMsg("Choose a video no larger than 500 MB."), true);
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(file);
  video.src = url;
  video.hidden = false;
  video.load();
  status(
    uiMsg("Local video ready. Browser codec support determines playback."),
  );
};
video.ontimeupdate = overlay;
video.onerror = () =>
  status(
    uiMsg(
      "This video format cannot play here. Subtitle editing and downloads remain available.",
    ),
    true,
  );
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  video.pause();
});
draw();

export function recoveryData() {
  return cues.length ? serialize(cues, "vtt") : "";
}
export function restoreRecovery(text) {
  if (typeof text !== "string") throw Error("Invalid subtitle recovery copy.");
  const next = text ? parseSubtitles(text) : [];
  cues = next;
  selected = null;
  page = 0;
  dirty = true;
  draw();
}

window.KenseiAdvancedContexts ||= {};
window.KenseiAdvancedContexts["subtitle-studio"] = {
  get cues() {
    return cues;
  },
  replace(next) {
    if (next.length > 5000) throw Error("Use at most 5,000 cues.");
    serialize(next, "vtt");
    cues = next;
    selected = null;
    page = 0;
    dirty = true;
    draw();
  },
};
