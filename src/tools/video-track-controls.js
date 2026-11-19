import { button, el, field, row } from "./advanced-ui.js";
import { uiAttr, uiMsg, uiText } from "../site/ui.js";
import { videoIcon } from "./video-icons.js";
import { clampBox, trackLimits } from "./video-assembly.js";

export function trackManagement(root, actions) {
  function render(tracks, name, canAddCue) {
    const focus = document.activeElement?.dataset.trackCommand;
    const groups = el("div", "", { class: "video-track-actions" });
    for (const [kind, label] of [
      ["video", "Add video layer"],
      ["audio", "Add audio track"],
      ["captions", "Add subtitle track"],
    ]) {
      const add = button(label, () => actions.add(kind));
      add.disabled =
        tracks.filter((track) => track.kind === kind).length >=
        trackLimits[kind];
      add.dataset.trackCommand = "add-" + kind;
      groups.append(add);
    }
    root.replaceChildren(groups);
    for (const track of tracks) {
      const { id, kind } = track;
      const item = el("div", "", { class: "video-track-options" });
      const heading = el("strong");
      uiText(heading, name(id));
      const peers = tracks.filter((t) => t.kind === kind);
      const index = peers.indexOf(track);
      const make = (command, label, icon, fn) => {
        const b = videoIcon(button("", fn), icon, label);
        b.dataset.trackCommand = id + "-" + command;
        return b;
      };
      const up = make("up", "Move track up", "up", () => actions.move(id, -1));
      const down = make("down", "Move track down", "down", () =>
        actions.move(id, 1),
      );
      up.disabled = index === 0;
      down.disabled = index === peers.length - 1;
      const remove = make("remove", "Delete track", "trash", () =>
        actions.remove(id),
      );
      const title = el("input", "", { value: track.name || "", maxLength: 50 });
      title.dataset.trackCommand = id + "-name";
      title.onchange = () => actions.edit(id, { name: title.value.trim() });
      const buttons = row(up, down, remove);
      item.append(heading, buttons, field("Track name", title));
      if (kind === "video") {
        const visible = el("input", "", {
          type: "checkbox",
          checked: !track.hidden,
        });
        visible.onchange = () => actions.edit(id, { hidden: !visible.checked });
        const check = field("Show video layer", visible);
        check.classList.add("check-label");
        item.append(check);
      }
      if (kind === "captions") {
        const lang = el("input", "", {
          value: track.language || "",
          maxLength: 32,
        });
        lang.dataset.trackCommand = id + "-language";
        lang.onchange = () => actions.edit(id, { language: lang.value.trim() });
        const cue = button("Add subtitle at playhead", () =>
          actions.addCaption(id),
        );
        cue.disabled = !canAddCue;
        const input = el("input", "", { type: "file", accept: ".srt,.vtt" });
        input.onchange = () => {
          const file = input.files[0];
          input.value = "";
          if (file) actions.importCaption(id, file);
        };
        item.append(
          field("Subtitle language", lang),
          cue,
          field("Import SRT or VTT", input),
        );
      }
      root.append(item);
    }
    if (focus)
      [...root.querySelectorAll("[data-track-command]")]
        .find((el) => el.dataset.trackCommand === focus)
        ?.focus({ preventScroll: true });
  }
  return { render, addVideo: actions.addVideo };
}

export function layerHandles(root, { select, change }) {
  let drag,
    last = [];
  function boxStyle(node, box) {
    node.style.left = box.x * 100 + "%";
    node.style.top = box.y * 100 + "%";
    node.style.width = box.size * 100 + "%";
    node.style.height = box.size * 100 + "%";
  }
  function paint(positions, id, enabled) {
    last = [positions, id, enabled];
    if (drag) return;
    root.replaceChildren();
    if (
      !enabled ||
      !positions.some(({ clip }) => clip?.id === id && clip.lane && !clip.full)
    )
      return;
    for (const { clip } of positions.filter(({ clip }) => clip?.id === id)) {
      const box = clip.box;
      const node = el("div", "", { class: "video-layer-outline" });
      const resize = el("span", "", { class: "video-layer-resize" });
      node.append(resize);
      boxStyle(node, box);
      root.append(node);
      node.onpointerdown = (event) => {
        if (event.button !== 0 || drag) return;
        event.preventDefault();
        select(id);
        const rect = root.getBoundingClientRect();
        drag = {
          node,
          id,
          box,
          pointer: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          rect,
          resize: event.target === resize,
        };
        node.setPointerCapture(event.pointerId);
      };
      node.onpointermove = (event) => {
        if (!drag || event.pointerId !== drag.pointer) return;
        const dx = (event.clientX - drag.x) / drag.rect.width,
          dy = (event.clientY - drag.y) / drag.rect.height;
        drag.next = drag.resize
          ? clampBox({
              ...box,
              size: Math.min(
                1 - box.x,
                1 - box.y,
                box.size +
                  Math.max(Math.abs(dx), Math.abs(dy)) *
                    (Math.abs(dx) > Math.abs(dy)
                      ? Math.sign(dx)
                      : Math.sign(dy)),
              ),
            })
          : clampBox({ ...box, x: box.x + dx, y: box.y + dy });
        boxStyle(node, drag.next);
        const video = root.parentElement.querySelector(
          'video[data-front][data-layer="' + clip.lane + '"]',
        );
        if (video) boxStyle(video, drag.next);
      };
      function finish(event, cancel = false) {
        if (
          !drag ||
          (event?.pointerId != null && event.pointerId !== drag.pointer)
        )
          return;
        const { next } = drag;
        drag = null;
        if (!cancel && next) change(id, next);
        else {
          const video = root.parentElement.querySelector(
            'video[data-front][data-layer="' + clip.lane + '"]',
          );
          if (video) boxStyle(video, box);
          paint(...last);
        }
      }
      node.onpointerup = finish;
      node.onpointercancel = node.onlostpointercapture = (event) =>
        finish(event, true);
    }
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !drag) return;
    event.preventDefault();
    drag.node.onpointercancel();
  });
  return { paint };
}
