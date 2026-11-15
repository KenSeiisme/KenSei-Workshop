import { $, download, size } from "./common.js";
import {
  VIDEO_TYPES,
  makeRecording,
  stopTracks,
  mediaError,
  clockText,
} from "./media-capture.js";
import { uiJoin, uiFrom, uiMsg, uiText, uiConfirm } from "../site/ui.js";

let attempt = null,
  result = null,
  unsaved = false,
  state = "idle";
const start = $("#screen-start"),
  cancel = $("#screen-cancel"),
  video = $("#screen-result"),
  live = $("#screen-live"),
  placeholder = $("#screen-placeholder");
const supported = Boolean(
  navigator.mediaDevices?.getDisplayMedia && globalThis.MediaRecorder,
);
const message = (text, error = false) => {
  uiText($("#screen-status"), text);
  $("#screen-status").classList.toggle("error-text", error);
};
function metrics(seconds, bytes) {
  uiText($("#screen-time"), clockText(seconds));
  uiText($("#screen-bytes"), bytes ? size(bytes) : uiMsg("0 MB"));
}
function controls() {
  start.disabled = !supported || attempt !== null;
  cancel.hidden = !attempt?.phase;
  uiText(
    cancel,
    attempt?.phase === "countdown"
      ? uiMsg("Cancel countdown")
      : uiMsg("Cancel capture"),
  );
  $("#screen-pause").disabled = !["recording", "paused"].includes(state);
  uiText(
    $("#screen-pause"),
    state === "paused" ? uiMsg("Resume") : uiMsg("Pause"),
  );
  $("#screen-stop").disabled = $("#screen-pause").disabled;
  $("#screen-microphone").disabled = $("#screen-shared-audio").disabled =
    Boolean(attempt);
  $("#screen-download").disabled = $("#screen-discard").disabled =
    !result || Boolean(attempt);
}
function showResult() {
  video.hidden = !result;
  placeholder.hidden = Boolean(result);
  metrics(result?.seconds ?? 0, result?.blob.size ?? 0);
  uiText($("#screen-specs"), result?.specs ?? "");
}
function clearResult() {
  if (result) URL.revokeObjectURL(result.url);
  result = null;
  unsaved = false;
  video.pause();
  video.removeAttribute("src");
  video.load();
}
function finish(current) {
  if (attempt !== current) return;
  attempt = null;
  clearTimeout(current.hint);
  current.recording?.dispose();
  stopTracks(current.screen, current.mic, current.mixed);
  current.audio?.close().catch(() => {});
  state = "idle";
  live.srcObject = null;
  live.hidden = true;
  showResult();
  controls();
}
function waitFor(current, phase, prompt, hint) {
  clearTimeout(current.hint);
  current.phase = phase;
  message(prompt);
  controls();
  if (hint) {
    current.hint = setTimeout(() => {
      if (attempt === current) message(hint);
    }, 8000);
  }
}
function sourceEnded(current) {
  if (attempt !== current) return;
  if (current.recording) {
    current.recording.stop("Capture source ended");
    return;
  }
  finish(current);
  message(
    uiMsg("Screen sharing ended before recording started. Please try again."),
    true,
  );
}

