import { GAMES, timeScored } from "./engine.js";

export const CATALOG = [
  "2048",
  "minesweeper",
  "snake",
  "memory-match",
  "sudoku",
  "nonogram",
  "block-puzzle",
  "brick-breaker",
  "connect-four",
  "reversi",
  "block-drop",
  "go",
  "chess",
  "xiangqi",
  "pong",
];
export const BOARD_GAMES = [
  "go",
  "chess",
  "xiangqi",
  "connect-four",
  "reversi",
  "pong",
];
export const SKINS = {
  classic: { name: "Classic", price: 0, hue: 157, head: "#d9fff0" },
  neon: { name: "Neon", price: 40, hue: 304, head: "#ffd2f7" },
  amber: { name: "Amber", price: 80, hue: 39, head: "#fff0bf" },
  ice: { name: "Ice", price: 120, hue: 205, head: "#d8f6ff" },
};
export const malaysiaDay = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kuala_Lumpur" }).format(
    date,
  );
const dayNumber = (day) => Date.parse(day) / 86400000;
export function featuredGame(day) {
  const count = CATALOG.length - 1;
  const offset = dayNumber(day) - dayNumber("2026-01-01");
  return CATALOG[((offset % count) + count) % count];
}
export function tasks(games, featured) {
  return [
    ["warm-up", games.length >= 1],
    ["explorer", games.length >= 2],
    ["featured", games.includes(featured)],
  ];
}
export const DAILY_REWARD = 10;
export const LOBBY_BADGES = [
  ["first-finish", "First finish", "Complete your first game."],
  ["score-1000", "Score chaser", "Score over 1,000 points in a single game."],
  [
    "seven-days",
    "Seven-day streak",
    "Finish every daily task for seven days in a row.",
  ],
];
export function dailyTaskProgress(games, featured) {
  return [
    { id: "warm-up", value: Math.min(1, games.length), target: 1 },
    { id: "explorer", value: Math.min(2, games.length), target: 2 },
    { id: "featured", value: Number(games.includes(featured)), target: 1 },
  ];
}
export const malaysiaReset = (day) => Date.parse(day) + 16 * 3600000;

export function claimGuestDaily(data, day, task, today = malaysiaDay()) {
  if (data.days[day]?.tasks.includes(task)) return;
  if (day !== today) throw Error("This daily reward has expired.");
  if (
    !tasks(data.days[day]?.games || [], featuredGame(day)).some(
      ([id, complete]) => id === task && complete,
    )
  )
    throw Error("Complete this task before claiming its reward.");
  data.days[day].tasks.push(task);
  data.balance += DAILY_REWARD;
}
export function guestSnapshot(data, day = malaysiaDay()) {
  const stats = {};
  for (const run of Object.values(data.runs)) {
    const totals = (stats[run.game] ||= { plays: 0, activeMs: 0 });
    totals.plays += Number(run.started);
    totals.activeMs += run.activeMs;
  }
  return {
    day,
    featured: featuredGame(day),
    stats,
    today: data.days[day]?.games || [],
    manualClaims: true,
    claimedTasks: data.days[day]?.tasks || [],
    resetAt: malaysiaReset(day),
    balance: data.balance,
    skin: data.skin,
    owned: data.owned,
    badges: data.badges,
  };
}
export function awardGuest(data, run, day = malaysiaDay()) {
  const daily = (data.days[day] ||= { games: [], finishes: 0, tasks: [] });
  if (daily.finishes < 10) data.balance += 5;
  daily.finishes++;
  if (!daily.games.includes(run.game)) daily.games.push(run.game);
  const unlock = (badge) => {
    if (!data.badges.includes(badge)) data.badges.push(badge);
  };
  unlock("first-finish");
  if (
    run.score > 1000 &&
    (["2048", "snake", "brick-breaker", "block-puzzle"].includes(run.game) ||
      (run.game === "block-drop" && run.mode === "classic"))
  )
    unlock("score-1000");
  const today = dayNumber(day);
  if (
    Array.from({ length: 7 }, (_, i) =>
      new Date((today - i) * 86400000).toISOString().slice(0, 10),
    ).every((date) =>
      tasks(data.days[date]?.games || [], featuredGame(date)).every(
        ([, complete]) => complete,
      ),
    )
  )
    unlock("seven-days");
}
export function modesFor(game) {
  if (game === "go")
    return Object.fromEntries(
      ["chinese", "japanese", "aga"].flatMap((rule) =>
        [9, 13, 19].map((size) => [
          `${rule}:${size}`,
          {
            label: `${rule === "aga" ? "AGA" : rule[0].toUpperCase() + rule.slice(1)} · ${size}×${size}`,
          },
        ]),
      ),
    );
  if (["chess", "xiangqi"].includes(game))
    return Object.fromEntries(
      ["5+3", "10+5", "15+10"].map((time) => [time, { label: time }]),
    );
  if (game === "pong") return { normal: { label: "Standard" } };
  if (game === "snake") return { normal: { label: "Standard" } };
  return GAMES[game]?.modes || {};
}
export const timedBoard = (game, mode) =>
  timeScored(game) || (game === "block-drop" && mode === "sprint");
export function compareLocal(game, mode, a, b) {
  const date = () => a.date.localeCompare(b.date);
  if (BOARD_GAMES.includes(game)) return b.wins - a.wins || date();
  if (game === "memory-match")
    return a.moves - b.moves || a.elapsed_ms - b.elapsed_ms || date();
  if (timedBoard(game, mode)) return a.elapsed_ms - b.elapsed_ms || date();
  return (
    b.score - a.score ||
    (game === "2048" ? b.max_tile - a.max_tile : 0) ||
    (game === "block-drop" ? b.lines - a.lines : 0) ||
    (game === "brick-breaker" ? a.elapsed_ms - b.elapsed_ms : 0) ||
    date()
  );
}
