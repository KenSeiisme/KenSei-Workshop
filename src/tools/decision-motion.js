import { randomIndex } from "./sprint-core.js";

// 结果与落点独立随机；边界缓冲避免浮点误差改变指针归属。
export function wheelTarget(count, index, rotation = 0, random = randomIndex) {
  const weights = Array.isArray(count)
    ? count
    : Array.from({ length: count }, () => 1);
  count = weights.length;
  if (weights.some((w) => !Number.isInteger(w) || w < 1 || w > 100))
    throw Error("Weights must be whole numbers from 1 to 100.");
  if (!Number.isInteger(count) || count < 1 || index < 0 || index >= count)
    throw new Error("Invalid wheel selection.");
  const total = weights.reduce((n, w) => n + w, 0),
    width = (360 * weights[index]) / total,
    start = (360 * weights.slice(0, index).reduce((n, w) => n + w, 0)) / total;
  const fraction = (random(1000000) + 0.5) / 1000000;
  const angle = start + width * (0.00001 + fraction * 0.99998);
  const normalize = (value) => ((value % 360) + 360) % 360;
  return {
    rotation:
      rotation +
      normalize(normalize(-angle) - normalize(rotation)) +
      (2 + random(3)) * 360,
    duration: 2600 + random(801),
    index,
  };
}

export function weightedIndex(weights, random = randomIndex) {
  const total = weights.reduce((n, w) => n + w, 0);
  if (
    !weights.length ||
    weights.some((w) => !Number.isInteger(w) || w < 1 || w > 100)
  )
    throw Error("Weights must be whole numbers from 1 to 100.");
  let ticket = random(total);
  for (let i = 0; i < weights.length; i++) {
    ticket -= weights[i];
    if (ticket < 0) return i;
  }
  throw Error("Invalid weighted selection.");
}
