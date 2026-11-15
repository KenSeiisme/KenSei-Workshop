import { api } from "/tool-scripts/common.js";
import { uiMsg, uiText } from "../site/ui.js";

export const MATCH_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestedMatch() {
  return new URLSearchParams(location.search).get("match");
}

export function mountMatchLink(root) {
  const panel = root.querySelector("[data-match-link]");
  const message = panel.querySelector("[data-match-link-message]");
  const signIn = panel.querySelector("[data-match-link-sign-in]");
  const retry = panel.querySelector("[data-match-link-retry]");
  signIn.onclick = () => api.openAuth(location.pathname + location.search);
  return (state, reload) => {
    panel.hidden = !state;
    signIn.hidden = state !== "guest";
    retry.hidden = state !== "retry";
    retry.onclick = reload;
    uiText(
      message,
      state === "guest"
        ? uiMsg("Sign in to return to this online match.")
        : state === "loading"
          ? uiMsg("Opening your online match…")
          : state === "retry"
            ? uiMsg("The match could not load. Retry when connected.")
            : state
              ? uiMsg(
                  "This match has ended, expired or is unavailable to this account.",
                )
              : "",
    );
  };
}
