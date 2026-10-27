import { el, field, row, button, select } from "./advanced-ui.js";
import { workspaceTabs, recipeControls } from "./studio-recipes.js";
import { validateMixRecipe, mixBudget, renderMix } from "./audio-mix-core.js";
import { download } from "./common.js";
import { uiMsg, uiText } from "../site/ui.js";
export async function init() {
  const root = document.querySelector("[data-tool]"),
    single = el("div", "", { id: "audio-trim-workspace" }),
    pane = el("section", "", {
      id: "audio-mix-workspace",
      class: "panel tool-form",
    });
  const old = [...root.children].filter(
    (n) =>
      n.matches(".panel,.studio-grid,.advanced-panel,.job-status") ||
      n.querySelector("#audio-file,#audio-record-start"),
  );
  if (!old.length) return;
  old[0].before(single);
  old.forEach((n) => single.append(n));
  root.append(pane);
  const tabs = workspaceTabs(root, [
    ["Trim & record", single],
    ["Mix", pane],
  ]);
  let raw = [],
    buffers = [],
    sources = [],
    tracks = [],
    clips = [],
    selected = -1,
    revision = 0,
    renderRevision = -1,
    rendered = null,
    playing = null,
    context = null,
    generation = 0,
    encoder = null,
    pendingRecipe = null,
    mappingReady = true;
  const input = el("input", "", {
      type: "file",
      multiple: true,
      accept: "audio/*",
      id: "mix-files",
    }),
    state = el(
      "p",
      "Choose up to ten audio files. No automatic playback or rendering.",
      { role: "status", id: "mix-status" },
    ),
    fileList = el("div"),
    trackList = el("div"),
    timeline = el("div", "", {
      class: "mix-timeline",
      "aria-label": "Multitrack timeline",
    }),
    properties = el("div", "", { class: "mix-properties" }),
    left = el("aside", "", { class: "mix-sources" }),
    main = el("section", "", { class: "mix-main" }),
    layout = el("div", "", { class: "mix-layout" }),
    crossfade = el("input", "", {
      type: "number",
      min: 0,
      max: 10,
      step: 0.1,
      value: 0.5,
      id: "mix-crossfade",
    }),
    normalize = el("input", "", { type: "checkbox", id: "mix-normalize" }),
    format = select([
      ["wav", "WAV"],
      ["mp3", "MP3"],
    ]),
    bitrate = select(
      [
        ["128", "128 kbps"],
        ["192", "192 kbps"],
        ["320", "320 kbps"],
      ],
      "192",
    ),
    wave = el("canvas", "", {
      width: 1000,
      height: 130,
      class: "mix-wave",
      "aria-label": "Rendered mix waveform",
    }),
    slotSelect = select([]),
    mapping = el("details");
  mapping.append(el("summary", "Audio source slot mapping"));
  format.id = "mix-format";
  bitrate.id = "mix-bitrate";
  const action = (label, fn, primary = false) =>
    button(
      label,
      async () => {
        try {
          await fn();
        } catch (e) {
          uiText(state, uiMsg(e.message));
        }
      },
      primary,
    );
  const stop = () => {
    try {
      playing?.stop();
    } catch {}
    playing = null;
  };
  function stale() {
    revision++;
    generation++;
    encoder?.terminate();
    encoder = null;
    stop();
    uiText(
      state,
      uiMsg("Mix changed. Preview it again before playing or exporting."),
    );
  }
  function settings() {
    return validateMixRecipe({
      format: format.value,
      bitrate: +bitrate.value,
      tracks,
      clips,
      crossfade: +crossfade.value,
      normalize: normalize.checked,
    });
  }
  function fresh() {
    if (!rendered || renderRevision !== revision)
      throw Error("Preview the updated mix before playing or exporting.");
    return rendered;
  }
  const defaultTrack = () => ({
    volume: 1,
    pan: 0,
    eq: [0, 0, 0],
    mute: false,
    solo: false,
  });
  async function audioContext() {
    context ||= new AudioContext();
    return context;
  }
  left.append(
    el("h3", "Sources & tracks"),
    fileList,
    trackList,
    action("Add track", () => {
      if (tracks.length >= 10) throw Error("Use at most ten tracks.");
      tracks.push(defaultTrack());
      draw();
      stale();
    }),
  );
  main.append(
    el("h3", "Timeline"),
    el(
      "p",
      "Drag clips to move them. Drag the edges to trim; precise seconds are available in Clip properties.",
      { class: "muted small" },
    ),
    timeline,
    row(
      field("Source slot", slotSelect),
      action("Add clip", () => {
        if (!sources.length) throw Error("Choose audio files first.");
        clips.push({
          slot: +slotSelect.value,
          track: 0,
          at: 0,
          start: 0,
          end: sources[+slotSelect.value].duration,
          fadeIn: 0,
          fadeOut: 0,
        });
        selected = clips.length - 1;
        draw();
        stale();
      }),
    ),
    action("Arrange clips with crossfade", () => {
      let at = 0;
      const fade = +crossfade.value;
      clips.forEach((c, i) => {
        c.track = 0;
        c.at = at;
        at += c.end - c.start;
        if (i < clips.length - 1)
          at -= Math.min(
            fade,
            (c.end - c.start) / 2,
            (clips[i + 1].end - clips[i + 1].start) / 2,
          );
      });
      draw();
      stale();
    }),
  );
  properties.append(el("h3", "Clip properties"));
  layout.append(left, main, properties);
  workspaceTabs(
    layout,
    [
      ["Sources & tracks", left],
      ["Timeline", main],
      ["Clip properties", properties],
    ],
    { mobile: true },
  );
  const prepare = action(
    "Preview mix",
    async () => {
      if (window.KenseiAdvancedContexts["audio-studio"].isRecording)
        throw Error("Stop microphone recording before preparing a mix.");
      const s = settings();
      mixBudget(s, sources);
      const token = ++generation,
        rev = revision;
      prepare.disabled = true;
      uiText(
        state,
        uiMsg("Rendering the same mix used for preview and export…"),
      );
      try {
        const value = await renderMix(s, sources);
        if (token !== generation || rev !== revision) return;
        rendered = value.buffer;
        renderRevision = rev;
        paintWave();
        uiText(
          state,
          uiMsg(
            value.peak > 1
              ? "Mix ready. Peaks may clip; lower track volume or enable normalization."
              : "Mix ready. Play or export the rendered result.",
          ),
        );
      } finally {
        prepare.disabled = false;
      }
    },
    true,
  );
  pane.append(
    el("h2", "Mix on this device"),
    field("Audio files · ten files / 50 MB / five minutes", input),
    state,
    mapping,
    layout,
    row(
      field("Crossfade · seconds", crossfade),
      field("Peak normalization", normalize),
      field("Output format", format),
      field("MP3 bitrate", bitrate),
    ),
    row(
      prepare,
      action("Play mix", async () => {
        const buffer = fresh(),
          ctx = await audioContext();
        await ctx.resume();
        window.KenseiAdvancedContexts["audio-studio"].stopPlayback();
        stop();
        playing = ctx.createBufferSource();
        playing.buffer = buffer;
        playing.connect(ctx.destination);
        playing.start();
      }),
      action("Stop playback", stop),
      action("Cancel rendering", () => {
        generation++;
        encoder?.terminate();
        encoder = null;
        stop();
        prepare.disabled = false;
        uiText(
          state,
          uiMsg("Cancelled. Sources and the previous mix are retained."),
        );
      }),
      action("Export mix", exportMix),
    ),
    wave,
  );
  // 主操作与波形紧邻时间轴；移动现有节点以保留输入和播放状态。
  main.append(
    crossfade.closest(".action-row"),
    prepare.closest(".action-row"),
    wave,
  );
  crossfade.oninput = normalize.onchange = stale;
  input.onchange = async () => {
    const files = [...input.files];
    if (!files.length) return;
    try {
      if (files.length > 10 || files.reduce((n, f) => n + f.size, 0) > 50000000)
        throw Error("Choose up to ten files totaling 50 MB.");
      const token = ++generation,
        next = [],
        ctx = await audioContext();
      let seconds = 0,
        bytes = 0;
      for (const f of files) {
        await durationCheck(f, seconds);
        const b = await ctx.decodeAudioData(await f.arrayBuffer());
        seconds += b.duration;
        bytes += b.length * b.numberOfChannels * 4;
        if (
          b.numberOfChannels < 1 ||
          b.numberOfChannels > 2 ||
          seconds > 300.05 ||
          bytes > 128000000
        )
          throw Error(
            "Combined audio exceeds five minutes, stereo or the 128 MB PCM limit.",
          );
        next.push(b);
      }
      if (token !== generation) return;
      raw = files;
      buffers = next;
      sources = next;
      if (pendingRecipe) {
        mappingReady = false;
        drawMapping();
      } else {
        tracks = files.map(defaultTrack);
        clips = next.map((b, i) => ({
          slot: i,
          track: i,
          at: 0,
          start: 0,
          end: b.duration,
          fadeIn: 0,
          fadeOut: 0,
        }));
        selected = 0;
        mappingReady = true;
      }
      draw();
      stale();
      uiText(
        state,
        uiMsg("Audio sources ready. Arrange and preview when ready."),
      );
    } catch (e) {
      uiText(state, uiMsg(e.message));
    }
  };
  async function durationCheck(file, used) {
    const url = URL.createObjectURL(file),
      audio = new Audio();
    try {
      const duration = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Audio metadata could not load. Try MP3 or WAV.")),
          10000,
        );
        audio.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve(audio.duration);
        };
        audio.onerror = () => {
          clearTimeout(timer);
          reject(Error("This audio file is damaged or unsupported."));
        };
        audio.preload = "metadata";
        audio.src = url;
      });
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        used + duration > 300.05
      )
        throw Error("Combined audio may be at most five minutes.");
    } finally {
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    }
  }
  function draw() {
    fileList.replaceChildren(
      ...raw.map((f, i) => {
        const n = el("p");
        n.textContent = `${i + 1}. ${f.name} · ${buffers[i].duration.toFixed(2)} s`;
        return n;
      }),
    );
    slotSelect.replaceChildren(
      ...sources.map((_, i) =>
        el("option", uiMsg("Slot {0}", [i + 1]), { value: i }),
      ),
    );
    drawTracks();
    drawTimeline();
    drawProperties();
  }
  function drawTracks() {
    trackList.replaceChildren();
    tracks.forEach((t, i) => {
      const box = el("details", "", { class: "mix-track-settings" });
      box.dataset.track = i;
      box.append(el("summary", uiMsg("Track {0}", [i + 1])));
      for (const [key, title, min, max, step] of [
        ["volume", "Track volume", 0, 2, 0.05],
        ["pan", "Pan", -1, 1, 0.05],
      ]) {
        const n = el("input", "", {
          type: "number",
          min,
          max,
          step,
          value: t[key],
        });
        n.dataset.param = key;
        n.onchange = () => {
          t[key] = +n.value;
          stale();
        };
        box.append(field(title, n));
      }
      for (const key of ["mute", "solo"]) {
        const n = el("input", "", { type: "checkbox", checked: t[key] });
        n.onchange = () => {
          t[key] = n.checked;
          stale();
        };
        box.append(field(key === "mute" ? "Mute" : "Solo track", n));
      }
      ["Low EQ · 200 Hz", "Mid EQ · 1 kHz", "High EQ · 4 kHz"].forEach(
        (label, j) => {
          const n = el("input", "", {
            type: "number",
            min: -12,
            max: 12,
            step: 0.5,
            value: t.eq[j],
          });
          n.dataset.eq = j;
          n.onchange = () => {
            t.eq[j] = +n.value;
            stale();
          };
          box.append(field(label, n));
        },
      );
      trackList.append(box);
    });
  }
  function drawTimeline() {
    timeline.replaceChildren();
    const duration = Math.max(
        10,
        ...clips.map((c) =>
          Number.isFinite(c.at + c.end - c.start) ? c.at + c.end - c.start : 0,
        ),
      ),
      width = Math.max(600, timeline.clientWidth);
    timeline.style.setProperty("--mix-duration", duration);
    const ruler = el("div", "", { class: "mix-ruler" });
    for (let i = 0; i <= 5; i++) {
      const n = el("span");
      n.textContent = ((duration * i) / 5).toFixed(1) + " s";
      ruler.append(n);
    }
    timeline.append(ruler);
    tracks.forEach((_, track) => {
      const lane = el("div", "", { class: "mix-lane" });
      lane.style.minWidth = width + "px";
      lane.dataset.track = track;
      clips.forEach((clip, index) => {
        if (clip.track !== track) return;
        const b = el("button", "", {
          class: "mix-clip" + (selected === index ? " selected" : ""),
          type: "button",
        });
        b.dataset.clip = index;
        b.textContent = `${clip.slot + 1} · ${(clip.end - clip.start).toFixed(2)}s`;
        b.style.left = (clip.at / duration) * 100 + "%";
        b.style.width = ((clip.end - clip.start) / duration) * 100 + "%";
        const a = el("span", "‹", { class: "mix-trim-start" }),
          z = el("span", "›", { class: "mix-trim-end" });
        b.append(a, z);
        b.onclick = () => {
          selected = index;
          drawProperties();
        };
        b.onpointerdown = (e) => {
          e.preventDefault();
          selected = index;
          drawProperties();
          const start = { ...clip },
            x = e.clientX,
            resize = e.target === a ? "start" : e.target === z ? "end" : "move";
          b.setPointerCapture(e.pointerId);
          b.onpointermove = (event) => {
            const delta =
              ((event.clientX - x) / lane.getBoundingClientRect().width) *
              duration;
            if (resize === "move")
              clip.at = Math.max(
                0,
                Math.min(
                  300 - (clip.end - clip.start),
                  Math.round((start.at + delta) * 100) / 100,
                ),
              );
            else if (resize === "start") {
              clip.start = Math.max(
                0,
                Math.min(start.end - 0.01, start.start + delta),
              );
              clip.at = Math.max(0, start.at + clip.start - start.start);
            } else
              clip.end = Math.max(
                start.start + 0.01,
                Math.min(
                  sources[clip.slot]?.duration || 300,
                  start.end + delta,
                ),
              );
            b.style.left = (clip.at / duration) * 100 + "%";
            b.style.width = ((clip.end - clip.start) / duration) * 100 + "%";
          };
          b.onpointerup = b.onpointercancel = () => {
            b.onpointermove = null;
            stale();
            drawTimeline();
            drawProperties();
          };
        };
        lane.append(b);
      });
      timeline.append(lane);
    });
  }
  function drawProperties() {
    properties.replaceChildren(el("h3", "Clip properties"));
    const c = clips[selected];
    if (!c) {
      properties.append(el("p", "Select a clip on the timeline."));
      return;
    }
    const track = select(
        tracks.map((_, i) => [i, uiMsg("Track {0}", [i + 1])]),
        c.track,
      ),
      slot = select(
        sources.map((_, i) => [i, uiMsg("Slot {0}", [i + 1])]),
        c.slot,
      );
    track.onchange = () => {
      c.track = +track.value;
      drawTimeline();
      stale();
    };
    slot.onchange = () => {
      c.slot = +slot.value;
      stale();
    };
    properties.append(field("Track", track), field("Source slot", slot));
    for (const [key, title] of [
      ["at", "Timeline position · seconds"],
      ["start", "Trim start · seconds"],
      ["end", "Trim end · seconds"],
      ["fadeIn", "Fade in · seconds"],
      ["fadeOut", "Fade out · seconds"],
    ]) {
      const n = el("input", "", {
        type: "number",
        min: 0,
        max: 300,
        step: 0.01,
        value: c[key],
      });
      n.dataset.clipParam = key;
      n.onchange = () => {
        c[key] = +n.value;
        drawTimeline();
        stale();
      };
      properties.append(field(title, n));
    }
    properties.append(
      action("Duplicate clip", () => {
        if (clips.length >= 60) throw Error("Use at most 60 clips.");
        clips.push({
          ...c,
          at: Math.min(300 - (c.end - c.start), c.at + c.end - c.start),
        });
        selected = clips.length - 1;
        draw();
        stale();
      }),
      action("Remove clip", () => {
        clips.splice(selected, 1);
        selected = Math.min(selected, clips.length - 1);
        draw();
        stale();
      }),
    );
  }
  function paintWave() {
    const x = wave.getContext("2d");
    x.clearRect(0, 0, wave.width, wave.height);
    x.fillStyle = "#d3a5ed";
    const a = rendered.getChannelData(0),
      step = Math.max(1, Math.floor(a.length / wave.width));
    for (let i = 0; i < wave.width; i++) {
      let peak = 0;
      for (let j = i * step; j < Math.min(a.length, (i + 1) * step); j++)
        peak = Math.max(peak, Math.abs(a[j]));
      x.fillRect(i, 65 - peak * 60, 1, Math.max(1, peak * 120));
    }
  }
  async function exportMix() {
    const b = fresh();
    if (!mappingReady)
      throw Error("Confirm audio source mapping before rendering.");
    const token = generation,
      channels = Array.from({ length: b.numberOfChannels }, (_, i) =>
        b.getChannelData(i).slice(),
      );
    encoder?.terminate();
    encoder = new Worker("/tool-scripts/audio-worker.js", { type: "module" });
    encoder.onmessage = ({ data }) => {
      if (token !== generation) return;
      if (data.type === "complete") {
        download(data.blob, "mix." + format.value);
        uiText(
          state,
          uiMsg(
            data.clipped
              ? "Mix exported. Some peaks clipped."
              : "Mix exported.",
          ),
        );
        encoder.terminate();
        encoder = null;
      } else if (data.type === "error") uiText(state, uiMsg(data.message));
    };
    encoder.onerror = () =>
      uiText(state, uiMsg("Encoder could not load. Retry or choose WAV."));
    encoder.postMessage(
      { channels, format: format.value, bitrate: +bitrate.value, gain: 1 },
      channels.map((c) => c.buffer),
    );
  }
  function drawMapping() {
    mapping.replaceChildren(el("summary", "Audio source slot mapping"));
    const selectors = pendingRecipe.slots.map((slot, i) => {
      const n = select(
        raw.map((f, j) => [j, f.name]),
        Math.min(i, raw.length - 1),
      );
      n.onchange = () => {
        mappingReady = false;
        stale();
      };
      mapping.append(field(uiMsg("Slot {0}", [i + 1]), n));
      return n;
    });
    mapping.append(
      action("Confirm audio source mapping", () => {
        const next = selectors.map((n) => buffers[+n.value]);
        if (next.some((x) => !x))
          throw Error("Choose a file for every source slot.");
        mixBudget(pendingRecipe, next);
        sources = next;
        tracks = structuredClone(pendingRecipe.tracks);
        clips = structuredClone(pendingRecipe.clips);
        mappingReady = true;
        mapping.open = false;
        selected = 0;
        draw();
        stale();
      }),
    );
    mapping.open = true;
  }
  recipeControls(
    pane,
    "audio-studio",
    settings,
    (s) => {
      pendingRecipe = s;
      tracks = structuredClone(s.tracks);
      clips = structuredClone(s.clips);
      crossfade.value = s.crossfade;
      normalize.checked = s.normalize;
      format.value = s.format;
      bitrate.value = s.bitrate;
      mappingReady = false;
      drawMapping();
      draw();
      stale();
    },
    validateMixRecipe,
  );
  const oldPrepare = prepare.onclick;
  prepare.onclick = () => {
    if (!mappingReady) {
      uiText(state, uiMsg("Confirm audio source mapping before rendering."));
      return;
    }
    return oldPrepare();
  };
  document
    .querySelector("#audio-record-start")
    ?.addEventListener("click", stop);
  document.querySelector("#audio-play")?.addEventListener("click", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  tabs.nav.addEventListener("click", () => {
    stop();
    window.KenseiAdvancedContexts["audio-studio"].stopPlayback();
  });
  window.addEventListener("pagehide", () => {
    generation++;
    stop();
    encoder?.terminate();
    context?.close();
  });
  draw();
}
