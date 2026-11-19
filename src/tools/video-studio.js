import { $, size, downloadText, status, busy } from "./common.js";
import { button, el, field, row } from "./advanced-ui.js";
import { receiveHandoff } from "./handoff.js";
import {
  uiAttr,
  uiMsg,
  uiError,
  uiText,
  uiOption,
  uiConfirm,
  uiRender,
} from "../site/ui.js";
import { parseSubtitles, serialize } from "./subtitle-core.js";
import { createVideoPreview } from "./video-preview.js";
import { createVideoTrack } from "./video-track-editor.js";
import { createVideoMonitor } from "./video-monitor.js";
import { videoIcon } from "./video-icons.js";
import {
  audioCut,
  defaultLevels,
  editHistory,
  maxFrames,
  videoMix,
} from "./video-mix.js";
import {
  containers,
  exportSettings,
  frameMs,
  cutClips,
  insertAtFrame,
  timelineCut,
  makeTimeline,
  exactMs,
  units,
  outputLimit,
  videoLimits,
} from "./video-timeline.js";

import {
  captionTracks,
  clampBox,
  clipSpan,
  clipEnd,
  defaultBox,
  initialTracks,
  kindOf,
  makeAssembly,
  trackLimits,
  validatePositioned,
} from "./video-assembly.js";
import { trackManagement, layerHandles } from "./video-track-controls.js";

const sourceList = $("#video-source-list"),
  list = $("#video-clips");

const progress = $("#video-progress"),
  prepare = $("#video-encode");
const format = $("#video-format"),
  resolution = $("#video-resolution");
const fps = $("#video-fps");
const step = () => 30 / Number(fps.value);
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
let audioClips = [],
  tracks = initialTracks(),
  previewCaptions = ["source"],
  burnCaptions = ["source"],
  captionLists = [],
  levels = defaultLevels(),
  mix,
  activeLane = 0,
  snapEnabled = true,
  monitorMuted = false;
const history = editHistory(),
  mediaCache = new Map();
let waveWorker,
  leaving = false;
const mobile = matchMedia("(max-width: 768px)");
if (mobile.matches) $(".video-export").open = false;
const basePlayers = [$("#video-preview"), $("#video-preview-next")];
const players = new Map([[0, basePlayers]]);
for (const id of ["v1", "v2"]) {
  const videos = basePlayers.map(() => {
    const v = el("video", "", {
      playsInline: true,
      preload: "auto",
      "aria-hidden": "true",
    });
    $("#video-stage").prepend(v);
    return v;
  });
  players.set(id, videos);
}
const monitor = createVideoMonitor([...players.values()].flat(), (error) => {
  const node = $("#video-preview-audio-status");
  uiText(
    node,
    error.cause
      ? uiMsg(error.message, [error.cause])
      : uiMsg(
          "Audio preview is unavailable. Editing and export are still available.",
        ),
  );
  node.hidden = false;
});

const worker = () =>
  new Worker("/tool-scripts/video-export-worker.js", { type: "module" });
const settings = () => ({
  resolution: resolution.value,
  quality: quality.value,
  orientation: orientation.value,
  fps: Number(fps.value),
});
const isBusy = () => importing || !!running;
const newId = () => crypto.randomUUID();
const makeClip = (source, end) => ({ id: newId(), source, start: 0, end });
const transport = createVideoPreview(
  {
    players,
    caption: $("#video-caption"),
    empty: $("#video-preview-empty"),
    step,
  },
  {
    onFrame(frame) {
      cursor = frame;
      track.paintPosition(frame, plan, true);
      updateControls();
    },
    onState: updateControls,
    onAudioFrame(frame, video) {
      if (mix) monitor.update(mix, sources, frame, video);
    },
    onSilence: monitor.silence,
    onLayers(positions) {
      handles.paint(positions, selected, !transport.playing && !isBusy());
    },
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
      transport.show(
        {
          ...draft,
          layers: [
            {
              id: 0,
              clips: draft.segments.map((c) => ({
                ...c,
                at: c.firstFrame,
                stop: c.firstFrame + c.frames,
                box: { x: 0, y: 0, size: 1 },
              })),
            },
            ...plan.layers.slice(1),
          ],
        },
        sources,
        cues,
        frame,
      );
    else showFrame(frame);
  },
  pause: transport.pause,
  select: selectClip,
  commit,
  commitAudio(next, id, focus) {
    return commitSound(next, id, undefined, focus);
  },
  snapping: () => snapEnabled,
  transferVideo,
  step,
  captionName: trackName,
  message(value, error = false) {
    editStatus(value ? uiMsg(value) : "", error);
  },
  isBusy,
});

