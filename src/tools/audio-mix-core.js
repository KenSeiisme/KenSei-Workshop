import { audioContextType } from "./audio-context.js";
export function validateMixRecipe(value) {
  if (
    !value ||
    !Array.isArray(value.tracks) ||
    !Array.isArray(value.clips) ||
    value.tracks.length < 1 ||
    value.tracks.length > 10 ||
    value.clips.length > 60
  )
    throw Error("Use 1–10 tracks and at most 60 clips.");
  const number = (v, min, max) => {
    v = Number(v);
    if (!Number.isFinite(v) || v < min || v > max)
      throw Error("The mix contains an invalid range or setting.");
    return v;
  };
  const tracks = value.tracks.map((t) => ({
    volume: number(t.volume, 0, 2),
    pan: number(t.pan, -1, 1),
    eq: (t.eq || [0, 0, 0]).map((x) => number(x, -12, 12)),
    mute: !!t.mute,
    solo: !!t.solo,
  }));
  if (tracks.some((t) => t.eq.length !== 3)) throw Error("Use three EQ bands.");
  if (
    value.clips.some(
      (c) => !Number.isInteger(+c.slot) || !Number.isInteger(+c.track),
    )
  )
    throw Error("The mix contains an invalid range or setting.");
  const clips = value.clips.map((c) => ({
    slot: Math.round(number(c.slot, 0, 9)),
    track: Math.round(number(c.track, 0, tracks.length - 1)),
    at: number(c.at, 0, 300),
    start: number(c.start, 0, 300),
    end: number(c.end, 0, 300),
    fadeIn: number(c.fadeIn || 0, 0, 30),
    fadeOut: number(c.fadeOut || 0, 0, 30),
  }));
  for (const c of clips)
    if (
      c.end <= c.start ||
      c.at + c.end - c.start > 300 ||
      c.fadeIn + c.fadeOut > c.end - c.start
    )
      throw Error(
        "Clips must fit inside five minutes with valid trim and fade ranges.",
      );
  const slots = Array.from(
    { length: Math.max(0, ...clips.map((c) => c.slot + 1)) },
    (_, i) => ({
      id: "slot_" + (i + 1),
      minimumDuration: Math.max(
        0,
        ...clips.filter((c) => c.slot === i).map((c) => c.end),
      ),
    }),
  );
  return {
    version: 1,
    format: value.format === "mp3" ? "mp3" : "wav",
    bitrate: [128, 192, 320].includes(+value.bitrate) ? +value.bitrate : 192,
    tracks,
    clips,
    slots,
    crossfade: number(value.crossfade ?? 0.5, 0, 10),
    normalize: !!value.normalize,
  };
}
export function mixBudget(settings, sources) {
  if (!settings.clips.length) throw Error("Add a clip to the timeline.");
  for (const c of settings.clips)
    if (!sources[c.slot] || c.end > sources[c.slot].duration + 0.0001)
      throw Error("Confirm a source mapping that covers every clip range.");
  const duration = Math.max(
      ...settings.clips.map((c) => c.at + c.end - c.start),
    ),
    frames = Math.ceil(duration * 44100),
    bytes =
      [...new Set(sources)].reduce(
        (sum, b) => sum + b.length * b.numberOfChannels * 4,
        0,
      ) +
      frames * 2 * 4;
  if (duration > 300 || bytes > 128000000)
    throw Error(
      "The source and rendered mix exceed the five-minute or 128 MB PCM budget. Shorten the clips.",
    );
  return { duration, frames, bytes };
}
const curve = (incoming) =>
  Float32Array.from({ length: 64 }, (_, i) =>
    incoming
      ? Math.sin(((i / 63) * Math.PI) / 2)
      : Math.cos(((i / 63) * Math.PI) / 2),
  );
export async function renderMix(
  settings,
  sources,
  create = (n, len, rate) => new (audioContextType(true))(n, len, rate),
) {
  const { frames } = mixBudget(settings, sources),
    ctx = create(2, frames, 44100),
    anySolo = settings.tracks.some((t) => t.solo),
    nodes = [];
  settings.tracks.forEach((track, index) => {
    const low = ctx.createBiquadFilter(),
      mid = ctx.createBiquadFilter(),
      high = ctx.createBiquadFilter(),
      pan = ctx.createStereoPanner(),
      gain = ctx.createGain();
    low.type = "lowshelf";
    low.frequency.value = 200;
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 0.8;
    high.type = "highshelf";
    high.frequency.value = 4000;
    [low, mid, high].forEach((n, i) => (n.gain.value = track.eq[i]));
    pan.pan.value = track.pan;
    gain.gain.value = track.mute || (anySolo && !track.solo) ? 0 : track.volume;
    low.connect(mid);
    mid.connect(high);
    high.connect(pan);
    pan.connect(gain);
    gain.connect(ctx.destination);
    nodes[index] = low;
  });
  const ordered = settings.clips
    .map((c, i) => ({ ...c, index: i }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  ordered.forEach((clip, index) => {
    const source = ctx.createBufferSource(),
      fade = ctx.createGain(),
      crossIn = ctx.createGain(),
      crossOut = ctx.createGain(),
      duration = clip.end - clip.start,
      end = clip.at + duration;
    source.buffer = sources[clip.slot];
    fade.gain.setValueAtTime(clip.fadeIn ? 0 : 1, clip.at);
    if (clip.fadeIn)
      fade.gain.linearRampToValueAtTime(1, clip.at + clip.fadeIn);
    if (clip.fadeOut) {
      fade.gain.setValueAtTime(1, end - clip.fadeOut);
      fade.gain.linearRampToValueAtTime(0, end);
    }
    const previous = ordered
        .slice(0, index)
        .filter((c) => c.track === clip.track)
        .at(-1),
      next = ordered.slice(index + 1).find((c) => c.track === clip.track);
    const incoming = previous
        ? Math.min(
            settings.crossfade,
            Math.max(0, previous.at + previous.end - previous.start - clip.at),
            duration,
          )
        : 0,
      outgoing = next
        ? Math.min(settings.crossfade, Math.max(0, end - next.at), duration)
        : 0;
    if (incoming)
      crossIn.gain.setValueCurveAtTime(curve(true), clip.at, incoming);
    if (outgoing)
      crossOut.gain.setValueCurveAtTime(curve(false), end - outgoing, outgoing);
    source.connect(fade);
    fade.connect(crossIn);
    crossIn.connect(crossOut);
    crossOut.connect(nodes[clip.track]);
    source.start(clip.at, clip.start, duration);
  });
  const result = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < result.numberOfChannels; c++)
    for (const v of result.getChannelData(c))
      peak = Math.max(peak, Math.abs(v));
  if (settings.normalize && peak > 0) {
    const gain = 0.98 / peak;
    for (let c = 0; c < result.numberOfChannels; c++) {
      const a = result.getChannelData(c);
      for (let i = 0; i < a.length; i++) a[i] *= gain;
    }
    peak = 0.98;
  }
  return { buffer: result, peak };
}
