const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await c.newPage(),
    errors = [],
    external = [];
  await c.route("**/config.js", (r) =>
    r.fulfill({
      body: "window.KENSEI_CONFIG={};",
      contentType: "application/javascript",
    }),
  );
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  p.on("request", (r) => {
    if (!r.url().startsWith(base) && /^https?:/.test(r.url()))
      external.push(r.url());
  });
  async function open(slug, lang = "") {
    await p.goto(base + lang + "/tools/" + slug + "/");
    await p.waitForSelector("[data-ready=true]");
  }
  async function dl(fn) {
    const w = p.waitForEvent("download", { timeout: 90000 });
    await fn();
    return fs.readFileSync(await (await w).path());
  }
  try {
    await open("data-studio");
    await p.getByRole("tab", { name: "Analyze", exact: true }).click();
    await p.setInputFiles("#analyze-files", [
      {
        name: "people.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("id,team,value\n001,A,2\n002,A,3\n003,B,4"),
      },
      {
        name: "teams.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          '[{"team":"A","title":"Alpha"},{"team":"B","title":"Beta"}]',
        ),
      },
    ]);
    await p.waitForFunction(
      () => document.querySelector("#analyze-sql").value.includes("SELECT"),
      { timeout: 90000 },
    );
    const state = p.locator("#data-analyze-workspace > p[role=status]");
    async function query(sql, ok = true) {
      await p.fill("#analyze-sql", sql);
      await p.getByRole("button", { name: "Run query", exact: true }).click();
      await p.waitForFunction(
        () =>
          !document.querySelector("#data-analyze-workspace button.primary")
            .disabled,
        { timeout: 90000 },
      );
      if (ok) assert.match(await state.textContent(), /Query complete/);
    }
    await query(
      "SELECT a.id,b.title,CAST(a.value AS INTEGER)*2 AS doubled FROM table_1 a LEFT JOIN table_2 b ON a.team=b.team ORDER BY a.id",
    );
    let result = JSON.parse(
      (
        await dl(() =>
          p
            .getByRole("button", { name: "Download result JSON", exact: true })
            .click(),
        )
      ).toString(),
    );
    assert.equal(result[0].id, "001");
    assert.equal(result[0].title, "Alpha");
    assert.equal(result[2].doubled, 8);
    console.log(
      "PASS native local SQL join, explicit conversion and leading zeros",
    );
    await query(
      "WITH totals AS (SELECT team,SUM(CAST(value AS DOUBLE)) total FROM table_1 GROUP BY team) SELECT * FROM totals ORDER BY team",
    );
    assert.match(await p.locator(".analysis-result").textContent(), /5/);
    await query(
      "SELECT * FROM read_csv('https://invalid.test/private.csv')",
      false,
    );
    assert.match(
      await state.textContent(),
      /disabled|permission|not allowed|external/i,
    );
    await query("SELECT 1; DROP TABLE table_1", false);
    assert.match(await state.textContent(), /one SQL statement/);
    await query("DELETE FROM table_1 RETURNING *", false);
    assert.match(await state.textContent(), /SELECT/);
    await query("SELECT * FROM range(50001)", false);
    assert.match(await state.textContent(), /50,000/);
    await p.fill(
      "#analyze-sql",
      "SELECT SUM(i) FROM range(1000000000000) t(i)",
    );
    await p.getByRole("button", { name: "Run query", exact: true }).click();
    await p.getByRole("button", { name: "Cancel query", exact: true }).click();
    assert.match(await state.textContent(), /cancelled/);
    await query("SELECT COUNT(*) n FROM table_1");
    console.log(
      "PASS grouping, read-only restriction, result cap, cancellation and retained sources",
    );
    const generated = await p.evaluate(async () => {
      const { visualSQL } = await import("/tool-scripts/data-analysis-core.js");
      return visualSQL({
        source: "table_1",
        second: "table_2",
        join: "none",
        leftKey: "team",
        rightKey: "team",
        columns: [],
        groups: [],
        aggregate: "sum",
        measure: "a.value",
        numeric: true,
        pivot: true,
        pivotColumn: "a.team",
        pivotValues: "A,B",
        sort: "",
        sortNumeric: false,
        desc: false,
        filters: [],
      });
    });
    await query(generated);
    const pivotResult = JSON.parse(
      (
        await dl(() =>
          p
            .getByRole("button", { name: "Download result JSON", exact: true })
            .click(),
        )
      ).toString(),
    );
    assert.deepEqual(pivotResult, [{ A: 5, B: 4 }]);
    console.log("PASS visual pivot SQL executes with exact aggregates");
    await p.fill(
      "#analyze-sql",
      "SELECT SUM(sin(i * .123)) AS total FROM range(20000000) t(i)",
    );
    await p.getByRole("button", { name: "Run query", exact: true }).click();
    await p.fill("#analyze-sql", "SELECT 999 AS changed");
    await p.waitForFunction(
      () =>
        !document.querySelector("#data-analyze-workspace button.primary")
          .disabled,
      { timeout: 90000 },
    );
    assert.match(await state.textContent(), /Settings changed/);
    await p.setInputFiles("#analyze-files", {
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("{bad"),
    });
    await p.waitForFunction(
      () =>
        !document.querySelector("#data-analyze-workspace button.primary")
          .disabled,
      { timeout: 90000 },
    );
    await query("SELECT COUNT(*) n FROM table_1");
    console.log(
      "PASS stale in-flight results and failed import retain usable original sources",
    );

    await open("markdown-studio");
    const md =
      "# Formula and diagrams\n\nInline $E=mc^2$ and a note.[^n]\n\n[^n]: Footnote content\n\n$$\n\\frac{a}{b} + \\sqrt{x}\n$$\n\n```mermaid\nflowchart LR\n A[Start] --> B[End]\n```\n\n```mermaid\nsequenceDiagram\n Alice->>Bob: Hello\n```\n\n```mermaid\nclassDiagram\n Animal <|-- Duck\n```\n\n```mermaid\nerDiagram\n CUSTOMER ||--o{ ORDER : places\n```";
    await p.fill("#markdown-input", md);
    await p.waitForFunction(
      () =>
        document.querySelectorAll("#markdown-preview .markdown-diagram svg")
          .length === 4,
      { timeout: 90000 },
    );
    assert.equal(await p.locator("#markdown-preview .katex").count(), 2);
    assert.match(
      await p.locator("#markdown-preview .footnotes").textContent(),
      /Footnote content/,
    );
    const html = (await dl(() => p.click("#markdown-html"))).toString();
    assert(
      html.includes("data:font/woff2;base64,") ||
        html.includes("data:application/octet-stream;base64,"),
    );
    assert(html.includes("<svg"));
    assert(!html.includes("<script"));
    if (b.browserType().name() === "chromium") {
      const doc = await p.pdf({ format: "A4", printBackground: true });
      assert(doc.length > 5000);
    } else {
      // Playwright 的 PDF 打印 API 仅支持 Chromium；HTML 导出断言仍完整执行。
      console.log(
        "MANUAL browser Save as PDF: Playwright print API is Chromium-only",
      );
    }
    await p.fill(
      "#markdown-input",
      '```mermaid\nflowchart LR\n A-->B\n click A "https://example.com"\n```\n\n<img src="https://invalid.test/a.png">\n\n![bad](https://invalid.test/b.png)',
    );
    await p.waitForFunction(() =>
      document
        .querySelector("#markdown-preview")
        .textContent.includes("disabled"),
    );
    assert.equal(await p.locator("#markdown-preview img").count(), 0);
    console.log(
      "PASS formulas, footnotes, four diagrams, standalone HTML fonts, " +
        (b.browserType().name() === "chromium" ? "printed PDF, " : "") +
        "and unsafe content restriction",
    );
    for (const slug of ["data-studio", "markdown-studio"])
      for (const width of [320, 360, 768, 1440]) {
        await p.setViewportSize({ width, height: 950 });
        await open(slug, "/zh-hant");
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " " + width,
        );
      }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log("PASS responsive pages and zero external requests");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
