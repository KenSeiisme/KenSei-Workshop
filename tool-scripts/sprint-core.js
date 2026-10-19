export function randomIndex(length) {
  if (!Number.isInteger(length) || length < 1)
    throw new Error("Add at least one option.");
  // 拒绝取模偏差，让每个选项拥有相同概率。
  const limit = 4294967296 - (4294967296 % length),
    value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % length;
}
export function shuffle(input) {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function scoreText(source, typed, language) {
  const target = Array.from(source),
    input = Array.from(typed);
  let correct = 0,
    counted = 0;
  input.forEach((c, i) => {
    if (c === target[i]) {
      correct++;
      if (language === "en" || !/\s/u.test(c)) counted++;
    }
  });
  return {
    correct,
    speed: +(counted / (language === "en" ? 5 : 1)).toFixed(2),
    accuracy: input.length ? +((correct * 100) / input.length).toFixed(2) : 0,
  };
}
