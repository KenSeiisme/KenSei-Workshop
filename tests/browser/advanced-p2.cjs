const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext({ reducedMotion: "reduce" }),
    p = await c.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
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
      await p.waitForSelector('[data-ready="true"]');
    } catch (e) {
      console.log(
        "PAGE ERRORS",
        errors,
        "BODY",
        await p.locator("body").innerText(),
      );
      throw e;
    }
  }
  try {
    await open("text-toolkit");
    await p.fill("#text-input", "b\na\nb");
    await p
      .getByRole("button", { name: "Preview changes", exact: true })
      .click();
    await p.getByRole("button", { name: "Apply changes", exact: true }).click();
    assert.equal(await p.inputValue("#text-input"), "b\na");
    await p
      .getByRole("button", { name: "Undo last edit", exact: true })
      .click();
    assert.equal(await p.inputValue("#text-input"), "b\na\nb");
    await open("markdown-studio");
    await p.fill("#markdown-input", "# Heading\n\nHello");
    await p.waitForTimeout(250);
    assert(
      await p
        .getByRole("navigation", { name: "Document outline" })
        .getByText("Heading")
        .isVisible(),
    );
    await p
      .getByRole("button", { name: "Insert contents", exact: true })
      .click();
    assert((await p.inputValue("#markdown-input")).includes("- Heading"));
    await open("flashcards");
    await p.click("#deck-new");
    await p.waitForFunction(
      () => document.querySelector("#deck-name").value === "Untitled deck",
    );
    await p.fill("#card-front", "Question");
    await p.fill("#card-back", "Answer");
    await p.click("#card-save");
    await p.waitForFunction(() => document.querySelector("#card-list button"));
    await p.click("#study-start");
    await p.click("#study-card");
    await p.click("#study-known");
    await p.waitForTimeout(200);
    const review = await p.evaluate(async () => {
      const m = await import("/tool-scripts/flashcard-store.js");
      return m.rows()[0].data.cards[0].review;
    });
    assert.equal(review.stage, 1);
    assert(Date.parse(review.dueAt) > Date.now() + 86000000);
    console.log(
      "PASS text preview/undo, Markdown outline and spaced review saved",
    );
    await open("typing-sprint");
    await p.selectOption("#typing-mode", "practice");
    await p
      .locator("details")
      .filter({ hasText: "Practice settings" })
      .locator("summary")
      .click();
    await p.getByPlaceholder("Optional custom practice text").fill("abcde");
    await p.getByLabel("Practice duration").selectOption("15");
    await p.click("#typing-start");
    await p.fill("#typing-input", "abcde");
    await p.waitForTimeout(15400);
    assert((await p.textContent("#typing-result")).includes("4.0"));
    assert.equal(
      await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem("kensei-workshop:typing:v1:guest"))[0]
            .duration,
      ),
      15,
    );
    console.log("PASS custom 15-second practice with normalized score");
    for (const slug of [
      "text-toolkit",
      "markdown-studio",
      "flashcards",
      "study-planner",
      "focus-timer",
      "time-studio",
      "whiteboard",
      "typing-sprint",
    ]) {
      await open(slug);
      for (const width of [320, 360, 768, 1440]) {
        await p.setViewportSize({ width, height: 900 });
        await p.waitForTimeout(50);
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " overflow " + width,
        );
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS eight learning pages at four widths, no JavaScript errors",
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
