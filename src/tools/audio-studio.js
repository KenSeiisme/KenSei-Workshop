import { $, busy, status, download, size } from "./common.js";
import {
  AUDIO_TYPES,
  makeRecording,
  stopTracks,
  mediaError,
  clockText,
} from "./media-capture.js";
import {
  uiMsg,
  uiJoin,
  uiFrom,
  uiError,
  uiText,
  uiConfirm,
} from "../site/ui.js";

let buffer = null,
  name = "audio",
  wave = null,
  region = null,
  regions = null,
  context = null,
  source = null,
  worker = null,
  job = 0,
  url = null,
  playingAt = 0,
  playingFrom = 0,
  raf = null,
  editingRegion = false;
const info = $("#audio-info"),
  start = $("#audio-start"),
  end = $("#audio-end"),
  gain = $("#audio-gain");
function stopPlayback() {
  try {
    source?.stop();
  } catch {}
  source = null;
  cancelAnimationFrame(raf);
  raf = null;
}
async function audioContext() {
  if (!context) context = new AudioContext();
  if (context.state === "suspended") await context.resume();
  return context;
}
function valid() {
  if (!buffer) throw Error("Choose an audio file first.");
  const a = Number(start.value),
    b = Number(end.value),
    volume = Number(gain.value);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    start.value === "" ||
    end.value === "" ||
    a < 0 ||
    b <= a ||
    b > buffer.duration + 0.00001
  )
    throw Error(
      "Choose start/end seconds inside the audio, with end after start.",
    );
  if (
    gain.value === "" ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 200
  )
    throw Error("Volume must be from 0 to 200%.");
  return { a, b, volume: volume / 100 };
}
function controls() {
  let okay = false;
  try {
    valid();
    okay = true;
  } catch {}
  $("#audio-play").disabled = $("#audio-export").disabled = !okay;
  $("#audio-bitrate").disabled = $("#audio-format").value !== "mp3";
}
function syncRegion() {
  controls();
  if (editingRegion || !region) return;
  try {
    const { a, b } = valid();
    editingRegion = true;
    region.setOptions({ start: a, end: b });
  } catch {
  } finally {
    editingRegion = false;
  }
}
for (const input of [start, end, gain])
  input.addEventListener("input", () => {
    stopPlayback();
    syncRegion();
  });
