export function timestamp(value) {
  const m = value.trim().match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!m || +m[2] > 59 || +m[3] > 59)
    throw Error("Use timestamps such as 00:01:23.456.");
  return ((+(m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
}
export function formatTime(ms, format = "vtt") {
  const h = Math.floor(ms / 3600000),
    m = Math.floor((ms % 3600000) / 60000),
    s = Math.floor((ms % 60000) / 1000);
  return (
    [h, m, s].map((n) => String(n).padStart(2, "0")).join(":") +
    (format === "srt" ? "," : ".") +
    String(ms % 1000).padStart(3, "0")
  );
}
export function validateCue(c) {
  if (
    !Number.isSafeInteger(c.start) ||
    !Number.isSafeInteger(c.end) ||
    c.start < 0 ||
    c.end <= c.start ||
    c.end >= 360000000
  )
    throw Error(
      "Every cue needs nonnegative times, with end after start (under 100 hours).",
    );
  if (
    typeof c.text !== "string" ||
    !c.text.trim() ||
    c.text.length > 10000 ||
    c.text.includes("\n\n")
  )
    throw Error(
      "Use non-empty subtitle text, up to 10,000 characters, without blank lines inside a cue.",
    );
  return c;
}
export function parseSubtitles(input) {
  if (new TextEncoder().encode(input).length > 5000000)
    throw Error("Subtitle file exceeds 5 MB.");
  const text = input
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .trim(),
    vtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text),
    blocks = text.split(/\n(?:[ \t]*\n)+/),
    cues = [];
  if (!text) throw Error("This file contains no subtitles.");
  if (vtt) blocks.shift();
  for (const block of blocks) {
    if (vtt && /^NOTE(?:\s|$)/.test(block)) continue;
    if (/^(STYLE|REGION)(?:\s|$)/.test(block))
      throw Error(
        "Styled or region-based WebVTT is not supported. Use plain-text cues.",
      );
    const lines = block.split("\n");
    if (!lines[0].includes("-->")) lines.shift();
    const timing = lines.shift()?.match(/^(\S+)\s+-->\s+(\S+)(.*)$/);
    if (!timing || timing[3].trim())
      throw Error("Use plain SRT or WebVTT cues without layout settings.");
    cues.push(
      validateCue({
        id: crypto.randomUUID(),
        start: timestamp(timing[1]),
        end: timestamp(timing[2]),
        text: lines.join("\n"),
      }),
    );
    if (cues.length > 5000) throw Error("Use at most 5,000 cues.");
  }
  if (!cues.length) throw Error("This file contains no subtitle cues.");
  return cues;
}
export function serialize(cues, format) {
  const ordered = [...cues]
    .map(validateCue)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const text =
    (format === "vtt" ? "WEBVTT\n\n" : "") +
    ordered
      .map(
        (c, i) =>
          (format === "srt" ? i + 1 + "\n" : "") +
          formatTime(c.start, format) +
          " --> " +
          formatTime(c.end, format) +
          "\n" +
          c.text,
      )
      .join("\n\n") +
    "\n";
  if (new TextEncoder().encode(text).length > 5000000)
    throw Error("Output exceeds 5 MB.");
  return text;
}
export function shiftCues(cues, amount) {
  if (!Number.isSafeInteger(amount))
    throw Error("Use a whole number of milliseconds.");
  return cues.map((c) =>
    validateCue({ ...c, start: c.start + amount, end: c.end + amount }),
  );
}
