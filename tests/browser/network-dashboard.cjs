const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8796",
  IP = "198.51.100.42",
  checks = [];
const pass = (x) => {
  checks.push(x);
  console.log("PASS " + x);
};
const legacy = {
  id: "legacy",
  date: "2026-10-01T00:00:00Z",
  metrics: {
    download: 50,
    upload: 10,
    latency: 20,
    jitter: 3,
    downloadLatency: 50,
    uploadLatency: 40,
  },
  used: 1000000,
};
(async () => {
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    c = await browser.newContext({ reducedMotion: "reduce" }),
    p = await c.newPage(),
    errors = [],
    requests = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await c.addInitScript((row) => {
    if (!localStorage.getItem("kensei-network-history-v1"))
      localStorage.setItem("kensei-network-history-v1", JSON.stringify([row]));
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      (window.__paintedText ||= []).push(String(text));
      return original.call(this, text, ...args);
    };
  }, legacy);
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  await c.route("https://speed.cloudflare.com/**", async (r) => {
    const u = new URL(r.request().url());
    requests.push(u.pathname);
    if (u.pathname === "/meta")
      return r.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          clientIp: IP,
          asOrganization: "Example Network",
          asn: 64500,
          country: "MY",
          city: "Approximate city",
          httpProtocol: "HTTP/2",
          colo: { iata: "TEST", city: "Test edge" },
        }),
        headers: { "access-control-allow-origin": "*" },
      });
    const bytes = Number(u.searchParams.get("bytes"));
    await new Promise((resolve) => setTimeout(resolve, bytes ? 1100 : 20));
    try {
      await r.fulfill({
        body: Buffer.alloc(u.pathname === "/__down" ? bytes : 0, 65),
        headers: {
          "access-control-allow-origin": "*",
          "timing-allow-origin": "*",
          "content-type": "text/plain",
          "server-timing": "cf;dur=0",
        },
      });
    } catch {}
  });
  async function download(id) {
    const pending = p.waitForEvent("download");
    await p.click(id);
    const d = await pending;
    return fs.readFileSync(await d.path());
  }
  try {
    await p.goto(base + "/tools/network-test/");
    await p.waitForSelector('[data-ready="true"]');
    assert.equal(requests.length, 0);
    await require("../support/tool-controls.cjs").expand(
      p,
      "Completed tests & comparison",
    );
    await p.getByRole("button", { name: "View", exact: true }).click();
    assert.match(
      await p.textContent("#network-samples"),
      /Legacy summary only/,
    );
    await p.getByPlaceholder("For example: Home Wi-Fi").fill("Lab Wi-Fi");
    await p.click("#network-start");
    await p.waitForFunction(
      () =>
        document
          .querySelector("#network-status")
          .textContent.includes("complete"),
      null,
      { timeout: 45000 },
    );
    assert.equal(requests.filter((x) => x === "/meta").length, 1);
    assert.ok(requests.every((x) => ["/meta", "/__down", "/__up"].includes(x)));
    assert.match(await p.textContent(".network-top"), /Example Network/);
    assert.ok(!(await p.textContent(".network-top")).includes(IP));
    await p.click("#network-ip");
    assert.ok((await p.textContent(".network-top")).includes(IP));
    await p.click("#network-ip");
    assert.ok(!(await p.textContent(".network-top")).includes(IP));
    const stored = await p.evaluate(() =>
        JSON.parse(localStorage.getItem("kensei-network-history-v1")),
      ),
      row = stored.find((x) => x.version === 2);
    assert.ok(row);
    assert.equal(row.label, "Lab Wi-Fi");
    await p.getByLabel("Tests to overlay").selectOption([row.id, "legacy"]);
    assert.equal(row.stats.idle.count, 20);
    assert.ok(
      row.samples.download.length >= 1 && row.samples.upload.length >= 1,
    );
    assert.ok(
      row.stats.download.min <= row.stats.download.median &&
        row.stats.download.median <= row.stats.download.p90 &&
        row.stats.download.p90 <= row.stats.download.max,
    );
    assert.ok(!JSON.stringify(stored).includes(IP));
    await p.waitForSelector("#network-speed-chart .uplot");
    await p.waitForSelector("#network-latency-chart .uplot");
    const mbps = Number(
      await p
        .locator("#network-metrics .metric-card strong")
        .first()
        .textContent(),
    );
    await p.selectOption("#network-unit", "mbytes");
    const mbytes = Number(
      await p
        .locator("#network-metrics .metric-card strong")
        .first()
        .textContent(),
    );
    assert.ok(Math.abs(mbytes - mbps / 8) < 0.02);
    pass(
      "real pinned engine produces valid sample curves, latency distributions, P90/peak separation and Mbps/MB/s conversion",
    );
    assert.equal(await p.locator("#gauge-ticks line").count(), 26);
    assert.equal(await p.locator("#gauge-ticks text").count(), 6);
    const maximum = Number(
      await p.locator(".speed-gauge").getAttribute("data-maximum"),
    );
    const progress = Number(
      (await p.locator("#gauge-arc").getAttribute("stroke-dasharray")).split(
        " ",
      )[0],
    );
    assert(Math.abs(progress - (mbps / maximum) * 100) < 0.02);
    assert((await p.locator("#gauge-range").textContent()).includes("MB/s"));
    await p
      .locator("#network-ip-value")
      .evaluate(
        (n) => (n.textContent = "2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
      );
    for (const width of [320, 360, 768, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      await p.waitForTimeout(250);
      const rects = await p.locator(".network-ip-row").evaluate((n) =>
        [...n.children].map((x) => {
          const r = x.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width };
        }),
      );
      assert(rects[1].x < rects[2].x && rects[2].x < rects[3].x);
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        JSON.stringify(
          await p.evaluate(() => ({
            width: innerWidth,
            wide: [...document.querySelectorAll("body *")]
              .filter((n) => n.getBoundingClientRect().right > innerWidth + 1)
              .map((n) => n.tagName + "." + n.className)
              .slice(0, 12),
          })),
        ),
      );
    }
    pass(
      "numeric gauge intervals, exact arc ratio, unit conversion and inline long IPv6 fit 320–1440px",
    );
    const json = JSON.parse((await download("#network-json")).toString());
    assert.equal(json.version, 2);
    assert.ok(json.samples.download.length);
    assert.ok(!JSON.stringify(json).includes(IP));
    const csv = (await download("#network-csv")).toString();
    assert.match(csv, /speed_mbps,latency_ms/);
    assert.ok(!csv.includes(IP));
    const png = await download("#network-png");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 760);
    assert.ok(
      !(await p.evaluate(() => window.__paintedText)).some((text) =>
        text.includes(IP),
      ),
    );
    await p.click("#network-copy");
    assert.ok(!(await p.inputValue("#network-result")).includes(IP));
    await require("../support/tool-controls.cjs").expand(
      p,
      "Completed tests & comparison",
    );
    await p.click("#network-compare");
    assert.match(await p.textContent("#network-comparison"), /Second − first/);
    for (const width of [360, 768, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      await p.waitForTimeout(250);
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "dashboard overflow " + width,
      );
      await p.evaluate(() => {
        document.activeElement?.blur();
        scrollTo(0, 0);
      });
      await p.screenshot({
        path: "_qa/network-v2-" + width + ".png",
        fullPage: true,
      });
    }
    pass(
      "metadata masks IP; history, PNG, CSV, JSON and copied reports exclude it; legacy records and comparisons work",
    );
    await p.reload();
    await p.waitForSelector('[data-ready="true"]');
    assert.equal(await p.locator("#network-history .saved-row").count(), 2);
    const noCanvas = await browser.newContext(),
      q = await noCanvas.newPage();
    await noCanvas.route("**/config.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: "window.KENSEI_CONFIG={};",
      }),
    );
    await noCanvas.addInitScript((row) => {
      localStorage.setItem("kensei-network-history-v1", JSON.stringify([row]));
      HTMLCanvasElement.prototype.getContext = () => null;
    }, row);
    const fallbackErrors = [];
    q.on("pageerror", (e) => fallbackErrors.push(e.message));
    await q.goto(base + "/tools/network-test/");
    await q.waitForSelector('[data-ready="true"]');
    await require("../support/tool-controls.cjs").expand(
      q,
      "Completed tests & comparison",
    );
    await q.getByRole("button", { name: "View", exact: true }).click();
    await q.waitForTimeout(500);
    assert.match(await q.textContent("#network-speed-chart"), /unavailable/i);
    assert.ok((await q.locator("#network-samples tr").count()) > 1);
    await q.click("#network-png");
    assert.match(
      await q.textContent("#network-status"),
      /PNG export is unavailable/,
    );
    assert.deepEqual(fallbackErrors, []);
    await noCanvas.close();
    pass(
      "canvas restrictions preserve accessible statistics, samples and non-image reports without uncaught errors",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/network-dashboard-results.json",
      JSON.stringify(
        {
          base,
          checks,
          errors,
          requests,
          boundary: "Actual pinned engine with controlled HTTP measurements",
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
