const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const url = base + "/tools/grade-planner/";
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
  });
  const context = await browser.newContext({
    viewport: { width: 320, height: 800 },
    acceptDownloads: true,
  });
  await context.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  try {
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForSelector('[data-ready="true"]');
    const data = {
      version: 1,
      name: "Semester test",
      scale: [
        { minimum: 80, points: 4 },
        { minimum: 70, points: 3 },
        { minimum: 0, points: 0 },
      ],
      terms: [
        {
          id: randomUUID(),
          name: "Term 1",
          courses: [
            {
              id: randomUUID(),
              name: "Mathematics",
              credits: 3,
              target: 80,
              confirmed: 90,
              forecast: null,
              excluded: false,
              items: [
                {
                  id: randomUUID(),
                  name: "Midterm",
                  weight: 40,
                  max: 50,
                  score: 45,
                  absent: false,
                },
                {
                  id: randomUUID(),
                  name: "Final",
                  weight: 60,
                  max: 100,
                  score: null,
                  absent: false,
                },
              ],
            },
          ],
        },
        {
          id: randomUUID(),
          name: "Term 2",
          courses: [
            {
              id: randomUUID(),
              name: "Design",
              credits: 1,
              target: 70,
              confirmed: null,
              forecast: 75,
              excluded: false,
              items: [],
            },
          ],
        },
      ],
    };
    await page.locator("#grade-import").setInputFiles({
      name: "grades.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
    await page
      .getByText("Average needed on remaining assessments: 73.33%", {
        exact: true,
      })
      .waitFor();
    assert.match(
      await page.locator("#grade-summary").innerText(),
      /Projected CGPA: 3.75/,
    );
    assert.match(
      await page.locator("#grade-summary").innerText(),
      /Cumulative CGPA: 4.00/,
    );
    await page.getByLabel("Absent (counts as zero)").last().check();
    await page
      .getByText("This target cannot be reached with the remaining weight.")
      .waitFor();
    await page.getByLabel("Absent (counts as zero)").last().uncheck();
    await page.locator("#grade-save").click();
    await page.waitForURL(/\?id=/);
    const id = new URL(page.url()).searchParams.get("id");
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector("#grade-name").value === "Semester test",
    );
    const download = page.waitForEvent("download");
    await page.locator("#grade-export").click();
    const backup = JSON.parse(
      await fs.readFile(await (await download).path(), "utf8"),
    );
    assert.equal(backup.terms[0].courses[0].items[1].score, null);
    assert.equal(backup.terms[1].courses[0].forecast, 75);
    await page.goto(base + "/workspace/");
    await page.waitForSelector('a[href*="grade-planner/?id=' + id + '"]');
    await page.goto(base + "/zh-hant/tools/grade-planner/?id=" + id);
    await page.waitForFunction(
      () => document.querySelector("#grade-name").value === "Semester test",
    );
    await page.getByText("剩餘考核所需平均分：73.33%").waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    const studyCourse = randomUUID();
    await page.goto(base + "/tools/study-planner/");
    await page.waitForSelector('[data-ready="true"]');
    await page.locator("#planner-import").setInputFiles({
      name: "plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          name: "Study plan fixture",
          timeZone: "Asia/Kuala_Lumpur",
          courses: [
            {
              id: studyCourse,
              title: "Physics",
              color: "#8899aa",
              startDate: "2026-11-01",
              endDate: "2027-01-01",
              sessions: [],
            },
          ],
          tasks: [
            {
              id: randomUUID(),
              title: "Lab report",
              courseId: studyCourse,
              type: "assignment",
              due: "2026-12-05T09:00",
              done: false,
            },
          ],
        }),
      ),
    });
    await page.waitForURL(/\?id=/);
    await page.goto(url + "?id=" + id);
    await page.waitForFunction(
      () => document.querySelector("#grade-name").value === "Semester test",
    );
    await page.locator("#grade-study-panel summary").click();
    await page.getByLabel("Lab report").waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Copy selected course and assessments" })
      .click();
    assert.equal(await page.getByLabel("Course name").inputValue(), "Physics");
    assert.equal(
      await page.getByLabel("Assessment name").inputValue(),
      "Lab report",
    );
    await page.locator("#grade-save").click();
    await page
      .getByText("Grade plan saved.", { exact: true })
      .first()
      .waitFor();
    console.log(
      "PASS grade calculation, absence, GPA/CGPA, backup, Workspace, bilingual restore and Study Planner import",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
