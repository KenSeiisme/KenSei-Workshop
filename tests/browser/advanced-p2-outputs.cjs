const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { chromium } = require("../support/browser.cjs");
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    p = await b.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
  try {
    await p.goto(base + "/tools/whiteboard/");
    await p.waitForSelector("[data-ready=true]");
    await p.click("#board-new");
    await p.waitForFunction(
      () =>
        window.KenseiAdvancedContexts?.whiteboard?.drawing &&
        !document.querySelector("#board-name").disabled,
    );
    await p
      .getByRole("button", { name: "Insert template", exact: true })
      .click();
    await p.waitForFunction(
      () =>
        window.KenseiAdvancedContexts.whiteboard.drawing.getSceneElements()
          .length >= 8,
    );
    await p.getByRole("button", { name: "Prepare PNG", exact: true }).click();
    const wait = p.waitForEvent("download");
    await p
      .getByRole("button", { name: "Download PNG", exact: true })
      .last()
      .click();
    const d = await wait,
      bytes = fs.readFileSync(await d.path());
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    fs.writeFileSync("_qa/p2-whiteboard.png", bytes);
    console.log("PASS template vectors and actual PNG export");
    await p.goto(base + "/tools/time-studio/");
    await p.waitForSelector("[data-ready=true]");
    const calendar = p.waitForEvent("download");
    await p
      .getByRole("button", { name: "Export event (.ics)", exact: true })
      .click();
    assert(
      fs
        .readFileSync(await (await calendar).path(), "utf8")
        .includes("BEGIN:VEVENT"),
    );
    console.log("PASS meeting calendar download");
    await p.goto(base + "/tools/focus-timer/");
    await p.waitForSelector("[data-ready=true]");
    await p.addInitScript(() => {
      if (sessionStorage.getItem("qa-focus-seeded")) return;
      sessionStorage.setItem("qa-focus-seeded", "1");
      sessionStorage.setItem(
        "kensei-workshop:v1:guest:active-timer",
        JSON.stringify({
          settings: { focus: 1, short: 5, long: 15 },
          mode: "focus",
          running: true,
          remaining: 1,
          end: Date.now() + 500,
          round: 0,
          completedId: "qa-focus-one",
          remainingMs: 500,
        }),
      );
    });
    await p.reload();
    await p.waitForSelector("[data-ready=true]");
    await p.waitForFunction(() =>
      window.KenseiWorkspace.items("session").some(
        (x) => x.id === "qa-focus-one",
      ),
    );
    await p.reload();
    await p.waitForSelector("[data-ready=true]");
    assert.equal(
      await p.evaluate(
        () =>
          window.KenseiWorkspace.items("session").filter(
            (x) => x.id === "qa-focus-one",
          ).length,
      ),
      1,
    );
    console.log("PASS restored timer completion saved once");
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