$("#audio-format").onchange = controls;
async function waveform(file, token) {
  try {
    const { WaveSurfer, Regions } = await import("/vendor/wave.js");
    if (token !== job) return;
    wave?.destroy();
    wave = null;
    regions = Regions.create();
    wave = WaveSurfer.create({
      container: "#audio-wave",
      height: 130,
      waveColor: "#887294",
      progressColor: "#ef9bb7",
      cursorColor: "#d6afe8",
      plugins: [regions],
    });
    const source = buffer.getChannelData(0),
      count = Math.min(3000, source.length),
      peaks = new Float32Array(count),
      stride = Math.max(1, Math.floor(source.length / count));
    for (let i = 0; i < count; i++) {
      let value = 0;
      for (
        let j = i * stride;
        j < Math.min(source.length, (i + 1) * stride);
        j++
      )
        if (Math.abs(source[j]) > Math.abs(value)) value = source[j];
      peaks[i] = value;
    }
    await wave.load(url, [peaks], buffer.duration);
    if (token !== job) return;
    region = regions.addRegion({
      start: 0,
      end: buffer.duration,
      color: "rgba(214,175,232,.2)",
      drag: true,
      resize: true,
    });
    regions.on("region-updated", (r) => {
      if (editingRegion) return;
      editingRegion = true;
      start.value = String(Math.round(r.start * 1000) / 1000);
      end.value = String(
        Math.min(buffer.duration, Math.round(r.end * 1000) / 1000),
      );
      editingRegion = false;
      stopPlayback();
      controls();
    });
  } catch {
    if (token === job) {
      uiText(
        $("#audio-wave"),
        uiMsg(
          "Waveform unavailable. Exact start/end fields and audio processing remain available.",
        ),
      );
      region = null;
    }
  }
}
function finish(message, error = false) {
  worker?.terminate();
  worker = null;
  busy(false);
  controls();
  if (message) status(uiFrom(message), error);
}
async function loadAudio(file, recordedDuration = null) {
  stopPlayback();
  const token = ++job;
  busy(true);
  status(uiMsg("Reading audio metadata…"));
  $("#audio-progress").value = 0;
  let nextUrl = null;
  try {
    if (file.size > 50000000)
      throw Error("Choose an audio file no larger than 50 MB.");
    nextUrl = URL.createObjectURL(file);
    const metadata = new Audio();
    metadata.preload = "metadata";
    metadata.src = nextUrl;
    let duration = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        metadata.removeAttribute("src");
        reject(Error("This audio format could not be read. Try MP3 or WAV."));
      }, 10000);
      metadata.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(metadata.duration);
      };
      metadata.onerror = () => {
        clearTimeout(timer);
        reject(Error("This file is damaged or unsupported. Try MP3 or WAV."));
      };
    });
    metadata.removeAttribute("src");
    metadata.load();
    if (token !== job) return;
    // MediaRecorder 的 WebM 可能没有最终 duration metadata；只对本站录制使用实测时长回退。
    if (!Number.isFinite(duration) && Number.isFinite(recordedDuration))
      duration = recordedDuration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 300.05)
      throw Error("Choose audio up to five minutes long.");
    status(uiMsg("Decoding on this device…"));
    const ctx = await audioContext(),
      decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    if (token !== job) return;
    if (
      decoded.duration > 300.05 ||
      decoded.numberOfChannels < 1 ||
      decoded.numberOfChannels > 2 ||
      decoded.length * decoded.numberOfChannels * 4 > 128000000
    )
      throw Error(
        "Audio exceeds the five-minute, mono/stereo or 128 MB decoded PCM limit.",
      );
    wave?.destroy();
    wave = null;
    region = null;
    if (url) URL.revokeObjectURL(url);
    url = nextUrl;
    nextUrl = null;
    buffer = decoded;
    name = file.name.replace(/\.[^.]+$/, "") || "audio";
    start.value = "0";
    end.value = String(decoded.duration);
    gain.value = "100";
    uiText(
      info,
      uiJoin([
        file.name +
          " · " +
          decoded.duration.toFixed(2) +
          " s · " +
          decoded.numberOfChannels,
        uiMsg(" channel(s) · "),
        decoded.sampleRate,
        uiMsg(" Hz decoded · "),
        size(file.size),
      ]),
    );
    await waveform(file, token);
    if (token === job) {
      finish("Audio ready. Drag or enter a selection; export as MP3 or WAV.");
      return true;
    }
  } catch (error) {
    if (token === job) finish(error.message, true);
  } finally {
    if (nextUrl) URL.revokeObjectURL(nextUrl);
    if (token === job) {
      busy(false);
      controls();
    }
  }
  return false;
}
$("#audio-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) await loadAudio(file);
};
$("#audio-play").onclick = async () => {
  try {
    const { a, b, volume } = valid();
    stopPlayback();
    const ctx = await audioContext(),
      node = ctx.createBufferSource(),
      level = ctx.createGain();
    node.buffer = buffer;
    level.gain.value = volume;
    node.connect(level).connect(ctx.destination);
    source = node;
    playingAt = ctx.currentTime;
    playingFrom = a;
    node.start(0, a, b - a);
    node.onended = () => {
      if (source === node) stopPlayback();
    };
    const tick = () => {
      if (!source) return;
      try {
        wave?.setTime(Math.min(b, playingFrom + ctx.currentTime - playingAt));
      } catch {}
      raf = requestAnimationFrame(tick);
    };
    tick();
    status(
      uiJoin([
        uiMsg("Playing selection"),
        volume > 1 ? uiMsg(" · gain may clip at export") : "",
        ".",
      ]),
    );
  } catch (e) {
    status(uiError(e), true);
  }
};
$("#audio-stop").onclick = stopPlayback;
$("#audio-export").onclick = async () => {
  let selected;
  try {
    selected = valid();
  } catch (e) {
    status(uiError(e), true);
    return;
  }
  stopPlayback();
  const token = ++job;
  busy(true);
  status(uiMsg("Preparing 44.1 kHz selection…"));
  $("#audio-progress").value = 0;
  try {
    const { a, b, volume } = selected,
      len = Math.max(1, Math.round((b - a) * 44100)),
      render = new OfflineAudioContext(buffer.numberOfChannels, len, 44100),
      node = render.createBufferSource();
    node.buffer = buffer;
    node.connect(render.destination);
    node.start(0, a, b - a);
    const output = await render.startRendering();
    if (token !== job) return;
    const channels = Array.from({ length: output.numberOfChannels }, (_, c) =>
        output.getChannelData(c).slice(),
      ),
      format = $("#audio-format").value,
      bitrate = Number($("#audio-bitrate").value);
    worker = new Worker("/tool-scripts/audio-worker.js", { type: "module" });
    status(
      uiJoin([
        uiMsg("Encoding "),
        format.toUpperCase(),
        uiMsg(" on this device…"),
      ]),
    );
    worker.onmessage = ({ data }) => {
      if (token !== job) return;
      if (data.type === "progress") $("#audio-progress").value = data.value;
      if (data.type === "error") finish(data.message, true);
      if (data.type === "complete") {
        download(data.blob, name + "-selection." + format);
        recordingUnsaved = false;
        finish(
          data.clipped
            ? "Export ready. Some samples clipped at the output limit; lower volume for more headroom."
            : "Export ready · " + format.toUpperCase() + " · 44.1 kHz.",
        );
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      if (token === job)
        finish(
          "Encoder could not load. Your selection remains available; retry or choose WAV.",
          true,
        );
    };
    worker.postMessage(
      { channels, format, bitrate, gain: volume },
      channels.map((c) => c.buffer),
    );
  } catch (e) {
    if (token === job)
      finish(
        "Could not prepare this selection. Try a shorter clip. " + e.message,
        true,
      );
  }
};
$("#cancel-job").onclick = () => {
  job++;
  stopPlayback();
  finish(
    "Processing cancelled. Your previous audio and selection remain available.",
  );
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPlayback();
});
window.addEventListener("pagehide", (event) => {
  job++;
  worker?.terminate();
  worker = null;
  stopPlayback();
  busy(false);
  controls();
  if (event.persisted) {
    context?.suspend();
  } else {
    wave?.destroy();
    context?.close();
    if (url) URL.revokeObjectURL(url);
  }
});
controls();

