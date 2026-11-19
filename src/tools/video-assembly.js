import { validateCue } from "./subtitle-core.js";
import {
  exactMs,
  frameMs,
  makeTimeline,
  mediaTick,
  timelineCues,
  units,
  videoLimits,
} from "./video-timeline.js";

export const trackLimits = { video: 2, audio: 6, captions: 4 };
export const initialTracks = () => [1, 2].map((id) => ({ id, kind: "audio" }));
export const kindOf = (id) =>
  id === 0 || String(id).startsWith("v")
    ? "video"
    : typeof id === "number"
      ? "audio"
      : "captions";
export const clipSpan = (clip) => mediaTick(units(clip.end - clip.start)) / 100;
export const clipEnd = (clip) =>
  (mediaTick(clip.at) + mediaTick(clipSpan(clip))) / 100;
export const defaultBox = { x: 0.65, y: 0.65, size: 0.31 };
export const fullBox = { x: 0, y: 0, size: 1 };
export const clampBox = ({ x, y, size }) => {
  size = Math.max(0.15, Math.min(1, size));
  return {
    x: Math.max(0, Math.min(1 - size, x)),
    y: Math.max(0, Math.min(1 - size, y)),
    size,
  };
};
export function fitBox(box, width, height, sourceWidth, sourceHeight) {
  const scale = Math.min(
    (width * box.size) / sourceWidth,
    (height * box.size) / sourceHeight,
  );
  const w = scale * sourceWidth,
    h = scale * sourceHeight;
  return {
    x: box.x * width + (width * box.size - w) / 2,
    y: box.y * height + (height * box.size - h) / 2,
    w,
    h,
  };
}
export function validatePositioned(clips, sources, tracks) {
  for (const clip of clips) {
    const track = tracks.find(({ id }) => id === clip.lane);
    if (
      !track ||
      ![clip.at, clip.start, clip.end].every(Number.isFinite) ||
      clip.at < 0 ||
      clip.start < 0 ||
      clip.end <= clip.start ||
      clipEnd(clip) > units(videoLimits.outputMs)
    )
      throw Error("Keep clips within the five-minute timeline.");
    if (track.kind === "captions") {
      validateCue({
        start: frameMs(clip.at),
        end: frameMs(clipEnd(clip)),
        text: clip.text,
      });
    } else {
      const source = sources[clip.source];
      if (
        !source ||
        source.kind !== track.kind ||
        clip.end > source.duration ||
        !Number.isInteger(clip.volume) ||
        clip.volume < 0 ||
        clip.volume > 100
      )
        throw Error("Keep clip trims within the source.");
    }
  }
  for (const { id, kind } of tracks) {
    const items = clips
      .filter((c) => c.lane === id)
      .sort((a, b) => a.at - b.at);
    if (items.length > (kind === "captions" ? 5000 : videoLimits.clips))
      throw Error(
        kind === "captions"
          ? "Use at most 5,000 cues."
          : "Keep at most twelve clips per track.",
      );
    if (
      kind !== "captions" &&
      items.some(
        (clip, i) => i && mediaTick(clip.at) < mediaTick(clipEnd(items[i - 1])),
      )
    )
      throw Error(
        kind === "audio"
          ? "Clips on the same audio track cannot overlap."
          : "Clips on the same video track cannot overlap.",
      );
  }
}
export function makeAssembly(clips, sources, tracks, positioned) {
  const primary = clips.length ? makeTimeline(clips, sources, true) : null;
  const layers = [
    {
      id: 0,
      clips: (primary?.segments || []).map((segment) => ({
        ...segment,
        at: segment.firstFrame,
        stop: (mediaTick(segment.firstFrame) + mediaTick(segment.frames)) / 100,
        box: fullBox,
      })),
    },
  ];
  for (const lane of tracks.filter((t) => t.kind === "video").reverse()) {
    const items = positioned
      .filter((clip) => clip.lane === lane.id)
      .sort((a, b) => a.at - b.at);
    layers.push({
      id: lane.id,
      hidden: Boolean(lane.hidden),
      clips: items.map((clip) => ({
        ...clip,
        stop: clipEnd(clip),
        box: clip.full ? fullBox : clip.box || defaultBox,
      })),
    });
  }
  const frames = Math.max(
    0,
    ...layers
      .filter((layer) => !layer.hidden)
      .flatMap((layer) => layer.clips.map((clip) => clip.stop)),
  );
  return frames
    ? {
        primary,
        layers,
        frames,
        exact: true,
        duration: frameMs(frames),
        segments: primary?.segments || [],
      }
    : null;
}
export function layersAt(plan, frame) {
  return plan.layers
    .filter((layer) => !layer.hidden)
    .map(({ id, clips }) => {
      const clip = clips.find(
        (c) =>
          mediaTick(c.at) <= mediaTick(frame) &&
          mediaTick(frame) < mediaTick(c.stop),
      );
      return {
        id,
        clip,
        sourceMs: clip
          ? Math.min(clip.end - 0.001, clip.start + exactMs(frame - clip.at))
          : 0,
      };
    });
}
export function captionTracks(plan, sources, tracks, positioned) {
  if (!plan) return [];
  const bound = plan.primary ? timelineCues(plan.primary, sources) : [];
  const result = tracks
    .filter((t) => t.kind === "captions")
    .map((track) => ({
      ...track,
      cues: positioned
        .filter((clip) => clip.lane === track.id && clip.at < plan.frames)
        .map((clip) => ({
          start: frameMs(clip.at),
          end: frameMs(Math.min(clipEnd(clip), plan.frames)),
          text: clip.text,
        }))
        .filter((cue) => cue.end > cue.start)
        .sort((a, b) => a.start - b.start || a.end - b.end),
    }));
  if (bound.length) result.unshift({ id: "source", cues: bound });
  return result;
}
export function captionText(tracks, time) {
  return tracks.map((cues) =>
    cues
      .filter((cue) => cue.start <= time && time < cue.end)
      .map((cue) => cue.text)
      .join("\n"),
  );
}
export function captionLines(text, measure, width) {
  return text.split("\n").flatMap((paragraph) => {
    let line = "";
    const lines = [];
    for (const token of paragraph.match(
      /[^\S\n]+|[\u2E80-\u9FFF\uF900-\uFAFF]|[^\s\u2E80-\u9FFF\uF900-\uFAFF]+/gu,
    ) || []) {
      const next = line + token;
      if (line && measure(next) > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (!line && measure(token) > width) {
        for (const char of token) {
          if (line && measure(line + char) > width) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
      } else line += line ? token : token.trimStart();
    }
    return [...lines, line];
  });
}
export function paintCaptions(ctx, texts, width, height) {
  const font = Math.max(12, Math.round(Math.min(width, height) * 0.046));
  const lineHeight = font * 1.2;
  ctx.font = "600 " + font + "px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const paired = texts.length > 1;
  texts.forEach((text, index) => {
    if (!text) return;
    const lines = captionLines(
      text,
      (line) => ctx.measureText(line).width,
      width * 0.82,
    );
    const pad = font * 0.27;
    const top = paired && index === 0;
    const boxHeight = Math.min(
      height * (paired ? 0.42 : 0.84),
      lines.length * lineHeight + 2 * pad,
    );
    const y = top ? height * 0.06 : height * 0.94 - boxHeight;
    const boxWidth = Math.min(
      width * 0.9,
      Math.max(...lines.map((line) => ctx.measureText(line).width)) + 4 * pad,
    );
    ctx.save();
    ctx.beginPath();
    ctx.rect((width - boxWidth) / 2, y, boxWidth, boxHeight);
    ctx.clip();
    ctx.fillStyle = "#151018e6";
    ctx.fillRect((width - boxWidth) / 2, y, boxWidth, boxHeight);
    ctx.fillStyle = "#fff";
    lines.forEach((line, i) =>
      ctx.fillText(line, width / 2, y + pad + (i + 0.5) * lineHeight),
    );
    ctx.restore();
  });
}
