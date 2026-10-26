export async function targetCompression(
  encode,
  maximum,
  target,
  isCurrent = () => true,
) {
  let calls = 0;
  const attempt = async (q) => {
    if (!isCurrent()) throw Error("Cancelled.");
    calls++;
    const blob = await encode(q);
    if (!isCurrent()) throw Error("Cancelled.");
    return { blob, quality: q };
  };
  let best = await attempt(maximum);
  if (!target || best.blob.size <= target) return { ...best, calls, met: true };
  let low = Math.min(0.1, maximum),
    high = maximum,
    smallest = await attempt(low),
    fit = smallest.blob.size <= target ? smallest : null;
  if (!fit) return { ...smallest, calls, met: false };
  while (calls < 8 && high - low > 0.005) {
    const mid = (low + high) / 2,
      r = await attempt(mid);
    if (r.blob.size < smallest.blob.size) smallest = r;
    if (r.blob.size <= target) {
      fit = r;
      low = mid;
    } else high = mid;
  }
  return { ...(fit || smallest), calls, met: !!fit };
}