const handles = layerHandles($("#video-layer-handles"), {
  select(id) {
    selectClip(id, false);
  },
  change(id, box) {
    commitSound(
      audioClips.map((clip) => (clip.id === id ? { ...clip, box } : clip)),
      id,
    );
  },
});
const manage = trackManagement($("#video-track-management"), {
  add(kind) {
    const ids = Array.from({ length: trackLimits[kind] }, (_, i) =>
      kind === "audio" ? i + 1 : (kind === "video" ? "v" : "s") + (i + 1),
    );
    const id = ids.find((id) => !tracks.some((track) => track.id === id));
    if (id === undefined || isBusy()) return;
    updateTracks([...tracks, { id, kind }], audioClips, id);
  },
  edit(id, patch) {
    updateTracks(tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  },
  move(id, direction) {
    const from = tracks.findIndex((t) => t.id === id);
    const peers = tracks.filter((t) => t.kind === tracks[from].kind);
    const to = tracks.indexOf(
      peers[peers.findIndex((t) => t.id === id) + direction],
    );
    if (to === -1) return;
    const next = [...tracks];
    [next[from], next[to]] = [next[to], next[from]];
    updateTracks(next);
  },
  remove(id) {
    const count = audioClips.filter((clip) => clip.lane === id).length;
    if (
      count &&
      !uiConfirm(uiMsg("Delete this track and its {0} items?", [count]))
    )
      return;
    updateTracks(
      tracks.filter((t) => t.id !== id),
      audioClips.filter((clip) => clip.lane !== id),
      activeLane === id ? 0 : activeLane,
      id,
    );
  },
  addCaption(id) {
    if (!plan || cursor >= plan.frames || isBusy()) return;
    const clip = {
      id: newId(),
      lane: id,
      at: cursor,
      start: 0,
      end: Math.min(2000, exactMs(plan.frames - cursor)),
      text: uiRender(uiMsg("New subtitle")),
    };
    commitSound([...audioClips, clip], clip.id);
    $("#video-caption-text")?.focus();
  },
  async importCaption(id, file) {
    if (isBusy()) return;
    const current = tracks.find((t) => t.id === id);
    try {
      if (file.size > 5000000) throw Error("Subtitle file exceeds 5 MB.");
      const items = parseSubtitles(await file.text()).map(
        ({ id: cueId, start, end, text }) => ({
          id: cueId,
          lane: id,
          at: units(start),
          start: 0,
          end: end - start,
          text,
        }),
      );
      if (!tracks.includes(current) || isBusy()) return;
      const prior = audioClips.filter((clip) => clip.lane === id);
      if (
        prior.length &&
        !uiConfirm(uiMsg("Replace this track's existing subtitles?"))
      )
        return;
      commitSound(
        [...audioClips.filter((clip) => clip.lane !== id), ...items],
        items[0]?.id,
      );
    } catch (error) {
      editStatus(uiError(error), true);
    }
  },
  addVideo(id) {
    if (kindOf(activeLane) !== "video" || !activeLane) return;
    const asset = sources[id];
    const uncut = Math.min(
      asset.duration,
      videoLimits.outputMs - exactMs(cursor),
    );
    const next = audioClips
      .filter((clip) => clip.lane === activeLane && clip.at > cursor)
      .sort((a, b) => a.at - b.at)[0];
    const end = next ? Math.min(uncut, exactMs(next.at - cursor)) : uncut;
    const clip = {
      ...makeClip(id, end),
      at: cursor,
      lane: activeLane,
      volume: 100,
      box: defaultBox,
    };
    commitSound([...audioClips, clip], clip.id);
  },
});
function trackName(id) {
  if (id === 0) return uiMsg("Video track");
  if (id === "source") return uiMsg("Source subtitles");
  const type = kindOf(id);
  return (
    tracks.find((t) => t.id === id)?.name ||
    (type === "video"
      ? uiMsg("Video {0}", [String(id).slice(1)])
      : type === "audio"
        ? uiMsg("Audio {0}", [id])
        : uiMsg("Subtitles {0}", [String(id).slice(1)]))
  );
}
const order = () =>
  ["video", "audio", "captions"].flatMap((kind) =>
    tracks.filter((track) => track.kind === kind),
  );
function transferVideo(id, to, at) {
  if (isBusy()) return;
  const moving = clips.find((clip) => clip.id === id) || whichAudio(id);
  if (!moving) return;
  const { source, start, end } = moving;
  let next = clips.filter((clip) => clip.id !== id);
  let positioned = audioClips.filter((clip) => clip.id !== id);
  try {
    if (to === 0)
      next = insertAtFrame(
        next,
        plan?.primary,
        at,
        { id, source, start, end },
        newId(),
      );
    else
      positioned = [
        ...positioned,
        { id, source, start, end, at, lane: to, volume: 100, box: defaultBox },
      ];
    if (next.length) makeTimeline(next, sources, true);
    validatePositioned(positioned, sources, tracks);
  } catch (error) {
    editStatus(uiError(error), true);
    return;
  }
  history.push(snapshot());
  clips = next;
  audioClips = positioned;
  activeLane = to;
  selected = id;
  invalidate();
  editStatus("");
  refreshTimeline(at);
  updateFormats();
  track.focus(id, "clip");
}
function updateTracks(next, project = audioClips, lane = activeLane, removed) {
  if (isBusy()) return;
  history.push(snapshot());
  const id = selected;
  tracks = next;
  if (removed !== undefined) {
    levels = { ...levels };
    delete levels[removed];
    previewCaptions = previewCaptions.filter((id) => id !== removed);
    burnCaptions = burnCaptions.filter((id) => id !== removed);
  }
  audioClips = project;
  activeLane = lane;
  selected =
    project.some((clip) => clip.id === id) ||
    clips.some((clip) => clip.id === id)
      ? id
      : undefined;
  invalidate();
  refreshTimeline();
  updateFormats();
}
function setCaptionChoices() {
  captionLists = captionTracks(plan, sources, tracks, audioClips);
  const used = (ids) =>
    ids
      .map((id) => captionLists.find((t) => t.id === id)?.cues)
      .filter(Boolean);
  cues = used(previewCaptions);
  for (const [key, box, ids] of [
    ["preview", $("#video-caption-preview-options"), previewCaptions],
    ["export", $("#video-caption-export-options"), burnCaptions],
  ]) {
    box.replaceChildren();
    for (let i = 0; i < 2; i++) {
      const input = el("select");
      input.append(
        uiOption(uiMsg("None"), ""),
        ...captionLists.map((t) => uiOption(trackName(t.id), t.id)),
      );
      input.value = captionLists.some((t) => t.id === ids[i]) ? ids[i] : "";
      input.onchange = () => {
        const newId = input.value;
        const next = ids.slice();
        if (newId === next[1 - i]) next[1 - i] = "";
        next[i] = newId;
        if (key === "preview") previewCaptions = next;
        else {
          burnCaptions = next;
          invalidate();
        }
        setCaptionChoices();
        if (key === "preview") showFrame(cursor);
        box.querySelectorAll("select")[i]?.focus();
      };
      box.append(
        field(i === 0 ? "Subtitle track 1" : "Subtitle track 2", input),
      );
    }
  }
  const select = $("#video-caption-download"),
    prior = select.value;
  select.replaceChildren(
    ...captionLists.map((t) => uiOption(trackName(t.id), t.id)),
  );
  if (captionLists.some((t) => t.id === prior)) select.value = prior;
  select.disabled = !captionLists.length;
  const has = captionLists.find((t) => t.id === select.value)?.cues.length;
  $("#video-srt").disabled = $("#video-vtt").disabled = !has || isBusy();
  select.onchange = updateControls;
}

function snapshot() {
  return {
    sources,
    clips,
    audioClips,
    tracks,
    previewCaptions,
    burnCaptions,
    levels,
    selected,
    activeLane,
    cursor,
    orientation: orientation.value,
  };
}
function collectMedia() {
  function referenced() {
    return new Set(
      [snapshot(), ...history.states()].flatMap((state) =>
        Object.values(state.sources).map((asset) => asset.url),
      ),
    );
  }
  let used = referenced();
  while (
    [...used].reduce((sum, url) => sum + mediaCache.get(url).file.size, 0) >
    videoLimits.totalBytes
  ) {
    history.trim();
    used = referenced();
  }
  for (const [url, asset] of mediaCache) {
    if (used.has(url)) continue;
    monitor.release(url);
    URL.revokeObjectURL(url);
    mediaCache.delete(url);
    if (waveWorker?.asset === asset) waveWorker.cancel();
  }
}
function restore(action) {
  if (isBusy()) return;
  const saved = history[action](snapshot());
  if (!saved) return;
  transport.pause();
  ({
    sources,
    clips,
    audioClips,
    tracks,
    previewCaptions,
    burnCaptions,
    levels,
    selected,
    activeLane,
    cursor,
  } = saved);
  orientation.value = saved.orientation;
  collectMedia();
  invalidate();
  renderSources();
  refreshTimeline();
  updateFormats();
  scanWaveforms();
  editStatus(action === "undo" ? uiMsg("Edit undone.") : uiMsg("Edit redone."));
}
function scanWaveforms() {
  if (waveWorker || isBusy() || leaving) return;
  const entry = Object.entries(sources).find(
    ([, asset]) => asset.kind === "audio" && !asset.peaks && !asset.waveFailed,
  );
  if (!entry) return;
  const [id, asset] = entry;
  const task = request({ action: "waveform", file: asset.file }, "waveform");
  waveWorker = { ...task, asset };
  task.promise
    .then(({ peaks }) => {
      asset.peaks = peaks;
      if (sources[id] === asset) track.updateWaveform(id);
    })
    .catch((error) => {
      if (error.name !== "AbortError") asset.waveFailed = true;
    })
    .finally(() => {
      task.job.terminate();
      waveWorker = null;
      scanWaveforms();
    });
}
function whichAudio(id = selected) {
  return audioClips.find((clip) => clip.id === id);
}
function audioAtCursor() {
  return audioClips.find(
    (clip) =>
      clip.lane === activeLane && cursor > clip.at && cursor < clipEnd(clip),
  );
}
function currentCut() {
  if (!activeLane) {
    const cut = timelineCut(plan?.primary, cursor);
    return cut &&
      cursor - plan.primary.segments[cut.index].firstFrame >= step() - 1e-6 &&
      plan.primary.segments[cut.index].firstFrame +
        plan.primary.segments[cut.index].frames -
        cursor >=
        step() - 1e-6
      ? cut
      : null;
  }
  const clip = audioAtCursor();
  const at = clip && audioCut(clip, cursor, step());
  return at == null ? null : { clip, at };
}
function findAddedAudio(
  id,
  assets = sources,
  existing = audioClips,
  length = plan?.frames || 0,
) {
  if (cursor >= length) return null;
  const end = Math.min(assets[id].duration, exactMs(length - cursor));
  const ids = tracks.filter((t) => t.kind === "audio").map((t) => t.id);
  for (const lane of ids.includes(activeLane)
    ? [activeLane, ...ids.filter((id) => id !== activeLane)]
    : ids) {
    const clip = {
      id: newId(),
      source: id,
      lane,
      at: cursor,
      start: 0,
      end,
      volume: 100,
    };
    try {
      validatePositioned([...existing, clip], assets, tracks);
      return clip;
    } catch {}
  }
  return null;
}
function commitSound(next, id, frame = cursor, focus) {
  if (isBusy()) return false;
  try {
    validatePositioned(next, sources, tracks);
  } catch (error) {
    editStatus(uiError(error), true);
    return false;
  }
  history.push(snapshot());
  audioClips = next;
  selected = id;
  activeLane = whichAudio()?.lane ?? activeLane;
  invalidate();
  editStatus("");
  refreshTimeline(frame);
  updateFormats();
  collectMedia();
  if (focus) track.focus(id, focus);
  return true;
}
function renderTrackLabels() {
  const labels = $("#video-track-labels");
  labels.replaceChildren();
  for (const id of [0, ...order().map((track) => track.id)]) {
    const b = button("", () => {
      if (isBusy()) return;
      activeLane = id;
      selected = (id ? audioClips.find((c) => c.lane === id) : clips[0])?.id;
      renderClips();
      track.markSelected(selected);
      paintTrackLabels();
      updateControls();
    });
    uiText(b, trackName(id));
    b.dataset.videoLane = id;
    labels.append(b);
  }
  manage.render(order(), trackName, Boolean(plan));
  paintTrackLabels();
}
function paintTrackLabels() {
  for (const b of $("#video-track-labels").children)
    b.setAttribute("aria-pressed", b.dataset.videoLane === String(activeLane));
}
function updateMix(next) {
  const previous = snapshot();
  history.push(previous);
  levels = next;
  mix = videoMix(plan, audioClips, levels, sources);
  invalidate();
  updateSummary();
  updateFormats();
  collectMedia();
}
function renderMixer() {
  const mixer = $("#video-track-mixer");
  mixer.replaceChildren();
  for (const index of [
    0,
    ...order()
      .filter((t) => t.kind !== "captions")
      .map((t) => t.id),
  ]) {
    const label = index === 0 ? uiMsg("Video sound") : trackName(index);
    const level = levels[index] ?? {
      volume: 100,
      muted: kindOf(index) === "video",
    };
    const input = el("input", "", {
      type: "range",
      min: 0,
      max: 100,
      value: level.volume,
    });
    uiAttr(input, "aria-label", uiMsg("{0} volume", [label]));
    const percent = el("output");
    percent.value = level.volume + "%";
    const b = button("", () => {
      if (isBusy()) return;
      updateMix({
        ...levels,
        [index]: { ...level, muted: !(levels[index]?.muted ?? level.muted) },
      });
      styleMute();
    });
    function styleMute() {
      const muted = levels[index]?.muted ?? level.muted;
      videoIcon(
        b,
        muted ? "mute" : "sound",
        uiMsg(muted ? "Unmute {0}" : "Mute {0}", [label]),
      );
      b.setAttribute("aria-pressed", muted);
    }
    input.oninput = () => {
      percent.value = input.value + "%";
      mix = videoMix(
        plan,
        audioClips,
        {
          ...levels,
          [index]: { ...level, ...levels[index], volume: +input.value },
        },
        sources,
      );
    };
    input.onchange = () => {
      if (!isBusy() && (levels[index]?.volume ?? level.volume) !== +input.value)
        updateMix({
          ...levels,
          [index]: { ...level, ...levels[index], volume: +input.value },
        });
    };
    styleMute();
    const name = el("span");
    uiText(name, label);
    mixer.append(row(name, b, input, percent));
  }
}
function invalidate() {
  $("#video-result-previous").hidden = !resultUrl;
}
function request(task, receive) {
  const job = worker();
  let abort;
  const promise = new Promise((resolve, reject) => {
    abort = () => reject(new DOMException("Cancelled", "AbortError"));
    job.onmessage = ({ data }) =>
      data.type === "error"
        ? reject(Error(data.message, { cause: data.file }))
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
  kind = "video",
) {
  if (!files.length || isBusy()) return false;
  const prior = replace ? {} : sources;
  const total =
    files.reduce((sum, file) => sum + file.size, 0) +
    Object.values(prior).reduce((sum, source) => sum + source.file.size, 0);
  if (
    files.length +
      Object.values(prior).filter((asset) => asset.kind === kind).length >
      videoLimits.sources ||
    total > videoLimits.totalBytes ||
    files.some(
      (file) =>
        file.size > videoLimits.fileBytes ||
        !(kind === "audio" ? /\.(mp3|wav|m4a)$/i : /\.(mp4|webm)$/i).test(
          file.name,
        ),
    )
  ) {
    throw Error(
      kind === "audio"
        ? "Choose up to six MP3, WAV or AAC M4A files within the shared 500 MB limit."
        : "Choose up to six MP4 or WebM files, 250 MB each and 500 MB in total.",
    );
  }
  const imported = {};
  const token = ++generation;
  importing = true;
  waveWorker?.cancel();
  transport.pause();
  busy(true);
  try {
    const subtitles = sidecar ? parseSubtitles(await sidecar.text()) : [];
    for (const file of files) {
      if (token !== generation || !current()) return false;
      status(uiMsg("Reading {0}…", [file.name]));
      const { job, promise, cancel } = request(
        { action: kind === "audio" ? "audio-probe" : "probe", file },
        "metadata",
      );
      probeWorker = { cancel };
      let metadata;
      try {
        metadata = await promise;
      } catch (error) {
        if (kind === "audio" && error.name !== "AbortError")
          throw Error("Could not decode {0}.", { cause: file.name });
        throw error;
      } finally {
        job.terminate();
      }
      if (token !== generation || !current()) return false;
      imported[newId()] = { file, ...metadata, kind, cues: subtitles };
    }
    if (!current()) return false;
    history.push(snapshot());
    if (replace) {
      transport.discard();
      clipboard = null;
      audioClips = [];
      levels = defaultLevels();
      tracks = initialTracks();
      previewCaptions = burnCaptions = ["source"];
      activeLane = 0;
    }
    const next = replace ? [] : [...clips];
    let nextPlan = replace ? null : plan;
    for (const [id, source] of Object.entries(imported)) {
      source.url = URL.createObjectURL(source.file);
      mediaCache.set(source.url, source);
      if (kind === "audio") continue;
      if (
        !Object.values(prior).some((asset) => asset.kind === "video") &&
        id === Object.keys(imported)[0]
      )
        orientation.value = source.portrait ? "portrait" : "landscape";
      const used = next.reduce((sum, c) => sum + c.end - c.start, 0);
      const end = Math.min(
        source.duration,
        videoLimits.outputMs - used,
        videoLimits.outputMs - (nextPlan?.duration || 0),
      );
      if (end > 0 && next.length < videoLimits.clips) {
        next.push(makeClip(id, end));
        nextPlan = makeTimeline(next, { ...prior, ...imported }, true);
      }
    }
    sources = { ...prior, ...imported };
    if (kind === "audio") {
      let added = false;
      for (const id of Object.keys(imported)) {
        const clip = findAddedAudio(id);
        if (!clip) continue;
        audioClips = [...audioClips, clip];
        selected = clip.id;
        activeLane = clip.lane;
        added = true;
      }
      if (added) invalidate();
      status(
        added
          ? uiMsg("Audio added to the timeline.")
          : uiMsg("Audio imported. Choose a free position on the timeline."),
      );
    }
    if (replace || next.length !== clips.length) invalidate();
    clips = next;
    if (replace) cursor = 0;
    if (kind === "video")
      status(uiMsg("Videos ready. Set the clips you want to keep."));
    if (mobile.matches && clips.length) $(".video-sources-panel").open = false;
    collectMedia();
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
      scanWaveforms();
    }
  }
}

function updateControls() {
  const enabled = !!plan && !isBusy();
  const active = clips.find((clip) => clip.id === selected) ?? whichAudio();
  prepare.disabled =
    !enabled ||
    !available.includes(format.value) ||
    estimatedBytes() > outputLimit;
  $("#video-fps-note").hidden = !(
    fps.value === "60" &&
    Object.values(sources).some(
      (asset) => asset.kind === "video" && asset.frameRate < 59,
    )
  );
  for (const b of sourceList.querySelectorAll("[data-add-overlay]"))
    b.disabled = isBusy() || !String(activeLane).startsWith("v");
  const play = $("#video-play");
  play.disabled = !enabled;
  const key = transport.playing ? "pause" : "play";
  if (play.dataset.transport !== key) {
    play.dataset.transport = key;
    videoIcon(play, key, transport.playing ? "Pause preview" : "Play preview");
  }
  $("#video-back-frame").disabled = !enabled || cursor === 0;
  $("#video-next-frame").disabled = !enabled || cursor >= plan.frames;
  $("#video-split").disabled = isBusy() || !currentCut();
  $("#video-delete").disabled = isBusy() || !active;
  $("#video-undo").disabled = isBusy() || !history.canUndo;
  $("#video-redo").disabled = isBusy() || !history.canRedo;
  $("#video-duplicate").disabled = $("#video-copy").disabled =
    !active || isBusy();
  $("#video-paste").disabled =
    isBusy() || !clipboard || (clipboard.source && !sources[clipboard.source]);
  $("#video-srt").disabled = $("#video-vtt").disabled =
    !enabled ||
    !captionLists.find((t) => t.id === $("#video-caption-download").value)?.cues
      .length;
}
function estimatedBytes() {
  return plan
    ? ((exportSettings(
        quality.value,
        resolution.value,
        orientation.value,
        fps.value,
      ).bitrate +
        (mix?.audible ? 128000 : 0)) *
        plan.duration) /
        8000
    : 0;
}
function updateSummary() {
  updateControls();
  const bytes = estimatedBytes();
  $("#video-export-budget").hidden = bytes <= outputLimit;
  uiText(
    $("#video-duration"),
    plan
      ? uiMsg("{0} clips · {1} seconds · estimated {2}", [
          clips.length +
            audioClips.filter((clip) => kindOf(clip.lane) === "video").length,
          (plan.duration / 1000).toFixed(2),
          size(bytes),
        ])
      : uiMsg("Add a clip to begin."),
  );
}

async function updateFormats() {
  const audio = !!mix?.audible;
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
  plan = makeAssembly(clips, sources, order(), audioClips);
  setCaptionChoices();
  mix = videoMix(plan, audioClips, levels, sources);
  if (![...clips, ...audioClips].some((c) => c.id === selected))
    selected = activeLane
      ? audioClips.find((c) => c.lane === activeLane)?.id
      : clips[0]?.id;
  renderTrackLabels();
  renderMixer();
  cursor = Math.min(frame, plan?.frames || 0);
  $("#video-stage").dataset.orientation = orientation.value;
  if (!keepFields) renderClips();
  track.render(clips, sources, plan, selected, cursor, audioClips, order());
  updateSummary();
  showFrame(cursor);
}

function commit(next, id, frame = cursor, focus, keepFields = false) {
  if (isBusy()) return false;
  let nextPlan;
  try {
    nextPlan = next.length && makeTimeline(next, sources, true);
  } catch (error) {
    editStatus(uiError(error), true);
    return false;
  }
  const changed =
    clips.length !== next.length || clips.some((clip, i) => clip !== next[i]);
  if (changed) history.push(snapshot());
  selected = id;
  activeLane = 0;
  if (frame === null)
    frame =
      nextPlan?.segments[next.findIndex((c) => c.id === id)]?.firstFrame ??
      cursor;
  if (changed) invalidate();
  clips = next;
  editStatus("");
  refreshTimeline(frame, keepFields);
  updateFormats();
  if (focus) track.focus(id, focus);
  collectMedia();
  return true;
}

function selectClip(id, jump) {
  if (isBusy()) return;
  const index = clips.findIndex((clip) => clip.id === id);
  const audio = whichAudio(id);
  if (index < 0 && !audio) return;
  activeLane = audio?.lane || 0;
  paintTrackLabels();
  if (id !== selected) {
    selected = id;
    renderClips();
    track.markSelected(id);
  }
  if (jump && audio) showFrame(audio.at);
  else if (jump) {
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
    const remove = button("Remove source", () => {
      if (isBusy()) return;
      history.push(snapshot());
      transport.discard(asset.url);
      monitor.release(asset.url);
      sources = Object.fromEntries(
        Object.entries(sources).filter(([key]) => key !== id),
      );
      clips = clips.filter((clip) => clip.source !== id);
      audioClips = audioClips.filter((clip) => clip.source !== id);
      invalidate();
      renderSources();
      refreshTimeline();
      updateFormats();
      collectMedia();
    });
    videoIcon(remove, "trash", "Remove source");
    if (asset.kind === "audio") {
      const add = button("Add audio to timeline", () => {
        const clip = findAddedAudio(id);
        if (!clip) {
          editStatus(
            uiMsg("Choose a free audio position before the video ends."),
            true,
          );
          return;
        }
        commitSound([...audioClips, clip], clip.id, clip.at);
      });
      videoIcon(add, "duplicate", "Add audio to timeline");
      card.append(title, row(add, remove));
      sourceList.append(card);
      continue;
    }
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
        history.push(snapshot());
        sources = { ...sources, [id]: { ...asset, cues: updated } };
        uiText(count, uiMsg("{0} subtitle cues", [updated.length]));
        if (!clips.some((clip) => clip.source === id)) {
          updateControls();
          return;
        }
        setCaptionChoices();
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
    videoIcon(add, "duplicate", "Add clip");
    const overlay = videoIcon(
      button("", () => manage.addVideo(id)),
      "duplicate",
      "Add to selected video layer",
    );
    overlay.dataset.addOverlay = "";
    card.append(
      title,
      row(add, overlay, remove),
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
  const draft = makeTimeline(next, sources, true);
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
  const picker = $("#video-clip-picker");
  const all = [...clips, ...audioClips];
  picker.replaceChildren(
    uiOption(uiMsg("Select a clip"), ""),
    ...all.map((clip) =>
      uiOption(
        clip.lane
          ? clip.source
            ? uiMsg("{0}: {1}", [
                trackName(clip.lane),
                sources[clip.source].file.name,
              ])
            : clip.text
          : sources[clip.source].file.name,
        clip.id,
      ),
    ),
  );
  picker.value = selected || "";
  picker.disabled = !all.length;
  picker.onchange = () => selectClip(picker.value, true);
  $("#video-inspector-empty").hidden = !!selected;
  const audio = whichAudio();
  renderAudioProperties(audio);
  list.hidden = !!audio;
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
          transport.show(
            makeAssembly(next, sources, order(), audioClips),
            sources,
            cues,
            frame,
          );
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
      card.append(
        row(
          move(-1, "Move clip earlier"),
          move(1, "Move clip later"),
          button("Remove clip", () => {
            if (
              commit(
                clips.toSpliced(i, 1),
                clips[i + 1]?.id ?? clips[i - 1]?.id,
              )
            ) {
              (
                list.querySelector("[data-selected] .video-clip-summary") ||
                $("#video-sources")
              ).focus();
            }
          }),
        ),
      );
      const layers = order().filter((track) => track.kind === "video");
      if (layers.length) {
        const destination = el("select");
        destination.append(
          ...layers.map((track) => uiOption(trackName(track.id), track.id)),
        );
        card.append(
          field("Move to video layer", destination),
          button("Move clip to layer", () =>
            transferVideo(
              clip.id,
              destination.value,
              plan.primary.segments[i].firstFrame,
            ),
          ),
        );
      }
    }
    list.append(card);
  });
}

function renderAudioProperties(clip) {
  const area = $("#video-audio-properties");
  area.replaceChildren();
  area.hidden = !clip;
  if (!clip) return;
  const edit = (props) => {
    const next = audioClips.map((item) =>
      item.id === clip.id ? { ...item, ...props } : item,
    );
    return commitSound(next, clip.id);
  };
  const numeric = (title, value, min, max, step, make) => {
    const input = el("input", "", { type: "number", min, max, step, value });
    input.onchange = () => {
      if (!edit(make(input.valueAsNumber))) {
        input.value = value;
        input.setAttribute("aria-invalid", "true");
        input.focus();
      }
    };
    return field(title, input);
  };
  const type = kindOf(clip.lane);
  const laneLabel =
    type === "audio"
      ? "Audio track"
      : type === "video"
        ? "Video layer"
        : "Subtitle track";
  const lanes = el("select", "", { id: "video-selected-audio-track" });
  lanes.append(
    ...order()
      .filter((l) => l.kind === type)
      .map((l) => uiOption(trackName(l.id), l.id)),
  );
  lanes.value = clip.lane;
  lanes.onchange = () => {
    if (!edit({ lane: type === "audio" ? +lanes.value : lanes.value }))
      lanes.value = clip.lane;
  };
  const seconds = (ms) => Number((ms / 1000).toFixed(4));
  area.append(
    field(laneLabel, lanes),
    numeric(
      "Position (seconds)",
      seconds(exactMs(clip.at)),
      0,
      300,
      0.001,
      (v) => ({ at: units(Math.round(v * 1000)) }),
    ),
  );
  if (type === "captions") {
    const text = el("textarea", "", {
      id: "video-caption-text",
      rows: 3,
      value: clip.text,
      maxLength: 10000,
    });
    text.onchange = () => {
      if (!edit({ text: text.value }))
        text.setAttribute("aria-invalid", "true");
    };
    area.append(
      field("Subtitle text", text),
      numeric(
        "End time (seconds)",
        seconds(exactMs(clipEnd(clip))),
        0,
        300,
        0.001,
        (v) => ({ end: Math.round(v * 1000) - exactMs(clip.at) }),
      ),
    );
    return;
  }
  const asset = sources[clip.source];
  area.append(
    numeric(
      "Clip start (seconds)",
      seconds(clip.start),
      0,
      asset.duration / 1000,
      0.001,
      (v) => ({ start: Math.round(v * 1000) }),
    ),
    numeric(
      "Clip end (seconds)",
      seconds(clip.end),
      0,
      asset.duration / 1000,
      0.001,
      (v) => ({ end: Math.round(v * 1000) }),
    ),
    numeric("Clip volume (%)", clip.volume, 0, 100, 1, (v) => ({
      volume: Math.round(v),
    })),
  );
  if (type === "video") {
    area.append(
      button("Move to main video track", () =>
        transferVideo(clip.id, 0, clip.at),
      ),
    );
    const full = el("input", "", { type: "checkbox", checked: !!clip.full });
    full.onchange = () => edit({ full: full.checked });
    const check = field("Full frame", full);
    check.classList.add("check-label");
    area.append(check);
    const box = clip.box || defaultBox;
    if (!clip.full)
      for (const [label, key] of [
        ["Horizontal position (%)", "x"],
        ["Vertical position (%)", "y"],
        ["Size (%)", "size"],
      ]) {
        area.append(
          numeric(
            label,
            Math.round(box[key] * 100),
            key === "size" ? 15 : 0,
            100,
            1,
            (v) => ({ box: clampBox({ ...box, [key]: v / 100 }) }),
          ),
        );
      }
  } else if (clipEnd(clip) > (plan?.frames || 0)) {
    area.append(
      el("p", "Audio beyond the video end will be left out of export.", {
        class: "muted small",
      }),
    );
  }
}
function copySelected() {
  const clip = whichAudio() ?? clips.find((c) => c.id === selected);
  if (!clip || isBusy()) return;
  const { id, ...copy } = clip;
  clipboard = copy;
  editStatus(uiMsg("Clip copied."));
  updateControls();
}
function pasteClip() {
  if (
    isBusy() ||
    !clipboard ||
    (clipboard.source && !sources[clipboard.source])
  )
    return;
  const copy = { ...clipboard, id: newId() };
  try {
    if (copy.lane) {
      copy.lane =
        activeLane && kindOf(activeLane) === kindOf(copy.lane)
          ? activeLane
          : copy.lane;
      copy.at = cursor;
      if (commitSound([...audioClips, copy], copy.id))
        editStatus(uiMsg("Clip pasted."));
    } else if (
      commit(
        insertAtFrame(clips, plan?.primary, cursor, copy, newId()),
        copy.id,
        null,
      )
    )
      editStatus(uiMsg("Clip pasted."));
  } catch (error) {
    editStatus(uiError(error), true);
  }
}
function splitSelected() {
  const cut = currentCut();
  if (!cut) return;
  const right = newId();
  if (activeLane) {
    const { clip, at } = cut;
    const index = audioClips.indexOf(clip);
    if (
      !commitSound(
        audioClips.toSpliced(
          index,
          1,
          { ...clip, end: at },
          {
            ...clip,
            id: right,
            ...(kindOf(clip.lane) === "captions"
              ? { start: 0, end: clip.end - at }
              : { start: at }),
            at: cursor,
          },
        ),
        right,
      )
    )
      return;
  } else if (!commit(cutClips(clips, cut, right), right)) return;
  editStatus(uiMsg("Clip split."));
}
function duplicateSelected() {
  const clip = whichAudio();
  if (clip) {
    const copy = { ...clip, id: newId(), at: clipEnd(clip) };
    if (
      !commitSound(
        [...audioClips, copy],
        copy.id,
        Math.min(plan?.frames || 0, copy.at),
      )
    )
      return;
  } else {
    const index = clips.findIndex((c) => c.id === selected);
    if (index < 0) return;
    const copy = { ...clips[index], id: newId() };
    if (!commit(clips.toSpliced(index + 1, 0, copy), copy.id, null)) return;
  }
  editStatus(uiMsg("Clip duplicated."));
}
function removeSelected() {
  const clip = whichAudio();
  if (clip)
    commitSound(
      audioClips.filter((c) => c !== clip),
      null,
    );
  else {
    const i = clips.findIndex((c) => c.id === selected);
    if (i >= 0)
      commit(clips.toSpliced(i, 1), clips[i + 1]?.id ?? clips[i - 1]?.id);
  }
}
$("#video-undo").onclick = () => restore("undo");
$("#video-redo").onclick = () => restore("redo");
$("#video-snap").onclick = () => {
  snapEnabled = !snapEnabled;
  $("#video-snap").setAttribute("aria-pressed", snapEnabled);
};
$("#video-delete").onclick = removeSelected;
$("#video-split").onclick = splitSelected;
$("#video-duplicate").onclick = duplicateSelected;
$("#video-copy").onclick = copySelected;
$("#video-paste").onclick = pasteClip;
$(".video-studio-grid").onkeydown = (event) => {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.altKey ||
    isBusy() ||
    event.target.closest("input,textarea,select,[contenteditable]") ||
    !window.getSelection()?.isCollapsed
  )
    return;
  const key = event.key.toLowerCase();
  const id =
    event.ctrlKey || event.metaKey
      ? {
          c: "video-copy",
          v: "video-paste",
          z: event.shiftKey ? "video-redo" : "video-undo",
        }[key]
      : {
          " ": "video-play",
          arrowleft: "video-back-frame",
          arrowright: "video-next-frame",
          s: "video-split",
          delete: "video-delete",
        }[key];
  if (!id || (key === " " && event.target.closest("button,summary,a"))) return;
  if (!$("#" + id).disabled) {
    event.preventDefault();
    $("#" + id).click();
  }
};

