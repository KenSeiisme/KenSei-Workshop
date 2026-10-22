const assert = require("node:assert/strict"),
  fs = require("node:fs");
const {
  chromium,
} = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8795";
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true }),
    c = await browser.newContext(),
    p = await c.newPage(),
    checks = [],
    requests = [];
  const pass = (x) => {
    checks.push(x);
    console.log("PASS " + x);
  };
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  const fake =
    "export default class Engine{constructor(config){window.testConfig=config;}play(){}pause(){window.testPaused=true;}}";
  await c.route("**/vendor/speedtest.js", (r) =>
    r.fulfill({ contentType: "text/javascript", body: fake }),
  );
  await c.route("https://speed.cloudflare.com/**", (r) => {
    if (new URL(r.request().url()).pathname !== "/meta")
      requests.push(r.request().url());
    return r.fulfill({
      body: "",
      headers: {
        "access-control-allow-origin": "*",
        "timing-allow-origin": "*",
      },
    });
  });
  async function open() {
    await p.goto(base + "/tools/network-test/");
    await p.waitForSelector('[data-ready="true"]');
  }
  try {
    await open();
    await p.click("#network-start");
    let frame;
    await p.waitForSelector("iframe", { state: "attached" });
    frame = await (await p.locator("iframe").elementHandle()).contentFrame();
    await frame.waitForURL(/network-runner/);
    await frame.waitForFunction(() => window.testConfig);
    const config = await frame.evaluate(() => ({
      auto: window.testConfig.autoStart,
      measurement: window.testConfig.logMeasurementApiUrl,
      results: window.testConfig.logAimApiUrl,
    }));
    assert.deepEqual(config, { auto: false, measurement: null, results: null });
    const blocked = await frame.evaluate(async () => {
      const urls = [
        "https://speed.cloudflare.com/__results",
        "https://example.com/__down?bytes=0",
        "https://speed.cloudflare.com/__down?bytes=50000001",
      ];
      return Promise.all(
        urls.map(async (url) => {
          try {
            await fetch(url);
            return false;
          } catch {
            return true;
          }
        }),
      );
    });
    assert.deepEqual(blocked, [true, true, true]);
    assert.equal(requests.length, 0);
    const result = await frame.evaluate(async () => {
      let sent = 0,
        blocked = false;
      for (let i = 0; i < 11; i++) {
        try {
          await fetch(
            "https://speed.cloudflare.com/__down?bytes=50000000&attempt=" + i,
          );
          sent++;
        } catch {
          blocked = true;
          break;
        }
      }
      return { sent, blocked };
    });
    assert.deepEqual(result, { sent: 10, blocked: true });
    assert.equal(requests.length, 10);
    await p.waitForFunction(() =>
      document.querySelector("#network-status").textContent.includes("budget"),
    );
    assert.equal(await p.locator("#network-history .saved-row").count(), 0);
    pass(
      "runner independently blocks reports, foreign destinations, oversized requests and attempts beyond 500 MB",
    );
    await open();
    await p.clock.install();
    await p.click("#network-start");
    await p.clock.fastForward(120001);
    assert.match(await p.textContent("#network-status"), /120 seconds/);
    assert.equal(await p.locator("#network-history .saved-row").count(), 0);
    pass(
      "120-second timeout stops test and keeps incomplete result out of history",
    );
    const rateContext = await browser.newContext(),
      ratePage = await rateContext.newPage();
    const rateDebug = [];
    ratePage.on("console", (m) => rateDebug.push(m.text()));
    ratePage.on("pageerror", (e) => rateDebug.push(e.message));
    await rateContext.route("**/config.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: "window.KENSEI_CONFIG={};",
      }),
    );
    await rateContext.route("https://speed.cloudflare.com/**", (r) =>
      r.fulfill({
        status: 429,
        body: "Rate limited",
        headers: {
          "access-control-allow-origin": "*",
          "retry-after": "0",
          "access-control-expose-headers": "retry-after",
        },
      }),
    );
    await ratePage.goto(base + "/tools/network-test/");
    await ratePage.waitForSelector('[data-ready="true"]');
    await ratePage.click("#network-start");
    try {
      await ratePage.waitForFunction(
        () =>
          document
            .querySelector("#network-status")
            .textContent.includes("rate limiting"),
        null,
        { timeout: 20000 },
      );
    } catch (e) {
      console.log(
        "Rate test status:",
        await ratePage.textContent("#network-status"),
        rateDebug,
      );
      throw e;
    }
    assert.equal(
      await ratePage.locator("#network-history .saved-row").count(),
      0,
    );
    pass(
      "actual pinned engine handles HTTP 429 without saving a failed result",
    );
    fs.writeFileSync(
      "_qa/network-guards.json",
      JSON.stringify({ base, checks }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
