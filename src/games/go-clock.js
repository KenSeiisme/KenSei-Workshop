import { CLOCKS } from "./go-engine.js";
export function createClock(size, now) {
  const c = CLOCKS[size];
  return {
    preset: size,
    remaining: { 1: c.main, "-1": c.main },
    periods: { 1: c.periods, "-1": c.periods },
    anchor: now,
  };
}
export function clockView(clock, color, now, running = true) {
  const c = CLOCKS[clock.preset],
    elapsed = running ? Math.max(0, now - clock.anchor) : 0;
  const main = clock.remaining[color],
    overtime = Math.max(0, elapsed - main),
    periods = Math.max(
      0,
      clock.periods[color] - Math.floor(overtime / c.period),
    );
  return {
    main: Math.max(0, main - elapsed),
    periods,
    period: overtime ? c.period - (overtime % c.period) : c.period,
    expired: elapsed >= main + clock.periods[color] * c.period,
    deadline: clock.anchor + main + clock.periods[color] * c.period,
  };
}
export function chargeClock(clock, color, now) {
  const view = clockView(clock, color, now);
  if (view.expired) throw Error("The clock has expired.");
  return {
    ...structuredClone(clock),
    remaining: { ...clock.remaining, [color]: view.main },
    periods: { ...clock.periods, [color]: view.periods },
    anchor: now,
  };
}
export function formatGoClock(
  clock,
  color,
  now,
  running = true,
  timedOut = false,
) {
  const view = clockView(clock, color, now, running),
    expired = timedOut || view.expired;
  const ms = expired ? 0 : view.main || view.period,
    seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${!expired && view.main > 0 ? "" : ` · ${expired ? 0 : view.periods}×`}`;
}
