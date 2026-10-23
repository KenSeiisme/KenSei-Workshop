// 保留棋盘节点、焦点和事件；这里只接收应用生成且已转义的标记。
const keyed = [
  "id",
  "data-cell",
  "data-puzzle-cell",
  "data-block-cell",
  "data-block-slot",
  "data-board-cell",
  "data-puzzle-action",
  "data-puzzle-digit",
  "data-puzzle-paint",
  "data-player-id",
  "data-game-avatar",
  "data-rank",
  "data-game-theme",
];
function key(node) {
  if (node.nodeType !== 1) return "";
  for (const name of keyed)
    if (node.hasAttribute(name))
      return `${node.localName}:${name}:${node.getAttribute(name)}`;
  return "";
}
function compatible(a, b) {
  return (
    a.nodeType === b.nodeType &&
    (a.nodeType !== 1 || a.localName === b.localName) &&
    key(a) === key(b)
  );
}
function update(node, wanted) {
  if (node.nodeType !== 1) {
    if (node.nodeValue !== wanted.nodeValue) node.nodeValue = wanted.nodeValue;
    return;
  }
  for (const attr of [...node.attributes])
    if (
      !wanted.hasAttribute(attr.name) &&
      !(attr.name === "open" && wanted.hasAttribute("data-preserve-open")) &&
      !(
        node.hasAttribute("data-motion-hidden") &&
        ["style", "data-motion-hidden"].includes(attr.name)
      )
    )
      node.removeAttribute(attr.name);
  for (const attr of wanted.attributes)
    if (node.getAttribute(attr.name) !== attr.value)
      node.setAttribute(attr.name, attr.value);
  if (!wanted.hasAttribute("data-preserve")) reconcile(node, wanted);
}
function reconcile(parent, wanted) {
  const candidates = [...parent.childNodes].filter(
      (node) => !node.hasAttribute?.("data-motion-layer"),
    ),
    used = new Set();
  let cursor = parent.firstChild;
  for (const next of [...wanted.childNodes]) {
    let node = candidates.find(
      (item) => !used.has(item) && compatible(item, next),
    );
    if (node) {
      used.add(node);
      if (node !== cursor) parent.insertBefore(node, cursor);
      update(node, next);
    } else {
      node = next.cloneNode(true);
      parent.insertBefore(node, cursor);
    }
    cursor = node.nextSibling;
  }
  for (const node of candidates) if (!used.has(node)) node.remove();
}
export function patchMarkup(parent, markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  reconcile(parent, template.content);
}
