import assert from "node:assert/strict";
import {
  makeTimeline,
  timelineCues,
  exportSettings,
  timelinePosition,
  timelineCut,
  cutClips,
  insertAtFrame,
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
assert.deepEqual(timelinePosition(timeline, 12), {
  index: 1,
  segment: timeline.segments[1],
  frame: 12,
  sourceMs: 800,
});
assert.equal(
  timelinePosition(timeline, timeline.frames).frame,
  timeline.frames - 1,
);
assert.equal(timelineCut(timeline, 12), null);
for (let ms = 1; ms <= 500; ms++) {
  const original = [{ id: "a", source: "a", start: 17, end: ms + 17 }];
  const base = makeTimeline(original, sources);
  for (let frame = 1; frame < base.frames; frame++) {
    const cut = timelineCut(base, frame);
    assert.ok(cut, "representable split for " + ms + "/" + frame);
    const next = makeTimeline(cutClips(original, cut, "right"), sources);
    assert.equal(next.frames, base.frames);
    assert.equal(next.segments[1].firstFrame, frame);
  }
}
const duplicate = { ...clips[0], id: "paste" };
const inserted = makeTimeline(
  insertAtFrame(clips, timeline, 15, duplicate, "r"),
  sources,
);
assert.equal(inserted.frames, 51);
assert.equal(inserted.segments[2].firstFrame, 15);
assert.equal(inserted.segments[3].start, 900);
assert.equal(insertAtFrame(clips, timeline, 12, duplicate, "unused").length, 4);
assert.equal(
  insertAtFrame(clips, timeline, timeline.frames, duplicate, "unused").at(-1),
  duplicate,
);
assert.throws(() => makeTimeline(Array(13).fill(duplicate), sources), /twelve/);
assert.throws(
  () =>
    makeTimeline(
      insertAtFrame(
        [{ source: "long", start: 0, end: 300000 }],
        { frames: 9000 },
        9000,
        duplicate,
        "r",
      ),
      { ...sources, long: { duration: 600000 } },
    ),
  /five minutes/,
);
console.log(
  "PASS clip, repeated/reordered and crossed-boundary subtitle timing, export limits",
);
