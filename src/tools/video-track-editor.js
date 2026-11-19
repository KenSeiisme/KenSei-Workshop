import { $ } from "./common.js";
import { el } from "./advanced-ui.js";
import { uiAttr, uiMsg, uiText } from "../site/ui.js";
import { frameMs, frameRate, makeTimeline } from "./video-timeline.js";

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

export function createVideoTrack({ seek, pause, select, commit, isBusy }) {
  const scroll = $("#video-scroll"),
    track = $("#video-track");
  const ruler = $("#video-ruler"),
    lane = $("#video-lane");
  const needle = $("#video-needle"),
    insert = $("#video-insert");
  let plan = null,
    clips = [],
    sources = {},
    frame = 0,
    selected;
  let zoom = 0,
    gesture,
    motion = 0;
  const clipNodes = new Map();
  function percent(value, layout) {
    return (100 * value) / Math.max(1, layout.frames) + "%";
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
      const x = (shown / layout.frames) * track.clientWidth;
      if (
        x < scroll.scrollLeft ||
        x > scroll.scrollLeft + scroll.clientWidth - 4
      )
        scroll.scrollLeft = x - scroll.clientWidth * 0.3;
    }
  }
  function paintGeometry(layout = plan) {
    if (!layout) return;
    const width = track.clientWidth;
    const required = matchMedia("(pointer: coarse)").matches ? 150 : 74;
    for (const [i, { firstFrame, frames }] of layout.segments.entries()) {
      const node = clipNodes.get(clips[i].id);
      node.style.left = percent(firstFrame, layout);
      node.style.width = percent(frames, layout);
      node.toggleAttribute(
        "data-narrow",
        (width * frames) / layout.frames < required,
      );
    }
  }
  function ticks() {
    ruler.replaceChildren();
    if (!plan) return;
    const parts = Math.min(plan.frames, 3 * zoomLevels[zoom]);
    for (let i = 0; i <= parts; i++) {
      const at = Math.round((i * plan.frames) / parts);
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
      Math.round(((clientX - rect.left) / rect.width) * layout.frames),
      0,
      layout.frames,
    );
  }
  function updatePointer(active) {
    const { x, type } = active;
    if (type === "seek") {
      const next = frameAt(x);
      if (active.frame === next) return;
      active.frame = next;
      seek(next);
      return;
    }
    const current = frameAt(x);
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
      ((x - active.from + scroll.scrollLeft - active.scroll) * plan.frames) /
        active.width,
    );
    const next = clip[type] + frameMs(delta);
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
  function start(event, type, index) {
    if (!plan || gesture || isBusy() || event.button !== 0) return;
    if (
      event.pointerType !== "mouse" &&
      event.currentTarget.classList.contains("video-clip-body")
    )
      return;
    const target = event.currentTarget;
    const savedFrame = frame;
    target.focus({ preventScroll: true });
    if (index !== undefined) select(clips[index].id, false);
    pause();
    gesture = {
      type,
      index,
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
    active.moved ||= Math.abs(active.x - active.from) >= 4;
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
    insert.hidden = true;
    if (active.target.hasPointerCapture(active.pointer))
      active.target.releasePointerCapture(active.pointer);
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
  function pointer(target, type, index) {
    target.onpointerdown = (event) => start(event, type, index);
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
    if (!(event.key in keys)) return;
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
  function render(nextClips, nextSources, nextPlan, id, nextFrame) {
    clips = nextClips;
    sources = nextSources;
    plan = nextPlan;
    clipNodes.clear();
    lane.replaceChildren();
    for (const [i, clip] of clips.entries()) {
      const item = el("div", "", { class: "video-track-clip" });
      const body = el("button", "", {
        class: "video-clip-body",
        type: "button",
      });
      const label = uiMsg("Clip {0}: {1}", [
        i + 1,
        sources[clip.source].file.name,
      ]);
      uiText(body, label);
      uiAttr(body, "aria-label", label);
      body.setAttribute("data-video-handle", "clip");
      const control = (className, label, icon, type) => {
        const b = el("button", "", { class: className, type: "button" });
        b.textContent = icon;
        b.setAttribute("data-video-handle", type);
        uiAttr(b, "aria-label", uiMsg(label));
        pointer(b, type, i);
        return b;
      };
      const left = control("video-trim", "Trim start", "[", "start");
      const right = control("video-trim", "Trim end", "]", "end");
      const grip = control("video-grip", "Drag clip to reorder", "⋮⋮", "move");
      // Numeric times and move buttons in Clip settings are the keyboard equivalents.
      left.tabIndex = right.tabIndex = grip.tabIndex = -1;
      pointer(body, "move", i);
      body.onclick = (event) => {
        if (event.detail === 0 || matchMedia("(pointer: coarse)").matches)
          select(clip.id, true);
      };
      item.dataset.clipId = clip.id;
      item.append(left, body, grip, right);
      lane.append(item);
      clipNodes.set(clip.id, item);
    }
    markSelected(id);
    ruler.setAttribute("aria-disabled", String(!plan));
    frame = nextFrame;
    if (plan) setZoom(zoom);
    else {
      ticks();
      paintPosition(0);
      for (const id of ["video-fit", "video-zoom-in", "video-zoom-out"])
        $("#" + id).disabled = true;
    }
  }
  new ResizeObserver(() => paintGeometry()).observe(scroll);
  return {
    render,
    markSelected,
    paintPosition,
    focus,
    cancel: () => finish(null, true),
  };
}
