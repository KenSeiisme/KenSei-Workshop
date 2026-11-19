import { frameMs, frameRate, timelinePosition } from "./video-timeline.js";

const epsilon = 0.004;

function loadFrame(slot, asset, sourceMs) {
  if (slot.url === asset.url && slot.sourceMs === sourceMs && slot.task)
    return slot.task;
  slot.abort?.abort();
  const video = slot.video;
  const abort = new AbortController();
  const signal = abort.signal;
  slot.abort = abort;
  slot.sourceMs = sourceMs;
  slot.task = new Promise((resolve, reject) => {
    const loaded =
      video.readyState > 0 && !video.error && slot.url === asset.url;
    let time = null;
    function finish(error) {
      clearTimeout(timeout);
      for (const type of ["loadedmetadata", "loadeddata", "seeked", "canplay"])
        video.removeEventListener(type, ready);
      video.removeEventListener("error", fail);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(!signal.aborted);
    }
    const fail = () =>
      finish(Error("The source video could not be previewed."));
    const cancel = () => finish();
    const timeout = setTimeout(fail, 8000);
    function ready() {
      if (video.readyState === 0) return;
      if (time === null) {
        slot.offset = video.seekable.length ? video.seekable.start(0) : 0;
        const limit = Number.isFinite(video.duration)
          ? video.duration - epsilon
          : Infinity;
        time = Math.max(
          slot.offset,
          Math.min(limit, slot.offset + sourceMs / 1000),
        );
        if (Math.abs(video.currentTime - time) > 0.001 || video.seeking)
          video.currentTime = time;
      }
      if (
        !video.seeking &&
        video.readyState >= 2 &&
        Math.abs(video.currentTime - time) <= epsilon
      )
        finish();
    }
    signal.addEventListener("abort", cancel, { once: true });
    for (const type of ["loadedmetadata", "loadeddata", "seeked", "canplay"])
      video.addEventListener(type, ready);
    video.addEventListener("error", fail);
    if (loaded) ready();
    else {
      slot.url = video.src = asset.url;
      video.load();
    }
  }).catch((error) => {
    if (slot.abort === abort) slot.task = null;
    throw error;
  });
  return slot.task;
}

