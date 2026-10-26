const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
function wav(seconds, value) {
  const rate = 44100,
    n = rate * seconds,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  return b;
}
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext(),
    p = await c.newPage(),
    errors = [],
    uploads = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  c.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
  });
  await c.route("**/config.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  async function open(slug) {
    await p.goto(base + "/tools/" + slug + "/");
    await p.waitForSelector("[data-ready=true]");
  }
  try {
    await open("audio-studio");
    await p.getByLabel("Audio files in order").setInputFiles([
      { name: "one.wav", mimeType: "audio/wav", buffer: wav(1, 0.25) },
      { name: "two.wav", mimeType: "audio/wav", buffer: wav(1, 0.5) },
    ]);
    await p.getByLabel("Fade in (seconds)").fill(".2");
    await p.getByLabel("Fade out (seconds)").fill(".2");
    await p.getByLabel("Peak normalization").check();
    await p
      .getByRole("button", { name: "Prepare audio preview", exact: true })
      .click();
    await p.waitForFunction(() =>
      document
        .querySelector("#audio-info")
        .textContent.includes("joined-audio"),
    );
    assert.equal(
      await p.evaluate(
        () => window.KenseiAdvancedContexts["audio-studio"].buffer.duration,
      ),
      2,
    );
    await p.selectOption("#audio-format", "wav");
    const wait = p.waitForEvent("download");
    await p.click("#audio-export");
    const data = fs.readFileSync(await (await wait).path());
    assert.equal(data.readUInt32LE(40) / 2 / 44100, 2);
    assert(Math.abs(data.readInt16LE(44)) < 3);
    console.log("PASS actual joined, normalized and faded WAV download");
    await open("subtitle-studio");
    await p.setInputFiles("#sub-file", {
      name: "test.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n",
      ),
    });
    await p.waitForFunction(
      () => document.querySelector("#sub-list").children.length === 2,
    );
    await p.getByLabel("Selected cues").selectOption(
      await p
        .getByLabel("Selected cues")
        .locator("option")
        .evaluateAll((ns) => ns.map((n) => n.value)),
    );
    await p
      .getByRole("button", { name: "Merge selected", exact: true })
      .click();
    await p.waitForFunction(
      () => document.querySelector("#sub-list").children.length === 1,
    );
    await p.getByLabel("Source anchor 1 (ms)").fill("1000");
    await p.getByLabel("Target anchor 1 (ms)").fill("2000");
    await p.getByLabel("Source anchor 2 (ms)").fill("4000");
    await p.getByLabel("Target anchor 2 (ms)").fill("8000");
    await p
      .getByRole("button", { name: "Preview corrected times", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Apply corrected times", exact: true })
      .click();
    assert.deepEqual(
      await p.evaluate(() =>
        window.KenseiAdvancedContexts["subtitle-studio"].cues.map((c) => [
          c.start,
          c.end,
        ]),
      ),
      [[2000, 8000]],
    );
    console.log("PASS subtitle merge and affine timing correction");
    await c.addInitScript(() => {
      window.captureCalls = [];
      window.streams = [];
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: async (options) => {
          captureCalls.push(options);
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          const x = canvas.getContext("2d");
          let n = 0;
          setInterval(() => {
            x.fillStyle = n++ % 2 ? "#d6b6ec" : "#222";
            x.fillRect(0, 0, 640, 360);
          }, 40);
          const s = canvas.captureStream(25);
          streams.push(s);
          return s;
        },
      });
    });
    await open("screen-recorder");
    assert.equal(await p.evaluate(() => captureCalls.length), 0);
    await p.getByLabel("Recording preset").selectOption("720");
    await p.click("#screen-start");
    await p.waitForFunction(() =>
      document
        .querySelector("#screen-status")
        .textContent.includes("starts in"),
    );
    await p
      .getByRole("button", { name: "Cancel countdown", exact: true })
      .click();
    assert(
      await p.evaluate(() =>
        streams.every((s) =>
          s.getTracks().every((t) => t.readyState === "ended"),
        ),
      ),
    );
    await p.click("#screen-start");
    await p.waitForFunction(
      () => !document.querySelector("#screen-pause").disabled,
    );
    await p.waitForTimeout(1200);
    await p.click("#screen-stop");
    await p.waitForFunction(
      () => !document.querySelector("#screen-download").disabled,
    );
    assert.equal(await p.evaluate(() => captureCalls[1].video.height.max), 720);
    const video = p.waitForEvent("download");
    await p.click("#screen-download");
    assert(fs.readFileSync(await (await video).path()).length > 100);
    console.log(
      "PASS countdown cancel, 720p request and actual MediaRecorder download",
    );
    for (const slug of ["audio-studio", "subtitle-studio", "screen-recorder"]) {
      await open(slug);
      for (const width of [320, 360, 768, 1440]) {
        await p.setViewportSize({ width, height: 900 });
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " overflow " + width,
        );
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    console.log("PASS media layouts and no uploads");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
