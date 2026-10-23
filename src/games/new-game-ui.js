import { createPuzzleUI } from "./puzzle-ui.js";
import { createArcadeUI } from "./arcade-ui.js";
import { createBoardUI } from "./board-ui.js";

export function createExtraUI(context) {
  if (["sudoku", "nonogram"].includes(context.game))
    return createPuzzleUI(context);
  if (["block-puzzle", "brick-breaker"].includes(context.game))
    return createArcadeUI(context);
  if (["connect-four", "reversi"].includes(context.game))
    return createBoardUI(context);
  return null;
}
