import {
  Input,
  BlobSource,
  MP4,
  WEBM,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSource,
  AudioSampleSource,
  VideoSampleSink,
  AudioSampleSink,
  AudioSample,
  Quality,
  canEncodeVideo,
  canEncodeAudio,
} from "/vendor/mediabunny-video-1.66.1.mjs";
import {
  containers,
  frameRate,
  makeTimeline,
  timelineCues,
  exportSettings,
  videoLimits,
} from "./video-timeline.js";

const sampleRate = 48000;
const audioBitrate = 128_000;
const audioFramesPerVideoFrame = sampleRate / frameRate;
const open = (file) =>
  new Input({ formats: [MP4, WEBM], source: new BlobSource(file) });
async function tracks(input) {
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw Error("Choose an MP4 or WebM file with a video track.");
  const audio = (await input.getAudioTracks())[0];
  const selected = audio ? [video, audio] : [video];
  const first = await input.getFirstTimestamp(selected);
  const duration = Math.round(
    ((await input.computeDuration(selected)) - first) * 1000,
  );
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > videoLimits.sourceMs
  )
    throw Error("Each source must be ten minutes or shorter.");
  return { video, audio, first, duration };
}
async function formats(settings, audio) {
  if (typeof OffscreenCanvas !== "function") return [];
  const { width, height, bitrate } = settings;
  const supported = await Promise.all(
    Object.entries(containers).map(async ([name, codec]) => {
      if (
        !(await canEncodeVideo(codec.video, {
          width,
          height,
          bitrate,
          framerate: frameRate,
        }))
      )
        return null;
      if (
        audio &&
        !(await canEncodeAudio(codec.audio, {
          numberOfChannels: 2,
          sampleRate,
          bitrate: audioBitrate,
        }))
      )
        return null;
      return name;
    }),
  );
  return supported.filter(Boolean);
}

function caption(ctx, text, width, height) {
  const fontSize = Math.round(Math.min(width, height) * 0.045);
  ctx.font = "600 " + fontSize + "px sans-serif";
  const limit = width * 0.86;
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && ctx.measureText(line + character).width > limit) {
        lines.push(line);
        line = "";
        if (lines.length >= 6) break;
      }
      line += character;
    }
    if (lines.length >= 6) break;
    if (line) lines.push(line);
  }
  const lineHeight = fontSize * 1.3;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    const y = height * 0.93 - lineHeight * (lines.length - i - 0.5);
    const w = ctx.measureText(line).width + fontSize * 0.65;
    ctx.fillStyle = "#000d";
    ctx.fillRect((width - w) / 2, y - lineHeight / 2, w, lineHeight);
    ctx.fillStyle = "#fff";
    ctx.fillText(line, width / 2, y);
  });
}

function* sourceTimes(start, end, total) {
  for (let i = 0; i < total; i++)
    yield Math.min(start + i / frameRate, end - 0.000001);
}

async function exportVideoFrames(
  source,
  segment,
  destination,
  ctx,
  cues,
  total,
) {
  const {
    canvas: { width, height },
  } = ctx;
  const first = source.first + segment.start / 1000;
  const end = source.first + segment.end / 1000;
  const sink = new VideoSampleSink(source.video);
  let frame = segment.firstFrame;
  let cueIndex = 0,
    active = [];
  for await (const sample of sink.samplesAtTimestamps(
    sourceTimes(first, end, segment.frames),
  )) {
    try {
      ctx.fillStyle = "#0e0b12";
      ctx.fillRect(0, 0, width, height);
      if (sample) {
        const fit = Math.min(
          width / sample.displayWidth,
          height / sample.displayHeight,
        );
        const w = sample.displayWidth * fit,
          h = sample.displayHeight * fit;
        sample.draw(ctx, (width - w) / 2, (height - h) / 2, w, h);
      }
      if (cues.length) {
        const ms = (frame * 1000) / frameRate;
        active = active.filter((cue) => cue.end > ms);
        while (cueIndex < cues.length && cues[cueIndex].start <= ms) {
          const cue = cues[cueIndex++];
          if (cue.end > ms) active.push(cue);
        }
        if (active.length)
          caption(ctx, active.map((cue) => cue.text).join("\n"), width, height);
      }
      await destination.add(frame / frameRate, 1 / frameRate, {
        keyFrame: frame === segment.firstFrame,
      });
      frame++;
      if (frame % 15 === 0 || frame === total)
        postMessage({ type: "progress", value: (100 * frame) / total });
    } finally {
      sample?.close();
    }
  }
}

