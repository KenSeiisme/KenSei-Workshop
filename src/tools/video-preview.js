import { exactMs, units } from "./video-timeline.js";
import { layersAt, captionText, paintCaptions } from "./video-assembly.js";

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
  { players, caption, empty, step },
  { onFrame, onState, onError, onAudioFrame, onSilence, onLayers },
) {
  const banks = new Map(
    [...players].map(([id, videos]) => [
      id,
      {
        slots: videos.map((video) => ({ video, offset: 0 })),
        front: null,
        clip: null,
      },
    ]),
  );
  let revision = 0,
    animation,
    loading,
    playing = false,
    lastCaptions = [];
  const fronts = new Map();
  const clear = (slot) => {
    slot.abort?.abort();
    slot.task = null;
  };
  const hide = (slot) => {
    if (!slot) return;
    slot.video.pause();
    delete slot.video.dataset.front;
  };
  const paintText = (texts) => {
    lastCaptions = texts;
    caption.textContent = texts.filter(Boolean).join("\n");
    const rect = caption.parentElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(2, globalThis.devicePixelRatio || 1);
    const width = Math.round(rect.width * scale),
      height = Math.round(rect.height * scale);
    if (caption.width !== width || caption.height !== height) {
      caption.width = width;
      caption.height = height;
    }
    caption.hidden = !texts.some(Boolean);
    const ctx = caption.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    if (!caption.hidden) paintCaptions(ctx, texts, width, height);
  };
  new ResizeObserver(() => paintText(lastCaptions)).observe(
    caption.parentElement,
  );
  const subtitles = (tracks, frame) => {
    const texts = captionText(tracks, exactMs(frame));
    if (
      texts.length !== lastCaptions.length ||
      texts.some((value, i) => value !== lastCaptions[i])
    )
      paintText(texts);
  };

  function pause() {
    revision++;
    clearTimeout(loading);
    cancelAnimationFrame(animation);
    for (const bank of banks.values())
      for (const slot of bank.slots) {
        slot.video.pause();
        clear(slot);
      }
    playing = false;
    onSilence();
    onState(false);
  }

  function discard(url) {
    pause();
    for (const [id, bank] of banks)
      for (const slot of bank.slots) {
        if (url && slot.url !== url) continue;
        hide(slot);
        if (bank.front === slot) {
          bank.front = bank.clip = null;
          fronts.delete(id);
        }
        slot.video.removeAttribute("src");
        slot.video.load();
        slot.url = null;
      }
    if (!fronts.size) {
      empty.hidden = false;
      paintText([]);
    }
  }

  async function reveal(plan, sources, tracks, frame, token, play) {
    const positions = layersAt(plan, frame);
    const pending = await Promise.all(
      positions.map(async ({ id, clip, sourceMs }) => {
        if (!clip) return { id, clip };
        const bank = banks.get(id);
        const slot =
          play && bank.clip === clip
            ? bank.front
            : bank.slots.find((slot) => slot !== bank.front);
        if (
          slot !== bank.front &&
          !(await loadFrame(slot, sources[clip.source], sourceMs))
        )
          return null;
        return { id, clip, slot };
      }),
    );
    if (token !== revision || pending.some((slot) => !slot)) return false;
    for (const [id, bank] of banks) {
      const next = pending.find((item) => item.id === id);
      if (!next?.slot) {
        hide(bank.front);
        bank.front = bank.clip = null;
        fronts.delete(id);
        continue;
      }
      const { slot, clip } = next;
      if (slot !== bank.front) hide(bank.front);
      bank.front = slot;
      bank.clip = clip;
      fronts.set(id, slot.video);
      const style = slot.video.style;
      const { x, y, size } = clip.box;
      style.left = x * 100 + "%";
      style.top = y * 100 + "%";
      style.width = size * 100 + "%";
      style.height = size * 100 + "%";
      style.zIndex = positions.findIndex((p) => p.id === id) + 1;
      slot.video.dataset.front = "";
      slot.video.dataset.layer = id;
      if (play && slot.video.paused) await slot.video.play();
      if (token !== revision) return false;
    }
    empty.hidden = true;
    subtitles(tracks, frame);
    onLayers?.(positions);
    if (play) {
      for (const { id, clips } of plan.layers) {
        const bank = banks.get(id);
        const next = clips.find(
          (clip) => clip.at > frame && clip.at - frame < 45,
        );
        if (next && bank.front)
          loadFrame(
            bank.slots.find((slot) => slot !== bank.front),
            sources[next.source],
            next.start,
          ).catch(() => {});
      }
    }
    return true;
  }
  const sampleFrame = (plan, frame) =>
    Math.max(
      0,
      Math.min(
        frame,
        Math.max(0, (Math.ceil(plan.frames / step() - 1e-8) - 1) * step()),
      ),
    );
  async function show(plan, sources, tracks, frame) {
    pause();
    if (!plan) return;
    const token = revision;
    loading = setTimeout(() => onError(null, true), 180);
    try {
      if (
        await reveal(
          plan,
          sources,
          tracks,
          sampleFrame(plan, frame),
          token,
          false,
        )
      )
        onError();
    } catch (error) {
      if (token === revision) onError(error);
    } finally {
      if (token === revision) clearTimeout(loading);
    }
  }
  async function play(plan, sources, tracks, frame) {
    pause();
    if (!plan) return;
    if (frame >= plan.frames) frame = 0;
    const token = revision;
    playing = true;
    onState(true);
    onError();
    const fail = (error) => {
      if (token !== revision) return;
      pause();
      onError(error);
    };
    try {
      if (!(await reveal(plan, sources, tracks, frame, token, true))) return;
      let origin = performance.now() - exactMs(frame);
      const tick = async (now) => {
        if (token !== revision) return;
        const at = Math.max(0, units(now - origin));
        if (at >= plan.frames) {
          onFrame(plan.frames);
          await show(plan, sources, tracks, plan.frames);
          return;
        }
        const positions = layersAt(plan, at);
        try {
          if (
            positions.some(
              ({ id, clip }) => (clip || null) !== banks.get(id).clip,
            )
          ) {
            onSilence();
            for (const bank of banks.values()) bank.front?.video.pause();
            const changes = positions.filter(
              ({ id, clip }) => (clip || null) !== banks.get(id).clip,
            );
            const bound = Math.max(
              frame,
              ...changes.map(
                ({ id, clip }) => clip?.at ?? banks.get(id).clip?.stop ?? at,
              ),
            );
            if (
              !(await reveal(
                plan,
                sources,
                tracks,
                Math.min(at, bound),
                token,
                true,
              ))
            )
              return;
            origin = performance.now() - exactMs(Math.min(at, bound));
          } else {
            for (const { id, clip, sourceMs } of positions) {
              if (!clip) continue;
              const { video, offset } = banks.get(id).front;
              const expected = offset + sourceMs / 1000;
              if (
                !video.seeking &&
                Math.abs(video.currentTime - expected) > 0.12
              )
                video.currentTime = expected;
            }
          }
          frame =
            Math.floor(units(performance.now() - origin) / step()) * step();
          onFrame(Math.min(frame, plan.frames));
          subtitles(tracks, frame);
          if (
            [...fronts.values()].some(
              (video) => video.readyState < 2 || video.seeking,
            )
          )
            onSilence();
          else onAudioFrame(frame, fronts);
          animation = requestAnimationFrame(tick);
        } catch (error) {
          fail(error);
        }
      };
      animation = requestAnimationFrame(tick);
    } catch (error) {
      fail(error);
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
