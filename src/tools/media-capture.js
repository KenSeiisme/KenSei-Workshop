// 原生录制共用生命周期；不保存或上传捕获内容。
export const AUDIO_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
];
export const VIDEO_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/mp4",
  "video/webm",
];
export function recordingType(types, Recorder = globalThis.MediaRecorder) {
  if (!Recorder) throw Error("Recording is not available in this browser.");
  return types.find((type) => Recorder.isTypeSupported(type)) || "";
}
export function stopTracks(...streams) {
  const tracks = new Set(
    streams.flatMap((stream) => stream?.getTracks?.() || []),
  );
  tracks.forEach((track) => {
    try {
      track.stop();
    } catch {}
  });
}
export function mediaError(error) {
  const messages = {
    NotAllowedError:
      "Permission was not granted. Start again when you are ready to allow access.",
    NotFoundError: "No matching device or capture source is available.",
    NotReadableError:
      "The device or source could not be read. It may be in use by another application.",
    InvalidStateError: "Return to this tab and click Start again.",
    SecurityError: "Recording is blocked by this browser or page permissions.",
    AbortError: "Capture was cancelled. You can start again.",
  };
  return (
    messages[error?.name] || error?.message || "Capture failed. Please retry."
  );
}
export function clockText(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
export function makeRecording(
  stream,
  {
    types = AUDIO_TYPES,
    maxSeconds = 300,
    maxBytes = 50000000,
    onTick = () => {},
    onState = () => {},
    onComplete = () => {},
    onError = () => {},
    Recorder = globalThis.MediaRecorder,
    now = () => performance.now(),
  } = {},
) {
  const type = recordingType(types, Recorder);
  const recorder = new Recorder(stream, type ? { mimeType: type } : {});
  let chunks = [],
    bytes = 0,
    started = 0,
    pausedAt = null,
    pausedFor = 0,
    timer = null,
    finalTimer = null,
    stopped = false,
    disposed = false,
    reason = "Stopped",
    failure = null,
    endedAt = null;
  const elapsed = () =>
    Math.max(0, ((pausedAt ?? now()) - started - pausedFor) / 1000);
  const clean = () => {
    clearInterval(timer);
    clearTimeout(finalTimer);
    timer = null;
    stream
      .getTracks()
      .forEach((track) => track.removeEventListener("ended", ended));
    stopTracks(stream);
  };
  function stop(why = "Stopped") {
    if (stopped || disposed) return;
    stopped = true;
    endedAt = now();
    reason = why;
    clearInterval(timer);
    if (recorder.state !== "inactive") {
      onState("stopping");
      try {
        recorder.stop();
      } catch (error) {
        failure = error;
        complete();
      }
    } else complete();
  }
  function ended() {
    stop("Capture source ended");
  }
  function complete() {
    const seconds = Math.max(
      0,
      ((pausedAt ?? endedAt ?? now()) - started - pausedFor) / 1000,
    );
    clean();
    if (disposed) return;
    disposed = true;
    const blob = new Blob(chunks, {
      type:
        recorder.mimeType ||
        type ||
        (stream.getVideoTracks().length ? "video/webm" : "audio/webm"),
    });
    chunks = [];
    onState("idle");
    if (blob.size)
      onComplete(blob, { seconds, reason, error: failure, type: blob.type });
    else
      onError(
        failure ||
          Error(
            "No recording data was produced. Please record for a moment and try again.",
          ),
      );
  }
  recorder.ondataavailable = ({ data }) => {
    if (disposed || !data?.size) return;
    if (bytes + data.size > maxBytes) {
      stop("Recording size limit reached");
      return;
    }
    chunks.push(data);
    bytes += data.size;
    if (bytes >= maxBytes) stop("Recording size limit reached");
  };
  recorder.onerror = (event) => {
    failure =
      event.error || Error("The browser stopped recording unexpectedly.");
    if (recorder.state === "inactive") {
      stopped = true;
      endedAt = now();
      reason = "Recording interrupted";
      clearInterval(timer);
      onState("stopping");
      // 错误事件后浏览器通常仍发送最终 dataavailable 和 stop，先接收再收尾。
      finalTimer = setTimeout(complete, 1000);
    } else stop("Recording interrupted");
  };
  recorder.onstop = complete;
  stream.getTracks().forEach((track) => track.addEventListener("ended", ended));
  return {
    start() {
      started = now();
      try {
        recorder.start(1000);
      } catch (error) {
        clean();
        disposed = true;
        throw error;
      }
      onState("recording");
      timer = setInterval(() => {
        onTick({
          seconds: elapsed(),
          bytes,
          wallSeconds: (now() - started) / 1000,
        });
        if (now() - started >= maxSeconds * 1000 - 200)
          stop("Recording time limit reached");
      }, 200);
    },
    pause() {
      if (!disposed && !stopped && recorder.state === "recording") {
        recorder.pause();
        pausedAt = now();
        onState("paused");
      }
    },
    resume() {
      if (!disposed && !stopped && recorder.state === "paused") {
        pausedFor += now() - pausedAt;
        pausedAt = null;
        recorder.resume();
        onState("recording");
      }
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true;
      recorder.onstop = recorder.ondataavailable = recorder.onerror = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {}
      chunks = [];
      clean();
    },
    get state() {
      return disposed ? "inactive" : recorder.state;
    },
  };
}