start.onclick = async () => {
  if (!supported || attempt) return;
  if (
    unsaved &&
    !uiConfirm(
      uiMsg(
        "Start a new capture? Your current recording stays available until a new recording succeeds.",
      ),
    )
  )
    return;
  const current = { phase: "screen" };
  attempt = current;
  waitFor(
    current,
    "screen",
    uiMsg("Choose a tab, window or screen in your browser's capture picker…"),
    uiMsg(
      "Still waiting for a screen. Check the browser's capture picker, or cancel and try again.",
    ),
  );
  try {
    const includeShared = $("#screen-shared-audio").checked,
      includeMic = $("#screen-microphone").checked,
      smaller = window.KenseiRecorderPreset === 720;
    // 打开选择器之前不等待异步操作，保留浏览器要求的用户激活。
    const screen = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: smaller ? 1280 : 1920, max: smaller ? 1280 : 1920 },
        height: { ideal: smaller ? 720 : 1080, max: smaller ? 720 : 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: includeShared,
      systemAudio: includeShared ? "include" : "exclude",
    });
    if (attempt !== current) {
      stopTracks(screen);
      return;
    }
    current.screen = screen;
    if (!includeShared) {
      for (const track of screen.getAudioTracks()) {
        track.stop();
        screen.removeTrack(track);
      }
    }
    const screenTrack = screen.getVideoTracks()[0];
    if (!screenTrack || screenTrack.readyState === "ended") {
      sourceEnded(current);
      return;
    }
    screenTrack.addEventListener("ended", () => sourceEnded(current), {
      once: true,
    });
    if (includeMic) {
      waitFor(
        current,
        "microphone",
        uiMsg("Screen selected. Allow microphone access to continue…"),
        uiMsg(
          "Still waiting for microphone access. Check the browser prompt or this site's microphone permission. You can cancel and try again.",
        ),
      );
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (attempt !== current) {
        stopTracks(mic);
        return;
      }
      current.mic = mic;
    }
    if (screenTrack.readyState === "ended") {
      sourceEnded(current);
      return;
    }
    const audioTracks = [
      ...screen.getAudioTracks(),
      ...(current.mic?.getAudioTracks() || []),
    ];
    current.mixed = new MediaStream([screenTrack]);
    if (audioTracks.length === 1) current.mixed.addTrack(audioTracks[0]);
    else if (audioTracks.length > 1) {
      waitFor(
        current,
        "audio",
        uiMsg("Preparing shared and microphone audio…"),
        uiMsg(
          "Still preparing audio. You can cancel and retry with one audio source.",
        ),
      );
      current.audio = new AudioContext();
      if (current.audio.state === "suspended") await current.audio.resume();
      if (attempt !== current) return;
      const destination = current.audio.createMediaStreamDestination();
      for (const track of audioTracks) {
        current.audio
          .createMediaStreamSource(new MediaStream([track]))
          .connect(destination);
      }
      for (const track of destination.stream.getAudioTracks())
        current.mixed.addTrack(track);
    }
    const settings = screenTrack.getSettings?.() || {},
      hasShared = screen.getAudioTracks().length > 0;
    const parts = [
      settings.width && settings.height
        ? settings.width + " × " + settings.height
        : "Size decided by browser",
      settings.frameRate
        ? Math.round(settings.frameRate) + " fps"
        : "Frame rate decided by browser",
      hasShared ? "Shared audio on" : "No shared audio",
      current.mic ? "Microphone on" : "Microphone off",
    ];
    const specs = uiJoin(
      parts.flatMap((part, index) => [...(index ? [" · "] : []), uiFrom(part)]),
    );
    metrics(0, 0);
    uiText($("#screen-specs"), specs);
    for (let n = 3; n > 0; n--) {
      waitFor(current, "countdown", uiMsg("Recording starts in {0}…", [n]));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (attempt !== current) return;
      if (screenTrack.readyState === "ended") {
        sourceEnded(current);
        return;
      }
    }
    current.phase = null;
    current.recording = makeRecording(current.mixed, {
      types: VIDEO_TYPES,
      maxSeconds: 600,
      maxBytes: 250000000,
      onTick({ seconds, bytes }) {
        metrics(seconds, bytes);
      },
      onState(next) {
        state = next;
        controls();
      },
      onComplete(blob, detail) {
        if (attempt !== current) return;
        if (detail.error && result) {
          finish(current);
          message(
            uiMsg(
              "Recording failed. Your previous recording is still available.",
            ),
            true,
          );
          return;
        }
        const url = URL.createObjectURL(blob);
        clearResult();
        result = { blob, url, seconds: detail.seconds, specs };
        video.src = url;
        unsaved = true;
        finish(current);
        message(
          uiMsg("{0}. Recording ready · {1} · {2}. Download to keep it.{3}", [
            detail.reason,
            size(blob.size),
            blob.type.split(";")[0],
            detail.error
              ? uiMsg(
                  " The browser reported an interruption; review the result.",
                )
              : "",
          ]),
        );
      },
      onError(error) {
        if (attempt !== current) return;
        finish(current);
        message(
          result
            ? uiMsg(
                "Recording failed. Your previous recording is still available.",
              )
            : mediaError(error),
          true,
        );
      },
    });
    current.recording.start();
    for (const track of audioTracks)
      track.addEventListener(
        "ended",
        () => current.recording?.stop("An audio capture source ended"),
        { once: true },
      );
    video.pause();
    video.hidden = true;
    live.srcObject = screen;
    live.hidden = false;
    live.play().catch(() => {});
    placeholder.hidden = true;
    message(
      includeShared && !hasShared
        ? uiMsg(
            "Recording. The browser provided no shared audio track; your video is still being captured.",
          )
        : uiMsg(
            "Recording on this device. Switch to your content whenever you are ready.",
          ),
    );
  } catch (error) {
    if (attempt !== current) return;
    const blockedMic =
      current.phase === "microphone" &&
      ["NotAllowedError", "SecurityError"].includes(error?.name);
    finish(current);
    message(
      blockedMic
        ? uiMsg(
            "Microphone permission was not granted. Allow microphone access for this site and for your browser app in system settings, then try again.",
          )
        : mediaError(error),
      true,
    );
  }
};
cancel.onclick = () => {
  if (!attempt?.phase) return;
  const countdown = attempt.phase === "countdown";
  finish(attempt);
  message(
    countdown
      ? uiMsg("Countdown cancelled. Ready to capture again.")
      : uiMsg("Capture cancelled. Ready to try again."),
  );
  start.focus();
};
$("#screen-stop").onclick = () => attempt?.recording?.stop("Stopped by you");
$("#screen-pause").onclick = () => {
  const recording = attempt?.recording;
  if (recording?.state === "paused") {
    recording.resume();
    message(uiMsg("Recording resumed."));
  } else if (recording?.state === "recording") {
    recording.pause();
    message(
      uiMsg(
        "Paused. Capture permissions remain active; the 10-minute elapsed limit still applies.",
      ),
    );
  }
};
$("#screen-download").onclick = () => {
  if (!result) return;
  const extension = result.blob.type.includes("mp4") ? "mp4" : "webm";
  download(
    result.blob,
    "kensei-screen-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "." +
      extension,
  );
  unsaved = false;
  message(
    uiMsg("Download requested. Check your downloads before leaving this page."),
  );
};
$("#screen-discard").onclick = () => {
  clearResult();
  showResult();
  controls();
  message(uiMsg("Recording discarded. Ready for a new capture."));
};
window.addEventListener("beforeunload", (event) => {
  if (unsaved || state !== "idle") {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  if (!attempt) return;
  finish(attempt);
  message(uiMsg("Capture cancelled. Ready to try again."));
});
if (!supported)
  message(
    uiMsg(
      "Screen recording is unavailable in this browser. Try a current desktop Chrome, Edge, Firefox or Safari browser.",
    ),
    true,
  );
controls();

window.KenseiAdvancedContexts ||= {};
window.KenseiAdvancedContexts["screen-recorder"] = {
  get result() {
    return result?.blob ?? null;
  },
};
