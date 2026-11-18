const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 830 },
      timezoneId: "America/Los_Angeles",
    });
    await context.route("**/config.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "window.KENSEI_CONFIG={};",
      }),
    );
    const errors = [];
    context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    const page = await context.newPage();
    const date = new Date("2026-11-16T07:00:00Z");
    await page.clock.setFixedTime(date);
    await page.goto(base + "/tools/flashcards/");
    await page.waitForSelector('[data-ready="true"]');
    const deckId = await page.evaluate(async () => {
      const store = await import("/tool-scripts/flashcard-store.js");
      return (
        await store.put({
          name: "Revision deck",
          cards: [
            {
              id: crypto.randomUUID(),
              front: "Question",
              back: "Answer",
              known: false,
            },
          ],
        })
      ).id;
    });

    await page.goto(base + "/tools/study-planner/");
    const id = "76b0bca1-b09b-4a04-9f21-130ad1120101";
    const exam = "76b0bca1-b09b-4a04-9f21-130ad1120102";
    await page.waitForSelector('[data-ready="true"]');
    await page.setInputFiles("#planner-import", {
      name: "plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          id,
          name: "Revision plan",
          timeZone: "Asia/Kuala_Lumpur",
          courses: [],
          tasks: [
            {
              id: exam,
              title: "Programming exam",
              courseId: null,
              type: "exam",
              due: "2026-11-23T09:00",
              done: false,
            },
          ],
        }),
      ),
    });
    await page.locator("#planner-name").waitFor();
    await page.getByLabel("Exam to prepare for").selectOption(exam);
    await page
      .getByLabel("Review topics, one per line")
      .fill("Loops\nFunctions\nArrays");
    await page
      .getByRole("button", { name: "Preview schedule", exact: true })
      .click();
    await page
      .getByText("3 scheduled · 0 unscheduled · Asia/Kuala_Lumpur", {
        exact: true,
      })
      .waitFor();
    const preview = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Schedule revision",
          exact: true,
        }),
      })
      .last();
    assert.deepEqual(
      await preview
        .locator('input[type="datetime-local"]')
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["2026-11-16T18:00", "2026-11-18T18:00", "2026-11-20T18:00"],
    );
    const confirm = page.getByRole("button", {
      name: "Add review sessions",
      exact: true,
    });
    await confirm.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.getByText("3 review sessions added.", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.KenseiAdvancedContexts["study-planner"].plan.data.tasks.length,
      ),
      4,
    );
    const focusUrl = await page
      .getByRole("link", { name: "Open Focus Timer", exact: true })
      .getAttribute("href");
    const reviewUrl = await page
      .getByRole("link", { name: "Open review queue", exact: true })
      .getAttribute("href");
    assert.ok(reviewUrl.includes(deckId));
    await page.goto(base + focusUrl);
    await page.waitForFunction(() => window.KenseiFocusTag?.title === "Loops");
    assert.match(await page.locator("#timer-start").innerText(), /Start focus/);
    await page.goto(base + reviewUrl);
    await page.waitForSelector("#study-start", { state: "visible" });
    assert.equal(await page.locator("#study-unknown").isChecked(), true);
    assert.equal(await page.locator("#study-card").isDisabled(), true);
    await page.click("#study-start");
    await page.locator("#study-card").filter({ hasText: "Question" }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS plan-zone scheduling, three idempotently saved tasks, preselected timer and due cards without auto-start",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
