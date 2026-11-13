(() => {
  const canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical || new URL(canonical.href).origin !== location.origin) return;

  window.va ??= (...args) => {
    (window.vaq ??= []).push(args);
  };

  // Public pages may still carry invite links or tool inputs in the URL.
  window.va("beforeSend", (event) => {
    if (event.type !== "pageview") return null;
    const url = new URL(event.url);
    url.search = "";
    url.hash = "";
    return { ...event, url: url.href };
  });

  const script = document.createElement("script");
  script.src = "/_vercel/insights/script.js";
  document.head.append(script);
})();
