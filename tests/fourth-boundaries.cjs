const assert = require("node:assert/strict"),
  fs = require("node:fs");
const {
  chromium,
} = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8796",
  checks = [];
const pass = (x) => {
  checks.push(x);
  console.log("PASS " + x);
};
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true }),
    c = await browser.newContext(),
    p = await c.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  async function open(slug) {
    await p.goto(base + "/tools/" + slug + "/");
    await p.waitForSelector('[data-ready="true"]');
  }
  async function job(data) {
    return p.evaluate(
      (data) =>
        new Promise((resolve, reject) => {
          const w = new Worker("/tool-scripts/data-worker.js"),
            timer = setTimeout(() => {
              w.terminate();
              reject(Error("Worker timeout"));
            }, 20000);
          w.onmessage = (e) => {
            clearTimeout(timer);
            w.terminate();
            resolve(e.data);
          };
          w.onerror = (e) => {
            clearTimeout(timer);
            w.terminate();
            reject(Error(e.message));
          };
          if (data.fileBytes)
            data.file = new File(
              [new Uint8Array(data.fileBytes)],
              "sample.csv",
            );
          w.postMessage(data);
        }),
      data,
    );
  }
  try {
    await open("data-studio");
    for (const [text, pattern] of [
      ["a,a\n1,2", /unique/],
      [Array.from({ length: 201 }, (_, i) => "h" + i).join(","), /200/],
      ["id\n" + Array(50001).fill("001").join("\n"), /50,000/],
      ["a,b\n1", /different number/],
      ['a,b\n"unfinished,1', /malformed/],
    ]) {
      const r = await job({ kind: "csv", action: "preview", text });
      assert.equal(r.ok, false);
      assert.match(r.error, pattern);
    }
    const valid = await job({
      kind: "csv",
      action: "to-json",
      text: "\ufeffid\r\n0001\r\n0002",
    });
    assert.equal(JSON.parse(valid.text)[0].id, "0001");
    const invalid = await job({
      kind: "csv",
      action: "preview",
      fileBytes: [0xff, 0xfe, 0xfd],
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /UTF-8/);
    const tooBig = await job({
      kind: "json",
      action: "format",
      text: '"' + "x".repeat(5000000) + '"',
    });
    assert.match(tooBig.error, /5 MB/);
    const unsafe = await job({
      kind: "json",
      action: "to-csv",
      text: '[{"__proto__":"literal","constructor":"own"},{"id":"001"}]',
    });
    assert.equal(unsafe.ok, true);
    assert.equal(unsafe.table.rows[1][0], "");
    assert.equal(unsafe.table.rows[1][1], "");
    assert.ok(!unsafe.text.includes("[object Object]"));
    await p.fill(
      "#data-csv",
      "id\n" +
        Array.from({ length: 101 }, (_, i) => String(i).padStart(4, "0")).join(
          "\n",
        ),
    );
    await p.click("#data-csv-preview");
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("Done"),
    );
    assert.equal(await p.locator("#data-table tbody tr").count(), 50);
    await p.click("#data-next");
    assert.match(
      await p.textContent("#data-table tbody tr:first-child"),
      /0050/,
    );
    await p.click("#data-next");
    assert.equal(await p.locator("#data-table tbody tr").count(), 1);
    await p.evaluate(() => {
      document.querySelector("#data-json").value = '{"keep":"input"}';
      document.querySelector('[data-json-action="format"]').click();
      document.querySelector("#cancel-job").click();
    });
    assert.match(await p.textContent("#tool-status"), /Cancelled/);
    assert.equal(await p.inputValue("#data-json"), '{"keep":"input"}');
    await p.locator('[data-json-action="minify"]').click();
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("Done"),
    );
    pass(
      "worker limits, malformed CSV, UTF-8/BOM, own-property safety, pagination and cancel/retry",
    );
    await open("file-renamer");
    await p.setInputFiles("#rename-files", [
      { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
      { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
    ]);
    await p.locator(".rename-row input").first().fill("custom.txt");
    await p.locator(".rename-row input").first().blur();
    await p
      .getByRole("button", { name: "Move first.txt down", exact: true })
      .click();
    assert.equal(
      await p.locator(".rename-row input").nth(1).inputValue(),
      "custom.txt",
    );
    await p.locator(".rename-row input").first().fill("CON.txt");
    await p.locator(".rename-row input").first().blur();
    assert.ok(await p.isDisabled("#rename-download"));
    await p.setInputFiles(
      "#rename-files",
      Array.from({ length: 101 }, (_, i) => ({
        name: i + ".txt",
        mimeType: "text/plain",
        buffer: Buffer.from("x"),
      })),
    );
    assert.match(await p.textContent("#tool-status"), /100 files/);
    assert.ok(await p.isDisabled("#rename-download"));
    await p.setInputFiles("#rename-files", [
      {
        name: "retry.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("retry"),
      },
    ]);
    assert.ok(await p.isEnabled("#rename-download"));
    pass(
      "manual filenames survive ordering, reserved names and excess inputs are rejected, reselection works",
    );
    await open("time-studio");
    const remove = p.locator("#world-clocks button").first();
    await remove.focus();
    await p.waitForTimeout(1250);
    assert.ok(await remove.evaluate((el) => el === document.activeElement));
    await p.selectOption("#time-format", "12");
    assert.match(await p.textContent("#world-clocks"), /am|pm/i);
    await p.reload();
    await p.waitForSelector('[data-ready="true"]');
    assert.equal(await p.inputValue("#time-format"), "12");
    pass(
      "clock updates preserve keyboard focus and locally saved time-format preference",
    );
    await open("audio-studio");
    const audio = await p.evaluate(() => {
      const rate = 44100,
        count = rate,
        b = new ArrayBuffer(44 + count * 2),
        v = new DataView(b);
      const str = (o, s) =>
        [...s].forEach((x, i) => v.setUint8(o + i, x.charCodeAt(0)));
      str(0, "RIFF");
      v.setUint32(4, b.byteLength - 8, true);
      str(8, "WAVEfmt ");
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, rate, true);
      v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      str(36, "data");
      v.setUint32(40, count * 2, true);
      for (let i = 0; i < count; i++)
        v.setInt16(44 + i * 2, Math.sin(i / 10) * 30000, true);
      return Array.from(new Uint8Array(b));
    });
    await p.setInputFiles("#audio-file", {
      name: "mono.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from(audio),
    });
    await p.waitForFunction(() =>
      document
        .querySelector("#tool-status")
        .textContent.includes("Audio ready"),
    );
    await p.fill("#audio-end", "2");
    assert.ok(await p.isDisabled("#audio-export"));
    await p.fill("#audio-end", "1");
    await p.fill("#audio-gain", "200");
    await c.route("**/vendor/audio-codecs.js", (r) => r.abort("failed"));
    await p.selectOption("#audio-format", "mp3");
    await p.click("#audio-export");
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("failed"),
    );
    assert.ok(await p.isEnabled("#audio-export"));
    await p.selectOption("#audio-format", "wav");
    const pending = p.waitForEvent("download");
    await p.click("#audio-export");
    const d = await pending,
      bytes = fs.readFileSync(await d.path());
    assert.equal(bytes.readUInt16LE(22), 1);
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("clipped"),
    );
    assert.equal(await p.inputValue("#audio-gain"), "200");
    pass(
      "invalid audio selection, encoder-load failure, WAV retry and explicit clipping feedback",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/fourth-boundaries.json",
      JSON.stringify({ base, checks, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
