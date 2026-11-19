export const videoLimits = Object.freeze({
  sources: 6,
  fileBytes: 250_000_000,
  totalBytes: 500_000_000,
  sourceMs: 600_000,
  clips: 12,
  outputMs: 300_000,
});
export const frameRate = 30;
export const frameMs = (index) => Math.round((index * 1000) / frameRate);

const frameCount = (duration) =>
  Math.max(1, Math.round((duration * frameRate) / 1000));

export function makeTimeline(clips, sources) {
  if (!clips.length || clips.length > videoLimits.clips)
    throw Error("Keep between one and twelve video clips.");
  let cursor = 0;
  const segments = clips.map(({ source, start, end }) => {
    const duration = sources[source]?.duration;
    if (
      !Number.isFinite(duration) ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > duration ||
      end <= start
    )
      throw Error("Each clip needs a valid start and end within its video.");
    const frames = frameCount(end - start);
    const item = { source, start, end, firstFrame: cursor, frames };
    cursor += frames;
    return item;
  });
  if (
    frameMs(cursor) > videoLimits.outputMs ||
    segments.reduce((total, clip) => total + clip.end - clip.start, 0) >
      videoLimits.outputMs
  )
    throw Error("Keep the finished video to five minutes.");
  return { segments, frames: cursor, duration: frameMs(cursor) };
}

export function timelinePosition(plan, frame) {
  if (!plan?.frames) return null;
  frame = Math.max(0, Math.min(plan.frames - 1, Math.round(frame)));
  const index = plan.segments.findIndex(
    (segment) => frame < segment.firstFrame + segment.frames,
  );
  const segment = plan.segments[index];
  const sourceMs = Math.min(
    segment.end - 0.001,
    segment.start + ((frame - segment.firstFrame) * 1000) / frameRate,
  );
  return { index, segment, frame, sourceMs };
}

export function timelineCut(plan, frame) {
  if (!plan || frame <= 0 || frame >= plan.frames) return null;
  const position = timelinePosition(plan, frame);
  const { segment, sourceMs } = position;
  const framesBefore = frame - segment.firstFrame;
  if (!framesBefore || framesBefore >= segment.frames) return null;
  // Millisecond boundaries can round either way. Preserve both frame counts.
  const nearest = [
    Math.round(sourceMs),
    Math.floor(sourceMs),
    Math.ceil(sourceMs),
  ];
  const at = nearest.find(
    (ms) =>
      ms > segment.start &&
      ms < segment.end &&
      frameCount(ms - segment.start) === framesBefore &&
      frameCount(segment.end - ms) === segment.frames - framesBefore,
  );
  return at === undefined ? null : { index: position.index, at };
}

export function cutClips(clips, cut, rightId) {
  const clip = clips[cut.index];
  return clips.toSpliced(
    cut.index,
    1,
    { ...clip, end: cut.at },
    { ...clip, id: rightId, start: cut.at },
  );
}

export function insertAtFrame(clips, plan, frame, copy, rightId) {
  if (!plan || frame >= plan.frames) return [...clips, copy];
  const { index, segment } = timelinePosition(plan, frame);
  if (frame <= segment.firstFrame) return clips.toSpliced(index, 0, copy);
  const cut = timelineCut(plan, frame);
  if (!cut) throw Error("Choose a frame where the clip can be split.");
  return cutClips(clips, cut, rightId).toSpliced(index + 1, 0, copy);
}

export function timelineCues(timeline, sources) {
  return timeline.segments
    .flatMap((segment) => {
      const begin = frameMs(segment.firstFrame);
      const end = frameMs(segment.firstFrame + segment.frames);
      return (sources[segment.source].cues || []).flatMap((cue) => {
        const start = Math.max(segment.start, cue.start);
        const stop = Math.min(segment.end, cue.end);
        const from = begin + start - segment.start;
        const to =
          stop === segment.end
            ? end
            : Math.min(end, begin + stop - segment.start);
        if (stop <= start || to <= from) return [];
        return [{ start: from, end: to, text: cue.text }];
      });
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export const containers = Object.freeze({
  mp4: { video: "avc", audio: "aac", mime: "video/mp4" },
  webm: { video: "vp8", audio: "opus", mime: "video/webm" },
});
export function exportSettings(quality, resolution, orientation) {
  const side = resolution === "1080" ? 1080 : 720;
  const long = side === 1080 ? 1920 : 1280;
  const width = orientation === "portrait" ? side : long;
  const height = orientation === "portrait" ? long : side;
  const bitrate =
    { low: 1_250_000, standard: 2_500_000, high: 5_000_000 }[quality] *
    (side === 1080 ? 1.8 : 1);
  return { width, height, bitrate };
}
