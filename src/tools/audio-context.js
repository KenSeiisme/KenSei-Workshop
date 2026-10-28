export const AUDIO_UNAVAILABLE =
  "Audio editing is unavailable in this browser. Try Chrome, Edge or Firefox.";
export function audioContextType(offline = false, scope = globalThis) {
  const name = offline ? "OfflineAudioContext" : "AudioContext",
    Context = scope[name] || scope["webkit" + name];
  if (typeof Context !== "function") throw Error(AUDIO_UNAVAILABLE);
  return Context;
}
export function supportsAudioEditing(scope = globalThis) {
  try {
    audioContextType(false, scope);
    audioContextType(true, scope);
    return true;
  } catch {
    return false;
  }
}
