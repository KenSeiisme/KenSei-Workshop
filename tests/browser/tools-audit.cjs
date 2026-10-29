const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const browsers = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769",
  output = process.env.TOOLS_AUDIT_OUTPUT || "_qa/tools-audit",
  tools = JSON.parse(fs.readFileSync("data/tools.json", "utf8")),
  names = (process.env.TOOLS_BROWSERS || "chromium,firefox,webkit")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  cases = [],
  failed = [];
fs.mkdirSync(output, { recursive: true });
async function launch(name) {
  if (name === "msedge")
    return browsers.chromium.launch({ channel: "msedge", headless: true });
  if (name === "brave")
    return browsers.chromium.launch({
      executablePath:
        process.env.BRAVE_PATH ||
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
      headless: true,
    });
  assert(["chromium", "firefox", "webkit"].includes(name), "Unknown browser");
  return browsers[name].launch({ headless: true });
}
(async () => {
  for (const name of names) {
    let browser;
    try {
      browser = await launch(name);
    } catch (e) {
      failed.push({
        browser: name,
        status: "blocked",
        error: e.message.split("\n")[0],
      });
      continue;
    }
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 900 },
    });
    await context.route("**/config.js", (r) =>
      r.fulfill({
        body: "window.KENSEI_CONFIG={};",
        contentType: "application/javascript",
      }),
    );
    await context.addInitScript(() => {
      window.__captureRequests = 0;
      for (const method of ["getUserMedia", "getDisplayMedia"]) {
        if (navigator.mediaDevices?.[method])
          navigator.mediaDevices[method] = async () => {
            window.__captureRequests++;
            throw new DOMException(
              "Audit: user action required",
              "NotAllowedError",
            );
          };
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let errors = [],
      network = [];
    page.on("pageerror", (e) => errors.push(e.message));
    context.on("request", (r) => {
      if (
        ["POST", "PUT", "PATCH"].includes(r.method()) ||
        /speed\.cloudflare\.com/.test(r.url())
      )
        network.push({ method: r.method(), host: new URL(r.url()).hostname });
    });
    for (const locale of ["", "/zh-hant"])
      for (const [slug] of tools) {
        errors = [];
        network = [];
        const item = {
          browser: name,
          locale: locale ? "zh-Hant" : "en",
          slug,
          status: "pass",
          viewports: [],
        };
        try {
          const response = await page.goto(`${base}${locale}/tools/${slug}/`, {
            waitUntil: "domcontentloaded",
          });
          assert.equal(response.status(), 200);
          await page.waitForSelector('[data-ui-ready="true"]');
          await page.waitForSelector('[data-ready="true"]');
          assert.equal(
            await page.locator("h1").count(),
            1,
            "One visible page title",
          );
          assert(
            (await page.locator("h1").innerText()).trim(),
            "Tool name is visible",
          );
          assert.equal(
            await page.locator("html").getAttribute("lang"),
            locale ? "zh-Hant" : "en",
          );
          for (const [width, height] of [
            [320, 640],
            [360, 800],
            [768, 1024],
            [1024, 768],
            [1440, 900],
            [800, 360],
          ]) {
            await page.setViewportSize({ width, height });
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
            const metrics = await page.evaluate(() => ({
              width: innerWidth,
              scroll: document.documentElement.scrollWidth,
            }));
            item.viewports.push({ width, height });
            assert(
              metrics.scroll <= width + 1,
              `Horizontal overflow: ${JSON.stringify(metrics)}`,
            );
            if (name === "msedge" && !locale && [360, 1440].includes(width))
              await page.screenshot({
                path: path.join(output, `review-${width}-${slug}.png`),
                fullPage: false,
              });
          }
          await page.setViewportSize({ width: 360, height: 800 });
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          if (slug === "whiteboard") await page.click("#board-menu-open");
          const help = page.locator("[data-open-help]");
          assert.equal(await help.count(), 1);
          await help.click();
          assert(await page.locator("#tool-help").isVisible());
          assert(
            (await page.locator("#tool-help").innerText()).trim().length > 50,
          );
          await page.keyboard.press("Escape");
          assert(await page.locator("#tool-help").isHidden());
          assert(
            await help.evaluate((n) => n === document.activeElement),
            "Help returns keyboard focus",
          );
          const a11y = await page.evaluate(() => {
            const visible = (n) =>
              n.getBoundingClientRect().width > 0 &&
              n.getBoundingClientRect().height > 0 &&
              getComputedStyle(n).visibility !== "hidden" &&
              !n.closest("[inert]");
            const named = (n) =>
              n.labels?.length ||
              n.getAttribute("aria-label")?.trim() ||
              n.getAttribute("title")?.trim() ||
              n
                .getAttribute("aria-labelledby")
                ?.split(/\s+/)
                .some((id) => document.getElementById(id)?.textContent.trim());
            return {
              unnamedInputs: [
                ...document.querySelectorAll(
                  "[data-tool] input:not([type=hidden]):not([type=button]):not([type=submit]),[data-tool] textarea,[data-tool] select",
                ),
              ]
                .filter((n) => !n.closest(".excalidraw") && !named(n))
                .map((n) => n.id || n.outerHTML.slice(0, 100)),
              unnamedButtons: [
                ...document.querySelectorAll("[data-tool] button"),
              ]
                .filter(
                  (n) =>
                    visible(n) &&
                    !n.disabled &&
                    !n.textContent.trim() &&
                    !named(n) &&
                    !n.closest(".excalidraw"),
                )
                .map((n) => n.id || n.outerHTML.slice(0, 100)),
              captures: window.__captureRequests,
              smallTargets: [...document.querySelectorAll("[data-tool] button")]
                .filter(
                  (n) =>
                    visible(n) &&
                    !n.closest(".excalidraw") &&
                    !n.closest(
                      "details:not([open]),[hidden],dialog:not([open])",
                    ) &&
                    !n.disabled &&
                    (n.getBoundingClientRect().height < 43 ||
                      n.getBoundingClientRect().width < 43),
                )
                .map((n) => n.id || n.textContent.trim().slice(0, 40)),
            };
          });
          item.accessibility = a11y;
          assert.deepEqual(
            a11y.unnamedInputs,
            [],
            "Inputs need accessible names",
          );
          assert.deepEqual(
            a11y.unnamedButtons,
            [],
            "Buttons need accessible names",
          );
          assert.deepEqual(
            a11y.smallTargets,
            [],
            "Touch buttons need a 44px target",
          );
          assert.equal(
            a11y.captures,
            0,
            "Page loading must not request capture",
          );
          assert.deepEqual(errors, [], "No uncaught exceptions");
          assert.deepEqual(network, [], "No automatic measurements or uploads");
        } catch (e) {
          item.status = "fail";
          item.error = e.message;
          item.startup = await page
            .locator("[data-tool]")
            .evaluate((n) => ({
              ready: n.dataset.ready,
              uiReady: n.dataset.uiReady,
              loadError: n.dataset.loadError,
            }))
            .catch(() => null);
          failed.push(item);
          await page
            .screenshot({
              path: path.join(output, `${name}-${item.locale}-${slug}.png`),
              fullPage: false,
            })
            .catch(() => {});
        }
        cases.push(item);
        console.log(
          `${item.status.toUpperCase()} ${name} ${item.locale} ${slug}${item.error ? ": " + item.error.split("\n")[0] : ""}`,
        );
        fs.writeFileSync(
          path.join(output, "browser-audit.json"),
          JSON.stringify({ cases, failed }, null, 2),
        );
      }
    await context.close();
    await browser.close();
  }
  fs.writeFileSync(
    path.join(output, "browser-audit.json"),
    JSON.stringify({ cases, failed }, null, 2),
  );
  assert.equal(
    failed.length,
    0,
    `${failed.length} failed/blocked audit cases. See browser-audit.json.`,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
