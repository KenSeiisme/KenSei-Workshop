import { $, size, downloadText, status, busy } from "./common.js";
import { button, el, field, row } from "./advanced-ui.js";
import { receiveHandoff } from "./handoff.js";
import { uiAttr, uiMsg, uiError, uiText, uiOption } from "../site/ui.js";
import { parseSubtitles, serialize } from "./subtitle-core.js";
import {
  containers,
  exportSettings,
  makeTimeline,
  timelineCues,
  videoLimits,
} from "./video-timeline.js";

const root = $("[data-tool]");
const sourceList = $("#video-source-list"),
  list = $("#video-clips");
const preview = $("#video-preview"),
  caption = $("#video-caption");
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
let clipPreview = 0,
  animation = 0,
  resultUrl,
  activeUrl,
  importing = false;
let finishClip, cancelSeek;
const worker = () =>
  new Worker("/tool-scripts/video-export-worker.js", { type: "module" });
const settings = () => ({
  resolution: resolution.value,
  quality: quality.value,
  orientation: orientation.value,
});
const timeline = () => makeTimeline(clips, sources);

function invalidate() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  $("#video-result").hidden = true;
  const result = $("#video-result-player");
  result.hidden = true;
  result.removeAttribute("src");
  result.load();
}
function stopPreview() {
  clipPreview++;
  cancelAnimationFrame(animation);
  finishClip?.();
  finishClip = null;
  cancelSeek?.();
  cancelSeek = null;
  $("#video-stop").disabled = true;
  preview.pause();
  caption.hidden = true;
}

function request(task, receive) {
  const job = worker();
  const promise = new Promise((resolve, reject) => {
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
  return { job, promise };
}
async function importFiles(
  files,
  sidecar,
  current = () => true,
  replace = false,
) {
  if (!files.length || importing) return false;
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
  )
    throw Error(
      "Choose up to six MP4 or WebM files, 250 MB each and 500 MB in total.",
    );
  const imported = {};
  const cues = sidecar ? parseSubtitles(await sidecar.text()) : [];
  const token = ++generation;
  importing = true;
  stopPreview();
  busy(true);
  try {
    for (const file of files) {
      status(uiMsg("Reading {0}…", [file.name]));
      const { job, promise } = request({ action: "probe", file }, "metadata");
      probeWorker = job;
      let metadata;
      try {
        metadata = await promise;
      } finally {
        job.terminate();
      }
      if (token !== generation || !current()) return false;
      imported[crypto.randomUUID()] = {
        file,
        ...metadata,
        cues: sidecar ? cues : [],
      };
    }
    if (!current()) return false;
    if (replace) {
      clips = [];
      preview.hidden = true;
      preview.removeAttribute("src");
    }
    for (const [id, source] of Object.entries(imported)) {
      source.url = URL.createObjectURL(source.file);
      if (clips.length === 0 && Object.keys(prior).length === 0)
        orientation.value = source.portrait ? "portrait" : "landscape";
      const used = clips.reduce((sum, c) => sum + c.end - c.start, 0);
      const end = Math.min(source.duration, videoLimits.outputMs - used);
      if (end > 0 && clips.length < videoLimits.clips)
        clips.push({ source: id, start: 0, end });
    }
    if (replace)
      Object.values(sources).forEach((a) => URL.revokeObjectURL(a.url));
    sources = { ...prior, ...imported };
    invalidate();
    status(uiMsg("Videos ready. Set the clips you want to keep."));
    return true;
  } finally {
    if (token === generation) {
      importing = false;
      probeWorker = null;
      busy(false);
      render();
    }
  }
}

function updateSummary() {
  let plan;
  try {
    plan = timeline();
  } catch {}
  const playable = !!plan && !running && !importing;
  prepare.disabled = !playable || !available.includes(format.value);
  $("#video-play").disabled = !playable;
  const hasCues = playable && timelineCues(plan, sources).length > 0;
  $("#video-srt").disabled = $("#video-vtt").disabled = !hasCues;
  const bytes = plan
    ? ((exportSettings(quality.value, resolution.value, orientation.value)
        .bitrate +
        128000) *
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
      : !clips.length
        ? uiMsg("Add a clip to begin.")
        : uiMsg("Check the clip times and five-minute limit."),
  );
}
async function updateFormats() {
  const token = ++choiceRevision;
  available = [];
  updateSummary();
  formatWorker?.terminate();
  if (!clips.length) return;
  uiText($("#video-availability"), uiMsg("Checking video encoders…"));
  const { job, promise } = request(
    {
      action: "formats",
      ...settings(),
      audio: clips.some((c) => sources[c.source].hasAudio),
    },
    "formats",
  );
  formatWorker = job;
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
    if (token === choiceRevision)
      uiText($("#video-availability"), uiError(error));
  } finally {
    job.terminate();
    if (token === choiceRevision) updateSummary();
  }
}
function changed() {
  stopPreview();
  invalidate();
  updateSummary();
}
function render() {
  sourceList.replaceChildren();
  for (const [id, asset] of Object.entries(sources)) {
    const card = el("div", "", { class: "video-item" }),
      title = el("strong");
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
        if (sources[id] !== asset) return;
        asset.cues = updated;
        uiText(count, uiMsg("{0} subtitle cues", [updated.length]));
        changed();
      } catch (error) {
        status(uiError(error), true);
      }
    };
    const add = button("Add clip", () => {
      if (clips.length >= videoLimits.clips)
        throw Error("Keep between one and twelve video clips.");
      clips.push({
        source: id,
        start: 0,
        end: Math.min(asset.duration, videoLimits.outputMs),
      });
      changed();
      render();
    });
    const remove = button("Remove source", () => {
      stopPreview();
      URL.revokeObjectURL(asset.url);
      if (activeUrl === asset.url) {
        preview.removeAttribute("src");
        preview.hidden = true;
        activeUrl = null;
      }
      delete sources[id];
      clips = clips.filter((c) => c.source !== id);
      changed();
      render();
    });
    card.append(
      title,
      row(add, remove),
      field("Source subtitles (SRT or VTT)", captions),
      count,
    );
    sourceList.append(card);
  }
  list.replaceChildren();
  clips.forEach((clip, i) => {
    const source = sources[clip.source],
      card = el("div", "", { class: "video-item" }),
      title = el("strong");
    uiText(title, uiMsg("Clip {0}: {1}", [i + 1, source.file.name]));
    // Both inputs are retained while moving a trim handle.
    const limit = (key, label) => {
      const group = el("div", "", { class: "video-time" });
      const input = el("input", "", {
        type: "number",
        min: 0,
        max: source.duration / 1000,
        step: 0.001,
        value: clip[key] / 1000,
      });
      const range = el("input", "", {
        type: "range",
        min: 0,
        max: source.duration / 1000,
        step: 0.001,
        value: clip[key] / 1000,
        "aria-label": label,
      });
      const edit = (from, to) => {
        clip[key] =
          from.value === "" ? NaN : Math.round(Number(from.value) * 1000);
        if (from.value !== "") to.value = from.value;
        changed();
      };
      input.oninput = () => edit(input, range);
      range.oninput = () => edit(range, input);
      group.append(field(label, input), range);
      return group;
    };
    const move = (offset, label) => {
      const b = button(label, () => {
        const j = i + offset;
        [clips[i], clips[j]] = [clips[j], clips[i]];
        changed();
        render();
        list.children[j]?.querySelector("button")?.focus();
      });
      b.disabled = i + offset < 0 || i + offset >= clips.length;
      return b;
    };
    card.append(
      title,
      limit("start", "Clip start (seconds)"),
      limit("end", "Clip end (seconds)"),
      row(
        move(-1, "Move earlier"),
        move(1, "Move later"),
        button("Remove clip", () => {
          clips.splice(i, 1);
          changed();
          render();
        }),
      ),
    );
    list.append(card);
  });
  updateFormats();
}
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

