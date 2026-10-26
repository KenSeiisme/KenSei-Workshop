const routes = new Set([
  "qr-studio",
  "color-studio",
  "unit-converter",
  "password-generator",
  "calculator-studio",
  "decision-studio",
  "answer-book",
  "network-test",
  "device-check",
  "pdf-toolkit",
  "zip-studio",
  "file-renamer",
  "file-check",
  "data-studio",
  "text-compare",
  "text-toolkit",
  "markdown-studio",
  "audio-studio",
  "subtitle-studio",
  "screen-recorder",
  "flashcards",
  "study-planner",
  "focus-timer",
  "time-studio",
  "whiteboard",
  "typing-sprint",
]);
export async function initAdvanced(slug) {
  if (routes.has(slug)) {
    const m = await import("./advanced-" + slug + ".js");
    await m.init();
  }
}
