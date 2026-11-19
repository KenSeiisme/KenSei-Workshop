import { frameRate, videoLimits, timelineCut } from "./video-timeline.js";

export const audioLanes = [1, 2];
export const defaultLevels = () =>
  [0, ...audioLanes].map(() => ({ volume: 100, muted: false }));
export const sampleRate = 48000;
export const framesPerSampleBlock = sampleRate / frameRate;
export const maxFrames = (videoLimits.outputMs * frameRate) / 1000;
export const toFrame = (ms) => Math.round((ms * frameRate) / 1000);
export const audioLength = (clip) =>
  Math.max(1, toFrame(clip.end - clip.start));

export function validateAudioClips(clips, assets) {
  for (const clip of clips) {
    if (
      !audioLanes.includes(clip.lane) ||
      !assets[clip.source] ||
      ![clip.at, clip.start, clip.end].every(Number.isInteger) ||
      clip.at < 0 ||
      clip.start < 0 ||
      clip.end <= clip.start ||
      clip.end > assets[clip.source].duration ||
      clip.at + audioLength(clip) > maxFrames ||
      !Number.isInteger(clip.volume) ||
      clip.volume < 0 ||
      clip.volume > 100
    )
      throw Error(
        "Keep audio trims within the source and the five-minute timeline.",
      );
  }
  for (const lane of audioLanes) {
    const sorted = clips
      .filter((clip) => clip.lane === lane)
      .sort((a, b) => a.at - b.at);
    if (sorted.length > videoLimits.clips)
      throw Error("Keep at most twelve clips on each audio track.");
    if (
      sorted.some(
        (clip, index) =>
          index &&
          clip.at < sorted[index - 1].at + audioLength(sorted[index - 1]),
      )
    )
      throw Error("Clips on the same audio track cannot overlap.");
  }
}

export function audioCut(clip, frame) {
  return timelineCut(
    {
      frames: audioLength(clip) + clip.at,
      segments: [{ ...clip, firstFrame: clip.at, frames: audioLength(clip) }],
    },
    frame,
  )?.at;
}

export function videoMix(plan, clips, levels, sources) {
  const limit = plan?.frames ?? 0;
  const lanes = [
    (plan?.segments ?? [])
      .filter((segment) => sources[segment.source]?.hasAudio)
      .map((segment) => ({ ...segment, at: segment.firstFrame, volume: 100 })),
    ...audioLanes.map((lane) =>
      clips
        .filter((clip) => clip.lane === lane)
        .map((clip) => ({ ...clip, frames: audioLength(clip) })),
    ),
  ].map((clips, index) =>
    clips
      .filter((clip) => clip.at < limit)
      .sort((a, b) => a.at - b.at)
      .map((clip) => ({
        ...clip,
        stop: Math.min(limit, clip.at + clip.frames),
        gain: levels[index].muted
          ? 0
          : (levels[index].volume * clip.volume) / 10000,
      })),
  );
  const edges = lanes.flatMap((lane) =>
    lane.flatMap(({ at, stop, gain }) => [
      [at, gain],
      [stop, -gain],
    ]),
  );
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0,
    peak = 1;
  for (const [, change] of edges) {
    total += change;
    peak = Math.max(peak, total);
  }
  return {
    lanes,
    scale: 1 / peak,
    audible: lanes.some((lane) => lane.some((clip) => clip.gain > 0)),
  };
}

export function editHistory(limit = 50) {
  const undo = [],
    redo = [];
  return {
    get canUndo() {
      return !!undo.length;
    },
    get canRedo() {
      return !!redo.length;
    },
    push(state) {
      undo.push(state);
      if (undo.length > limit) undo.shift();
      redo.length = 0;
    },
    undo(state) {
      if (!undo.length) return null;
      redo.push(state);
      return undo.pop();
    },
    redo(state) {
      if (!redo.length) return null;
      undo.push(state);
      return redo.pop();
    },
    states() {
      return [...undo, ...redo];
    },
    trim() {
      if (undo.length) undo.shift();
      else redo.shift();
    },
  };
}
