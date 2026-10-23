// 稳定标识用于服务器授予和历史补发；展示名称不参与权限或计分。
const tiers = (game, field, values, names) =>
  values.map((target, i) => ({
    id: `${game}-${i + 1}`,
    game,
    field,
    target,
    name: names[i],
    description: `Reach ${target.toLocaleString()} ${field === "max_tile" ? "as your largest tile" : "points"} in a qualifying Public run.`,
  }));
const modes = (game, values, names) =>
  values.map((mode, i) => ({
    id: `${game}-${i + 1}`,
    game,
    field: "mode",
    mode,
    target: 1,
    name: names[i],
    description: `Complete ${mode === "easy" ? "Easy" : mode === "normal" ? "Normal" : mode === "hard" ? "Hard" : mode[0].toUpperCase() + mode.slice(1)} in Public.`,
  }));
export const ACHIEVEMENTS = [
  ...tiers(
    "2048",
    "max_tile",
    [256, 1024, 2048],
    ["Room to grow", "Four figures", "The namesake"],
  ),
  ...modes(
    "minesweeper",
    ["beginner", "intermediate", "expert"],
    ["Careful steps", "Clear thinking", "Expert sweep"],
  ),
  ...tiers(
    "snake",
    "score",
    [100, 300, 600],
    ["Ten more bites", "Long story", "Room for sixty"],
  ),
  ...modes(
    "memory-match",
    ["easy", "normal", "hard"],
    ["Six connections", "Eight in mind", "Perfect company"],
  ),
  ...modes(
    "sudoku",
    ["easy", "normal", "hard"],
    ["A logical start", "Nine by nine", "Hard-earned logic"],
  ),
  ...modes(
    "nonogram",
    ["easy", "normal", "hard"],
    ["Little picture", "Pixel by pixel", "The whole picture"],
  ),
  ...tiers(
    "block-puzzle",
    "score",
    [250, 750, 1500],
    ["Make some space", "Fit for more", "Space architect"],
  ),
  ...tiers(
    "brick-breaker",
    "score",
    [400, 800],
    ["Brick by brick", "Keep it bouncing"],
  ),
  {
    id: "brick-breaker-3",
    game: "brick-breaker",
    field: "won",
    target: 1,
    name: "Three-stage clear",
    description:
      "Clear all three Brick Breaker stages in a qualifying Public run.",
  },
  {
    id: "block-drop-1",
    game: "block-drop",
    field: "lines",
    mode: "classic",
    target: 10,
    name: "A clean ten",
    description: "Clear 10 lines in one qualifying Public Classic run.",
  },
  {
    id: "block-drop-2",
    game: "block-drop",
    field: "lines",
    mode: "classic",
    target: 40,
    name: "Forty and rising",
    description: "Clear 40 lines in one qualifying Public Classic run.",
  },
  {
    id: "block-drop-3",
    game: "block-drop",
    field: "won",
    mode: "sprint",
    target: 1,
    name: "Sprint finish",
    description: "Complete the 40-line Sprint in Public.",
  },
  {
    id: "public-first",
    game: null,
    field: "results",
    target: 1,
    name: "First verified",
    description: "Finish your first qualifying Public run.",
  },
  {
    id: "public-ten",
    game: null,
    field: "results",
    target: 10,
    name: "Ten on record",
    description: "Finish 10 qualifying Public runs.",
  },
  {
    id: "public-three-games",
    game: null,
    field: "games",
    target: 3,
    name: "Find your range",
    description: "Earn qualifying Public results in three different games.",
  },
];
export function liveValue(def, state) {
  if (
    !state ||
    def.game !== state.game ||
    (def.mode && state.difficulty !== def.mode)
  )
    return 0;
  if (def.field === "max_tile") return Math.max(...state.board);
  if (def.field === "score") return state.score;
  if (def.field === "lines") return state.lines;
  if (def.field === "won" || def.field === "mode")
    return state.status === "won" ? 1 : 0;
  return 0;
}