async function exportAudio(source, segment, destination) {
  const start = source.first + segment.start / 1000;
  const end = source.first + segment.end / 1000;
  const segmentStart = segment.firstFrame * audioFramesPerVideoFrame;
  const length = segment.frames * audioFramesPerVideoFrame;
  let cursor = 0;
  const add = async (data, frames) => {
    const sample = new AudioSample({
      data,
      format: "f32-planar",
      sampleRate,
      numberOfChannels: 2,
      timestamp: (segmentStart + cursor) / sampleRate,
    });
    try {
      await destination.add(sample);
    } finally {
      sample.close();
    }
    cursor += frames;
  };
  async function pad(stop) {
    while (cursor < stop) {
      const frames = Math.min(stop - cursor, 4096);
      await add(new Float32Array(frames * 2), frames);
    }
  }
  if (source.audio) {
    const sink = new AudioSampleSink(source.audio);
    for await (const sample of sink.samples(start, end)) {
      try {
        const from = Math.max(
          cursor,
          Math.round((sample.timestamp - start) * sampleRate),
        );
        const to = Math.min(
          length,
          Math.round(
            (Math.min(end, sample.timestamp + sample.duration) - start) *
              sampleRate,
          ),
        );
        if (to <= from) continue;
        await pad(from);
        const count = to - from;
        const data = new Float32Array(count * 2);
        for (let channel = 0; channel < 2; channel++) {
          const decoded = new Float32Array(sample.numberOfFrames);
          sample.copyTo(decoded, {
            planeIndex: Math.min(channel, sample.numberOfChannels - 1),
            format: "f32-planar",
          });
          for (let i = 0; i < count; i++) {
            const at = Math.max(
              0,
              Math.min(
                decoded.length - 1,
                (start + (from + i) / sampleRate - sample.timestamp) *
                  sample.sampleRate,
              ),
            );
            const left = Math.floor(at),
              right = Math.min(left + 1, decoded.length - 1);
            data[channel * count + i] =
              decoded[left] + (decoded[right] - decoded[left]) * (at - left);
          }
        }
        await add(data, count);
      } finally {
        sample.close();
      }
    }
  }
  await pad(length);
}

async function encode({
  sources,
  clips,
  resolution,
  quality,
  orientation,
  format,
  burn,
}) {
  const inputs = [];
  let output;
  try {
    const used = new Set(clips.map((clip) => clip.source));
    const media = {};
    for (const [id, asset] of Object.entries(sources)) {
      if (!used.has(id)) continue;
      const input = open(asset.file);
      inputs.push(input);
      media[id] = { ...(await tracks(input)), cues: asset.cues };
      if (
        !(await media[id].video.canDecode()) ||
        (media[id].audio && !(await media[id].audio.canDecode()))
      )
        throw Error(
          "A source contains video or audio this browser cannot decode.",
        );
    }
    const settings = exportSettings(quality, resolution, orientation);
    const timeline = makeTimeline(clips, media);
    const hasAudio = Object.values(media).some((source) => source.audio);
    if (!(await formats(settings, hasAudio)).includes(format))
      throw Error("This browser cannot encode the chosen video format.");
    const codec = containers[format];
    const target = new BufferTarget();
    const canvas = new OffscreenCanvas(settings.width, settings.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Video canvas is unavailable in this browser.");
    output = new Output({
      format:
        format === "mp4"
          ? new Mp4OutputFormat({ fastStart: "in-memory" })
          : new WebMOutputFormat(),
      target,
    });
    const picture = new CanvasSource(canvas, {
      codec: codec.video,
      quality: new Quality({ bitrate: settings.bitrate }),
    });
    output.addVideoTrack(picture, { frameRate });
    const sound = hasAudio
      ? new AudioSampleSource({
          codec: codec.audio,
          quality: new Quality({ bitrate: audioBitrate }),
        })
      : null;
    if (sound) output.addAudioTrack(sound);
    await output.start();
    const cues = burn ? timelineCues(timeline, media) : [];
    for (const segment of timeline.segments) {
      const src = media[segment.source];
      await Promise.all([
        exportVideoFrames(src, segment, picture, ctx, cues, timeline.frames),
        sound && exportAudio(src, segment, sound),
      ]);
    }
    await output.finalize();
    const blob = new Blob([target.buffer], { type: codec.mime });
    postMessage({ type: "finished", blob, format });
  } catch (error) {
    if (output) await output.cancel().catch(() => {});
    throw error;
  } finally {
    for (const input of inputs) input.dispose();
  }
}
onmessage = async ({ data }) => {
  try {
    if (data.action === "formats") {
      const supported = await formats(
        exportSettings(data.quality, data.resolution, data.orientation),
        data.audio,
      );
      postMessage({ type: "formats", formats: supported });
    } else if (data.action === "probe") {
      const input = open(data.file);
      try {
        const { video, audio, duration } = await tracks(input);
        postMessage({
          type: "metadata",
          duration,
          hasAudio: !!audio,
          portrait:
            (await video.getDisplayHeight()) > (await video.getDisplayWidth()),
        });
      } finally {
        input.dispose();
      }
    } else if (data.action === "encode") await encode(data);
  } catch (error) {
    postMessage({ type: "error", message: error.message });
  }
};
