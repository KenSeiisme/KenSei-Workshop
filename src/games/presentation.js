import { GAMES, timeScored } from "./engine.js";
import { uiDate, uiHtml } from "../site/ui.js";

// 名称与难度取自同一份规则；这里只格式化展示，不改变计分。
export { GAMES };
export { gameIcon } from "./game-icons.js";
export function scoreParts(row, game) {
  if (game === "block-drop" && row.difficulty === "sprint")
    return { value: (row.elapsed_ms / 1000).toFixed(2), unit: "seconds" };
  if (timeScored(game))
    return { value: (row.elapsed_ms / 1000).toFixed(2), unit: "seconds" };
  if (game === "memory-match")
    return { value: Number(row.moves).toLocaleString(), unit: "attempts" };
  return { value: Number(row.score).toLocaleString(), unit: "points" };
}
export function scoreDetail(row, game) {
  if (game === "block-drop")
    return `${Number(row.lines || row.summary?.lines || 0).toLocaleString()} lines cleared`;
  if (game === "2048")
    return `Largest tile · ${Number(row.max_tile).toLocaleString()}`;
  if (game === "memory-match")
    return `Completed in ${(row.elapsed_ms / 1000).toFixed(2)} s`;
  if (game === "minesweeper") return "All safe squares revealed";
  if (game === "sudoku") return "Completed 9 × 9 puzzle";
  if (game === "nonogram") return "All filled squares found";
  if (game === "block-puzzle")
    return `${Number(row.moves).toLocaleString()} shapes placed`;
  return `${Math.floor(row.elapsed_ms / 60000)}:${String(Math.floor(row.elapsed_ms / 1000) % 60).padStart(2, "0")} played`;
}
export function scoreDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : uiDate(d, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
