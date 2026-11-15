import { uiMsg, uiText } from "../site/ui.js";

export const matchEnded = (room) =>
  !!room && ["finished", "interrupted", "closed"].includes(room.status);

export function requireCurrentBoardRequest(isCurrent) {
  if (!isCurrent())
    throw Object.assign(new Error(), { staleBoardRequest: true });
}

export async function invokeBoardRequest(client, action, body, isCurrent) {
  let timer;
  try {
    const response = await Promise.race([
      (async () => {
        const { data, error } = await client.functions.invoke(
          "board-match/" + action,
          { body },
        );
        let reply = data;
        if (error?.context?.json) {
          try {
            reply = await error.context.json();
          } catch {}
        }
        return { reply, error };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "The online board could not be updated. Check your connection and retry.",
              ),
            ),
          15000,
        );
      }),
    ]);
    requireCurrentBoardRequest(isCurrent);
    return response;
  } catch (error) {
    requireCurrentBoardRequest(isCurrent);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function rejectedBoardCommand(error) {
  return (
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 429].includes(error.status)
  );
}

export function paintBoardConnection(root, { room, connected, pending, busy }) {
  const status = root.querySelector("[data-board-connection]");
  const ended = matchEnded(room);
  const label = !room
    ? ""
    : ended
      ? uiMsg("Online match ended")
      : !connected
        ? uiMsg("Reconnecting… The server clock is still running during play.")
        : !room.controller
          ? uiMsg("Read-only tab. Take control here to play.")
          : pending
            ? busy
              ? uiMsg("Checking move…")
              : uiMsg("Move awaiting confirmation. Retry to check its result.")
            : "";
  status.hidden = !label;
  uiText(status, label);
  const retry = root.querySelector("[data-board-retry-move]");
  retry.hidden = !room || ended || !pending;
  retry.disabled = !connected || !room?.controller || busy;
}
