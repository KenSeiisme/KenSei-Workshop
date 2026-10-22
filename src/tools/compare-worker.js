import {
  diffChars,
  diffLines,
  createTwoFilesPatch,
} from "/vendor/diff/index.js";
self.onmessage = ({
  data: { left, right, ignoreCase, ignoreWhitespace, mode },
}) => {
  try {
    const clean = (s) => {
      if (ignoreWhitespace)
        s = s
          .split("\n")
          .map((l) => l.replace(/\s+/g, " ").trim())
          .join("\n");
      return ignoreCase ? s.toLowerCase() : s;
    };
    const a = clean(left),
      b = clean(right),
      options = { timeout: 3000, maxEditLength: 20000 };
    const changes =
      mode === "characters"
        ? diffChars(a, b, options)
        : diffLines(a, b, options);
    if (!changes)
      throw new Error("These texts differ too much. Compare smaller sections.");
    const patch = createTwoFilesPatch(
      "original.txt",
      "updated.txt",
      a,
      b,
      "",
      "",
      options,
    );
    if (!patch)
      throw new Error(
        "Could not export this comparison. Use smaller sections.",
      );
    self.postMessage({ changes, patch });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
