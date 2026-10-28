// Explicit opt-in: one real Full Test can transfer up to 500 MB plus overhead.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { chromium } = require("../tests/support/browser.cjs");
if (process.env.RUN_REAL_NETWORK_TEST !== "1")
  throw Error(
    "Set RUN_REAL_NETWORK_TEST=1 to allow one real test (up to 500 MB plus overhead).",
  );
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true }),
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage(),
    requests = [],
    errors = [];
  const result = {
    checkedAt: new Date().toISOString(),
    status: "pending",
    actualNetwork: true,
    attempts: 0,
  };
  await context.route("**/config.js", (r) =>
    r.fulfill({
      body: "window.KENSEI_CONFIG={};",
      contentType: "application/javascript",
    }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (r) => {
    const url = new URL(r.url());
    if (url.hostname === "speed.cloudflare.com")
      requests.push({
        path: url.pathname,
        method: r.method(),
        bytes: Number(url.searchParams.get("bytes")) || 0,
      });
  });
  try {
    await page.goto(
      (process.env.TEST_BASE_URL || "http://127.0.0.1:8769") +
        "/tools/network-test/",
    );
    await page.waitForSelector('[data-ready="true"]');
    assert.equal(
      requests.length,
      0,
      "Loading the page must not start Cloudflare traffic",
    );
    result.attempts = 1;
    await page.click("#network-start");
    await page.waitForFunction(
      () => !document.querySelector("#network-start").disabled,
      null,
      { timeout: 135000 },
    );
    result.message = await page.locator("#network-status").innerText();
    result.payloadScheduled = requests.reduce((sum, r) => sum + r.bytes, 0);
    result.paths = [...new Set(requests.map((r) => r.path))];
    assert(
      result.payloadScheduled <= 500000000,
      "Actual requests exceed payload budget",
    );
    assert(
      result.paths.every((p) => ["/meta", "/__up", "/__down"].includes(p)),
      "Unexpected result reporting endpoint",
    );
    result.status = result.message.startsWith("Full Test complete")
      ? "pass"
      : "blocked";
    result.completedHistory = await page.evaluate(() => {
      const history = JSON.parse(
        localStorage.getItem("kensei-network-history-v1") || "[]",
      );
      const privateFields = (value) =>
        value &&
        typeof value === "object" &&
        Object.entries(value).some(([k, v]) => k === "ip" || privateFields(v));
      if (privateFields(history)) throw Error("Full IP was persisted");
      return history.length;
    });
    assert.equal(result.completedHistory, result.status === "pass" ? 1 : 0);
    assert.deepEqual(errors, []);
    console.log(
      result.status.toUpperCase(),
      result.message,
      `${(result.payloadScheduled / 1e6).toFixed(1)} MB scheduled; no extra reporting`,
    );
  } finally {
    fs.mkdirSync("_qa", { recursive: true });
    fs.writeFileSync(
      "_qa/network-actual-acceptance.json",
      JSON.stringify(result, null, 2),
    );
    await context.close();
    await browser.close();
  }
  if (result.status !== "pass") process.exitCode = 2;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