$("#video-import").onclick = () => $("#video-sources").click();
$("#video-sources").onchange = async ({ target }) => {
  const files = [...target.files];
  target.value = "";
  try {
    await importFiles(files);
  } catch (error) {
    status(uiError(error), true);
  }
};
$("#video-audio-files").onchange = async ({ target }) => {
  const files = [...target.files];
  target.value = "";
  try {
    await importFiles(files, null, undefined, false, "audio");
  } catch (error) {
    status(
      error.cause ? uiMsg(error.message, [error.cause]) : uiError(error),
      true,
    );
  }
};
receiveHandoff(
  "video-studio",
  (payload, current) =>
    importFiles([payload.files[0]], payload.files[1], current, true),
  () => Object.keys(sources).length > 0,
);

$("#video-play").onclick = () => {
  if (isBusy()) return;
  if (transport.playing) showFrame(cursor);
  else {
    $("#video-preview-audio-status").hidden = true;
    monitor.unlock();
    transport.play(plan, sources, cues, cursor);
  }
};
$("#video-monitor-mute").onclick = () => {
  monitorMuted = !monitorMuted;
  monitor.setMuted(monitorMuted);
  const b = $("#video-monitor-mute");
  videoIcon(
    b,
    monitorMuted ? "mute" : "sound",
    monitorMuted ? "Unmute preview" : "Mute preview",
  );
  b.setAttribute("aria-pressed", monitorMuted);
};
$("#video-back-frame").onclick = () =>
  showFrame(Math.round(cursor / step()) * step() - step());
