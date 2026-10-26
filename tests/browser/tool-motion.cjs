const { chromium } = require("../support/browser.cjs");
const assert = require("node:assert/strict");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const c = await browser.newContext({ reducedMotion: "reduce" });
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  const p = await c.newPage();
  await p.clock.install();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto(base + "/tools/focus-timer/");
    await p.waitForSelector('[data-ui-ready="true"]');
    await p.locator(".timer-settings").evaluate((n) => (n.open = true));
    await p.locator("#duration-focus").fill("1");
    await p.locator("#timer-save-settings").click();
    await p.waitForFunction(
      () => document.querySelector("#timer-display").textContent === "01:00",
    );
    await p.locator("#timer-start").click();
    await p.clock.fastForward(30000);
    let ratio = Number(
      await p.locator(".timer-ring").getAttribute("data-progress"),
    );
    assert(
      Math.abs(ratio - 0.5) < 0.015,
      JSON.stringify({
        ratio,
        time: await p.locator("#timer-display").textContent(),
        button: await p.locator("#timer-start").textContent(),
      }),
    );
    await p.locator("#timer-start").click();
    const paused = await p.locator(".timer-ring").getAttribute("data-progress");
    await p.clock.fastForward(10000);
    assert.equal(
      await p.locator(".timer-ring").getAttribute("data-progress"),
      paused,
    );
    await p.reload();
    await p.waitForSelector('[data-ui-ready="true"]');
    assert(
      Math.abs(
        Number(await p.locator(".timer-ring").getAttribute("data-progress")) -
          0.5,
      ) < 0.015,
    );
    await p.locator("#timer-start").click();
    await p.clock.fastForward(31000);
    await p.waitForFunction(() =>
      document.querySelector("#timer-summary").textContent.includes("saved"),
    );
    assert.equal(
      await p.locator('[data-mode="short"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await p.locator(".timer-ring").getAttribute("data-progress"),
      "1.000000",
    );
    console.log(
      "PASS countdown ring: half, exact pause, refresh, resume, completion and next phase",
    );
    await p.clock.resume();
    await p.goto(base + "/tools/answer-book/");
    await p.waitForSelector('[data-ui-ready="true"]');
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await p.locator("#answer-question").fill("DO_NOT_STORE_THIS");
    await p.locator("#answer-draw").evaluate((n) => {
      n.click();
      n.click();
    });
    assert(await p.locator("#answer-draw").isDisabled());
    await p.waitForFunction(
      () => !document.querySelector("#answer-draw").disabled,
    );
    const records = await p.evaluate(async () => {
      const s = await import("/tool-scripts/personal-store.js");
      return s.records("answer");
    });
    assert.equal(records.length, 1);
    assert(!JSON.stringify(records).includes("DO_NOT_STORE_THIS"));
    await p.locator("#answer-language").selectOption("en");
    assert.equal(
      (
        await p.evaluate(async () =>
          (await import("/tool-scripts/personal-store.js")).records("answer"),
        )
      ).length,
      1,
    );
    console.log(
      "PASS answer turn: one reveal/save, double-click guard, output-language switch and no saved question",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
