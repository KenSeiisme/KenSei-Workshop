/* Public catalog search and navigation run independently of account initialization. */
(() => {
  "use strict";
  const I = window.KenseiI18n;
  if (!I) return;
  const $ = (s) => document.querySelector(s),
    node = (tag, cls) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      return n;
    };
  const label = (n, key) => I.text(n, I.msg(key));
  const header = $(".nav-wrap");
  if (!header) return;
  const language = node("label", "site-language"),
    languageCaption = node("span");
  label(languageCaption, "site.language");
  language.append(languageCaption);
  const select = node("select");
  select.dataset.languageSelect = "";
  select.setAttribute("aria-label", I.t("site.language"));
  for (const [value, name] of [
    ["en", "English"],
    ["zh-Hant", "繁體中文"],
  ]) {
    const o = node("option");
    o.value = value;
    o.textContent = name;
    select.append(o);
  }
  select.value = I.getLocale();
  language.append(select);
  const searchButton = node("button", "icon-button site-search-button");
  searchButton.type = "button";
  searchButton.textContent = "⌕";
  I.attr(searchButton, "aria-label", I.msg("site.search"));
  header.insertBefore(searchButton, $("#account-controls"));
  header.insertBefore(language, $("#account-controls"));
  const feedback = node("p", "site-language-status");
  feedback.role = "status";
  feedback.hidden = true;
  header.append(feedback);
  let languageRequest = 0;
  document.addEventListener("change", async (event) => {
    if (!event.target.matches("[data-language-select]")) return;
    const request = ++languageRequest,
      target = event.target.value,
      host = event.target.closest("dialog") || header;
    host.append(feedback);
    feedback.classList.toggle("site-language-inline", host !== header);
    feedback.hidden = false;
    label(feedback, "site.languageLoading");
    try {
      await I.setLocale(target);
      if (request === languageRequest) feedback.hidden = true;
    } catch {
      if (request === languageRequest) label(feedback, "site.languageFailure");
    }
    for (const item of document.querySelectorAll("[data-language-select]"))
      item.value = I.getLocale();
  });
  // Native modal dialogs supply focus containment, inert background and Escape handling.
  const drawer = node("dialog", "site-drawer");
  drawer.id = "site-navigation-dialog";
  const close = node("button", "icon-button site-dialog-close");
  close.textContent = "×";
  I.attr(close, "aria-label", I.msg("site.close"));
  drawer.append(close);
  document.body.append(drawer);
  const nav = $("#navigation"),
    account = $("#account-controls"),
    toggle = $(".menu-toggle");
  const anchors = [nav, account, language].map((n) => {
    const slot = document.createComment("navigation slot");
    n.before(slot);
    return [n, slot];
  });
  let drawerReturn;
  const dismiss = () => drawer.close();
  close.onclick = dismiss;
  function restore() {
    for (const [n, slot] of anchors) slot.after(n);
    toggle.setAttribute("aria-expanded", "false");
    drawerReturn?.focus();
  }
  drawer.addEventListener("close", restore);
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      const menu = $("#account-menu");
      if (menu && !menu.hidden) {
        menu.hidden = true;
        $("#account-toggle").setAttribute("aria-expanded", "false");
        $("#account-toggle").focus();
      } else drawer.close();
    }
  });
  toggle.setAttribute("aria-controls", drawer.id);
  I.attr(toggle, "aria-label", I.msg("site.menu"));
  toggle.addEventListener("click", () => {
    drawerReturn = toggle;
    for (const [n] of anchors) drawer.append(n);
    toggle.setAttribute("aria-expanded", "true");
    drawer.showModal();
    close.focus();
  });
  drawer.addEventListener("click", (e) => {
    if (e.target === drawer || e.target.closest("a")) dismiss();
  });
  window.matchMedia("(min-width:1024px)").addEventListener("change", (e) => {
    if (e.matches && drawer.open) drawer.close();
  });
  // Search only the generated public tools/games/projects index.
  const dialog = node("dialog", "site-search");
  dialog.id = "site-search-dialog";
  const heading = node("h2");
  heading.id = "site-search-title";
  label(heading, "site.search");
  dialog.setAttribute("aria-labelledby", heading.id);
  const dismissSearch = node("button", "icon-button site-dialog-close");
  dismissSearch.textContent = "×";
  I.attr(dismissSearch, "aria-label", I.msg("site.close"));
  const input = node("input", "site-search-input");
  input.type = "search";
  input.autocomplete = "off";
  I.attr(input, "placeholder", I.msg("site.searchHint"));
  I.attr(input, "aria-label", I.msg("site.search"));
  const filters = node("div", "filter-bar"),
    status = node("p", "muted small"),
    list = node("div", "site-search-results");
  status.role = "status";
  list.id = "site-search-results";
  input.setAttribute("aria-controls", list.id);
  let filter = "all",
    index = null,
    pending = null,
    selected = -1,
    origin;
  for (const type of ["all", "tools", "games", "projects"]) {
    const b = node("button", "filter");
    b.type = "button";
    b.dataset.type = type;
    label(b, "site." + type);
    b.setAttribute("aria-pressed", String(type === filter));
    b.onclick = () => {
      filter = type;
      for (const c of filters.children)
        c.setAttribute("aria-pressed", String(c === b));
      render();
    };
    filters.append(b);
  }
  dialog.append(dismissSearch, heading, input, filters, status, list);
  document.body.append(dialog);
  dismissSearch.onclick = () => dialog.close();
  dialog.addEventListener("close", () => origin?.focus());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  const folded = (s) => s.toLocaleLowerCase().normalize("NFKC").trim();
  function rank(entry, q) {
    if (!q) return 1;
    const names = Object.values(entry.name).map(folded);
    if (names.includes(q)) return 100;
    if (names.some((s) => s.startsWith(q))) return 80;
    if (entry.aliases.some((s) => folded(s) === q)) return 70;
    if (names.some((s) => s.includes(q))) return 60;
    if (entry.aliases.some((s) => folded(s).includes(q))) return 50;
    if (Object.values(entry.description).some((s) => folded(s).includes(q)))
      return 20;
    return 0;
  }
  function render() {
    list.replaceChildren();
    selected = -1;
    if (!index) return;
    const locale = I.getLocale(),
      q = folded(input.value);
    const matches = index
      .filter((x) => filter === "all" || x.type === filter)
      .map((x) => ({ x, score: rank(x, q) }))
      .filter((x) => x.score)
      .sort((a, b) => b.score - a.score || a.x.route.localeCompare(b.x.route));
    label(status, matches.length ? "site.searchPrompt" : "site.searchEmpty");
    for (const { x } of matches) {
      const a = node("a", "site-search-result");
      a.href = I.localePath(x.route);
      const name = node("strong"),
        type = node("small"),
        desc = node("span");
      name.textContent = x.name[locale];
      label(type, "site." + x.type);
      desc.textContent = x.description[locale];
      a.append(name, type, desc);
      list.append(a);
    }
  }
  async function load() {
    label(status, "site.searchLoading");
    try {
      pending ??= fetch("/assets/search-index.json").then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      });
      index = await pending;
      render();
    } catch {
      pending = null;
      label(status, "site.searchFailure");
      const retry = node("button", "button secondary");
      label(retry, "site.retry");
      retry.onclick = load;
      list.replaceChildren(retry);
    }
  }
  function open() {
    origin = document.activeElement;
    dialog.showModal();
    input.focus();
    if (index) render();
    else load();
  }
  searchButton.onclick = open;
  input.addEventListener("input", render);
  dialog.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dialog.close();
      return;
    }
    const links = [...list.querySelectorAll("a")];
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      selected =
        (selected + (e.key === "ArrowDown" ? 1 : -1) + links.length) %
        links.length;
      links.forEach((a, i) => a.classList.toggle("selected", i === selected));
      links[selected]?.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter" && document.activeElement === input && links.length) {
      e.preventDefault();
      links[Math.max(selected, 0)].click();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.key.toLowerCase() !== "k" ||
      !(e.ctrlKey || e.metaKey) ||
      e.isComposing ||
      e.defaultPrevented
    )
      return;
    if (
      e.target.closest(
        'input,textarea,[contenteditable="true"],.excalidraw,[data-tool], [data-game]',
      ) ||
      $(
        '[data-run-state="playing"],[data-pong-state="playing"],[data-tool="typing-sprint"] .tool-session-active,[data-tool="device-check"].tool-stage-active',
      ) ||
      $('[data-tool="typing-sprint"] #typing-input:not(:disabled)') ||
      $("dialog[open]")
    )
      return;
    e.preventDefault();
    open();
  });
  window.addEventListener("locale-change", () => {
    if (dialog.open) render();
  });
})();