$("#video-next-frame").onclick = () =>
  showFrame(Math.round(cursor / step()) * step() + step());
$("#video-retry-preview").onclick = () => showFrame(cursor);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && transport.playing) transport.pause();
});
for (const input of [resolution, quality, orientation, fps])
  input.onchange = () => {
    $("#video-stage").dataset.orientation = orientation.value;
    invalidate();
    if (input === fps || input === orientation) showFrame(cursor);
    updateFormats();
  };
format.onchange = $("#video-burn").onchange = invalidate;
for (const type of ["srt", "vtt"])
  $("#video-" + type).onclick = () => {
    try {
      const target = captionLists.find(
        (t) => t.id === $("#video-caption-download").value,
      );
      if (target?.cues.length)
        downloadText(
          serialize(target.cues, type),
          "kensei-video" +
            (target.id === "source" ? "" : "-" + target.id) +
            "." +
            type,
        );
    } catch (error) {
      status(uiError(error), true);
    }
  };
prepare.onclick = () => {
  if (
    isBusy() ||
    !plan ||
    !available.includes(format.value) ||
    estimatedBytes() > outputLimit
  )
    return;
  transport.pause();
  const job = (running = worker());
  waveWorker?.cancel();
  const done = (message, error = false) => {
    if (job !== running) return;
    job.terminate();
    running = null;
    progress.hidden = true;
    busy(false);
    updateSummary();
    status(message, error);
    scanWaveforms();
  };
  busy(true);
  progress.hidden = false;
  progress.value = 0;
  status(uiMsg("Encoding video on this device…"));
  job.onmessage = ({ data }) => {
    if (job !== running) return;
    if (data.type === "progress") progress.value = data.value;
    if (data.type === "error")
      done(data.file ? uiMsg(data.message, [data.file]) : uiError(data), true);
    if (data.type === "finished") {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      $("#video-result-previous").hidden = true;
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
    audioClips,
    levels,
    ...settings(),
    format: format.value,
    tracks,
    burnTracks: $("#video-burn").checked
      ? burnCaptions.filter((id) => captionLists.some((t) => t.id === id))
      : [],
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
  scanWaveforms();
};
window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    transport.pause();
    return;
  }
  leaving = true;
  transport.discard();
  running?.terminate();
  probeWorker?.cancel();
  formatWorker?.cancel();
  waveWorker?.cancel();
  monitor.release();
  mediaCache.forEach((asset) => URL.revokeObjectURL(asset.url));
  if (resultUrl) URL.revokeObjectURL(resultUrl);
});
renderSources();
refreshTimeline();
