// 西洋棋和象棋共用加秒時鐘；只有有效落子才給增量。
export const FISCHER_CLOCKS = Object.freeze({
  "5+3": { main: 300000, increment: 3000 },
  "10+5": { main: 600000, increment: 5000 },
  "15+10": { main: 900000, increment: 10000 },
});
export function createFischerClock(preset, now) {
  const spec = FISCHER_CLOCKS[preset];
  return spec
    ? { preset, remaining: { 1: spec.main, "-1": spec.main }, anchor: now }
    : null;
}
export function fischerClockView(clock, color, now, turn, running = true) {
  if (!clock) return { remaining: Infinity, expired: false };
  const remaining = Math.max(
    0,
    clock.remaining[color] -
      (running && turn === color ? Math.max(0, now - clock.anchor) : 0),
  );
  return { remaining, expired: remaining === 0 };
}
export function chargeFischerClock(clock, color, now, move = false) {
  if (!clock) return null;
  const view = fischerClockView(clock, color, now, color);
  if (view.expired) throw Error("The clock has expired.");
  return {
    ...structuredClone(clock),
    remaining: {
      ...clock.remaining,
      [color]:
        view.remaining + (move ? FISCHER_CLOCKS[clock.preset].increment : 0),
    },
    anchor: now,
  };
}
