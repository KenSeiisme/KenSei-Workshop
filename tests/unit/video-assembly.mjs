import assert from "node:assert/strict";
import {
  captionTracks,
  clipSpan,
  defaultBox,
  fitBox,
  initialTracks,
  layersAt,
  makeAssembly,
  validatePositioned,
} from "../../src/tools/video-assembly.js";
import {
  exportSettings,
  exactMs,
  frameRate,
  mediaTick,
  timelineCut,
} from "../../src/tools/video-timeline.js";
import { videoMix, defaultLevels } from "../../src/tools/video-mix.js";

const sources = {
  main: {
    kind: "video",
    duration: 5000,
    hasAudio: true,
    cues: [{ start: 100, end: 1600, text: "linked caption" }],
  },
  guest: { kind: "video", duration: 5000, hasAudio: true, cues: [] },
  music: { kind: "audio", duration: 5000, hasAudio: true },
};
const base = [{ id: "main", source: "main", start: 0, end: 1000 }];
const tracks = [
  { id: "v1", kind: "video" },
  { id: "v2", kind: "video" },
  ...initialTracks(),
  { id: 6, kind: "audio" },
  { id: "s1", kind: "captions" },
];
const overlay = {
  id: "pip",
  source: "guest",
  at: 15.5,
  lane: "v1",
  start: 0,
  end: 1000,
  volume: 100,
};
const cover = {
  id: "broll",
  source: "guest",
  at: 15.5,
  lane: "v2",
  start: 100,
  end: 300,
  volume: 100,
  full: true,
};
const audio = {
  id: "song",
  source: "music",
  at: 15.5,
  lane: 6,
  start: 0,
  end: 2000,
  volume: 50,
};
const cue = {
  id: "caption",
  lane: "s1",
  at: 15.5,
  start: 0,
  end: 1500,
  text: "中文字幕",
};
const placed = [overlay, cover, audio, cue];
validatePositioned(placed, sources, tracks);
assert.throws(
  () =>
    validatePositioned(
      [...placed, { ...overlay, id: "overlap" }],
      sources,
      tracks,
    ),
  /same video track/,
);
assert.throws(
  () =>
    validatePositioned(
      [...placed, { ...audio, id: "overflow", at: 8999 }],
      sources,
      tracks,
    ),
  /five-minute/,
);
const plan = makeAssembly(base, sources, tracks, placed);
assert.equal(plan.frames, 45.5);
assert.equal(clipSpan(overlay), 30);
assert.equal(mediaTick(15.5), 1550);
assert.equal(timelineCut(plan.primary, 15.5).at, exactMs(15.5));
assert.deepEqual(
  layersAt(plan, 15.5).map((entry) => entry.id),
  [0, "v2", "v1"],
);
assert.equal(layersAt(plan, 20).at(-1).clip.box, defaultBox);
assert.equal(layersAt(plan, 20).at(-2).clip.box.size, 1);
assert.ok(!layersAt(plan, 31)[0].clip);
assert.equal(
  captionTracks(plan, sources, tracks, placed)[1].cues[0].end,
  plan.duration,
);
const mix = videoMix(plan, placed, defaultLevels(), sources);
assert.equal(mix.lanes[mix.ids.indexOf("v1")][0].gain, 0);
assert.equal(mix.lanes[mix.ids.indexOf(6)][0].gain, 0.5);
const loud = videoMix(
  plan,
  placed,
  { 0: { volume: 100 }, v1: { volume: 100 } },
  sources,
);
assert.equal(loud.scale, 0.4);
const trimmed = makeAssembly(
  base,
  sources,
  tracks.map((track) =>
    track.kind === "video" ? { ...track, hidden: true } : track,
  ),
  placed,
);
assert.equal(trimmed.frames, frameRate);
assert.equal(placed.length, 4);
const settings = exportSettings("high", "1440", "portrait", 60);
assert.deepEqual(settings, {
  width: 1440,
  height: 2560,
  bitrate: 25600000,
  fps: 60,
});
const fit = fitBox(defaultBox, 1440, 2560, 320, 180);
assert.ok(Math.abs(fit.w / fit.h - 16 / 9) < 1e-12);
console.log(
  "PASS exact 30/60 timing, layering and visibility, cross-track mixing, captions and portrait export settings",
);