let microphoneStream = null,
  microphoneContext = null,
  levelFrame = null,
  microphoneRecorder = null,
  recordPending = false,
  recordingState = "idle",
  recordingGeneration = 0,
  recordedFile = null,
  recordedSeconds = null,
  recordedUrl = null,
  recordingUnsaved = false;
if ($("#audio-record-start")) {
  const recordStatus = (text, error = false) => {
    uiText($("#audio-record-status"), text);
    $("#audio-record-status").classList.toggle("error-text", error);
  };
  function recordingControls() {
    $("#audio-record-start").disabled =
      recordPending ||
      recordingState !== "idle" ||
      !navigator.mediaDevices?.getUserMedia ||
      !globalThis.MediaRecorder;
    $("#audio-record-pause").disabled = !["recording", "paused"].includes(
      recordingState,
    );
    $("#audio-record-stop").disabled = !["recording", "paused"].includes(
      recordingState,
    );
    uiText(
      $("#audio-record-pause"),
      recordingState === "paused" ? uiMsg("Resume") : uiMsg("Pause"),
    );
    $("#audio-record-retry").disabled =
      recordPending || recordingState !== "idle" || !recordedFile;
  }
  function releaseMicrophone() {
    stopTracks(microphoneStream);
    microphoneStream = null;
    cancelAnimationFrame(levelFrame);
    levelFrame = null;
    microphoneContext?.close().catch(() => {});
    microphoneContext = null;
    $("#audio-record-level").value = 0;
  }
  function clearRecording() {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    recordedUrl = null;
    recordedFile = null;
    recordedSeconds = null;
    const preview = $("#audio-record-preview");
    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    $("#audio-record-recovery").hidden = true;
  }
  async function openRecording() {
    if (!recordedFile) return;
    $("#audio-record-retry").disabled = true;
    const okay = await loadAudio(recordedFile, recordedSeconds);
    recordStatus(
      okay
        ? "Recording ready in the editor. Select a region and export to keep it."
        : "The editor could not decode this recording. Your original remains available below; download it or retry the editor.",
      !okay,
    );
    recordingControls();
  }
  $("#audio-record-start").onclick = async () => {
    if (recordPending || recordingState !== "idle") return;
    if (
      recordingUnsaved &&
      !uiConfirm(
        uiMsg(
          "Discard the recording you have not downloaded and record again?",
        ),
      )
    )
      return;
    stopPlayback();
    clearRecording();
    const token = ++recordingGeneration;
    recordPending = true;
    busy(true);
    $("#cancel-job").hidden = true;
    recordingControls();
    recordStatus(
      "Allow microphone access to begin. Nothing is recorded until access is granted…",
    );
    let incoming = null;
    try {
      incoming = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 44100 } },
        video: false,
      });
      if (token !== recordingGeneration) {
        stopTracks(incoming);
        return;
      }
      microphoneStream = incoming;
      try {
        microphoneContext = new AudioContext();
        if (microphoneContext.state === "suspended")
          await microphoneContext.resume();
        if (token !== recordingGeneration) {
          releaseMicrophone();
          return;
        }
        const analyser = microphoneContext.createAnalyser();
        analyser.fftSize = 256;
        microphoneContext.createMediaStreamSource(incoming).connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          if (!microphoneStream) return;
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const value of data) sum += value * value;
          $("#audio-record-level").value =
            recordingState === "paused"
              ? 0
              : Math.min(1, Math.sqrt(sum / data.length) * 4);
          levelFrame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        microphoneContext?.close().catch(() => {});
        microphoneContext = null;
      }
      microphoneRecorder = makeRecording(incoming, {
        types: AUDIO_TYPES,
        maxSeconds: 300,
        maxBytes: 50000000,
        onTick({ seconds }) {
          uiText($("#audio-record-time"), clockText(seconds));
        },
        onState(next) {
          recordingState = next;
          recordingControls();
        },
        async onComplete(blob, detail) {
          releaseMicrophone();
          microphoneRecorder = null;
          busy(false);
          controls();
          const extension = blob.type.includes("mp4")
            ? "m4a"
            : blob.type.includes("ogg")
              ? "ogg"
              : "webm";
          recordedFile = new File(
            [blob],
            `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
            { type: blob.type },
          );
          recordedSeconds = Math.max(0.001, detail.seconds);
          recordedUrl = URL.createObjectURL(blob);
          $("#audio-record-preview").src = recordedUrl;
          $("#audio-record-recovery").hidden = false;
          uiText($("#audio-record-time"), clockText(detail.seconds));
          recordingUnsaved = true;
          recordStatus(
            `${detail.reason}. Opening ${size(blob.size)} in the editor…`,
          );
          await openRecording();
        },
        onError(error) {
          releaseMicrophone();
          microphoneRecorder = null;
          recordingState = "idle";
          busy(false);
          controls();
          recordingUnsaved = false;
          recordStatus(mediaError(error), true);
          recordingControls();
        },
      });
      microphoneRecorder.start();
      recordingUnsaved = true;
      uiText($("#audio-record-time"), "00:00");
      recordStatus(
        "Recording from your microphone. Stop to edit and export your clip.",
      );
    } catch (error) {
      if (token !== recordingGeneration) {
        stopTracks(incoming);
        return;
      }
      microphoneRecorder?.dispose();
      microphoneRecorder = null;
      releaseMicrophone();
      recordingState = "idle";
      recordingUnsaved = false;
      busy(false);
      controls();
      recordStatus(mediaError(error), true);
    } finally {
      if (token === recordingGeneration) {
        recordPending = false;
        recordingControls();
      }
    }
  };
  $("#audio-record-stop").onclick = () =>
    microphoneRecorder?.stop("Stopped by you");
  $("#audio-record-pause").onclick = () => {
    if (microphoneRecorder?.state === "paused") {
      microphoneRecorder.resume();
      recordStatus("Recording resumed.");
    } else if (microphoneRecorder?.state === "recording") {
      microphoneRecorder.pause();
      recordStatus(
        "Paused. Microphone access remains active; the five-minute elapsed limit still applies.",
      );
    }
  };
  $("#audio-record-download").onclick = () => {
    if (!recordedFile) return;
    download(recordedFile, recordedFile.name);
    recordingUnsaved = false;
    recordStatus(
      "Original recording download requested. You can still edit it below.",
    );
  };
  $("#audio-record-retry").onclick = openRecording;
  window.addEventListener("beforeunload", (event) => {
    if (recordingUnsaved || recordPending || recordingState !== "idle") {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    recordingGeneration++;
    microphoneRecorder?.dispose();
    microphoneRecorder = null;
    releaseMicrophone();
    recordPending = false;
    recordingState = "idle";
    recordingControls();
  });
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder)
    recordStatus(
      "Microphone recording is unavailable in this browser. You can still open an audio file below.",
    );
  recordingControls();
}

window.KenseiAdvancedContexts ||= {};
window.KenseiAdvancedContexts["audio-studio"] = {
  loadAudio,
  stopPlayback,
  get isRecording() {
    return recordingState !== "idle" || recordPending;
  },
  get buffer() {
    return buffer;
  },
};
