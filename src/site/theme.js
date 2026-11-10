(() => {
  "use strict";
  const root = document.documentElement;
  const key = "kensei-game-hub-theme";
  function apply(value) {
    root.dataset.siteTheme = value === "light" ? "light" : "dark";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", value === "light" ? "#f7f1fa" : "#111015");
  }
  try {
    apply(localStorage.getItem(key));
  } catch {
    apply("dark");
  }
  document.addEventListener("DOMContentLoaded", () => {
    const button = document.querySelector("[data-site-theme-toggle]");
    if (!button) return;
    const ui = window.KenseiI18n;
    button.removeAttribute("data-ui-attrs");
    function paint() {
      const light = root.dataset.siteTheme === "light";
      button.querySelector("[data-theme-sun]").hidden = light;
      button.querySelector("[data-theme-moon]").hidden = !light;
      const label = ui.msg(
        light ? "Switch to dark theme" : "Switch to light theme",
      );
      ui.attr(button, "aria-label", label);
      ui.attr(button, "title", label);
    }
    button.addEventListener("click", () => {
      const value = root.dataset.siteTheme === "light" ? "dark" : "light";
      apply(value);
      try {
        localStorage.setItem(key, value);
      } catch {}
      paint();
      window.KenseiNotify(
        ui.msg(value === "light" ? "Light theme" : "Dark theme"),
        { kind: "setting", key: "theme" },
      );
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== key && event.key !== null) return;
      apply(event.newValue);
      paint();
    });
    paint();
  });
})();
