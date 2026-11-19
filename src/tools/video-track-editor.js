import { $ } from "./common.js";
import { el } from "./advanced-ui.js";
import { uiAttr, uiMsg, uiText } from "../site/ui.js";
import { frameMs, frameRate, makeTimeline } from "./video-timeline.js";
import {
  audioLanes,
  audioLength,
  maxFrames,
  validateAudioClips,
} from "./video-mix.js";
import { videoIcon } from "./video-icons.js";

const zoomLevels = [1, 2, 4, 8];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function timecode(ms) {
  return (
    String(Math.floor(ms / 60000)).padStart(2, "0") +
    ":" +
    String(Math.floor(ms / 1000) % 60).padStart(2, "0") +
    "." +
    String(ms % 1000).padStart(3, "0")
  );
}

export function createVideoTrack({
  seek,
  pause,
  select,
  commit,
  commitAudio,
  isBusy,
  snapping,
  message,
}) {
  const scroll = $("#video-scroll"),
    track = $("#video-track");
  const ruler = $("#video-ruler"),
    lane = $("#video-lane");
  const needle = $("#video-needle"),
    insert = $("#video-insert"),
    snap = $("#video-snap-line");
  const endMark = $("#video-video-end"),
    audioRows = audioLanes.map((id) => $("#video-audio-lane-" + id));
  let plan = null,
    clips = [],
    audio = [],
    sources = {},
    frame = 0,
    selected;
  let zoom = 0,
    gesture,
    motion = 0;
  const clipNodes = new Map();
  function extent(layout = plan) {
    return Math.max(
      1,
      layout?.frames || 0,
      ...audio.map((clip) => clip.at + audioLength(clip)),
    );
  }
  function percent(value, layout) {
    return (100 * value) / extent(layout) + "%";
  }
  function waveform(clip) {
    const canvas = clipNodes.get(clip.id)?.querySelector("canvas");
    const asset = sources[clip.source],
      peaks = asset?.peaks;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#5b3582";
    for (let x = 0; x < canvas.width; x++) {
      const at = clip.start + ((clip.end - clip.start) * x) / canvas.width;
      const height = Math.max(
        1,
        peaks[
          Math.min(
            peaks.length - 1,
            Math.floor((at / asset.duration) * peaks.length),
          )
        ] * canvas.height,
      );
      ctx.fillRect(x, (canvas.height - height) / 2, 1, height);
    }
  }
  function paintAudio(clip) {
    const node = clipNodes.get(clip.id);
    const length = audioLength(clip);
    node.style.left = percent(clip.at, plan);
    node.style.width = percent(length, plan);
    node.style.setProperty(
      "--audio-tail",
      Math.max(
        0,
        Math.min(100, (100 * ((plan?.frames || 0) - clip.at)) / length),
      ) + "%",
    );
    node.toggleAttribute(
      "data-narrow",
      (track.clientWidth * length) / extent() <
        (matchMedia("(max-width: 768px), (pointer: coarse)").matches
          ? 150
          : 74),
    );
  }
  function snapped(at, id) {
    snap.hidden = true;
    if (!snapping()) return at;
    let mark = null,
      distance = (8 * extent()) / track.clientWidth;
    const edges = [frame, 0, plan?.frames || 0];
    for (const [i, s] of (plan?.segments || []).entries())
      if (clips[i].id !== id) edges.push(s.firstFrame, s.firstFrame + s.frames);
    for (const c of audio)
      if (c.id !== id) edges.push(c.at, c.at + audioLength(c));
    for (const edge of edges) {
      const delta = Math.abs(edge - at);
      if (delta <= distance) {
        distance = delta;
        mark = edge;
      }
    }
    if (mark === null) return at;
    snap.style.left = percent(mark, plan);
    snap.hidden = false;
    return mark;
  }
  function paintPosition(newFrame, layout = plan, reveal = false) {
    if (layout === plan) frame = clamp(newFrame, 0, layout?.frames || 0);
    const shown = clamp(newFrame, 0, layout?.frames || 0);
    const label = timecode(frameMs(shown));
    ruler.setAttribute("aria-valuemax", layout?.frames || 0);
    ruler.setAttribute("aria-valuenow", shown);
    ruler.setAttribute("aria-valuetext", label);
    const clock = label + " / " + timecode(layout?.duration || 0);
    if ($("#video-timecode").textContent !== clock)
      $("#video-timecode").textContent = clock;
    needle.hidden = !layout;
    if (!layout) return;
    needle.style.left = percent(shown, layout);
    if (reveal) {
      const x = (shown / extent(layout)) * track.clientWidth;
      if (
        x < scroll.scrollLeft ||
        x > scroll.scrollLeft + scroll.clientWidth - 4
      )
        scroll.scrollLeft = x - scroll.clientWidth * 0.3;
    }
  }
  function paintGeometry(layout = plan) {
    endMark.hidden = !audio.length || extent(layout) <= (layout?.frames || 0);
    endMark.style.left = percent(layout?.frames || 0, layout);
    for (const clip of audio) paintAudio(clip);
    if (!layout) return;
    const width = track.clientWidth;
    const required = matchMedia("(max-width: 768px), (pointer: coarse)").matches
      ? 150
      : 74;
    for (const [i, { firstFrame, frames }] of layout.segments.entries()) {
      const node = clipNodes.get(clips[i].id);
      node.style.left = percent(firstFrame, layout);
      node.style.width = percent(frames, layout);
      node.toggleAttribute(
        "data-narrow",
        (width * frames) / extent(layout) < required,
      );
    }
  }
  function ticks() {
    ruler.replaceChildren();
    if (!plan && !audio.length) return;
    const parts = Math.min(
      extent(),
      3 * zoomLevels[zoom],
      Math.max(1, Math.floor(track.clientWidth / 110)),
    );
    for (let i = 0; i <= parts; i++) {
      const at = Math.round((i * extent()) / parts);
      const node = el("span", "", {
        class: "video-tick",
        "aria-hidden": "true",
      });
      const ms = frameMs(at);
      node.textContent =
        ms % 1000 === 0 ? timecode(ms).slice(0, -4) : timecode(ms);
      node.style.left = percent(at, plan);
      ruler.append(node);
    }
  }
  function setZoom(level) {
    if (!plan || isBusy()) return;
    zoom = clamp(level, 0, zoomLevels.length - 1);
    track.style.setProperty("--video-zoom", zoomLevels[zoom]);
    ticks();
    paintGeometry();
    paintPosition(frame, plan, true);
    $("#video-zoom-in").disabled = zoom === zoomLevels.length - 1;
    $("#video-zoom-out").disabled = zoom === 0;
    $("#video-fit").disabled = zoom === 0;
  }
  function markSelected(id) {
    selected = id;
    for (const [key, node] of clipNodes) {
      node.toggleAttribute("data-selected", key === id);
      node
        .querySelector(".video-clip-body")
        .setAttribute("aria-pressed", key === id);
    }
  }
  function frameAt(clientX, layout = plan) {
    const rect = track.getBoundingClientRect();
    return clamp(
      Math.round(((clientX - rect.left) / rect.width) * extent(layout)),
      0,
      extent(layout),
    );
  }
  function updatePointer(active) {
    const { x, type } = active;
    if (type === "seek") {
      const next = Math.min(plan.frames, frameAt(x));
      if (active.frame === next) return;
      active.frame = next;
      seek(next);
      return;
    }
    if (active.audio) {
      const clip = audio[active.index];
      const length = audioLength(clip);
      const change =
        ((x - active.from + scroll.scrollLeft - active.scroll) * active.span) /
        active.width;
      const delta = Math.round(change);
      let updated = clip;
      if (type === "move") {
        const row = audioRows.find((row) => {
          const box = row.getBoundingClientRect();
          return active.y >= box.top && active.y < box.bottom;
        });
        const at = clamp(
          snapped(clip.at + delta, clip.id),
          0,
          maxFrames - length,
        );
        updated = {
          ...clip,
          at,
          lane: Number(row?.dataset.audioLane || clip.lane),
        };
      } else if (type === "start") {
        const shift = snapped(clip.at + delta, clip.id) - clip.at;
        const start = clamp(clip.start + frameMs(shift), 0, clip.end - 1);
        updated = {
          ...clip,
          start,
          at: clip.at + length - audioLength({ ...clip, start }),
        };
      } else {
        const stop = snapped(clip.at + length + delta, clip.id);
        const end = clamp(
          clip.end + frameMs(stop - clip.at - length),
          clip.start + 1,
          sources[clip.source].duration,
        );
        updated = { ...clip, end };
      }
      const drafts = audio.with(active.index, updated);
      try {
        validateAudioClips(drafts, sources);
        active.invalid = false;
        active.draft = drafts;
        const node = clipNodes.get(clip.id);
        const current = audioRows[clip.lane - 1].getBoundingClientRect();
        const nextRow = audioRows[updated.lane - 1].getBoundingClientRect();
        node.style.transform =
          "translateY(" + (nextRow.top - current.top) + "px)";
        node.toggleAttribute("data-dragging", true);
        paintAudio(updated);
        message("");
      } catch (error) {
        active.invalid = true;
        message(error.message, true);
      }
      return;
    }
    const current =
      type === "move"
        ? snapped(frameAt(x), clips[active.index].id)
        : frameAt(x);
    if (type === "move") {
      let drop = clips.length;
      for (const [i, segment] of plan.segments.entries()) {
        if (current < segment.firstFrame + segment.frames / 2) {
          drop = i;
          break;
        }
      }
      active.drop = drop;
      insert.style.left = percent(
        plan.segments[drop]?.firstFrame ?? plan.frames,
        plan,
      );
      insert.hidden = false;
      return;
    }
    const clip = clips[active.index];
    const delta = Math.round(
      ((x - active.from + scroll.scrollLeft - active.scroll) * active.span) /
        active.width,
    );
    const segment = plan.segments[active.index];
    const end = segment.firstFrame + segment.frames;
    const direction = type === "start" ? -1 : 1;
    const change =
      (snapped(end + delta * direction, clip.id) - end) * direction;
    const next = clip[type] + frameMs(change);
    const minLength = Math.min(frameMs(1), clip.end - clip.start);
    const time =
      type === "start"
        ? clamp(next, 0, clip.end - minLength)
        : clamp(next, clip.start + minLength, sources[clip.source].duration);
    if (active.attempt === time) return;
    active.attempt = time;
    const drafted = clips.with(active.index, { ...clip, [type]: time });
    let layout;
    try {
      layout = makeTimeline(drafted, sources);
    } catch {
      active.invalid = true;
      showTrimLimit();
      return;
    }
    if (active.invalid) $("#video-edit-status").hidden = true;
    active.invalid = false;
    active.draft = drafted;
    const { firstFrame, frames } = layout.segments[active.index];
    active.frame = type === "start" ? firstFrame : firstFrame + frames - 1;
    paintGeometry(layout);
    paintPosition(active.frame, layout);
    seek(active.frame, layout);
  }
  function showTrimLimit() {
    const note = $("#video-edit-status");
    uiText(note, uiMsg("Keep the finished video to five minutes."));
    note.classList.add("error-text");
    note.hidden = false;
  }
  function runEdgeScroll() {
    if (!gesture) return;
    const view = scroll.getBoundingClientRect();
    const speed =
      gesture.x < view.left + 28 ? -9 : gesture.x > view.right - 28 ? 9 : 0;
    if (speed) {
      const previous = scroll.scrollLeft;
      scroll.scrollLeft += speed;
      if (scroll.scrollLeft !== previous) updatePointer(gesture);
    }
    motion = requestAnimationFrame(runEdgeScroll);
  }
  function start(event, type, index, audioClip) {
    if ((!plan && !audioClip) || gesture || isBusy() || event.button !== 0)
      return;
    if (
      event.pointerType !== "mouse" &&
      event.currentTarget.classList.contains("video-clip-body")
    )
      return;
    const target = event.currentTarget;
    const savedFrame = frame;
    target.focus({ preventScroll: true });
    if (index !== undefined)
      select((audioClip ? audio : clips)[index].id, false);
    pause();
    gesture = {
      type,
      index,
      audio: audioClip,
      y: event.clientY,
      fromY: event.clientY,
      span: extent(),
      target,
      pointer: event.pointerId,
      from: event.clientX,
      x: event.clientX,
      savedFrame,
      scroll: scroll.scrollLeft,
      width: track.clientWidth,
      moved: false,
    };
    target.setPointerCapture(event.pointerId);
    if (type === "seek") updatePointer(gesture);
    event.preventDefault();
  }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const active = gesture;
    active.x = event.clientX;
    active.moved ||=
      Math.hypot(active.x - active.from, event.clientY - active.fromY) >= 4;
    active.y = event.clientY;
    if (active.type !== "seek" && !active.moved) return;
    updatePointer(active);
    if (!motion) motion = requestAnimationFrame(runEdgeScroll);
  }
  function finish(event, cancelled = false) {
    if (
      !gesture ||
      (event?.pointerId !== undefined && event.pointerId !== gesture.pointer)
    )
      return;
    const active = gesture;
    gesture = null;
    cancelAnimationFrame(motion);
    motion = 0;
    insert.hidden = snap.hidden = true;
    if (active.target.hasPointerCapture(active.pointer))
      active.target.releasePointerCapture(active.pointer);
    if (active.audio) {
      const clip = audio[active.index];
      const replacement = active.draft?.[active.index];
      if (
        !cancelled &&
        active.moved &&
        !active.invalid &&
        replacement &&
        [
          replacement.at,
          replacement.start,
          replacement.end,
          replacement.lane,
        ].some(
          (value, i) => value !== [clip.at, clip.start, clip.end, clip.lane][i],
        )
      ) {
        commitAudio(active.draft, clip.id, active.type);
      } else {
        clipNodes.get(clip.id).style.transform = "";
        delete clipNodes.get(clip.id).dataset.dragging;
        paintAudio(clip);
        if (!active.moved && !cancelled) select(clip.id, true);
      }
      return;
    }
    if (cancelled) {
      paintGeometry();
      seek(active.savedFrame);
      return;
    }
    if (active.type === "seek") return;
    if (!active.moved) {
      select(clips[active.index].id, true);
      return;
    }
    if (active.type === "move" && active.drop !== undefined) {
      const to = active.drop > active.index ? active.drop - 1 : active.drop;
      if (to === active.index) return;
      const clip = clips[active.index];
      commit(
        clips.toSpliced(active.index, 1).toSpliced(to, 0, clip),
        clip.id,
        frame,
        "clip",
      );
    } else if (
      !active.invalid &&
      active.draft &&
      active.draft[active.index][active.type] !==
        clips[active.index][active.type]
    ) {
      const clip = clips[active.index];
      commit(active.draft, clip.id, active.frame, active.type);
    } else {
      paintGeometry();
      seek(active.savedFrame);
    }
  }
  function pointer(target, type, index, audioClip = false) {
    target.onpointerdown = (event) => start(event, type, index, audioClip);
    target.onpointermove = move;
    target.onpointerup = finish;
    target.onpointercancel = target.onlostpointercapture = (event) =>
      finish(event, true);
  }
  pointer(ruler, "seek");
  ruler.onkeydown = (event) => {
    if (!plan || isBusy()) return;
    const keys = {
      ArrowLeft: frame - 1,
      ArrowDown: frame - 1,
      ArrowRight: frame + 1,
      ArrowUp: frame + 1,
      Home: 0,
      End: plan.frames,
    };
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    seek(keys[event.key]);
    paintPosition(frame, plan, true);
  };
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !gesture) return;
      event.preventDefault();
      finish(null, true);
    },
    true,
  );
  $("#video-fit").onclick = () => setZoom(0);
  $("#video-zoom-in").onclick = () => setZoom(zoom + 1);
  $("#video-zoom-out").onclick = () => setZoom(zoom - 1);
  function focus(id, type) {
    const node = clipNodes.get(id);
    const button = node?.querySelector('[data-video-handle="' + type + '"]');
    (button?.getClientRects().length
      ? button
      : node?.querySelector(".video-clip-body")
    )?.focus({ preventScroll: true });
  }
  function render(
    nextClips,
    nextSources,
    nextPlan,
    id,
    nextFrame,
    nextAudio = [],
  ) {
    audio = nextAudio;
    clips = nextClips;
    sources = nextSources;
    plan = nextPlan;
    clipNodes.clear();
    lane.replaceChildren();
    audioRows.forEach((row) => row.replaceChildren());
    for (const [i, clip, isAudio] of [
      ...clips.map((c, i) => [i, c, false]),
      ...audio.map((c, i) => [i, c, true]),
    ]) {
      const item = el("div", "", { class: "video-track-clip" });
      const body = el("button", "", {
        class: "video-clip-body",
        type: "button",
      });
      const label = isAudio
        ? uiMsg("Audio {0}: {1}", [clip.lane, sources[clip.source].file.name])
        : uiMsg("Clip {0}: {1}", [i + 1, sources[clip.source].file.name]);
      uiText(body, label);
      uiAttr(body, "aria-label", label);
      body.setAttribute("data-video-handle", "clip");
      const control = (className, label, icon, type) => {
        const b = el("button", "", { class: className, type: "button" });
        videoIcon(b, icon, label);
        b.setAttribute("data-video-handle", type);
        pointer(b, type, i, isAudio);
        return b;
      };
      const left = control("video-trim", "Trim start", "trim_start", "start");
      const right = control("video-trim", "Trim end", "trim_end", "end");
      const grip = control(
        "video-grip",
        isAudio ? "Move audio clip" : "Drag clip to reorder",
        "grip",
        "move",
      );
      // Numeric times and move buttons in Clip settings are the keyboard equivalents.
      left.tabIndex = right.tabIndex = grip.tabIndex = -1;
      pointer(body, "move", i, isAudio);
      body.onclick = (event) => {
        if (event.detail === 0 || matchMedia("(pointer: coarse)").matches)
          select(clip.id, true);
      };
      item.dataset.clipId = clip.id;
      item.append(left, body, grip, right);
      (isAudio ? audioRows[clip.lane - 1] : lane).append(item);
      clipNodes.set(clip.id, item);
      if (isAudio) {
        item.dataset.audioClip = "";
        item.prepend(
          el("canvas", "", { width: 128, height: 24, "aria-hidden": "true" }),
        );
        waveform(clip);
      }
    }
    markSelected(id);
    ruler.setAttribute("aria-disabled", String(!plan));
    frame = nextFrame;
    if (plan) setZoom(zoom);
    else {
      ticks();
      paintGeometry();
      paintPosition(0);
      for (const id of ["video-fit", "video-zoom-in", "video-zoom-out"])
        $("#" + id).disabled = true;
    }
  }
  new ResizeObserver(() => {
    ticks();
    paintGeometry();
  }).observe(scroll);
  return {
    render,
    markSelected,
    paintPosition,
    focus,
    updateWaveform(id) {
      audio.filter((clip) => clip.source === id).forEach(waveform);
    },
  };
}
