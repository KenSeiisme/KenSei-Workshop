import { $, size, downloadText, status, busy } from "./common.js";
import { button, el, field, row } from "./advanced-ui.js";
import { receiveHandoff } from "./handoff.js";
import { uiAttr, uiMsg, uiError, uiText, uiOption } from "../site/ui.js";
import { parseSubtitles, serialize } from "./subtitle-core.js";
import { createVideoPreview } from "./video-preview.js";
import { createVideoTrack } from "./video-track-editor.js";
import {
  containers,
  exportSettings,
  cutClips,
  insertAtFrame,
  timelineCut,
  makeTimeline,
  timelineCues,
  videoLimits,
} from "./video-timeline.js";

const sourceList = $("#video-source-list"),
  list = $("#video-clips");

const progress = $("#video-progress"),
  prepare = $("#video-encode");
const format = $("#video-format"),
  resolution = $("#video-resolution");
const quality = $("#video-quality"),
  orientation = $("#video-orientation");
let sources = {},
  clips = [],
  available = [],
  running = null;
let generation = 0,
  choiceRevision = 0,
  probeWorker,
  formatWorker;
let resultUrl,
  importing = false,
  formatKey = "";
let plan = null,
  cues = [],
  selected = null,
  cursor = 0,
  clipboard;
const worker = () =>
  new Worker("/tool-scripts/video-export-worker.js", { type: "module" });
const settings = () => ({
  resolution: resolution.value,
  quality: quality.value,
  orientation: orientation.value,
});
const isBusy = () => importing || !!running;
const newId = () => crypto.randomUUID();
const makeClip = (source, end) => ({ id: newId(), source, start: 0, end });
const transport = createVideoPreview(
  {
    players: [$("#video-preview"), $("#video-preview-next")],
    caption: $("#video-caption"),
    empty: $("#video-preview-empty"),
  },
  {
    onFrame(frame) {
      cursor = frame;
      track.paintPosition(frame, plan, true);
      updateControls();
    },
    onState: updateControls,
    onError(error, loading = false) {
      $("#video-preview-feedback").hidden = !error && !loading;
      $("#video-retry-preview").hidden = !error;
      uiText(
        $("#video-preview-status"),
        error ? uiError(error) : loading ? uiMsg("Seeking preview…") : "",
      );
    },
  },
);
const track = createVideoTrack({
  seek(frame, draft) {
    if (draft)
      transport.show(draft, sources, timelineCues(draft, sources), frame);
    else showFrame(frame);
  },
  pause: transport.pause,
  select: selectClip,
  commit,
  isBusy,
});

function invalidate() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  $("#video-result").hidden = true;
  const result = $("#video-result-player");
  result.hidden = true;
  result.removeAttribute("src");
  result.load();
}
function request(task, receive) {
  const job = worker();
  let abort;
  const promise = new Promise((resolve, reject) => {
    abort = () => reject(new DOMException("Cancelled", "AbortError"));
    job.onmessage = ({ data }) =>
      data.type === "error"
        ? reject(Error(data.message))
        : data.type === receive && resolve(data);
    job.onerror = (event) => {
      event.preventDefault();
      reject(Error("The video engine could not start. Reload to retry."));
    };
    job.postMessage(task);
  });
  return {
    job,
    promise,
    cancel() {
      job.terminate();
      abort();
    },
  };
}
async function importFiles(
  files,
  sidecar,
  current = () => true,
  replace = false,
) {
  if (!files.length || isBusy()) return false;
  const prior = replace ? {} : sources;
  const total =
    files.reduce((sum, file) => sum + file.size, 0) +
    Object.values(prior).reduce((sum, source) => sum + source.file.size, 0);
  if (
    files.length + Object.keys(prior).length > videoLimits.sources ||
    total > videoLimits.totalBytes ||
    files.some(
      (file) =>
        file.size > videoLimits.fileBytes || !/\.(mp4|webm)$/i.test(file.name),
    )
  ) {
    throw Error(
      "Choose up to six MP4 or WebM files, 250 MB each and 500 MB in total.",
    );
  }
  const imported = {};
  const token = ++generation;
  importing = true;
  transport.pause();
  busy(true);
  try {
    const subtitles = sidecar ? parseSubtitles(await sidecar.text()) : [];
    for (const file of files) {
      if (token !== generation || !current()) return false;
      status(uiMsg("Reading {0}…", [file.name]));
      const { job, promise, cancel } = request(
        { action: "probe", file },
        "metadata",
      );
      probeWorker = { cancel };
      let metadata;
      try {
        metadata = await promise;
      } finally {
        job.terminate();
      }
      if (token !== generation || !current()) return false;
      imported[newId()] = { file, ...metadata, cues: subtitles };
    }
    if (!current()) return false;
    if (replace) {
      transport.discard();
      Object.values(sources).forEach((asset) => URL.revokeObjectURL(asset.url));
      clipboard = null;
    }
    const next = replace ? [] : [...clips];
    let nextPlan = replace ? null : plan;
    for (const [id, source] of Object.entries(imported)) {
      source.url = URL.createObjectURL(source.file);
      if (!Object.keys(prior).length && id === Object.keys(imported)[0])
        orientation.value = source.portrait ? "portrait" : "landscape";
      const used = next.reduce((sum, c) => sum + c.end - c.start, 0);
      const end = Math.min(
        source.duration,
        videoLimits.outputMs - used,
        videoLimits.outputMs - (nextPlan?.duration || 0),
      );
      if (end > 0 && next.length < videoLimits.clips) {
        next.push(makeClip(id, end));
        nextPlan = makeTimeline(next, { ...prior, ...imported });
      }
    }
    sources = { ...prior, ...imported };
    if (replace || next.length !== clips.length) invalidate();
    clips = next;
    if (replace) cursor = 0;
    status(uiMsg("Videos ready. Set the clips you want to keep."));
    return true;
  } catch (error) {
    if (token !== generation) return false;
    throw error;
  } finally {
    if (token === generation) {
      importing = false;
      probeWorker = null;
      busy(false);
      renderSources();
      refreshTimeline();
      updateFormats();
    }
  }
}

