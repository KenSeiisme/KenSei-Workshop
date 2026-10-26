import { $, status } from "./common.js";
import { el, panel, row, button, field } from "./advanced-ui.js";
import { keptRanges, shapeSamples, pcmWav } from "./audio-edit-core.js";
import { uiMsg, uiText, uiError } from "../site/ui.js";
export function init() {
  const ctx = window.KenseiAdvancedContexts["audio-studio"],
    p = panel("Join and shape audio", $("#audio-file").closest(".panel")),
    input = el("input", "", {
      type: "file",
      multiple: true,
      accept: "audio/*",
    }),
    list = el("div"),
    ranges = el("textarea", "", {
      rows: 3,
      placeholder:
        "Keep ranges from the joined timeline, for example 0-10 and 20-30. Empty keeps all.",
    }),
    fadeIn = el("input", "", {
      type: "number",
      min: 0,
      max: 30,
      step: 0.1,
      value: 0,
    }),
    fadeOut = el("input", "", {
      type: "number",
      min: 0,
      max: 30,
      step: 0.1,
      value: 0,
    }),
    normalize = el("input", "", { type: "checkbox" }),
    note = el("p");
  let files = [],
    generation = 0,
    busy = false;
  function draw() {
    list.replaceChildren();
    files.forEach((f, i) => {
      const label = el("span");
      label.textContent = i + 1 + ". " + f.name;
      list.append(
        row(
          label,
          button("Move up", () => {
            if (busy || !i) return;
            [files[i - 1], files[i]] = [files[i], files[i - 1]];
            draw();
          }),
          button("Move down", () => {
            if (busy || i === files.length - 1) return;
            [files[i + 1], files[i]] = [files[i], files[i + 1]];
            draw();
          }),
        ),
      );
    });
  }
  input.onchange = () => {
    if (busy) return;
    const next = [...input.files];
    if (next.length > 10 || next.reduce((n, f) => n + f.size, 0) > 50000000) {
      status(uiMsg("Choose up to ten audio files, 50 MB combined."), true);
      return;
    }
    files = next;
    draw();
  };
  const normalized = el("label", "Peak normalization");
  normalized.prepend(normalize);
  const prepare = button(
    "Prepare audio preview",
    async () => {
      if (busy) return;
      if (!files.length) throw Error("Choose audio files first.");
      busy = true;
      const token = ++generation,
        ac = new AudioContext();
      prepare.disabled = true;
      [input, ranges, fadeIn, fadeOut, normalize].forEach(
        (n) => (n.disabled = true),
      );
      try {
        let buffers = [],
          seconds = 0,
          bytes = 0;
        for (const f of files) {
          const a = await ac.decodeAudioData(await f.arrayBuffer());
          if (token !== generation) return;
          seconds += a.duration;
          bytes += a.length * a.numberOfChannels * 4;
          if (seconds > 300.05 || bytes > 128000000 || a.numberOfChannels > 2)
            throw Error(
              "Combined audio exceeds five minutes or 128 MB decoded PCM.",
            );
          buffers.push(a);
        }
        const keep = keptRanges(ranges.value, seconds),
          duration = keep.reduce((n, [a, b]) => n + b - a, 0),
          channels = Math.max(...buffers.map((b) => b.numberOfChannels)),
          frames = Math.round(duration * 44100);
        if (bytes + frames * channels * 4 > 128000000)
          throw Error(
            "Audio preparation exceeds 128 MB PCM. Use shorter ranges.",
          );
        const fi = Number(fadeIn.value),
          fo = Number(fadeOut.value);
        if (
          !Number.isFinite(fi) ||
          !Number.isFinite(fo) ||
          fi < 0 ||
          fo < 0 ||
          fi > 30 ||
          fo > 30 ||
          fi + fo > duration
        )
          throw Error(
            "Fade lengths must fit inside the output and be at most 30 seconds.",
          );
        const offline = new OfflineAudioContext(channels, frames, 44100);
        let dest = 0;
        for (const [a, b] of keep) {
          let sourceAt = 0;
          for (const buffer of buffers) {
            const from = Math.max(a, sourceAt),
              to = Math.min(b, sourceAt + buffer.duration);
            if (to > from) {
              const node = offline.createBufferSource();
              node.buffer = buffer;
              node.connect(offline.destination);
              node.start(dest + from - a, from - sourceAt, to - from);
            }
            sourceAt += buffer.duration;
          }
          dest += b - a;
        }
        const output = await offline.startRendering();
        if (token !== generation) return;
        const data = Array.from({ length: channels }, (_, i) =>
          output.getChannelData(i),
        );
        const info = shapeSamples(data, 44100, fi, fo, normalize.checked),
          blob = pcmWav(data, 44100);
        buffers = [];
        await ctx.loadAudio(
          new File([blob], "joined-audio.wav", { type: "audio/wav" }),
        );
        uiText(
          note,
          uiMsg("Preview ready: {0} seconds · peak {1}", [
            duration.toFixed(2),
            info.peak.toFixed(3),
          ]),
        );
      } catch (e) {
        status(uiError(e), true);
      } finally {
        await ac.close().catch(() => {});
        busy = false;
        prepare.disabled = false;
        [input, ranges, fadeIn, fadeOut, normalize].forEach(
          (n) => (n.disabled = false),
        );
      }
    },
    true,
  );
  p.append(
    field("Audio files in order", input),
    list,
    field("Kept ranges (seconds)", ranges),
    row(
      field("Fade in (seconds)", fadeIn),
      field("Fade out (seconds)", fadeOut),
      normalized,
    ),
    prepare,
    button("Cancel preparation", () => {
      generation++;
    }),
    note,
  );
  window.addEventListener("pagehide", () => generation++);
}
