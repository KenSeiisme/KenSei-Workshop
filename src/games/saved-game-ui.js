import { uiMsg, uiText } from "../site/ui.js";

export function isUnfinishedSave(row, game = row?.data?.game) {
  return (
    !!row &&
    !row.deleted &&
    row.data?.game === game &&
    row.data.state?.status === "playing" &&
    !row.data.state.result
  );
}

export async function lookupSavedGame(store, id, game) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
  const row = await store.get(id);
  return isUnfinishedSave(row, game) ? row : null;
}

export function showMissingSave(root, missing) {
  const note = root.querySelector("[data-missing-game-save]");
  note.hidden = !missing;
  uiText(
    note.querySelector("span"),
    missing
      ? uiMsg(
          "This saved game is unavailable. Choose another save or start a new game.",
        )
      : "",
  );
}