function updateControls() {
  const enabled = !!plan && !isBusy();
  const active = clips.find((clip) => clip.id === selected);
  prepare.disabled = !enabled || !available.includes(format.value);
  $("#video-play").disabled = !enabled || transport.playing;
  $("#video-stop").disabled = !transport.playing;
  $("#video-back-frame").disabled = !enabled || cursor === 0;
  $("#video-next-frame").disabled = !enabled || cursor >= plan.frames;
  $("#video-split").disabled = !enabled || !timelineCut(plan, cursor);
  $("#video-duplicate").disabled = $("#video-copy").disabled =
    !active || !enabled;
  $("#video-paste").disabled = isBusy() || !sources[clipboard?.source];
  $("#video-srt").disabled = $("#video-vtt").disabled =
    !enabled || !cues.length;
}
function updateSummary() {
  updateControls();
  const bytes = plan
    ? ((exportSettings(quality.value, resolution.value, orientation.value)
        .bitrate +
        (clips.some((c) => sources[c.source].hasAudio) ? 128000 : 0)) *
        plan.duration) /
      8000
    : 0;
  uiText(
    $("#video-duration"),
    plan
      ? uiMsg("{0} clips · {1} seconds · estimated {2}", [
          clips.length,
          (plan.duration / 1000).toFixed(2),
          size(bytes),
        ])
      : uiMsg("Add a clip to begin."),
  );
}

async function updateFormats() {
  const audio = clips.some((c) => sources[c.source].hasAudio);
  const key = plan ? JSON.stringify([settings(), audio]) : "";
  if (key === formatKey) return;
  formatKey = key;
  const token = ++choiceRevision;
  available = [];
  updateSummary();
  formatWorker?.cancel();
  if (!plan) {
    format.replaceChildren();
    uiText($("#video-availability"), "");
    return;
  }
  uiText($("#video-availability"), uiMsg("Checking video encoders…"));
  const { job, promise, cancel } = request(
    {
      action: "formats",
      ...settings(),
      audio,
    },
    "formats",
  );
  formatWorker = { cancel };
  try {
    const info = await promise;
    if (token !== choiceRevision) return;
    const previous = format.value;
    available = info.formats;
    format.replaceChildren(
      ...available.map((key) =>
        uiOption(uiMsg(key === "mp4" ? "MP4 (H.264)" : "WebM (VP8)"), key),
      ),
    );
    if (available.includes(previous)) format.value = previous;
    uiText(
      $("#video-availability"),
      available.length
        ? ""
        : uiMsg(
            "This browser cannot export this video. Preview and subtitle downloads are available.",
          ),
    );
  } catch (error) {
    if (token === choiceRevision) {
      formatKey = "";
      uiText($("#video-availability"), uiError(error));
    }
  } finally {
    job.terminate();
    if (token === choiceRevision) {
      formatWorker = null;
      updateSummary();
    }
  }
}
function editStatus(message, error = false) {
  const node = $("#video-edit-status");
  uiText(node, message);
  node.hidden = !message;
  node.classList.toggle("error-text", error);
}

