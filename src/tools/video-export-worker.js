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
  exactMs,
  exportSettings,
  frameRate,
  outputLimit,
  videoLimits,
} from "./video-timeline.js";
import {
  defaultLevels,
  framesPerSampleBlock,
  sampleRate,
  videoMix,
} from "./video-mix.js";
import {
  makeAssembly,
  validatePositioned,
  captionTracks,
  fitBox,
  paintCaptions,
  captionText,
} from "./video-assembly.js";

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
  const { width, height, bitrate, fps } = settings;
  const supported = await Promise.all(
    Object.entries(containers).map(async ([name, codec]) => {
      if (
        !(await canEncodeVideo(codec.video, {
          width,
          height,
          bitrate,
          frameRate: fps,
          framerate: fps,
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

function* sourceTimes(clip, first, count, fps, offset) {
  for (let n = 0; n < count; n++) {
    const timeline = exactMs(((first + n) * frameRate) / fps - clip.at) / 1000;
    yield offset +
      Math.min(
        clip.end / 1000 - 0.000001,
        clip.start / 1000 + Math.max(0, timeline),
      );
  }
}
async function* pictures(layer, media, fps) {
  for (const clip of layer.clips) {
    const first = Math.ceil((clip.at * fps) / frameRate - 1e-8),
      last = Math.ceil((clip.stop * fps) / frameRate - 1e-8);
    if (last <= first) continue;
    const source = media[clip.source];
    const sink = new VideoSampleSink(source.video);
    let frame = first;
    for await (const sample of sink.samplesAtTimestamps(
      sourceTimes(clip, first, last - first, fps, source.first),
    )) {
      try {
        yield { frame: frame++, sample, box: clip.box };
      } finally {
        sample?.close();
      }
    }
  }
}
async function exportPicture(plan, settings, media, destination, ctx, cues) {
  const { width, height, fps } = settings;
  const frames = Math.ceil((plan.frames * fps) / frameRate - 1e-8);
  const readers = plan.layers
    .filter((layer) => !layer.hidden && layer.clips.length)
    .map((layer) => pictures(layer, media, fps));
  try {
    const heads = await Promise.all(readers.map((reader) => reader.next()));
    for (let frame = 0; frame < frames; frame++) {
      ctx.fillStyle = "#131019";
      ctx.fillRect(0, 0, width, height);
      for (const head of heads) {
        if (head.value?.frame !== frame || !head.value.sample) continue;
        const { sample, box } = head.value;
        const { x, y, w, h } = fitBox(
          box,
          width,
          height,
          sample.displayWidth,
          sample.displayHeight,
        );
        ctx.fillRect(
          box.x * width,
          box.y * height,
          box.size * width,
          box.size * height,
        );
        sample.draw(ctx, x, y, w, h);
      }
      if (cues.length)
        paintCaptions(
          ctx,
          captionText(cues, (frame * 1000) / fps),
          width,
          height,
        );
      await destination.add(frame / fps, 1 / fps, {
        keyFrame: frame % (fps * 2) === 0,
      });
      for (let i = 0; i < readers.length; i++)
        if (heads[i].value?.frame === frame) heads[i] = await readers[i].next();
      if ((frame + 1) % 15 === 0 || frame + 1 === frames)
        postMessage({ type: "progress", value: (100 * (frame + 1)) / frames });
    }
  } finally {
    await Promise.allSettled(readers.map((reader) => reader.return()));
  }
}

async function* audioBlocks(lane, media) {
  for (const clip of lane) {
    if (!clip.gain) continue;
    const source = media[clip.source];
    const start = source.first + clip.start / 1000;
    const length = Math.round((clip.stop - clip.at) * framesPerSampleBlock);
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
        yield {
          at: Math.round(clip.at * framesPerSampleBlock) + from,
          channels,
        };
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
  tracks: laneDefs = [
    { id: 1, kind: "audio" },
    { id: 2, kind: "audio" },
  ],
  burnTracks = burn ? ["source"] : [],
  fps = 30,
}) {
  const inputs = [];
  let output;
  try {
    const used = new Set(
      [...clips, ...audioClips].map((clip) => clip.source).filter(Boolean),
    );
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
        media[id] = {
          ...data,
          hasAudio: !!data.audio,
          kind: asset.kind,
          cues: asset.cues,
        };
      } catch {
        throw Error("Could not decode {0}.", { cause: asset.file.name });
      }
    }
    const settings = exportSettings(quality, resolution, orientation, fps);
    validatePositioned(audioClips, media, laneDefs);
    const timeline = makeAssembly(clips, media, laneDefs, audioClips);
    if (!timeline) throw Error("Add a clip to begin.");
    const mix = videoMix(timeline, audioClips, levels, media);
    if (
      ((settings.bitrate + (mix.audible ? audioBitrate : 0)) *
        timeline.duration) /
        8000 >
      outputLimit
    )
      throw Error(
        "Estimated video exceeds 400 MB. Reduce quality, frame rate or duration.",
      );
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
    let overBudget = false;
    target.onwrite = (_start, end) => {
      if (end <= outputLimit || overBudget) return;
      overBudget = true;
      output.cancel().catch(() => {});
    };
    const canvas = new OffscreenCanvas(settings.width, settings.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Video canvas is unavailable in this browser.");
    output = new Output({
      format:
        format === "mp4"
          ? new Mp4OutputFormat({ fastStart: false })
          : new WebMOutputFormat(),
      target,
    });
    const picture = new CanvasSource(canvas, {
      codec: codec.video,
      quality: new Quality({ bitrate: settings.bitrate }),
    });
    output.addVideoTrack(picture, { frameRate: settings.fps });
    const sound = hasAudio
      ? new AudioSampleSource({
          codec: codec.audio,
          quality: new Quality({ bitrate: audioBitrate }),
        })
      : null;
    if (sound) output.addAudioTrack(sound);
    await output.start();
    const captions = captionTracks(timeline, media, laneDefs, audioClips);
    const cues = burnTracks
      .slice(0, 2)
      .map((id) => captions.find((track) => track.id === id)?.cues ?? []);
    try {
      const audioFrames =
        (Math.ceil((timeline.frames * settings.fps) / frameRate - 1e-8) *
          frameRate) /
        settings.fps;
      await Promise.all([
        exportPicture(timeline, settings, media, picture, ctx, cues),
        sound && exportMix(mix, media, audioFrames, sound),
      ]);
      await output.finalize();
      if (target.buffer.byteLength > outputLimit) overBudget = true;
    } catch (error) {
      if (!overBudget) throw error;
    }
    if (overBudget)
      throw Error(
        "Video exceeds 400 MB. Reduce quality, frame rate or duration.",
      );
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
        exportSettings(
          data.quality,
          data.resolution,
          data.orientation,
          data.fps,
        ),
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
          frameRate: (await video.computePacketStats(90).catch(() => ({})))
            .averagePacketRate,
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
