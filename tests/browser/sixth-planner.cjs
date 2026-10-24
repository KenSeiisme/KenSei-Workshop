const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8797",
  output = "_qa/sixth-planner",
  checks = [];
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    timezoneId: "Asia/Kuala_Lumpur",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage(),
    errors = [],
    uploads = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  context.on("request", (request) => {
    if (["POST", "PUT", "PATCH"].includes(request.method()))
      uploads.push(request.url());
  });
  await context.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  const pass = (label) => {
    checks.push(label);
    console.log("PASS " + label);
  };
  async function ready() {
    await page.waitForSelector('[data-ready="true"]');
  }
  async function saved() {
    await page.waitForFunction(
      () =>
        !/Unsaved edits|Saving edits/.test(
          document.querySelector("#planner-save-state").textContent,
        ),
    );
  }
  async function exported(action) {
    const promise = page.waitForEvent("download");
    await action();
    const file = await promise,
      data = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
    return { name: file.suggestedFilename(), data };
  }
  async function importJSON(data, name = "plan.json") {
    await page.setInputFiles("#planner-import", {
      name,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  }
  try {
    await page.goto(base + "/tools/study-planner/");
    await ready();
    await page.clock.install({ time: new Date("2026-10-22T08:00:00Z") });
    await page.click("#planner-new");
    await page.waitForFunction(
      () => !document.querySelector("#planner-fields").disabled,
    );
    await page.fill("#planner-name", "TAR UMT · Semester 一");
    await saved();
    assert.equal(await page.inputValue("#planner-zone"), "Asia/Kuala_Lumpur");
    const originalId = new URL(page.url()).searchParams.get("id");
    assert.ok(originalId);
    await page.click("#planner-course-new");
    await page.fill("#planner-course-title", "Programming 编程");
    await page.fill("#planner-course-start", "2026-10-19");
    await page.fill("#planner-course-end", "2026-11-30");
    await page.selectOption("#planner-session-day", "1");
    await page.click("#planner-session-add");
    await page.selectOption("#planner-session-day", "4");
    await page.fill("#planner-session-start", "14:00");
    await page.fill("#planner-session-end", "16:00");
    await page.click("#planner-session-add");
    await page.click("#planner-course-save");
    await saved();
    assert.equal(
      await page.locator("#planner-sessions .planner-session").count(),
      2,
    );
    assert.equal(await page.locator("#planner-week .planner-event").count(), 2);
    await page.click("#planner-task-new");
    await page.fill("#planner-task-title", "Assignment 报告");
    await page.selectOption("#planner-task-course", {
      label: "Programming 编程",
    });
    await page.fill("#planner-task-due", "2026-10-21T23:59");
    await page.click("#planner-task-save");
    await saved();
    assert.match(await page.textContent("#planner-task-summary"), /1 overdue/);
    await page.click("#planner-task-new");
    await page.fill("#planner-task-title", "Programming exam");
    await page.selectOption("#planner-task-type", "exam");
    await page.fill("#planner-task-due", "2026-10-23T10:00");
    await page.click("#planner-task-save");
    await saved();
    assert.match(
      await page.textContent("#planner-task-summary"),
      /1 due · 1 overdue · 0 done/,
    );
    assert.equal(await page.locator("#planner-week .planner-event").count(), 4);
    await page
      .locator("#planner-tasks .planner-item")
      .filter({ hasText: "Assignment 报告" })
      .locator('input[type="checkbox"]')
      .check();
    await saved();
    await page.selectOption("#planner-task-filter", "done");
    assert.equal(await page.locator("#planner-tasks .planner-item").count(), 1);
    assert.match(
      await page.textContent("#planner-task-summary"),
      /1 due · 0 overdue · 1 done/,
    );
    await page.selectOption("#planner-task-filter", "all");
    await page.click("#planner-next");
    assert.match(await page.textContent("#planner-week-label"), /2026-10-26/);
    await page.click("#planner-today");
    assert.match(await page.textContent("#planner-week-label"), /2026-10-19/);
    pass(
      "Guest plan, bilingual course, repeated classes, assignment/exam, week navigation and due/overdue/done states",
    );

    const backup = await exported(() => page.click("#planner-export"));
    assert.equal(backup.data.version, 1);
    assert.equal(backup.data.courses.length, 1);
    assert.equal(backup.data.tasks.length, 2);
    assert.equal(
      backup.data.tasks.find((t) => t.title === "Assignment 报告").done,
      true,
    );
    assert.equal(backup.data.timeZone, "Asia/Kuala_Lumpur");
    assert.equal(backup.data.editing, undefined);
    await page.reload();
    await ready();
    await page.waitForFunction(
      () =>
        document.querySelector("#planner-name").value ===
        "TAR UMT · Semester 一",
    );
    assert.equal(
      await page.locator("#planner-courses .planner-item").count(),
      1,
    );
    assert.match(await page.textContent("#planner-task-summary"), /1 done/);
    await importJSON(backup.data);
    await page.waitForFunction(
      () => document.querySelectorAll("#planner-list button").length === 2,
    );
    await saved();
    assert.notEqual(new URL(page.url()).searchParams.get("id"), originalId);
    await page.goto(base + "/tools/study-planner/?id=" + originalId);
    await ready();
    await page.waitForFunction(
      () =>
        document.querySelector("#planner-name").value ===
        "TAR UMT · Semester 一",
    );
    assert.equal(new URL(page.url()).searchParams.get("id"), originalId);
    pass(
      "Actual JSON download/import, IndexedDB refresh recovery and Workspace-compatible ?id= deep link",
    );

    await page.fill("#planner-zone", "Invalid/Zone");
    await page.waitForFunction(() =>
      /valid IANA/.test(document.querySelector("#tool-status").textContent),
    );
    assert.equal(await page.inputValue("#planner-zone"), "Invalid/Zone");
    const recovery = await exported(() => page.click("#planner-export"));
    assert.equal(recovery.data.format, "kensei-planner-backup");
    assert.equal(recovery.data.editing.timeZone, "Invalid/Zone");
    await page.reload();
    await ready();
    await page.waitForFunction(
      () => document.querySelector("#planner-zone").value === "Invalid/Zone",
    );
    await page.fill("#planner-zone", "Asia/Kuala_Lumpur");
    await saved();
    await page.fill("#planner-course-title", "Unadded course kept in backup");
    const editorBackup = await exported(() => page.click("#planner-export"));
    assert.equal(
      editorBackup.data.editing.course.title,
      "Unadded course kept in backup",
    );
    await page.reload();
    await ready();
    await page.waitForFunction(
      () =>
        document.querySelector("#planner-course-title").value ===
        "Unadded course kept in backup",
    );
    await page.fill("#planner-course-title", "");
    await page.fill("#planner-task-title", "");
    await page.click("#planner-course-new");
    await page.waitForTimeout(50);
    await importJSON({ ...backup.data, timeZone: "not-a-zone" });
    await page.waitForFunction(() =>
      /valid IANA/.test(document.querySelector("#tool-status").textContent),
    );
    assert.equal(await page.locator("#planner-list button").count(), 2);
    pass(
      "Invalid edits stay editable, recovery JSON preserves unfinished forms, tab refresh restores edits and invalid imports leave saved plans intact",
    );

    await page.goto(base + "/tools/study-planner/?id=" + originalId);
    await ready();
    await page.waitForFunction(
      () => !document.querySelector("#planner-fields").disabled,
    );
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(100);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "No page overflow at " + width,
      );
      assert.ok(await page.locator("#planner-export").isVisible());
      await page.screenshot({
        path: path.join(output, "planner-" + width + ".png"),
        fullPage: true,
      });
    }
    await page.locator("#planner-courses .planner-item button").first().click();
    await page.click("#planner-course-delete");
    await saved();
    assert.equal(
      await page.locator("#planner-courses .planner-item").count(),
      0,
    );
    const unlinked = await exported(() => page.click("#planner-export"));
    assert.equal(unlinked.data.tasks.length, 2);
    assert.ok(unlinked.data.tasks.every((task) => task.courseId === null));
    await page.selectOption("#planner-task-filter", "all");
    await page
      .locator("#planner-tasks .planner-item button")
      .filter({ hasText: "Programming exam" })
      .click();
    await page.click("#planner-task-delete");
    await saved();
    const remaining = await exported(() => page.click("#planner-export"));
    assert.equal(remaining.data.tasks.length, 1);
    await page.click("#planner-delete");
    await page.waitForFunction(
      () => document.querySelectorAll("#planner-list button").length === 1,
    );
    await page.locator("#planner-list button").first().click();
    await page.click("#planner-clear");
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#planner-list button").length === 0 &&
        document.querySelector("#planner-fields").disabled,
    );
    assert.equal(await page.locator("#planner-name").isDisabled(), true);
    pass(
      "Course deletion preserves and unlinks tasks, individual task/plan deletion and clear-all reset the editor",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    pass(
      "360/768/1440 layouts, no uncaught browser errors and no guest/file upload requests",
    );
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify({ checks, errors, uploads }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