function showFrame(frame) {
  cursor = Math.max(0, Math.min(frame, plan?.frames || 0));
  track.paintPosition(cursor, plan);
  updateControls();
  if (plan) {
    transport.show(plan, sources, cues, cursor);
  } else {
    transport.discard();
    $("#video-preview-feedback").hidden = true;
  }
}

function refreshTimeline(frame = cursor, keepFields = false) {
  plan = clips.length ? makeTimeline(clips, sources) : null;
  cues = plan ? timelineCues(plan, sources) : [];
  if (!clips.some((c) => c.id === selected)) selected = clips[0]?.id;
  cursor = Math.min(frame, plan?.frames || 0);
  $("#video-stage").dataset.orientation = orientation.value;
  if (!keepFields) renderClips();
  track.render(clips, sources, plan, selected, cursor);
  updateSummary();
  showFrame(cursor);
}

function commit(next, id, frame = cursor, focus, keepFields = false) {
  if (isBusy()) return false;
  let nextPlan;
  try {
    nextPlan = next.length && makeTimeline(next, sources);
  } catch (error) {
    editStatus(uiError(error), true);
    return false;
  }
  selected = id;
  if (frame === null)
    frame =
      nextPlan?.segments[next.findIndex((c) => c.id === id)]?.firstFrame ??
      cursor;
  if (clips.length !== next.length || clips.some((clip, i) => clip !== next[i]))
    invalidate();
  clips = next;
  editStatus("");
  refreshTimeline(frame, keepFields);
  updateFormats();
  if (focus) track.focus(id, focus);
  return true;
}

function selectClip(id, jump) {
  if (isBusy()) return;
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return;
  if (id !== selected) {
    selected = id;
    renderClips();
    track.markSelected(id);
  }
  if (jump) {
    const segment = plan.segments[index];
    showFrame(
      cursor < segment.firstFrame ||
        cursor >= segment.firstFrame + segment.frames
        ? segment.firstFrame
        : cursor,
    );
  }
  updateControls();
}

function renderSources() {
  sourceList.replaceChildren();
  for (const [id, asset] of Object.entries(sources)) {
    const card = el("div", "", { class: "video-item" });
    const title = el("strong");
    title.textContent = asset.file.name;
    const captions = el("input", "", { type: "file", accept: ".srt,.vtt" });
    const count = el("small");
    uiText(count, uiMsg("{0} subtitle cues", [asset.cues.length]));
    captions.onchange = async () => {
      const file = captions.files[0];
      captions.value = "";
      if (!file) return;
      try {
        if (file.size > 5000000) throw Error("Subtitle file exceeds 5 MB.");
        const updated = parseSubtitles(await file.text());
        if (sources[id] !== asset || isBusy()) return;
        asset.cues = updated;
        uiText(count, uiMsg("{0} subtitle cues", [updated.length]));
        if (!clips.some((clip) => clip.source === id)) return;
        cues = plan ? timelineCues(plan, sources) : [];
        invalidate();
        showFrame(cursor);
      } catch (error) {
        status(uiError(error), true);
      }
    };
    const add = button("Add clip", () => {
      const remaining =
        videoLimits.outputMs -
        Math.max(
          plan?.duration || 0,
          clips.reduce((sum, c) => sum + c.end - c.start, 0),
        );
      if (remaining <= 0) {
        editStatus(uiMsg("Keep the finished video to five minutes."), true);
        return;
      }
      const clip = makeClip(id, Math.min(asset.duration, remaining));
      commit([...clips, clip], clip.id, null);
    });
    const remove = button("Remove source", () => {
      if (isBusy()) return;
      transport.discard(asset.url);
      URL.revokeObjectURL(asset.url);
      delete sources[id];
      if (clipboard?.source === id) clipboard = null;
      commit(
        clips.filter((c) => c.source !== id),
        selected,
      );
      renderSources();
    });
    card.append(
      title,
      row(add, remove),
      field("Source subtitles (SRT or VTT)", captions),
      count,
    );
    sourceList.append(card);
  }
}

