// UI adapters stay usable in deterministic Node tests; browser bindings delegate to the shared locale controller.
const core = () => globalThis.KenseiI18n;
const plain = (source, args = []) =>
  String(source).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? ""));
export const uiMsg = (source, args = []) =>
  core()?.msg(source, args) ?? plain(source, args);
export const uiJoin = (parts) => core()?.join(parts) ?? parts.join("");
export const uiFrom = (value) => core()?.from(value) ?? value;
export const uiError = (value) =>
  core()?.error(value) ?? value?.message ?? String(value);
export const uiText = (node, value) => {
  if (core()) return core().text(node, value);
  if (node) node.textContent = String(value ?? "");
  return value;
};
export const uiAttr = (node, name, value) => {
  if (core()) return core().attr(node, name, value);
  node?.setAttribute(name, String(value ?? ""));
  return value;
};
export const uiHtml = (first, ...values) =>
  core()?.html(first, ...values) ??
  (Array.isArray(first) && Object.hasOwn(first, "raw")
    ? first.map((part, i) => part + (values[i] ?? "")).join("")
    : String(first));
export const uiConfirm = (value) =>
  globalThis.confirm(core()?.render(value) ?? String(value));
export const uiAlert = (value) =>
  globalThis.alert(core()?.render(value) ?? String(value));
export const uiPrompt = (value, initial = "") =>
  globalThis.prompt(core()?.render(value) ?? String(value), initial);
export const uiDate = (value, options) =>
  uiMsg("{0}", [
    {
      toString: () =>
        new Intl.DateTimeFormat(core()?.getLocale() || "en", options).format(
          new Date(value),
        ),
    },
  ]);

export const uiSource = (node) =>
  core()?.canonical(node) ?? node?.textContent ?? "";

export const uiRender = (value) => core()?.render(value) ?? String(value);
export const uiOption = (label, value) => {
  const node = new Option("", value);
  uiText(node, label);
  return node;
};
