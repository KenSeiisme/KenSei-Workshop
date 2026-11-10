import { uiAttr, uiMsg } from "../site/ui.js";

const key = "kensei-game-hub-theme";
export function mountHubTheme(button) {
  button.removeAttribute("data-ui-attrs");
  function setTheme(light) {
    document.body.classList.toggle("hub-light", light);
    button.querySelector("[data-theme-sun]").toggleAttribute("hidden", light);
    button.querySelector("[data-theme-moon]").toggleAttribute("hidden", !light);
    const label = light
      ? uiMsg("Switch to dark theme")
      : uiMsg("Switch to light theme");
    uiAttr(button, "aria-label", label);
    uiAttr(button, "title", label);
  }
  let initialLight = false;
  try {
    initialLight = localStorage.getItem(key) === "light";
  } catch {}
  setTheme(initialLight);
  button.addEventListener("click", () => {
    const light = !document.body.classList.contains("hub-light");
    setTheme(light);
    try {
      localStorage.setItem(key, light ? "light" : "dark");
    } catch {}
  });
}