function parseTrim(index, type, input) {
  const time = Number.isFinite(input.valueAsNumber)
    ? Math.round(input.valueAsNumber * 1000)
    : NaN;
  const clip = clips[index];
  const next = clips.with(index, { ...clip, [type]: time });
  const draft = makeTimeline(next, sources);
  const { firstFrame, frames } = draft.segments[index];
  return {
    time,
    next,
    draft,
    frame: type === "start" ? firstFrame : firstFrame + frames - 1,
  };
}
function editTime(index, type, input) {
  try {
    const { time, next, frame } = parseTrim(index, type, input);
    input.removeAttribute("aria-invalid");
    if (time === clips[index][type]) {
      editStatus("");
      showFrame(cursor);
    } else {
      commit(next, clips[index].id, frame, undefined, true);
      input.value = time / 1000;
    }
  } catch (error) {
    input.setAttribute("aria-invalid", "true");
    editStatus(uiError(error), true);
    showFrame(cursor);
  }
}
function renderClips() {
  list.replaceChildren();
  clips.forEach((clip, i) => {
    const card = el("div", "", { class: "video-item" });
    const active = clip.id === selected;
    card.toggleAttribute("data-selected", active);
    const title = button("", () => {
      if (clip.id === selected) {
        selectClip(clip.id, true);
        return;
      }
      selectClip(clip.id, true);
      list.children[i]?.querySelector(".video-clip-summary")?.focus();
    });
    title.classList.add("video-clip-summary");
    uiText(
      title,
      uiMsg("Clip {0}: {1}", [i + 1, sources[clip.source].file.name]),
    );
    uiAttr(title, "aria-pressed", active);
    const trimField = (edge, label) => {
      const input = el("input", "", {
        type: "number",
        min: 0,
        max: sources[clip.source].duration / 1000,
        step: 0.001,
        value: clip[edge] / 1000,
      });
      input.dataset.edge = edge;
      input.oninput = () => {
        if (isBusy()) return;
        try {
          const { draft, frame } = parseTrim(i, edge, input);
          transport.show(draft, sources, timelineCues(draft, sources), frame);
          track.paintPosition(frame, draft);
          input.removeAttribute("aria-invalid");
          editStatus("");
        } catch {
          input.setAttribute("aria-invalid", "true");
          showFrame(cursor);
        }
      };
      input.onchange = () => editTime(i, edge, input);
      input.onkeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          editTime(i, edge, input);
        }
        if (event.key === "Escape") {
          input.value = clips[i][edge] / 1000;
          input.removeAttribute("aria-invalid");
          editStatus("");
          showFrame(cursor);
        }
      };
      return field(label, input);
    };
    const move = (offset, label) => {
      const to = i + offset;
      const control = button(label, () => {
        if (commit(clips.toSpliced(i, 1).toSpliced(to, 0, clips[i]), clip.id))
          list.children[to]
            ?.querySelector(".video-clip-summary")
            .focus({ preventScroll: true });
      });
      control.disabled = to < 0 || to >= clips.length;
      return control;
    };
    card.append(title);
    if (active) {
      const trim = el("div", "", { class: "video-time-fields" });
      trim.append(
        trimField("start", "Clip start (seconds)"),
        trimField("end", "Clip end (seconds)"),
      );
      card.append(trim);
    }
    card.append(
      row(
        move(-1, "Move earlier"),
        move(1, "Move later"),
        button("Remove clip", () => {
          if (
            commit(clips.toSpliced(i, 1), clips[i + 1]?.id ?? clips[i - 1]?.id)
          ) {
            (
              list.querySelector("[data-selected] .video-clip-summary") ||
              $("#video-sources")
            ).focus();
          }
        }),
      ),
    );
    list.append(card);
  });
}