export function createVideoPreview(
  elements,
  { onFrame, onState, onError, onAudioFrame, onSilence },
) {
  const { players, caption, empty } = elements;
  const slots = players.map((video) => ({ video, offset: 0 }));
  let front = null,
    presented = null,
    revision = 0;
  let animation,
    videoFrame,
    framePlayer,
    loading,
    playing = false;
  let finishSegment;

  function state() {
    onState(playing);
  }
  function cancelLoad(slot) {
    slot.abort?.abort();
    slot.task = null;
  }
  function pause() {
    ++revision;
    clearTimeout(loading);
    cancelAnimationFrame(animation);
    framePlayer?.cancelVideoFrameCallback?.(videoFrame);
    framePlayer = null;
    finishSegment?.();
    finishSegment = null;
    for (const slot of slots) {
      slot.video.pause();
      cancelLoad(slot);
    }
    playing = false;
    onSilence();
    state();
  }
  function unload(slot) {
    cancelLoad(slot);
    slot.video.pause();
    slot.video.removeAttribute("src");
    slot.video.load();
    slot.url = null;
  }
  function discard(url) {
    pause();
    for (const slot of slots) {
      if (url && slot.url !== url) continue;
      unload(slot);
      if (slot === front) {
        front = null;
        presented = null;
        delete slot.video.dataset.front;
        empty.hidden = false;
        caption.hidden = true;
      }
    }
  }
  function subtitles(cues, frame) {
    const ms = frameMs(frame);
    const text = cues
      .filter((c) => c.start <= ms && ms < c.end)
      .map((c) => c.text)
      .join("\n");
    if (caption.textContent !== text) caption.textContent = text;
    caption.hidden = !text;
  }
  const standby = () => slots.find((slot) => slot !== front);
  function reveal(slot, asset, position, cues) {
    const old = front;
    if (old && old !== slot) {
      old.video.pause();
      delete old.video.dataset.front;
    }
    front = slot;
    front.video.dataset.front = "";
    empty.hidden = true;
    presented = { url: asset.url, sourceMs: position.sourceMs };
    subtitles(cues, position.frame);
  }
  async function show(plan, sources, cues, frame) {
    pause();
    const token = revision;
    const position = timelinePosition(plan, frame);
    if (!position) return;
    const asset = sources[position.segment.source];
    if (
      presented?.url === asset.url &&
      presented.sourceMs === position.sourceMs
    ) {
      subtitles(cues, position.frame);
      onError();
      return;
    }
    const slot = standby();
    loading = setTimeout(() => onError(null, true), 180);
    try {
      if (
        (await loadFrame(slot, asset, position.sourceMs)) &&
        token === revision
      ) {
        reveal(slot, asset, position, cues);
        onError();
      }
    } catch (error) {
      if (token === revision) onError(error);
    } finally {
      if (token === revision) clearTimeout(loading);
    }
  }

  function segmentPlayback(slot, position, cues, token) {
    const video = slot.video;
    const { segment } = position;
    const end = Math.min(
      segment.end,
      segment.start + (segment.frames * 1000) / frameRate,
    );
    const paint = (mediaTime) => {
      const elapsed = (mediaTime - slot.offset) * 1000 - segment.start;
      const offset = Math.max(
        0,
        Math.min(segment.frames - 1, Math.floor((elapsed * frameRate) / 1000)),
      );
      const positionFrame = Math.max(
        position.frame,
        segment.firstFrame + offset,
      );
      presented = {
        url: slot.url,
        sourceMs: (video.currentTime - slot.offset) * 1000,
      };
      onFrame(positionFrame);
      subtitles(cues, positionFrame);
    };
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        cancelAnimationFrame(animation);
        video.cancelVideoFrameCallback?.(videoFrame);
        framePlayer = null;
        video.removeEventListener("error", fail);
        finishSegment = null;
        if (error) reject(error);
        else resolve();
      };
      const fail = () =>
        finish(Error("The source video could not be previewed."));
      finishSegment = finish;
      video.addEventListener("error", fail);
      if (video.requestVideoFrameCallback) {
        framePlayer = video;
        const next = (_, info) => {
          if (token !== revision) return;
          paint(info.mediaTime);
          videoFrame = video.requestVideoFrameCallback(next);
        };
        videoFrame = video.requestVideoFrameCallback(next);
      }
      // The transport also checks trim boundaries between decoded frames.
      function tick() {
        if (
          token !== revision ||
          video.ended ||
          (video.currentTime - slot.offset) * 1000 >= end
        ) {
          finish();
          return;
        }
        if (!video.requestVideoFrameCallback) paint(video.currentTime);
        if (video.readyState < 3 || video.seeking || video.paused) onSilence();
        else
          onAudioFrame(
            segment.firstFrame +
              Math.max(
                0,
                Math.min(
                  segment.frames,
                  (((video.currentTime - slot.offset) * 1000 - segment.start) *
                    frameRate) /
                    1000,
                ),
              ),
            video,
          );
        animation = requestAnimationFrame(tick);
      }
      tick();
    });
  }
  async function play(plan, sources, cues, frame) {
    pause();
    if (!plan?.frames) return;
    if (frame >= plan.frames) frame = 0;
    const token = revision;
    playing = true;
    state();
    onError();
    try {
      while (frame < plan.frames && token === revision) {
        const position = timelinePosition(plan, frame);
        const { segment } = position;
        const asset = sources[segment.source];
        const reuse =
          front &&
          presented?.url === asset.url &&
          Math.abs(presented.sourceMs - position.sourceMs) < 1;
        const slot = reuse ? front : standby();
        if (!reuse) {
          if (
            slot.video.readyState < 2 ||
            slot.video.seeking ||
            slot.url !== asset.url
          )
            onSilence();
          if (!(await loadFrame(slot, asset, position.sourceMs))) return;
        }
        if (token !== revision) return;
        reveal(slot, asset, position, cues);
        onFrame(position.frame);
        const next = plan.segments[position.index + 1];
        if (next)
          loadFrame(standby(), sources[next.source], next.start).catch(
            () => {},
          );
        slot.task = null;
        await slot.video.play();
        if (token !== revision) return;
        await segmentPlayback(slot, position, cues, token);
        if (token !== revision) return;
        slot.video.pause();
        frame = segment.firstFrame + segment.frames;
      }
      if (token === revision) {
        onFrame(plan.frames);
        await show(plan, sources, cues, plan.frames);
      }
    } catch (error) {
      if (token === revision) {
        pause();
        onError(error);
      }
    }
  }
  return {
    pause,
    discard,
    play,
    show,
    get playing() {
      return playing;
    },
  };
}
