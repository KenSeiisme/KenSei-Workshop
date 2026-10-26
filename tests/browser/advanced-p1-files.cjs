const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { zipSync, strToU8, unzipSync, strFromU8 } = require("fflate"),
  { createHash } = require("node:crypto");
const { chromium } = require("../support/browser.cjs");
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext({ reducedMotion: "reduce" }),
    p = await c.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await c.route("**/config.js", (r) =>
    r.fulfill({
      body: "window.KENSEI_CONFIG={};",
      contentType: "application/javascript",
    }),
  );
  async function open(s) {
    await p.goto(
      (process.env.TEST_BASE_URL || "http://127.0.0.1:8771") +
        "/tools/" +
        s +
        "/",
    );
    await p.waitForSelector('[data-ready="true"]');
  }
  try {
    await open("zip-studio");
    const archive = zipSync({
      "中文/a.txt": strToU8("Alpha"),
      "中文/b.txt": strToU8("Beta"),
      "other.txt": strToU8("Other"),
    });
    await p.setInputFiles("#zip-open", {
      name: "tree.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(archive),
    });
    await p.waitForSelector(".advanced-list details");
    await p.locator(".advanced-list input[type=checkbox]").nth(0).check();
    await p.locator(".advanced-list input[type=checkbox]").nth(1).check();
    const wait = p.waitForEvent("download");
    await p
      .getByRole("button", { name: "Repack selected files", exact: true })
      .click();
    const dl = await wait;
    const out = unzipSync(fs.readFileSync(await dl.path()));
    assert.equal(strFromU8(out["中文/a.txt"]), "Alpha");
    assert.equal(strFromU8(out["中文/b.txt"]), "Beta");
    assert.equal(Object.keys(out).length, 2);
    console.log(
      "PASS selected ZIP repack retains Chinese paths and exact file content",
    );
    await open("file-check");
    const bytes = Buffer.from("manifest test"),
      digest = createHash("sha256").update(bytes).digest("hex");
    await p.setInputFiles("#check-files", {
      name: "sample.txt",
      mimeType: "text/plain",
      buffer: bytes,
    });
    await p.click("#check-run");
    await p.waitForFunction(
      () => !document.querySelector("#check-download").disabled,
    );
    await p.locator(".advanced-panel input[type=file]").setInputFiles({
      name: "SHA256SUMS",
      mimeType: "text/plain",
      buffer: Buffer.from(digest + "  sample.txt\n" + digest + "  missing.txt"),
    });
    await p.waitForFunction(() =>
      document.querySelector(".advanced-panel").textContent.includes("Missing"),
    );
    assert(
      (await p.locator(".advanced-panel").textContent()).includes("Match"),
    );
    console.log(
      "PASS actual hash calculation compared against batch manifest, including missing files",
    );
    await open("image-to-text");
    for (const [lang, text, font, pattern] of [
      ["eng", "KenSei Workshop 123", "Arial", /Workshop/],
      ["chi_sim", "这是中文文字识别测试", "Microsoft YaHei", /中文/],
      ["chi_tra", "這是繁體中文測試", "Microsoft JhengHei", /中文/],
      ["msa", "Selamat pagi dunia Malaysia", "Arial", /Selamat/i],
    ]) {
      const img = Buffer.from(
        await p.evaluate(
          ({ text, font }) => {
            const c = document.createElement("canvas");
            c.width = 1600;
            c.height = 200;
            const x = c.getContext("2d");
            x.fillStyle = "white";
            x.fillRect(0, 0, 1600, 200);
            x.fillStyle = "black";
            x.font = '60px "' + font + '"';
            x.fillText(text, 30, 120);
            return c.toDataURL().split(",")[1];
          },
          { text, font },
        ),
        "base64",
      );
      await p.setInputFiles("#ocr-file", {
        name: lang + ".png",
        mimeType: "image/png",
        buffer: img,
      });
      await p.waitForFunction(() =>
        document.querySelector("#ocr-file-info").textContent.endsWith(".png"),
      );
      for (const option of ["eng", "chi_sim", "chi_tra", "msa"])
        await p
          .locator('[name="ocr-language"][value="' + option + '"]')
          .setChecked(option === lang);
      await p.click("#ocr-run");
      await p.waitForFunction(
        () =>
          document
            .querySelector("#tool-status")
            .textContent.startsWith("Text extracted"),
        null,
        { timeout: 120000 },
      );
      assert.match(await p.inputValue("#ocr-output"), pattern);
      console.log("PASS actual OCR language " + lang);
    }
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