function copySelected() {
  const clip = clips.find((c) => c.id === selected);
  if (!clip || isBusy()) return;
  clipboard = { source: clip.source, start: clip.start, end: clip.end };
  editStatus(uiMsg("Clip copied."));
  updateControls();
}
function pasteClip() {
  if (isBusy() || !sources[clipboard?.source]) return;
  const copy = { ...clipboard, id: newId() };
  try {
    if (
      commit(insertAtFrame(clips, plan, cursor, copy, newId()), copy.id, null)
    )
      editStatus(uiMsg("Clip pasted."));
  } catch (error) {
    editStatus(uiError(error), true);
  }
}
$("#video-split").onclick = () => {
  const cut = timelineCut(plan, cursor);
  if (!cut) return;
  const right = newId();
  if (commit(cutClips(clips, cut, right), right))
    editStatus(uiMsg("Clip split."));
};
$("#video-duplicate").onclick = () => {
  const index = clips.findIndex((c) => c.id === selected);
  if (index < 0) return;
  const copy = { ...clips[index], id: newId() };
  if (commit(clips.toSpliced(index + 1, 0, copy), copy.id, null))
    editStatus(uiMsg("Clip duplicated."));
};
$("#video-copy").onclick = copySelected;
$("#video-paste").onclick = pasteClip;
$("#video-editor").onkeydown = (event) => {
  if (
    event.isComposing ||
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.target.closest("input,textarea,select,[contenteditable]") ||
    !window.getSelection().isCollapsed
  )
    return;
  const key = event.key.toLowerCase();
  if (key === "c" && !$("#video-copy").disabled) {
    event.preventDefault();
    copySelected();
  }
  if (key === "v" && !$("#video-paste").disabled) {
    event.preventDefault();
    pasteClip();
  }
};

$("#video-sources").onchange = async ({ target }) => {
  const files = [...target.files];
  target.value = "";
  try {
    await importFiles(files);
  } catch (error) {
    status(uiError(error), true);
  }
};
receiveHandoff(
  "video-studio",
  (payload, current) =>
    importFiles([payload.files[0]], payload.files[1], current, true),
  () => Object.keys(sources).length > 0,
);

$("#video-play").onclick = () => {
  if (!isBusy()) transport.play(plan, sources, cues, cursor);
};
$("#video-stop").onclick = () => showFrame(cursor);
$("#video-back-frame").onclick = () => showFrame(cursor - 1);
$("#video-next-frame").onclick = () => showFrame(cursor + 1);
$("#video-retry-preview").onclick = () => showFrame(cursor);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && transport.playing) transport.pause();
});
for (const input of [resolution, quality, orientation])
  input.onchange = () => {
    $("#video-stage").dataset.orientation = orientation.value;
    invalidate();
    updateFormats();
  };
format.onchange = $("#video-burn").onchange = invalidate;
for (const type of ["srt", "vtt"])
  $("#video-" + type).onclick = () => {
    try {
      downloadText(serialize(cues, type), "kensei-video." + type);
    } catch (error) {
      status(uiError(error), true);
    }
  };
prepare.onclick = () => {
  if (isBusy() || !plan || !available.includes(format.value)) return;
  transport.pause();
  const job = (running = worker());
  const done = (message, error = false) => {
    if (job !== running) return;
    job.terminate();
    running = null;
    progress.hidden = true;
    busy(false);
    updateSummary();
    status(message, error);
  };
  busy(true);
  progress.hidden = false;
  progress.value = 0;
  status(uiMsg("Encoding video on this device…"));
  job.onmessage = ({ data }) => {
    if (job !== running) return;
    if (data.type === "progress") progress.value = data.value;
    if (data.type === "error") done(uiError(data), true);
    if (data.type === "finished") {
      invalidate();
      resultUrl = URL.createObjectURL(data.blob);
      const link = $("#video-download"),
        player = $("#video-result-player");
      link.href = player.src = resultUrl;
      link.download = "kensei-video." + data.format;
      player.hidden = $("#video-result").hidden = false;
      uiText(
        $("#video-result-size"),
        uiMsg("Finished video: {0}", [size(data.blob.size)]),
      );
      done(uiMsg("Video ready to download."));
    }
  };
  job.onerror = (event) => {
    event.preventDefault();
    done(uiMsg("The video engine could not start. Reload to retry."), true);
  };
  job.postMessage({
    action: "encode",
    sources,
    clips,
    ...settings(),
    format: format.value,
    burn: $("#video-burn").checked,
  });
};
$("#cancel-job").onclick = () => {
  generation++;
  importing = false;
  probeWorker?.cancel();
  probeWorker = null;
  running?.terminate();
  running = null;
  progress.hidden = true;
  busy(false);
  updateSummary();
  status(uiMsg("Cancelled."));
};
window.addEventListener("pagehide", () => {
  transport.discard();
  running?.terminate();
  probeWorker?.cancel();
  formatWorker?.cancel();
  Object.values(sources).forEach((a) => URL.revokeObjectURL(a.url));
  if (resultUrl) URL.revokeObjectURL(resultUrl);
});
renderSources();
refreshTimeline();
