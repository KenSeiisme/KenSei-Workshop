import { randomIndex } from "./sprint-core.js";

// 结果与落点独立随机；边界缓冲避免浮点误差改变指针归属。
export function wheelTarget(count, index, rotation = 0, random = randomIndex) {
  if (!Number.isInteger(count) || count < 1 || index < 0 || index >= count)
    throw new Error("Invalid wheel selection.");
  const width = 360 / count;
  const fraction = (random(1000000) + 0.5) / 1000000;
  const angle = width * (index + 0.00001 + fraction * 0.99998);
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
