import assert from "node:assert/strict";
import {
  makeTimeline,
  timelineCues,
  exportSettings,
} from "../../src/tools/video-timeline.js";
const sources = {
  a: {
    duration: 2000,
    cues: [
      { start: 300, end: 1100, text: "A" },
      { start: 900, end: 1800, text: "B" },
    ],
  },
  b: { duration: 1000, cues: [{ start: 100, end: 900, text: "字幕" }] },
};
const clips = [
  { source: "b", start: 600, end: 1000 },
  { source: "a", start: 800, end: 1300 },
  { source: "b", start: 0, end: 400 },
];
const timeline = makeTimeline(clips, sources);
assert.equal(timeline.duration, 1300);
assert.deepEqual(timelineCues(timeline, sources), [
  { start: 0, end: 300, text: "字幕" },
  { start: 400, end: 700, text: "A" },
  { start: 500, end: 900, text: "B" },
  { start: 1000, end: 1300, text: "字幕" },
]);
assert.throws(
  () => makeTimeline([{ source: "b", start: 0, end: 1100 }], sources),
  /valid start/,
);
assert.throws(
  () =>
    makeTimeline([{ source: "a", start: 0, end: 300001 }], {
      a: { duration: 600000 },
    }),
  /five minutes/,
);
assert.deepEqual(exportSettings("standard", "720", "portrait"), {
  width: 720,
  height: 1280,
  bitrate: 2500000,
});
console.log(
  "PASS clip, repeated/reordered and crossed-boundary subtitle timing, export limits",
);
