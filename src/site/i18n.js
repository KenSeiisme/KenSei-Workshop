/* Shared UI localization. Model data, file contents and editable values never pass through this layer. */
(() => {
  "use strict";
  const dataNode = document.getElementById("site-locale-data");
  if (!dataNode) return;
  const config = JSON.parse(dataNode.textContent),
    english = config.english || {},
    sourceKeys = new Map(),
    runtime = new Map(),
    bindings = new Set(),
    nodeBindings = new WeakMap(),
    cache = new Map();
  for (const [key, value] of Object.entries(english))
    sourceKeys.set(normalize(value), key);
  let locale = config.locale || "en",
    translations = config.messages || {},
    serial = 0,
    generation = 0,
    observer;
  const opaque =
    'textarea,input,pre,code,script,style,[contenteditable="true"],[data-ui-opaque],#markdown-preview,#compare-output,#qr-scan-result,#answer-en,#answer-zh,#typing-passage,#typing-input,#sub-overlay,#board-canvas';
  function normalize(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }
  function interpolate(source, args, html = false, original = source) {
    return source.replace(/\{(\d+)\}/g, (_, index) => {
      let value = args[Number(index)] ?? "";
      if (value instanceof Message) return render(value, html);
      if (
        locale === "zh-Hant" &&
        value === "s" &&
        new RegExp("[A-Za-z]\\{" + index + "\\}").test(original)
      )
        return "";
      return String(value);
    });
  }
  class Message extends String {
    constructor(source, args = [], parts = null) {
      super(
        parts
          ? parts.map(String).join("")
          : source.replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? "")),
      );
      this.source = source;
      this.args = args;
      this.parts = parts;
    }
  }
  function msg(source, args = []) {
    if (source instanceof Message) return source;
    return new Message(english[source] || String(source), args);
  }
  function join(parts) {
    return new Message("", [], parts);
  }
  function render(value, html = false) {
    if (!(value instanceof Message)) return String(value ?? "");
    if (value.parts)
      return value.parts.map((part) => render(part, html)).join("");
    const key = sourceKeys.get(normalize(value.source)),
      localized = locale !== "en" && translations[key] !== undefined,
      translated = localized ? translations[key] : value.source;
    return (
      (localized ? value.source.match(/^\s*/)[0] : "") +
      interpolate(translated, value.args, html, value.source) +
      (localized ? value.source.match(/\s*$/)[0] : "")
    );
  }
  const patterns = [];
  for (const [key, source] of Object.entries(english)) {
    if (!/\{\d+\}/.test(source)) continue;
    const indexes = [];
    const escaped = source
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\{(\d+)\\\}/g, (_, n) => {
        indexes.push(Number(n));
        return "([\\s\\S]*?)";
      });
    try {
      patterns.push({
        key,
        source,
        indexes,
        regex: new RegExp("^" + escaped + "$"),
      });
    } catch {}
  }
  patterns.sort(
    (a, b) =>
      b.source.replace(/\{\d+\}/g, "").length -
      a.source.replace(/\{\d+\}/g, "").length,
  );
  function from(value) {
    if (value instanceof Message) return value;
    const source = normalize(value),
      key = sourceKeys.get(source);
    if (key) return msg(english[key]);
    for (const item of patterns) {
      const match = item.regex.exec(source);
      if (match) {
        const args = [];
        item.indexes.forEach((n, i) => (args[n] = match[i + 1]));
        return msg(item.source, args);
      }
    }
    return value;
  }
  function error(value) {
    const text = value?.message ?? value;
    const translated = from(text);
    return translated instanceof Message
      ? translated
      : join([
          msg("Something went wrong. Please try again."),
          " ",
          String(text ?? ""),
        ]);
  }
  function decoded(value) {
    const box = document.createElement("textarea");
    box.innerHTML = value;
    return box.value;
  }
  function display(binding) {
    const value = render(binding.message);
    if (binding.attribute) {
      const result = binding.html ? decoded(value) : value;
      if (binding.node.getAttribute(binding.attribute) !== result)
        binding.node.setAttribute(binding.attribute, result);
    } else {
      const result =
        (binding.leading || "") +
        (binding.html ? decoded(value) : value) +
        (binding.trailing || "");
      if (binding.node.textContent !== result)
        binding.node.textContent = result;
    }
  }
  function remember(
    node,
    message,
    attribute = null,
    html = false,
    spaces = null,
  ) {
    if (!(message instanceof Message) || !node) return false;
    let records = nodeBindings.get(node);
    if (!records) {
      records = new Map();
      nodeBindings.set(node, records);
    }
    const name = attribute || "#text";
    let binding = records.get(name);
    if (binding) {
      binding.message = message;
      binding.html = html;
    } else {
      binding = { node, message, attribute, html };
      records.set(name, binding);
      bindings.add(binding);
    }
    if (spaces) {
      binding.leading = spaces[0];
      binding.trailing = spaces[1];
    }
    display(binding);
    return true;
  }
  function text(node, value) {
    if (!node) return value;
    if (!remember(node, value)) {
      const records = nodeBindings.get(node);
      const old = records?.get("#text");
      if (old) {
        bindings.delete(old);
        records.delete("#text");
      }
      node.textContent = String(value ?? "");
    }
    return value;
  }
  function canonical(node) {
    const record = nodeBindings.get(node)?.get("#text");
    if (record) return String(record.message);
    if (node?.nodeType === 1)
      return [...node.childNodes]
        .filter((n) => n.nodeType !== 8)
        .map(canonical)
        .join("");
    return node?.textContent ?? "";
  }
  function attr(node, name, value) {
    if (!remember(node, value, name))
      node?.setAttribute(name, String(value ?? ""));
    return value;
  }
  function attribute(node, name, value) {
    return attr(node, name, value);
  }
  function register(message, html = false) {
    const id = "r" + ++serial;
    runtime.set(id, { message, html });
    return id;
  }
  function lookup(id) {
    return (
      runtime.get(id) ||
      (english[id] ? { message: msg(english[id]), html: true } : null)
    );
  }
  function textParts(raw, args) {
    return raw.replace(/\{(\d+)\}/g, (_, index) => {
      const value = args[Number(index)] ?? "";
      if (!(value instanceof Message)) return String(value);
      return "<!--ui:" + register(value, true) + "-->" + render(value, true);
    });
  }
  function markText(raw, args = []) {
    const leading = raw.match(/^\s*/)[0],
      trailing = raw.match(/\s*$/)[0],
      source = normalize(raw);
    if (!source || !/[A-Za-z]/.test(source) || /^\{\d+\}$/.test(source))
      return textParts(raw, args);
    const canonicalSource = normalize(decoded(source)),
      key = sourceKeys.get(canonicalSource);
    if (!key) return textParts(raw, args);
    const used = [...source.matchAll(/\{(\d+)\}/g)].map(
      (match) => args[Number(match[1])],
    );
    if (
      used.some(
        (value) =>
          !(value instanceof Message) &&
          /<[a-z][a-z0-9:-]*(?:\s|>)/i.test(String(value)),
      )
    )
      return interpolate(raw, args, true);
    const value = msg(canonicalSource, args),
      id = register(value, true);
    return `${leading}<!--ui:${id}-->${render(value, true)}${trailing}`;
  }
  function html(first, ...values) {
    const source =
      Array.isArray(first) && Object.hasOwn(first, "raw")
        ? first
            .map(
              (piece, index) =>
                piece + (index < values.length ? "{" + index + "}" : ""),
            )
            .join("")
        : String(first);
    let protectedDepth = 0;
    return source.replace(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g, (piece) => {
      if (piece.startsWith("<!--")) return piece;
      if (piece.startsWith("<")) {
        if (/^<\/(?:script|style|textarea|pre|code)\b/i.test(piece))
          protectedDepth = Math.max(0, protectedDepth - 1);
        const attrs = {};
        let output = piece;
        if (!protectedDepth)
          output = output.replace(
            /\b(aria-label|title|placeholder|alt)=(['"])([\s\S]*?)\2/g,
            (whole, name, quote, value) => {
              const key = sourceKeys.get(normalize(value));
              if (!key) return interpolate(whole, values, true);
              const message = msg(normalize(value), values),
                id = register(message, true);
              attrs[name] = id;
              return (
                name +
                "=" +
                quote +
                render(message, true).replaceAll(
                  quote,
                  quote === '"' ? "&quot;" : "&#39;",
                ) +
                quote
              );
            },
          );
        if (Object.keys(attrs).length && !/^<\//.test(piece))
          output = output.replace(
            /\s*\/?>$/,
            (end) => ` data-ui-attrs='${JSON.stringify(attrs)}'${end}`,
          );
        if (/^<(?:script|style|textarea|pre|code)\b/i.test(piece))
          protectedDepth++;
        return interpolate(output, values, true);
      }
      return protectedDepth
        ? interpolate(piece, values, true)
        : markText(piece, values);
    });
  }
  function bindTree(root = document) {
    const comments = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    while (comments.nextNode()) {
      const marker = comments.currentNode,
        match = /^ui:([\w-]+)$/.exec(marker.data);
      if (!match) continue;
      const node = marker.nextSibling,
        record = lookup(match[1]);
      if (
        !record ||
        node?.nodeType !== 3 ||
        node.parentElement?.closest(opaque)
      )
        continue;
      remember(node, record.message, null, record.html, [
        node.textContent.match(/^\s*/)[0],
        node.textContent.match(/\s*$/)[0],
      ]);
    }
    const elements = root.querySelectorAll?.("[data-ui-attrs]") || [];
    for (const node of elements) {
      if (node.closest("[data-ui-opaque]")) continue;
      try {
        for (const [name, id] of Object.entries(
          JSON.parse(node.dataset.uiAttrs),
        )) {
          const record = lookup(id);
          if (record) remember(node, record.message, name, record.html);
        }
      } catch {}
    }
    for (const binding of bindings)
      if (!binding.node.isConnected) bindings.delete(binding);
    // Keep only descriptors referenced by live markers; editing never accumulates detached snapshots.
    if (runtime.size > 6000) {
      const live = new Set(
        [...document.querySelectorAll("[data-ui-attrs]")].flatMap((n) => {
          try {
            return Object.values(JSON.parse(n.dataset.uiAttrs));
          } catch {
            return [];
          }
        }),
      );
      const scan = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_COMMENT,
      );
      while (scan.nextNode()) {
        const match = /^ui:(r\d+)$/.exec(scan.currentNode.data);
        if (match) live.add(match[1]);
      }
      for (const id of runtime.keys()) if (!live.has(id)) runtime.delete(id);
    }
  }
  function observe() {
    observer?.observe(document.body, { childList: true, subtree: true });
  }
  function withObserverPaused(action) {
    observer?.disconnect();
    try {
      return action();
    } finally {
      observe();
    }
  }
  function localePath(pathname, target = locale) {
    const plain = pathname.replace(/^\/zh-hant(?=\/|$)/, "") || "/";
    if (plain.startsWith("/auth/callback")) return plain;
    return target === "zh-Hant"
      ? "/zh-hant" + (plain.startsWith("/") ? plain : "/" + plain)
      : plain;
  }
  function updateLinks() {
    for (const anchor of document.querySelectorAll("a[href]")) {
      const raw = anchor.getAttribute("href");
      if (
        !raw ||
        raw.startsWith("#") ||
        anchor.hasAttribute("data-language-link")
      )
        continue;
      try {
        const url = new URL(raw, location.origin);
        if (url.origin !== location.origin) continue;
        const logical = url.pathname.replace(/^\/zh-hant(?=\/|$)/, "");
        if (!config.routes?.includes(logical)) continue;
        anchor.setAttribute(
          "href",
          localePath(logical) + url.search + url.hash,
        );
      } catch {}
    }
  }
  function updateMetadata() {
    document.documentElement.lang = locale;
    const metadata = config.meta?.[locale];
    if (!metadata) return;
    document.title = metadata.title;
    for (const [selector, value] of [
      ['meta[name="description"]', metadata.description],
      ['meta[property="og:title"]', metadata.title],
      ['meta[property="og:description"]', metadata.description],
      ['meta[property="og:url"]', metadata.url],
      ['meta[property="og:image"]', metadata.image],
      ['meta[name="twitter:title"]', metadata.title],
      ['meta[name="twitter:description"]', metadata.description],
      ['meta[name="twitter:image"]', metadata.image],
    ]) {
      const node = document.querySelector(selector);
      if (node) node.setAttribute("content", value);
    }
    document
      .querySelector('link[rel="canonical"]')
      ?.setAttribute("href", metadata.url);
  }
  async function setLocale(next) {
    if (!["en", "zh-Hant"].includes(next)) throw Error("Unsupported locale");
    const request = ++generation;
    if (next === locale) return;
    let loaded = cache.get(next);
    if (next === "en") loaded = {};
    if (!loaded) {
      const url = config.packs?.[next];
      if (!url) throw Error("Language pack unavailable");
      const response = await fetch(url);
      if (!response.ok) throw Error("Language pack unavailable");
      loaded = await response.json();
      if (
        !loaded ||
        Object.keys(english).some((key) => typeof loaded[key] !== "string")
      )
        throw Error("Incomplete language pack");
      if (request !== generation) return;
      cache.set(next, loaded);
    }
    if (request !== generation) return;
    withObserverPaused(() => {
      locale = next;
      translations = loaded;
      for (const binding of [...bindings]) {
        if (binding.node.isConnected) display(binding);
        else bindings.delete(binding);
      }
      history.replaceState(
        history.state,
        "",
        localePath(location.pathname, next) + location.search + location.hash,
      );
      updateLinks();
      updateMetadata();
      for (const select of document.querySelectorAll("[data-language-select]"))
        select.value = next;
    });
    try {
      localStorage.setItem("kensei-ui-language-v1", next);
    } catch {}
    window.dispatchEvent(
      new CustomEvent("locale-change", { detail: { locale: next } }),
    );
  }
  window.KenseiI18n = {
    canonical,
    msg,
    join,
    from,
    error,
    text,
    attr,
    attribute,
    html,
    render,
    t: (key, params = []) =>
      render(msg(key, Array.isArray(params) ? params : Object.values(params))),
    setLocale,
    getLocale: () => locale,
    localePath,
    config,
    bindTree,
    confirm: (value) => window.confirm(render(value)),
    alert: (value) => window.alert(render(value)),
    prompt: (value, initial = "") => window.prompt(render(value), initial),
  };
  cache.set(locale, translations);
  if (location.pathname === "/" && locale === "en") {
    try {
      if (localStorage.getItem("kensei-ui-language-v1") === "zh-Hant") {
        location.replace("/zh-hant/" + location.search + location.hash);
        return;
      }
    } catch {}
  }
  withObserverPaused(() => {
    bindTree();
    updateLinks();
    updateMetadata();
    for (const select of document.querySelectorAll("[data-language-select]"))
      select.value = locale;
  });
  observer = new MutationObserver(() =>
    withObserverPaused(() => {
      bindTree();
      updateLinks();
    }),
  );
  observe();
  window.addEventListener("locale-change", () =>
    withObserverPaused(() => bindTree()),
  );
})();
