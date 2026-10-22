import assert from "node:assert/strict";
import fs from "node:fs";
const { makeRecording, recordingType, stopTracks, clockText, VIDEO_TYPES } =
  await import(
    "data:text/javascript;base64," +
      fs.readFileSync("src/tools/media-capture.js").toString("base64")
  );
class Track extends EventTarget {
  constructor() {
    super();
    this.stops = 0;
  }
  stop() {
    this.stops++;
  }
}
class Recorder {
  static supported = true;
  static isTypeSupported(type) {
    return this.supported && type.includes("webm");
  }
  constructor(stream, options) {
    this.state = "inactive";
    this.mimeType = options?.mimeType || "audio/webm";
    Recorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["end"]) });
    this.onstop?.();
  }
  chunk(text) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
}
let time = 0,
  tick = null;
const originalSet = globalThis.setInterval,
  originalClear = globalThis.clearInterval;
globalThis.setInterval = (fn) => {
  tick = fn;
  return 1;
};
globalThis.clearInterval = () => {
  tick = null;
};
const make = (options = {}) => {
  const track = new Track(),
    stream = { getTracks: () => [track], getVideoTracks: () => [] };
  const completions = [],
    failures = [],
    states = [];
  const recording = makeRecording(stream, {
    Recorder,
    now: () => time,
    onComplete: (...args) => completions.push(args),
    onError: (error) => failures.push(error),
    onState: (state) => states.push(state),
    ...options,
  });
  return { recording, track, completions, failures, states };
};
try {
  assert.equal(clockText(125.9), "02:05");
  assert.match(recordingType(VIDEO_TYPES, Recorder), /webm/);
  Recorder.supported = false;
  assert.equal(recordingType(VIDEO_TYPES, Recorder), "");
  Recorder.supported = true;
  const first = make();
  first.recording.start();
  time = 2000;
  first.recording.pause();
  time = 7000;
  first.recording.resume();
  time = 9000;
  Recorder.last.chunk("start");
  first.recording.stop("manual");
  assert.equal(first.completions.length, 1);
  assert.equal(first.completions[0][1].seconds, 4);
  assert.equal(await first.completions[0][0].text(), "startend");
  assert.equal(first.track.stops, 1);
  first.recording.stop();
  Recorder.last.onstop?.();
  assert.equal(first.completions.length, 1);
  const ended = make();
  ended.recording.start();
  Recorder.last.chunk("frame");
  ended.track.dispatchEvent(new Event("ended"));
  assert.equal(ended.completions[0][1].reason, "Capture source ended");
  const limit = make({ maxBytes: 5 });
  limit.recording.start();
  Recorder.last.chunk("1234");
  Recorder.last.chunk("too large");
  assert.equal(limit.completions[0][0].size, 4);
  assert.equal(limit.completions[0][1].reason, "Recording size limit reached");
  const duration = make({ maxSeconds: 3 });
  duration.recording.start();
  Recorder.last.chunk("data");
  time += 3000;
  tick();
  assert.equal(
    duration.completions[0][1].reason,
    "Recording time limit reached",
  );
  const disposed = make();
  disposed.recording.start();
  Recorder.last.chunk("secret");
  disposed.recording.dispose();
  Recorder.last.onstop?.();
  assert.equal(disposed.completions.length, 0);
  assert.equal(disposed.track.stops, 1);
  const empty = make({ maxBytes: 1 });
  empty.recording.start();
  empty.recording.stop();
  assert.equal(empty.failures.length, 1);
  assert.equal(empty.completions.length, 0);
  const broken = make();
  broken.recording.start();
  Recorder.last.onerror({ error: Error("device lost") });
  assert.equal(broken.completions.length + broken.failures.length, 1);
  assert.equal(broken.track.stops, 1);
  const asynchronousError = make();
  asynchronousError.recording.start();
  Recorder.last.state = "inactive";
  Recorder.last.onerror({ error: Error("native error") });
  Recorder.last.chunk("final data");
  Recorder.last.onstop();
  assert.equal(await asynchronousError.completions[0][0].text(), "final data");
  assert.equal(
    asynchronousError.completions[0][1].error.message,
    "native error",
  );
  let stops = 0;
  const track = {
      stop() {
        stops++;
      },
    },
    stream = { getTracks: () => [track] };
  stopTracks(stream, stream);
  assert.equal(stops, 1);
  console.log(
    "PASS capture pause duration, source ending, time/byte caps, final chunks, error/dispose cleanup and once-only completion",
  );
} finally {
  globalThis.setInterval = originalSet;
  globalThis.clearInterval = originalClear;
}
