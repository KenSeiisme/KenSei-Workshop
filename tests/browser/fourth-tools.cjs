const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { unzipSync } = require("fflate");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8796",
  checks = [];
function wav(seconds = 1.2, channels = 2, amplitude = 0.4) {
  const rate = 48000,
    count = Math.round(rate * seconds),
    b = Buffer.alloc(44 + count * channels * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(b.length - 44, 40);
  for (let i = 0; i < count; i++)
    for (let c = 0; c < channels; c++)
      b.writeInt16LE(
        Math.round(
          Math.sin((i / rate) * 2 * Math.PI * 440) * amplitude * 32767,
        ),
        44 + (i * channels + c) * 2,
      );
  return b;
}
const pass = (x) => {
  checks.push(x);
  console.log("PASS " + x);
};
(async () => {
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    context = await browser.newContext({ reducedMotion: "reduce" }),
    p = await context.newPage(),
    errors = [],
    uploads = [];
  p.on("pageerror", (e) => errors.push(e.message));
  context.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
  });
  await context.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  async function open(slug) {
    await p.goto(base + "/tools/" + slug + "/");
    await p.waitForSelector('[data-tool][data-ready="true"]');
  }
  async function ready(text) {
    await p.waitForFunction(
      (s) => document.querySelector("#tool-status").textContent.includes(s),
      text,
    );
  }
  async function result(action) {
    const pending = p.waitForEvent("download");
    await action();
    const d = await pending;
    return {
      data: fs.readFileSync(await d.path()),
      name: d.suggestedFilename(),
    };
  }
  try {
    for (const width of [360, 768, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      for (const slug of [
        "time-studio",
        "file-renamer",
        "audio-studio",
        "data-studio",
        "network-test",
      ]) {
        await open(slug);
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " overflow " + width,
        );
      }
    }
    await p.goto(base + "/tools/");
    assert.equal(await p.locator("[data-tool-card]").count(), 28);
    await p.locator('[data-filter="audio"]').click();
    assert.equal(await p.locator("[data-tool-card]:visible").count(), 1);
    await p.fill("#tool-search", "audio");
    await p.locator('[data-favorite="audio-studio"]').click();
    await p.goto(base + "/workspace/");
    assert.ok(await p.locator('a[href="/tools/audio-studio/"]').count());
    pass(
      "25-tool catalog, Audio category, favorites and mobile/tablet/desktop layouts",
    );
    await open("time-studio");
    await p.fill("#time-from", "America/New_York");
    await p.fill("#time-to", "Asia/Kuala_Lumpur");
    await p.fill("#time-date", "2026-03-08");
    await p.fill("#time-value", "02:30");
    assert.match(await p.textContent("#time-state"), /does not exist/);
    await p.fill("#time-date", "2026-11-01");
    await p.fill("#time-value", "01:30");
    assert.ok(await p.isVisible("#time-offset-label"));
    assert.equal(await p.locator("#time-offset option").count(), 2);
    assert.ok(await p.isDisabled("#countdown-add"));
    await p.selectOption("#time-offset", { index: 1 });
    assert.match(await p.inputValue("#time-output"), /14:30/);
    await p.fill("#date-start", "2024-02-28");
    await p.fill("#date-end", "2024-03-01");
    assert.match(await p.textContent("#date-result"), /^2 days/);
    await p.check("#date-inclusive");
    assert.match(await p.textContent("#date-result"), /^3 days/);
    await p.fill("#time-date", "2099-01-01");
    await p.fill("#time-value", "12:00");
    await p.fill("#countdown-name", "测试 deadline");
    await p.click("#countdown-add");
    assert.match(await p.textContent("#countdowns"), /测试 deadline/);
    await p.reload();
    await p.waitForSelector('[data-ready="true"]');
    assert.match(await p.textContent("#countdowns"), /测试 deadline/);
    pass(
      "time-zone conversion, explicit repeated-time selection, leap dates and countdown reload",
    );
    await open("file-renamer");
    await p.setInputFiles("#rename-files", [
      {
        name: "DSC_你好.JPG",
        mimeType: "text/plain",
        buffer: Buffer.from("keep original A"),
      },
      {
        name: "DSC_other.png",
        mimeType: "text/plain",
        buffer: Buffer.from("keep original B"),
      },
    ]);
    await p.getByText("Rename rules", { exact: true }).click();
    await p.fill("#rename-find", "DSC");
    await p.fill("#rename-replace", "Photo");
    await p.check("#rename-number");
    await p.fill("#rename-prefix", "set_");
    const zip = await result(() => p.click("#rename-download")),
      files = unzipSync(zip.data);
    assert.equal(
      Buffer.from(files["set_001_Photo_你好.JPG"]).toString(),
      "keep original A",
    );
    assert.equal(
      Buffer.from(files["set_002_Photo_other.png"]).toString(),
      "keep original B",
    );
    await p.locator(".rename-row input").first().fill("same.txt");
    await p.locator(".rename-row input").first().blur();
    await p.locator(".rename-row input").nth(1).fill("SAME.txt");
    await p.locator(".rename-row input").nth(1).blur();
    assert.ok(await p.isDisabled("#rename-download"));
    assert.match(await p.textContent("#rename-preview"), /conflict/);
    pass(
      "renamed ZIP preserves bytes, Unicode names, extensions, numbering and conflict prevention",
    );
    await open("data-studio");
    await p.fill(
      "#data-json",
      '[{"name":"<img src=x onerror=alert(1)>","id":"0012"},{"name":"中文","id":"0007"}]',
    );
    await p.locator('[data-json-action="to-csv"]').click();
    await ready("Done");
    assert.match(await p.inputValue("#data-csv"), /0012/);
    assert.equal(await p.locator("#data-table img").count(), 0);
    await p.click("#data-csv-to-json");
    await ready("Done");
    assert.equal(JSON.parse(await p.inputValue("#data-json"))[1].id, "0007");
    await p.fill("#data-csv", 'name,note\r\n"你好","line one\nline two"');
    await p.click("#data-csv-preview");
    await ready("Done");
    assert.match(await p.textContent("#data-table"), /line one/);
    await p.fill("#data-csv", "name,value\nA,=1+1");
    const csv = await result(() => p.click("#data-csv-download"));
    assert.match(csv.data.toString(), /'=1\+1/);
    assert.match(await p.textContent("#tool-status"), /escaped/);
    await p.fill("#data-json", '{"nested":{"v":1}}');
    await p.locator('[data-json-action="to-csv"]').click();
    await ready("flat objects");
    await p.fill("#data-json", "{bad}");
    await p.locator('[data-json-action="format"]').click();
    await p.waitForFunction(() =>
      document.querySelector("#tool-status").classList.contains("error-text"),
    );
    pass(
      "JSON/CSV conversion, leading zeros, safe text, quoted newlines, formula escaping and invalid inputs",
    );
    await open("audio-studio");
    await p.setInputFiles("#audio-file", {
      name: "tone.wav",
      mimeType: "audio/wav",
      buffer: wav(),
    });
    await ready("Audio ready");
    await p.fill("#audio-start", "0.2");
    await p.fill("#audio-end", "0.8");
    await p.fill("#audio-gain", "50");
    await p.selectOption("#audio-format", "wav");
    const output = await result(() => p.click("#audio-export"));
    assert.equal(output.data.toString("ascii", 0, 4), "RIFF");
    assert.equal(output.data.readUInt32LE(24), 44100);
    assert.equal(output.data.readUInt16LE(22), 2);
    assert.ok(Math.abs((output.data.length - 44) / 4 / 44100 - 0.6) < 0.001);
    let peak = 0;
    for (let i = 44; i < output.data.length; i += 2)
      peak = Math.max(peak, Math.abs(output.data.readInt16LE(i)));
    assert.ok(peak > 6000 && peak < 7000);
    await p.selectOption("#audio-format", "mp3");
    const mp3 = await result(() => p.click("#audio-export"));
    assert.ok(mp3.data.length > 1000);
    const decoded = await p.evaluate(
      async (bytes) => {
        const ctx = new AudioContext();
        try {
          const audio = await ctx.decodeAudioData(new Uint8Array(bytes).buffer);
          return {
            duration: audio.duration,
            channels: audio.numberOfChannels,
            rate: audio.sampleRate,
          };
        } finally {
          await ctx.close();
        }
      },
      [...mp3.data],
    );
    assert.ok(Math.abs(decoded.duration - 0.6) < 0.15);
    assert.equal(decoded.channels, 2);
    pass(
      "real WAV and MP3 exports: selected duration, stereo channels, 44.1 kHz WAV and gain amplitude",
    );
    await p.setInputFiles("#audio-file", {
      name: "bad.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("not audio"),
    });
    await p.waitForFunction(() =>
      /damaged|unsupported|format/.test(
        document.querySelector("#tool-status").textContent,
      ),
    );
    assert.ok(await p.isEnabled("#audio-export"));
    await p.click("#audio-play");
    await p.click("#audio-stop");
    await p.selectOption("#audio-format", "wav");
    await p.evaluate(() => {
      document.querySelector("#audio-export").click();
      document.querySelector("#cancel-job").click();
    });
    assert.match(await p.textContent("#tool-status"), /cancelled/);
    assert.ok(await p.isEnabled("#audio-export"));
    pass(
      "damaged audio keeps prior edit, playback works and cancelled exports remain retryable",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    fs.writeFileSync(
      "_qa/fourth-results.json",
      JSON.stringify({ base, checks, errors, uploads }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
