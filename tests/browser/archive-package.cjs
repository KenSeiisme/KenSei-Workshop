const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { zipSync, unzipSync, strFromU8 } = require("fflate");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
  });
  const context = await browser.newContext({
    viewport: { width: 320, height: 800 },
    acceptDownloads: true,
  });
  const requests = [];
  await context.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  context.on("request", (request) => {
    if (request.method() === "POST") requests.push(request.url());
  });
  const tmp = await fs.mkdtemp(
    path.join(__dirname, "../../_qa/package-fixture-"),
  );
  const directory = path.resolve(tmp, "課程");
  try {
    for (const name of ["組甲", "組乙"])
      await fs.mkdir(path.join(directory, name), { recursive: true });
    const first = Buffer.from([0, 2, 255, 128, 19]),
      second = Buffer.from([44, 90, 0, 66]);
    await fs.writeFile(path.join(directory, "組甲", "same.bin"), first);
    await fs.writeFile(path.join(directory, "組乙", "same.bin"), second);
    const page = await context.newPage();
    await page.goto(base + "/tools/file-renamer/");
    const folder = page.getByLabel("Choose a folder", { exact: true });
    await folder.waitFor({ state: "attached" });
    await folder.setInputFiles(directory);
    const prefix = page.locator("#rename-prefix");
    const settings = prefix.locator("xpath=ancestor::details[1]");
    if (
      (await settings.count()) &&
      !(await settings.evaluate((node) => node.open))
    )
      await settings.locator("summary").first().click();
    await prefix.fill("ready-");
    await page.locator("#rename-preview small").last().waitFor();
    const transferred = context.waitForEvent("page");
    await page.getByRole("button", { name: "ZIP Studio", exact: true }).click();
    const zip = await transferred;
    await zip.locator("#zip-pack-paths li").last().waitFor();
    const paths = await zip.locator("#zip-pack-paths li").allTextContents();
    const a = "課程/組甲/ready-same.bin",
      b = "課程/組乙/ready-same.bin";
    assert.deepEqual(paths.sort(), [a, b].sort());
    await zip.locator("#zip-checksum").check();
    const download = zip.waitForEvent("download");
    await zip.locator("#zip-pack").click();
    const zipBytes = await fs.readFile(await (await download).path());
    const contents = unzipSync(zipBytes);
    assert.deepEqual(Buffer.from(contents[a]), first);
    assert.deepEqual(Buffer.from(contents[b]), second);
    const digest = (buf) => createHash("sha256").update(buf).digest("hex");
    const text = strFromU8(contents.SHA256SUMS);
    assert.deepEqual(
      text.trim().split("\n").sort(),
      [digest(first) + "  " + a, digest(second) + "  " + b].sort(),
    );
    const manifest = zip.waitForEvent("download");
    await zip.locator("#zip-manifest").click();
    assert.equal(
      await fs.readFile(await (await manifest).path(), "utf8"),
      text,
    );

    await zip.getByRole("tab", { name: "Inspect ZIP" }).click();
    const opened = zip.locator("#zip-open");
    await opened.setInputFiles({
      name: "package.zip",
      mimeType: "application/zip",
      buffer: zipBytes,
    });
    await zip.locator(".package-verifier summary").click();
    await zip.getByRole("button", { name: "Check package" }).click();
    await zip.getByText("Matched 2 of 2 package paths.").waitFor();

    const check = await context.newPage();
    await check.goto(base + "/tools/file-check/");
    await check.locator(".package-verifier summary").click();
    const updated = Buffer.from(
      zipSync({
        [a]: Buffer.from("new content"),
        [b.toUpperCase()]: second,
        [b]: second,
        "extra.txt": Buffer.from("extra"),
        SHA256SUMS: contents.SHA256SUMS,
      }),
    );
    const input = check.getByLabel("ZIP to verify");
    await input.setInputFiles({
      name: "modified.zip",
      mimeType: "application/zip",
      buffer: updated,
    });
    const run = () =>
      check.getByRole("button", { name: "Check package" }).click();
    await run();
    const table = check.locator(".package-verifier tbody");
    const entries = async () =>
      Object.fromEntries(
        await table
          .locator("tr")
          .evaluateAll((nodes) =>
            nodes.map((node) =>
              Array.from(node.cells, (cell) => cell.textContent),
            ),
          ),
      );
    await table.getByText("Ambiguous").first().waitFor();
    let rows = await entries();
    assert.equal(rows[a], "Mismatch");
    assert.equal(rows[b], "Ambiguous");
    assert.equal(rows["extra.txt"], "Not in manifest");
    await input.setInputFiles({
      name: "missing.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(zipSync({ [a]: first })),
    });
    await check.getByLabel("Separate manifest (optional)").setInputFiles({
      name: "SHA256SUMS",
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
    await run();
    await table.getByText("Missing", { exact: true }).waitFor();
    rows = await entries();
    assert.deepEqual(rows, { [a]: "Match", [b]: "Missing" });
    await check.goto(base + "/zh-hant/tools/file-check/");
    await check.getByText("驗證壓縮包", { exact: true }).click();
    await check.getByLabel("要驗證的 ZIP", { exact: true }).setInputFiles({
      name: "package.zip",
      mimeType: "application/zip",
      buffer: zipBytes,
    });
    const verify = check.getByRole("button", {
      name: "核對壓縮包",
      exact: true,
    });
    await verify.focus();
    await verify.press("Enter");
    await check
      .getByText("2 條包內路徑中有 2 條相符。", { exact: true })
      .waitFor();
    assert.ok(
      await check.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    assert.equal(requests.length, 0);
    console.log(
      "PASS folder and native handoff, independent exact SHA-256, ZIP/File Check reports, external manifest and no uploads",
    );
  } finally {
    await browser.close();
    for (const name of ["組甲", "組乙"]) {
      await fs.rm(path.join(directory, name, "same.bin"), { force: true });
      await fs.rmdir(path.join(directory, name)).catch(() => {});
    }
    await fs.rmdir(directory).catch(() => {});
    await fs.rmdir(tmp);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
