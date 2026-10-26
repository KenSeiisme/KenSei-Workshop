const fs = require("node:fs"),
  { chromium } = require("../support/browser.cjs");
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext(),
    p = await c.newPage();
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
  try {
    for (const [slug, width] of [
      ["decision-studio", 1440],
      ["qr-studio", 360],
      ["calculator-studio", 1440],
    ]) {
      await p.setViewportSize({ width, height: 1000 });
      await p.goto(base + "/tools/" + slug + "/");
      await p.waitForSelector("[data-ready=true]");
      await p
        .locator(".advanced-panel")
        .last()
        .screenshot({ path: "_qa/advanced-" + slug + "-" + width + ".png" });
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
