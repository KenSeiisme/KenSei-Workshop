import {
  Input,
  BlobSource,
  MP4,
  WEBM,
  MP3,
  WAVE,
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

import {
  defaultLevels,
  framesPerSampleBlock,
  sampleRate,
  validateAudioClips,
  videoMix,
} from "./video-mix.js";

const audioBitrate = 128_000;
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
const openAudio = (file) =>
  new Input({
    formats: [MP3, WAVE, MP4],
    source: new BlobSource(file),
  });
async function audioTrack(input) {
  const audio = await input.getPrimaryAudioTrack();
  if (
    !audio ||
    (await input.getPrimaryVideoTrack()) ||
    !(await audio.canDecode())
  )
    throw Error("Choose a supported MP3, WAV or AAC M4A audio file.");
  const codec = await audio.getCodec();
  if (
    !codec ||
    !(codec === "mp3" || codec === "aac" || codec.startsWith("pcm-"))
  )
    throw Error("Choose a supported MP3, WAV or AAC M4A audio file.");
  const first = await input.getFirstTimestamp([audio]);
  const duration = Math.round(
    ((await input.computeDuration([audio])) - first) * 1000,
  );
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > videoLimits.sourceMs
  )
    throw Error("Each source must be ten minutes or shorter.");
  return { audio, first, duration };
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

async function* audioBlocks(lane, media) {
  for (const clip of lane) {
    if (!clip.gain) continue;
    const source = media[clip.source];
    const start = source.first + clip.start / 1000;
    const length = (clip.stop - clip.at) * framesPerSampleBlock;
    const end = Math.min(
      source.first + clip.end / 1000,
      start + length / sampleRate,
    );
    let consumed = 0;
    const sink = new AudioSampleSink(source.audio);
    for await (const sample of sink.samples(start, end)) {
      try {
        const from = Math.max(
          consumed,
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
        consumed = to;
        const channels = [0, 1].map((channel) => {
          const decoded = new Float32Array(sample.numberOfFrames);
          sample.copyTo(decoded, {
            planeIndex: Math.min(channel, sample.numberOfChannels - 1),
            format: "f32-planar",
          });
          const copy = new Float32Array(to - from);
          for (let i = 0; i < copy.length; i++) {
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
            copy[i] =
              (decoded[left] + (decoded[right] - decoded[left]) * (at - left)) *
              clip.gain;
          }
          return copy;
        });
        yield { at: clip.at * framesPerSampleBlock + from, channels };
      } finally {
        sample.close();
      }
    }
  }
}

async function exportMix(mix, media, frames, destination) {
  const iterators = mix.lanes.map((lane) => audioBlocks(lane, media));
  try {
    const heads = await Promise.all(iterators.map((i) => i.next()));
    for (let at = 0; at < frames * framesPerSampleBlock; at += 4096) {
      const count = Math.min(4096, frames * framesPerSampleBlock - at);
      const pcm = new Float32Array(count * 2);
      for (const [i, iterator] of iterators.entries()) {
        for (
          let block = heads[i].value;
          block && block.at < at + count;
          block = heads[i].value
        ) {
          const stop = block.at + block.channels[0].length;
          for (
            let pos = Math.max(at, block.at);
            pos < Math.min(at + count, stop);
            pos++
          ) {
            pcm[pos - at] += block.channels[0][pos - block.at];
            pcm[count + pos - at] += block.channels[1][pos - block.at];
          }
          if (stop > at + count) break;
          heads[i] = await iterator.next();
        }
      }
      for (let i = 0; i < pcm.length; i++)
        pcm[i] = Math.max(-1, Math.min(1, pcm[i] * mix.scale));
      const sample = new AudioSample({
        data: pcm,
        format: "f32-planar",
        sampleRate,
        numberOfChannels: 2,
        timestamp: at / sampleRate,
      });
      try {
        await destination.add(sample);
      } finally {
        sample.close();
      }
    }
  } finally {
    await Promise.allSettled(iterators.map((iterator) => iterator.return()));
  }
}

async function waveform({ audio, first, duration }) {
  const peaks = new Float32Array(512);
  for await (const sample of new AudioSampleSink(audio).samples()) {
    try {
      for (
        let channel = 0;
        channel < Math.min(2, sample.numberOfChannels);
        channel++
      ) {
        const pcm = new Float32Array(sample.numberOfFrames);
        sample.copyTo(pcm, { planeIndex: channel, format: "f32-planar" });
        for (let i = 0; i < pcm.length; i += 8) {
          const bin = Math.max(
            0,
            Math.min(
              peaks.length - 1,
              Math.floor(
                (((sample.timestamp - first + i / sample.sampleRate) * 1000) /
                  duration) *
                  peaks.length,
              ),
            ),
          );
          peaks[bin] = Math.max(peaks[bin], Math.min(1, Math.abs(pcm[i])));
        }
      }
    } finally {
      sample.close();
    }
  }
  return peaks;
}

async function encode({
  sources,
  clips,
  audioClips = [],
  levels = defaultLevels(),
  resolution,
  quality,
  orientation,
  format,
  burn,
}) {
  const inputs = [];
  let output;
  try {
    const used = new Set([...clips, ...audioClips].map((clip) => clip.source));
    const media = {};
    for (const [id, asset] of Object.entries(sources)) {
      if (!used.has(id)) continue;
      const input =
        asset.kind === "audio" ? openAudio(asset.file) : open(asset.file);
      inputs.push(input);
      try {
        const data =
          asset.kind === "audio"
            ? await audioTrack(input)
            : await tracks(input);
        if (data.video && !(await data.video.canDecode())) throw Error();
        media[id] = { ...data, hasAudio: !!data.audio, cues: asset.cues };
      } catch {
        throw Error("Could not decode {0}.", { cause: asset.file.name });
      }
    }
    const settings = exportSettings(quality, resolution, orientation);
    const timeline = makeTimeline(clips, media);
    validateAudioClips(audioClips, media);
    const mix = videoMix(timeline, audioClips, levels, media);
    for (const clip of mix.lanes.flat()) {
      if (clip.gain && !(await media[clip.source].audio.canDecode()))
        throw Error("Could not decode {0}.", {
          cause: sources[clip.source].file.name,
        });
    }
    const hasAudio = mix.audible;
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
    await Promise.all([
      (async () => {
        for (const segment of timeline.segments)
          await exportVideoFrames(
            media[segment.source],
            segment,
            picture,
            ctx,
            cues,
            timeline.frames,
          );
      })(),
      sound && exportMix(mix, media, timeline.frames, sound),
    ]);
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
    } else if (data.action === "audio-probe" || data.action === "waveform") {
      const input = openAudio(data.file);
      try {
        const track = await audioTrack(input);
        if (data.action === "waveform")
          postMessage({ type: "waveform", peaks: await waveform(track) });
        else
          postMessage({
            type: "metadata",
            duration: track.duration,
            hasAudio: true,
          });
      } finally {
        input.dispose();
      }
    } else if (data.action === "encode") await encode(data);
  } catch (error) {
    postMessage({ type: "error", message: error.message, file: error.cause });
  }
};
