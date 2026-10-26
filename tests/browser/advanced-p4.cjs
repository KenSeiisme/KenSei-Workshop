const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { unzipSync } = require("fflate"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext({ reducedMotion: "reduce" }),
    p = await c.newPage(),
    errors = [],
    uploads = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  c.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
  });
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  async function open(slug) {
    console.log("CHECK", slug);
    await p.goto(base + "/tools/" + slug + "/");
    try {
      await p.waitForSelector("[data-ready=true]");
    } catch (e) {
      console.log(errors, await p.locator("body").innerText());
      throw e;
    }
  }
  async function dl(action) {
    const wait = p.waitForEvent("download");
    await action();
    return fs.readFileSync(await (await wait).path());
  }
  try {
    await open("qr-studio");
    await p.getByLabel("Contact name", { exact: true }).fill("小明; Chan");
    await p
      .getByLabel("Email address", { exact: true })
      .fill("ken@example.com");
    await p
      .getByRole("button", { name: "Use content in generator", exact: true })
      .click();
    assert((await p.inputValue("#qr-content")).includes("FN:小明\\; Chan"));
    await p
      .getByPlaceholder("One text or URL per line; up to 50")
      .fill("Hello QR\nhttps://example.com\n測試二維碼");
    await p
      .getByRole("button", { name: "Generate batch preview", exact: true })
      .click();
    await p.waitForFunction(
      () => document.querySelector(".qr-batch-previews").children.length === 3,
    );
    const zip = await dl(() =>
        p.getByRole("button", { name: "Download QR ZIP", exact: true }).click(),
      ),
      files = unzipSync(zip);
    assert.equal(Object.keys(files).length, 3);
    const decoded = await p.evaluate(async (png) => {
      const { library } = await import("/tool-scripts/common.js"),
        jsQR = await library("jsqr.js", "jsQR");
      const image = new Image();
      image.src = "data:image/png;base64," + png;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const x = canvas.getContext("2d");
      x.drawImage(image, 0, 0);
      return jsQR(
        x.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
      )?.data;
    }, Buffer.from(files["qr-03.png"]).toString("base64"));
    assert.equal(decoded, "測試二維碼");
    console.log("PASS contact escaping, batch QR ZIP and actual PNG scanning");
    await open("password-generator");
    await p.getByLabel("Generator mode").selectOption("words");
    await p.click("#password-generate");
    await p.waitForFunction(
      () => document.querySelector("#password-output").value.length > 20,
    );
    assert(
      await p.evaluate(() => {
        const secret = document.querySelector("#password-output").value;
        return [
          ...Object.keys(localStorage),
          ...Object.keys(sessionStorage),
        ].every(
          (k) =>
            !(
              localStorage.getItem(k) ||
              sessionStorage.getItem(k) ||
              ""
            ).includes(secret),
        );
      }),
    );
    console.log("PASS six-word mode and no passphrase persistence");
    await open("calculator-studio");
    await p
      .getByLabel("Expressions and page-only variables")
      .fill("price = 12.50\nquantity = 3\nprice * quantity\n1/0");
    await p
      .getByRole("button", { name: "Calculate lines", exact: true })
      .click();
    await p.waitForFunction(() =>
      [...document.querySelectorAll(".advanced-panel td")].some(
        (n) => n.textContent === "37.5",
      ),
    );
    assert(
      (await p.locator(".advanced-panel").innerText()).includes(
        "Cannot divide by zero",
      ),
    );
    console.log("PASS calculation sheet variables and row errors");
    await open("decision-studio");
    await p.fill("#decision-name", "Weighted browser");
    await p.fill("#decision-options", "A\nB");
    await p.locator(".advanced-panel input[type=number]").nth(1).fill("100");
    await p.waitForTimeout(700);
    assert.deepEqual(
      await p.evaluate(() =>
        window.KenseiAdvancedContexts["decision-studio"].weights(),
      ),
      [1, 100],
    );
    await p.reload();
    await p.waitForSelector("[data-ready=true]");
    assert.deepEqual(
      await p.evaluate(() =>
        window.KenseiAdvancedContexts["decision-studio"].weights(),
      ),
      [1, 100],
    );
    await p.click("#decision-run");
    await p.waitForFunction(() =>
      ["A", "B"].includes(
        document.querySelector("#decision-result").textContent,
      ),
    );
    const choices = await dl(() =>
      p.getByRole("button", { name: "Export choice CSV", exact: true }).click(),
    );
    assert(choices.toString().includes("100"));
    console.log("PASS weighted scheme save, reopen, wheel and CSV");
    await open("answer-book");
    await p.click("#answer-draw");
    await p.waitForFunction(() => window.KenseiCurrentAnswerId);
    await p
      .getByRole("button", { name: "Favorite current answer", exact: true })
      .click();
    await p.getByLabel("Favorites only").check();
    assert.equal(
      await p
        .locator("#answer-history [data-history-list] [data-favorite]")
        .count(),
      1,
    );
    const txt = await dl(() =>
      p
        .getByRole("button", { name: "Export filtered TXT", exact: true })
        .click(),
    );
    assert(txt.length > 20);
    console.log("PASS answer favorites, loaded-history filtering and TXT");
    await open("unit-converter");
    await p.fill("#unit-value", "100");
    await p.getByLabel("Significant digits").fill("4");
    await p
      .getByRole("button", {
        name: "Save combination on this device",
        exact: true,
      })
      .click();
    assert.equal(
      await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem("kensei-unit-favorites-v1")).length,
      ),
      1,
    );
    assert(await p.locator(".advanced-panel").getByText(/100/).count());
    console.log("PASS multi-target conversion and local combination");
    await open("color-studio");
    const png = Buffer.from(
      await p.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = c.height = 30;
        c.getContext("2d").fillStyle = "#ff0000";
        c.getContext("2d").fillRect(0, 0, 30, 30);
        return c.toDataURL().split(",")[1];
      }),
      "base64",
    );
    await p
      .getByLabel("Local image", { exact: true })
      .setInputFiles({ name: "red.png", mimeType: "image/png", buffer: png });
    await p.waitForFunction(
      () =>
        document.querySelector("#palette input[type=color]").value ===
        "#ff0000",
    );
    const palette = JSON.parse(
      (
        await dl(() =>
          p
            .getByRole("button", { name: "Export palette JSON", exact: true })
            .click(),
        )
      ).toString(),
    );
    assert.equal(palette.colors[0], "#ff0000");
    console.log("PASS local image palette and JSON export");
    await open("device-check");
    await p.click("#tab-keyboard");
    await p.click("#keyboard-start");
    await p.keyboard.down("a");
    assert.equal(await p.locator(".key-matrix .pressed").count(), 1);
    await p.keyboard.up("a");
    await p.click("#keyboard-stop");
    assert.equal(await p.locator(".key-matrix .received").count(), 0);
    await p.getByRole("tab", { name: "Touch", exact: true }).click();
    await p
      .getByRole("button", { name: "Start touch test", exact: true })
      .click();
    await p.locator(".touch-test-surface").scrollIntoViewIfNeeded();
    const box = await p.locator(".touch-test-surface").boundingBox(),
      cdp = await c.newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: Math.round(box.x + 40), y: Math.round(box.y + 60), id: 1 },
        { x: Math.round(box.x + 140), y: Math.round(box.y + 120), id: 2 },
      ],
    });
    assert.equal(await p.locator(".touch-point").count(), 2);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await p
      .getByRole("button", { name: "Stop touch test", exact: true })
      .click();
    assert.equal(await p.locator(".touch-point").count(), 0);
    console.log("PASS keyboard matrix and touch test cleanup");
    for (const slug of [
      "qr-studio",
      "color-studio",
      "unit-converter",
      "password-generator",
      "calculator-studio",
      "decision-studio",
      "answer-book",
      "network-test",
      "device-check",
    ]) {
      await open(slug);
      for (const width of [320, 360, 768, 1440]) {
        await p.setViewportSize({ width, height: 900 });
        await p.waitForTimeout(40);
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " overflow " + width,
        );
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    console.log("PASS nine pages, four widths and no uploads");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
