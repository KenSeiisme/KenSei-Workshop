import { uiAttr, uiMsg, uiText } from "../site/ui.js";

const queueLease = 60000;

export function mountBoardLobby(root, game, { poll, render, restart }) {
  const summary = root.querySelector("#" + game + "-room-summary");
  const ready = root.querySelector("#" + game + "-ready");
  const status = document.createElement("p");
  status.className = "small muted";
  status.setAttribute("role", "status");
  const elapsed = document.createElement("p");
  elapsed.className = "small muted";
  const again = document.createElement("button");
  again.type = "button";
  again.className = "button secondary";
  uiText(again, uiMsg("Search again"));
  again.onclick = () => restart(lobby.search?.config);
  status.hidden = elapsed.hidden = again.hidden = true;
  summary.after(status, elapsed);
  ready.before(again);

  let checkedDeadline;
  const lobby = {
    search: null,
    cancelling: false,
    confirming: false,
    start(config, message, startedAt) {
      this.search = { config, startedAt };
      this.ack(message);
    },
    ack({ capacity }) {
      if (!this.search) return;
      Object.assign(this.search, {
        capacity,
        heardAt: Date.now(),
        lost: false,
      });
    },
    lookup() {
      const search = this.search;
      return (
        !!search && (search.lost || Date.now() - search.heardAt >= queueLease)
      );
    },
    afterLookup() {
      if (Date.now() - this.search.heardAt >= queueLease)
        this.search.expired = true;
      this.search.lost = false;
    },
    paint(room, offset, busy) {
      const search = this.search;
      const note = this.cancelling
        ? uiMsg("Cancelling search…")
        : search?.stopping
          ? uiMsg("Waiting to confirm cancellation. Retry Cancel.")
          : search?.expired
            ? uiMsg("This search expired. Search again to rejoin the queue.")
            : search?.lost
              ? uiMsg("Reconnecting to check your search…")
              : search?.capacity
                ? uiMsg("Waiting for a free online room.")
                : search
                  ? uiMsg("Finding an opponent…")
                  : room?.status === "ready"
                    ? uiMsg("Opponent found. Both players must press Ready.")
                    : room?.status === "waiting"
                      ? uiMsg("Share the invitation with your opponent.")
                      : "";
      status.hidden = !note;
      uiText(status, note);
      again.hidden = !search?.expired || this.cancelling;
      again.disabled = busy;
      uiText(
        ready,
        this.confirming ? uiMsg("Confirming Ready…") : uiMsg("Ready"),
      );
      this.tick(room, offset);
    },
    tick(room, offset) {
      const search = this.search;
      elapsed.hidden = !search || search.expired;
      if (search && !search.expired)
        uiText(
          elapsed,
          uiMsg("Waiting · {0} s", [
            Math.floor((Date.now() - search.startedAt) / 1000),
          ]),
        );
      const clock = root.querySelector("#" + game + "-ready-time");
      if (room?.status !== "ready" || !room.ready_deadline) {
        uiText(clock, "");
        return;
      }
      if (Date.parse(room.ready_deadline) > Date.now() + offset) return;
      ready.disabled = true;
      uiText(clock, uiMsg("Checking room status…"));
      const current = room.id + ":" + room.ready_deadline;
      if (checkedDeadline !== current) {
        checkedDeadline = current;
        void poll();
      }
    },
    async ready(action) {
      this.confirming = true;
      render();
      try {
        await action();
      } catch (error) {
        if (!error.staleBoardRequest) await poll();
        throw error;
      } finally {
        this.confirming = false;
      }
    },
  };
  return lobby;
}

export function readyLabel(isMe, value) {
  if (isMe) return value ? uiMsg("You are ready") : uiMsg("You are not ready");
  return value ? uiMsg("Opponent is ready") : uiMsg("Opponent is not ready");
}

export async function copyRoomInvite(button, key, code, report) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(key, code);
  const container = button.parentElement;
  container.querySelector("[data-invite-copy]")?.remove();
  try {
    await navigator.clipboard.writeText(url.href);
    report(uiMsg("Invite link copied."));
  } catch {
    const field = document.createElement("input");
    field.type = "text";
    field.readOnly = true;
    field.dataset.inviteCopy = "";
    field.value = url.href;
    uiAttr(field, "aria-label", uiMsg("Invitation link"));
    container.append(field);
    field.focus();
    field.select();
    report(uiMsg("Copy the invitation link shown next to the room code."));
  }
}
