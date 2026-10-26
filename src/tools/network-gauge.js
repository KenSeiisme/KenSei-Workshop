export function gaugeRange(previous, value) {
  const minimum = Number.isFinite(previous) && previous > 0 ? previous : 100;
  if (!Number.isFinite(value) || value <= minimum) return minimum;
  const base = 10 ** Math.floor(Math.log10(value));
  return (
    [1, 2, 5, 10].map((n) => n * base).find((n) => n >= value) || base * 10
  );
}
export function gaugeTicks(max, factor = 1) {
  return Array.from({ length: 26 }, (_, i) => {
    const angle = Math.PI + (i * Math.PI) / 25;
    return {
      major: i % 5 === 0,
      value: (max * factor * i) / 25,
      x1: 150 + Math.cos(angle) * 120,
      y1: 160 + Math.sin(angle) * 120,
      x2: 150 + Math.cos(angle) * (i % 5 ? 125 : 130),
      y2: 160 + Math.sin(angle) * (i % 5 ? 125 : 130),
      x: 150 + Math.cos(angle) * 99,
      y: 160 + Math.sin(angle) * 99,
    };
  });
}
