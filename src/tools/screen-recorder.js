import { $, download, size } from "./common.js";
import {
  VIDEO_TYPES,
  makeRecording,
  stopTracks,
  mediaError,
  clockText,
} from "./media-capture.js";
import { uiJoin, uiFrom, uiMsg, uiText, uiConfirm } from "../site/ui.js";

let capture = null,
  microphone = null,
  mixed = null,
  audio = null,
  recording = null,
  result = null,
  resultUrl = null,
  pending = false,
  unsaved = false,
  generation = 0,
  state = "idle";
const message = (text, error = false) => {
  uiText($("#screen-status"), text);
  $("#screen-status").classList.toggle("error-text", error);
};
const supported = Boolean(
  navigator.mediaDevices?.getDisplayMedia && globalThis.MediaRecorder,
);
function controls() {
  $("#screen-start").disabled = !supported || pending || state !== "idle";
  $("#screen-pause").disabled = !["recording", "paused"].includes(state);
  uiText(
    $("#screen-pause"),
    state === "paused" ? uiMsg("Resume") : uiMsg("Pause"),
  );
  $("#screen-stop").disabled = !["recording", "paused"].includes(state);
  $("#screen-microphone").disabled = $("#screen-shared-audio").disabled =
    pending || state !== "idle";
  $("#screen-download").disabled = $("#screen-discard").disabled =
    !result || pending || state !== "idle";
}
function release() {
  // 原始音轨也要释放；混音流停止不会自动关闭麦克风。
  stopTracks(capture, microphone, mixed);
  capture = microphone = mixed = null;
  audio?.close().catch(() => {});
  audio = null;
  $("#screen-live").srcObject = null;
  $("#screen-live").hidden = true;
}
function discard() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  result = null;
  unsaved = false;
  const video = $("#screen-result");
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.hidden = true;
  $("#screen-placeholder").hidden = false;
  controls();
}
$("#screen-start").onclick = async () => {
  if (!supported || pending || state !== "idle") return;
  if (
    unsaved &&
    !uiConfirm(
      uiMsg("Discard the recording you have not downloaded and start again?"),
    )
  )
    return;
  discard();
  const token = ++generation;
  pending = true;
  controls();
  message(
    uiMsg("Choose a tab, window or screen in your browser's capture picker…"),
  );
  let nextCapture = null,
    nextMic = null;
  try {
    const includeShared = $("#screen-shared-audio").checked,
      includeMic = $("#screen-microphone").checked;
    nextCapture = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: includeShared,
      systemAudio: includeShared ? "include" : "exclude",
    });
    if (token !== generation) {
      stopTracks(nextCapture);
      return;
    }
    capture = nextCapture;
    if (!includeShared)
      capture.getAudioTracks().forEach((track) => {
        track.stop();
        capture.removeTrack(track);
      });
    const screenTrack = capture.getVideoTracks()[0];
    if (!screenTrack || screenTrack.readyState === "ended")
      throw Error(
        "The selected screen source ended. Start again to choose another source.",
      );
    if (includeMic) {
      message(uiMsg("Screen selected. Allow microphone access to continue…"));
      nextMic = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (token !== generation) {
        stopTracks(nextCapture, nextMic);
        return;
      }
      microphone = nextMic;
    }
    if (screenTrack.readyState === "ended")
      throw Error(
        "Screen sharing ended before recording started. Please try again.",
      );
    const audioStreams = [capture, microphone].filter(
      (stream) => stream?.getAudioTracks().length,
    );
    mixed = new MediaStream([screenTrack]);
    if (audioStreams.length) {
      audio = new AudioContext();
      if (audio.state === "suspended") await audio.resume();
      if (token !== generation) {
        release();
        return;
      }
      const destination = audio.createMediaStreamDestination();
      audioStreams.forEach((stream) =>
        audio.createMediaStreamSource(stream).connect(destination),
      );
      destination.stream
        .getAudioTracks()
        .forEach((track) => mixed.addTrack(track));
    }
    const settings = screenTrack.getSettings?.() || {},
      hasShared = capture.getAudioTracks().length > 0;
    const parts = [
      settings.width && settings.height
        ? `${settings.width} × ${settings.height}`
        : "Size decided by browser",
      settings.frameRate
        ? `${Math.round(settings.frameRate)} fps`
        : "Frame rate decided by browser",
      hasShared ? "Shared audio on" : "No shared audio",
      microphone ? "Microphone on" : "Microphone off",
    ];
    uiText(
      $("#screen-specs"),
      uiJoin(
        parts.flatMap((part, index) => [
          ...(index ? [" · "] : []),
          uiFrom(part),
        ]),
      ),
    );
    recording = makeRecording(mixed, {
      types: VIDEO_TYPES,
      maxSeconds: 600,
      maxBytes: 250000000,
      onTick({ seconds, bytes }) {
        uiText($("#screen-time"), clockText(seconds));
        uiText($("#screen-bytes"), size(bytes));
      },
      onState(next) {
        state = next;
        controls();
      },
      onComplete(blob, detail) {
        release();
        recording = null;
        result = blob;
        resultUrl = URL.createObjectURL(blob);
        unsaved = true;
        const video = $("#screen-result");
        video.src = resultUrl;
        video.hidden = false;
        $("#screen-placeholder").hidden = true;
        uiText($("#screen-time"), clockText(detail.seconds));
        uiText($("#screen-bytes"), size(blob.size));
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
        controls();
      },
      onError(error) {
        release();
        recording = null;
        state = "idle";
        message(mediaError(error), true);
        controls();
      },
    });
    recording.start();
    for (const track of [
      ...(microphone?.getAudioTracks() || []),
      ...capture.getAudioTracks(),
    ])
      track.addEventListener(
        "ended",
        () => recording?.stop("An audio capture source ended"),
        { once: true },
      );
    uiText($("#screen-time"), "00:00");
    uiText($("#screen-bytes"), uiMsg("0 MB"));
    $("#screen-live").srcObject = capture;
    $("#screen-live").hidden = false;
    $("#screen-live")
      .play()
      .catch(() => {});
    $("#screen-placeholder").hidden = true;
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
    if (token !== generation) {
      stopTracks(nextCapture, nextMic);
      return;
    }
    recording?.dispose();
    recording = null;
    release();
    state = "idle";
    $("#screen-placeholder").hidden = false;
    message(mediaError(error), true);
  } finally {
    if (token === generation) {
      pending = false;
      controls();
    }
  }
};
$("#screen-stop").onclick = () => recording?.stop("Stopped by you");
$("#screen-pause").onclick = () => {
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
  const extension = result.type.includes("mp4") ? "mp4" : "webm";
  download(
    result,
    `kensei-screen-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
  );
  unsaved = false;
  message(
    uiMsg("Download requested. Check your downloads before leaving this page."),
  );
};
$("#screen-discard").onclick = () => {
  discard();
  message(uiMsg("Recording discarded. Ready for a new capture."));
};
window.addEventListener("beforeunload", (event) => {
  if (unsaved || pending || state !== "idle") {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  generation++;
  recording?.dispose();
  recording = null;
  release();
  pending = false;
  state = "idle";
  controls();
});
if (!supported)
  message(
    uiMsg(
      "Screen recording is unavailable in this browser. Try a current desktop Chrome, Edge, Firefox or Safari browser.",
    ),
    true,
  );
controls();
