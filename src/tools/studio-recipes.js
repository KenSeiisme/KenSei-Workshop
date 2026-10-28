import { api, downloadText } from "./common.js";
import { el, row, field, button, select } from "./advanced-ui.js";
import { uiMsg, uiText, uiConfirm, uiRender, uiAttr } from "../site/ui.js";

// 只接收各工具白名單驗證後的設定；媒體、表單值和結果從不進入配方。
export function recipeControls(
  parent,
  tool,
  get,
  apply,
  validate,
  legacy = () => ({}),
) {
  let current = null,
    owner = api.user?.id || "guest",
    saving = false;
  const box = el("details", "", { class: "studio-recipes" }),
    title = el("summary", "Settings recipes");
  const name = el("input", "", {
    maxLength: 100,
    value: uiRender(uiMsg("My recipe")),
    "aria-label": "Recipe name",
  });
  const saved = select([["", "Choose a saved recipe"]]);
  uiAttr(saved, "aria-label", uiMsg("Choose a saved recipe"));
  const note = el(
    "p",
    "Settings only. Choose source files again when reusing a recipe.",
    { class: "muted small", role: "status" },
  );
  const action = (label, fn, primary = false) =>
    button(
      label,
      async () => {
        try {
          await fn();
        } catch (e) {
          uiText(note, uiMsg(e.message));
        }
      },
      primary,
    );
  const clean = () => validate(structuredClone(get()));
  const use = (data, id = null) => {
    if (!data?.recipe || data.tool !== tool || data.recipe.version !== 1)
      throw Error("This recipe is not compatible with this tool.");
    const values = validate(data.recipe.settings);
    apply(values);
    current = id;
    name.value = String(data.name || "My recipe").slice(0, 100);
    uiText(
      note,
      uiMsg(
        "Recipe loaded. Select source files and confirm mappings before running.",
      ),
    );
  };
  function refresh() {
    if (owner !== (api.user?.id || "guest")) {
      current = null;
      owner = api.user?.id || "guest";
    }
    saved.replaceChildren(el("option", "Choose a saved recipe", { value: "" }));
    for (const item of api
      .items("preset")
      .filter((x) => x.data.tool === tool && x.data.recipe?.version === 1)) {
      const option = el("option", "", { value: item.id });
      option.textContent = item.data.name;
      saved.append(option);
    }
    saved.value = current || "";
  }
  async function save(asNew) {
    if (saving) return;
    if (!name.value.trim()) throw Error("Give the recipe a name.");
    const settings = clean(),
      data = {
        tool,
        name: name.value.trim(),
        ...legacy(settings),
        recipe: { version: 1, settings },
      };
    if (new TextEncoder().encode(JSON.stringify(data)).length > 100000)
      throw Error("Recipe settings are too large.");
    const saveOwner = api.user?.id || "guest",
      controls = [...box.querySelectorAll("button,select,input")],
      prior = controls.map((n) => n.disabled);
    saving = true;
    controls.forEach((n) => {
      n.disabled = true;
    });
    try {
      const item = await api.saveItem(
        "preset",
        data,
        asNew || !current ? undefined : current,
      );
      if (saveOwner !== (api.user?.id || "guest")) return;
      current = item.id;
      refresh();
      uiText(
        note,
        uiMsg(
          api.user
            ? "Recipe saved to your account."
            : "Recipe saved on this device.",
        ),
      );
    } finally {
      saving = false;
      controls.forEach((n, i) => {
        n.disabled = prior[i];
      });
    }
  }
  saved.onchange = () => {
    const item = api.items("preset").find((x) => x.id === saved.value);
    if (
      item &&
      uiConfirm(
        uiMsg(
          "Replace the current settings with this recipe? Files and results stay on this page.",
        ),
      )
    )
      use(item.data, item.id);
  };
  const input = el("input", "", {
    type: "file",
    accept: "application/json,.json",
    "aria-label": "Import recipe JSON",
  });
  input.onchange = async () => {
    try {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 100000)
        throw Error("Recipe JSON must be smaller than 100 KB.");
      const data = JSON.parse(await file.text());
      if (
        uiConfirm(
          uiMsg(
            "Replace the current settings with this recipe? Files and results stay on this page.",
          ),
        )
      )
        use(data);
    } catch (e) {
      uiText(note, uiMsg(e.message));
    } finally {
      input.value = "";
    }
  };
  box.append(
    title,
    field("Recipe name", name),
    saved,
    row(
      action("Save changes", () => save(false)),
      action("Save as new", () => save(true)),
      action("Export recipe JSON", () =>
        downloadText(
          JSON.stringify(
            {
              tool,
              name: name.value,
              recipe: { version: 1, settings: clean() },
            },
            null,
            2,
          ),
          tool + "-recipe.json",
          "application/json",
        ),
      ),
    ),
    field("Import recipe JSON", input),
    note,
  );
  parent.append(box);
  refresh();
  let applied = false;
  function fromURL() {
    refresh();
    const id = new URLSearchParams(location.search).get("preset");
    if (!id || applied) return;
    const item = api
      .items("preset")
      .find((x) => x.id === id && x.data.tool === tool && x.data.recipe);
    if (item) {
      try {
        use(item.data, item.id);
        applied = true;
      } catch (e) {
        uiText(note, uiMsg(e.message));
      }
    }
  }
  window.addEventListener("workspace-ready", fromURL);
  fromURL();
  return { refresh, use };
}

export function workspaceTabs(root, tabs, { mobile = false } = {}) {
  const query = matchMedia("(max-width:767px)");
  let active = 0;
  const nav = el("div", "", {
    class: "action-row studio-tabs",
    role: "tablist",
  });
  tabs.forEach(([label, pane], i) => {
    const id = pane.id || (pane.id = "studio-pane-" + crypto.randomUUID());
    const b = button(label, () => activate(i));
    b.id = id + "-tab";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", id);
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", b.id);
    nav.append(b);
    b.onkeydown = (e) => {
      let n = i;
      if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") n = (i + tabs.length - 1) % tabs.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = tabs.length - 1;
      else return;
      e.preventDefault();
      activate(n);
      nav.children[n].focus();
    };
  });
  function activate(i) {
    active = i;
    nav.hidden = mobile && !query.matches;
    tabs.forEach(([, p], j) => {
      p.hidden = (!mobile || query.matches) && i !== j;
      nav.children[j].setAttribute("aria-selected", String(i === j));
      nav.children[j].tabIndex = i === j ? 0 : -1;
    });
  }
  tabs[0][1].before(nav);
  query.addEventListener("change", () => activate(active));
  activate(0);
  return { activate, nav };
}
