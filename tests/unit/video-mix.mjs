import assert from "node:assert/strict";
import { makeTimeline } from "../../src/tools/video-timeline.js";
import {
  audioCut,
  audioLength,
  defaultLevels,
  editHistory,
  validateAudioClips,
  videoMix,
} from "../../src/tools/video-mix.js";

const assets = {
  v: { duration: 2000, hasAudio: true },
  music: { duration: 4000, hasAudio: true },
  voice: { duration: 4000, hasAudio: true },
};
const timeline = makeTimeline([{ source: "v", start: 0, end: 2000 }], assets);
const music = {
  id: "m",
  source: "music",
  lane: 1,
  at: 0,
  start: 0,
  end: 1500,
  volume: 50,
};
const voice = {
  id: "n",
  source: "voice",
  lane: 2,
  at: 15,
  start: 0,
  end: 2000,
  volume: 100,
};
validateAudioClips([music, voice], assets);
assert.throws(
  () => validateAudioClips([music, { ...voice, lane: 1 }], assets),
  /cannot overlap/,
);
assert.throws(
  () => validateAudioClips([{ ...voice, at: 8999 }], assets),
  /five-minute/,
);
assert.equal(audioCut(music, 12), 400);
assert.equal(audioCut(voice, 15), undefined);
assert.equal(audioCut(voice, 75), undefined);
assert.equal(audioLength(music), 45);
const mix = videoMix(timeline, [music, voice], defaultLevels(), assets);
assert.equal(mix.scale, 0.4);
assert.equal(mix.lanes[2][0].stop, 60);
const shortened = makeTimeline([{ source: "v", start: 0, end: 500 }], assets);
assert.equal(
  videoMix(shortened, [music, voice], defaultLevels(), assets).lanes[2].length,
  0,
);
assert.equal(voice.at, 15);
assert.equal(voice.end, 2000);
assert.equal(
  videoMix(
    timeline,
    [music, voice],
    [
      { volume: 100, muted: false },
      { volume: 100, muted: true },
      { volume: 60, muted: false },
    ],
    assets,
  ).scale,
  0.625,
);
assert.equal(
  videoMix(
    timeline,
    [music, voice],
    defaultLevels().map((s) => ({ ...s, muted: true })),
    assets,
  ).audible,
  false,
);
const history = editHistory(2);
history.push("first");
history.push("second");
history.push("third");
assert.equal(history.undo("current"), "third");
assert.equal(history.undo("third"), "second");
assert.equal(history.undo("second"), null);
assert.equal(history.redo("second"), "third");
history.push("third");
assert.equal(history.canRedo, false);
console.log(
  "PASS audio overlap, source trims, cuts, clipping to video, shared gain headroom and undo/redo limits",
);
