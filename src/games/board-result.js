import { uiMsg } from "../site/ui.js";

export function boardResult({ result, color, status }) {
  if (status === "interrupted" || result?.reason === "interrupted")
    return uiMsg("Interrupted");
  if (status === "unresolved" || result?.reason === "unresolved")
    return uiMsg("Unresolved");
  if (result?.reason === "both-lose") return uiMsg("Both players lost");
  if (result?.winner === 0) return uiMsg("Draw");
  if (result?.winner === 1 || result?.winner === -1)
    return result.winner === color ? uiMsg("Won") : uiMsg("Lost");
  return uiMsg("No result");
}