async function seek(asset, seconds) {
  const next = new Promise((resolve, reject) => {
    const controller = new AbortController();
    const finish = (error) => {
      clearTimeout(timer);
      controller.abort();
      cancelSeek = null;
      if (error) reject(error);
      else resolve();
    };
    cancelSeek = () => finish();
    const timer = setTimeout(
      () => finish(Error("The source video could not be previewed.")),
      10000,
    );
    const options = { once: true, signal: controller.signal };
    const at = () => {
      if (Math.abs(preview.currentTime - seconds) < 0.001) finish();
      else {
        preview.addEventListener("seeked", () => finish(), options);
        preview.currentTime = seconds;
      }
    };
    preview.addEventListener(
      "error",
      () => finish(Error("The source video could not be previewed.")),
      options,
    );
    if (activeUrl === asset.url && preview.readyState > 0) at();
    else {
      preview.addEventListener("loadedmetadata", at, options);
      preview.src = activeUrl = asset.url;
      preview.load();
    }
  });
  await next;
}
$("#video-play").onclick = async () => {
  stopPreview();
  const token = clipPreview;
  const plan = timeline();
  preview.hidden = false;
  $("#video-stop").disabled = false;
  try {
    for (const segment of plan.segments) {
      const asset = sources[segment.source];
      await seek(asset, segment.start / 1000);
      if (token !== clipPreview) return;
      await preview.play();
      await new Promise((resolve) => {
        finishClip = resolve;
        function tick() {
          if (
            token !== clipPreview ||
            preview.ended ||
            preview.currentTime * 1000 >= segment.end
          ) {
            resolve();
            return;
          }
          const text = asset.cues
            .filter(
              (c) =>
                c.start <= preview.currentTime * 1000 &&
                c.end > preview.currentTime * 1000,
            )
            .map((c) => c.text)
            .join("\n");
          caption.hidden = !text;
          caption.textContent = text;
          animation = requestAnimationFrame(tick);
        }
        tick();
      });
      if (token !== clipPreview) return;
      finishClip = null;
      preview.pause();
    }
  } catch (error) {
    if (token === clipPreview) status(uiError(error), true);
  } finally {
    if (token === clipPreview) {
      stopPreview();
      $("#video-stop").disabled = true;
    }
  }
};
$("#video-stop").onclick = () => {
  stopPreview();
  $("#video-stop").disabled = true;
};
for (const input of [resolution, quality, orientation])
  input.onchange = () => {
    invalidate();
    updateFormats();
  };
format.onchange = $("#video-burn").onchange = invalidate;
for (const type of ["srt", "vtt"])
  $("#video-" + type).onclick = () => {
    try {
      downloadText(
        serialize(timelineCues(timeline(), sources), type),
        "kensei-video." + type,
      );
    } catch (error) {
      status(uiError(error), true);
    }
  };
prepare.onclick = () => {
  if (running || !available.includes(format.value)) return;
  stopPreview();
  invalidate();
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
  probeWorker?.terminate();
  probeWorker = null;
  running?.terminate();
  running = null;
  progress.hidden = true;
  busy(false);
  updateSummary();
  status(uiMsg("Cancelled."));
};
window.addEventListener("pagehide", () => {
  stopPreview();
  running?.terminate();
  probeWorker?.terminate();
  formatWorker?.terminate();
  Object.values(sources).forEach((a) => URL.revokeObjectURL(a.url));
  if (resultUrl) URL.revokeObjectURL(resultUrl);
});
render();
