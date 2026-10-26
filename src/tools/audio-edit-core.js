export function keptRanges(source, total) {
  if (!source.trim()) return [[0, total]];
  const ranges = source
    .trim()
    .split(/\n|;/)
    .map((line) => {
      const m = line.trim().match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
      if (!m) throw Error("Use start-end seconds, one range per line.");
      return [+m[1], +m[2]];
    });
  if (
    ranges.length > 100 ||
    ranges.some(([a, b]) => a < 0 || b <= a || b > total + 0.0001) ||
    ranges.reduce((n, [a, b]) => n + b - a, 0) > 300
  )
    throw Error(
      "Keep valid ranges within the audio and five-minute output limit.",
    );
  return ranges;
}
export function shapeSamples(channels, rate, fadeIn, fadeOut, normalize) {
  const n = channels[0].length;
  let peak = 0;
  for (const c of channels)
    for (let i = 0; i < n; i++) {
      const envelope = Math.min(
        1,
        fadeIn ? i / (rate * fadeIn) : 1,
        fadeOut ? (n - 1 - i) / (rate * fadeOut) : 1,
      );
      c[i] *= Math.max(0, envelope);
      peak = Math.max(peak, Math.abs(c[i]));
    }
  const gain = normalize && peak > 0 ? 1 / peak : 1;
  if (gain !== 1)
    for (const c of channels) for (let i = 0; i < n; i++) c[i] *= gain;
  return { peak: normalize && peak > 0 ? 1 : peak, gain };
}
export function pcmWav(channels, rate) {
  const frames = channels[0].length,
    n = channels.length,
    b = new ArrayBuffer(44 + frames * n * 2),
    v = new DataView(b),
    write = (i, s) =>
      [...s].forEach((c, j) => v.setUint8(i + j, c.charCodeAt(0)));
  write(0, "RIFF");
  v.setUint32(4, b.byteLength - 8, true);
  write(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, n, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * n * 2, true);
  v.setUint16(32, n * 2, true);
  v.setUint16(34, 16, true);
  write(36, "data");
  v.setUint32(40, frames * n * 2, true);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < n; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(
        44 + (i * n + c) * 2,
        Math.round(x * (x < 0 ? 32768 : 32767)),
        true,
      );
    }
  return new Blob([b], { type: "audio/wav" });
}
