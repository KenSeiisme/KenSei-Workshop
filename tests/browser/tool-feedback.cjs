const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8801";
(async () => {
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    context = await browser.newContext({ reducedMotion: "reduce" }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.KENSEI_CONFIG={}",
    }),
  );
  async function open(tool) {
    await page.goto(base + "/tools/" + tool + "/");
    await page.waitForSelector('[data-ui-ready="true"]');
  }
  try {
    await open("text-toolkit");
    await page.fill("#text-input", "Keep my original text");
    await page.waitForFunction(
      () =>
        document.querySelector("#draft-state").dataset.saveKind ===
        "Unsaved changes",
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await page
      .getByRole("button", { name: "Try an example", exact: true })
      .click();
    assert.equal(await page.inputValue("#text-input"), "Keep my original text");
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Try an example", exact: true })
      .click();
    assert.match(await page.inputValue("#text-input"), /clarity/);
    console.log(
      "PASS examples need replacement confirmation and unsaved text never claims Saved locally",
    );
    page.on("dialog", (dialog) => dialog.accept());
    await open("calculator-studio");
    let workers = 0;
    page.on("worker", () => workers++);
    await page.fill("#calc-expression", "sqrt(144)");
    await page.locator("#calc-expression").evaluate((node) =>
      node.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(workers, 0);
    await page.locator("#calc-expression").press("Control+Enter");
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector("#calc-result").value.replace(/^≈\s*/, ""),
        ) === 12,
    );
    assert.equal(await page.locator("#calc-history button").count(), 1);
    await page.fill("#calc-expression", "sqrt(");
    assert(await page.locator("#calc-copy").isDisabled());
    await page.click("#calc-run");
    await page.waitForSelector("#tool-field-error");
    assert.equal(
      await page.locator("#calc-expression").getAttribute("aria-invalid"),
      "true",
    );
    console.log(
      "PASS Chinese composition cannot start calculation; shortcut runs once; stale copy and inline errors are clear",
    );
    await open("qr-studio");
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let requested = false;
    await context.route("**/vendor/qr-code-styling.js", async (route) => {
      requested = true;
      await gate;
      await route.continue();
    });
    await page.fill("#qr-content", "https://example.com/first");
    await page.click("#qr-generate");
    await page.waitForFunction(
      () => document.querySelector("#qr-generate").disabled,
    );
    await page.fill("#qr-content", "https://example.com/second");
    release();
    await page.waitForFunction(
      () => !document.querySelector("#qr-generate").disabled,
    );
    assert(requested);
    assert(await page.locator("#qr-png").isDisabled());
    await page.click("#qr-generate");
    await page.waitForSelector("#qr-preview svg");
    assert(await page.locator("#qr-png").isEnabled());
    await page.fill("#qr-content", "https://example.com/third");
    assert(await page.locator("#qr-png").isDisabled());
    console.log(
      "PASS changing QR inputs during a library load cannot publish or download a stale code",
    );
    await open("file-check");
    await page.setInputFiles("#check-files", {
      name: "hello.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await page.click("#check-run");
    await page.waitForFunction(
      () => !document.querySelector("#check-download").disabled,
    );
    await page.selectOption("#check-algorithm", "SHA-512");
    assert(await page.locator("#check-download").isDisabled());
    await open("password-generator");
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(Error("Denied")) },
      }),
    );
    await page.click("#password-copy");
    assert.equal(
      await page.locator("#password-output").getAttribute("type"),
      "password",
    );
    assert.match(await page.locator(".toast").textContent(), /Show password/);
    assert.deepEqual(errors, []);
    console.log(
      "PASS changed checksum algorithm invalidates the manifest; no browser exceptions",
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
