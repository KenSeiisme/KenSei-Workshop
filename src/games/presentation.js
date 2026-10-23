import { GAMES, timeScored } from "./engine.js";

// 名称与难度取自同一份规则；这里只格式化展示，不改变计分。
export { GAMES };
const paths = {
  sudoku:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18M6 5v2m6 4v2m6 4v2"/>',
  nonogram:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 3v18M3 8h18M12 11h4v4h-4zM16 15h4v5h-4z"/>',
  "block-puzzle":
    '<path d="M3 3h6v6H3zM3 9h6v6H3zM9 9h6v6H9zM15 9h6v6h-6zM15 15h6v6h-6z"/>',
  "brick-breaker":
    '<path d="M3 4h5v4H3zM10 4h5v4h-5zM17 4h4v4h-4zM5 20h14"/><circle cx="13" cy="14" r="2"/><path d="m11 11-2-2"/>',
  2048: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
  minesweeper: '<path d="M6 21V3m0 1h12l-3 4 3 4H6M3 21h7"/>',
  snake:
    '<path d="M4 19V9a4 4 0 0 1 8 0v6a4 4 0 0 0 8 0V6"/><circle cx="20" cy="4" r="1.5"/>',
  "memory-match":
    '<rect x="3" y="5" width="8" height="14" rx="2"/><rect x="13" y="5" width="8" height="14" rx="2"/><path d="m7 9 2 3-2 3-2-3zM15 12h4m-2-2v4"/>',
};
export function gameIcon(game) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[game] || paths["2048"]}</svg>`;
}
export function scoreParts(row, game) {
  if (timeScored(game))
    return { value: (row.elapsed_ms / 1000).toFixed(2), unit: "seconds" };
  if (game === "memory-match")
    return { value: Number(row.moves).toLocaleString(), unit: "attempts" };
  return { value: Number(row.score).toLocaleString(), unit: "points" };
}
export function scoreDetail(row, game) {
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
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
