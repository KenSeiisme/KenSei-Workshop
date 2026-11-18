const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const library = "/vendor/mediabunny-video-1.66.1.mjs";

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 820 },
  });
  const page = await context.newPage();
  await context.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  try {
    await page.goto(base + "/tools/video-studio/");
    await page.waitForSelector('[data-ready="true"]');
    const inputs = await page.evaluate(async (url) => {
      const m = await import(url);
      if (
        !(await m.canEncodeVideo("vp8", { width: 160, height: 96 })) ||
        !(await m.canEncodeAudio("opus"))
      )
        return null;
      async function source(width, height, color, sound) {
        const target = new m.BufferTarget();
        const output = new m.Output({
          format: new m.WebMOutputFormat(),
          target,
        });
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
        const picture = new m.CanvasSource(canvas, {
          codec: "vp8",
          bitrate: 250000,
        });
        output.addVideoTrack(picture, { frameRate: 30 });
        const audio = sound
          ? new m.AudioSampleSource({ codec: "opus", bitrate: 64000 })
          : null;
        if (audio) output.addAudioTrack(audio);
        await output.start();
        await Promise.all([
          (async () => {
            for (let i = 0; i < 30; i++) await picture.add(i / 30, 1 / 30);
          })(),
          audio &&
            (async () => {
              const data = Float32Array.from(
                { length: 48000 },
                (_, i) => 0.3 * Math.sin((i * Math.PI * 2 * 440) / 48000),
              );
              const sample = new m.AudioSample({
                data,
                format: "f32-planar",
                sampleRate: 48000,
                numberOfChannels: 1,
                timestamp: 0,
              });
              await audio.add(sample);
              sample.close();
            })(),
        ]);
        await output.finalize();
        return Array.from(new Uint8Array(target.buffer));
      }
      return [
        await source(160, 96, "#d64236", true),
        await source(96, 160, "#2eaa52", false),
      ];
    }, library);
    if (!inputs) {
      assert.equal(await page.locator("#video-encode").isDisabled(), true);
      console.log(
        "PASS tool loads with initial export unavailable; this browser cannot create the WebCodecs fixtures.",
      );
      if (process.env.REQUIRE_VIDEO_EXPORT)
        throw Error("Actual video export is required in this run.");
      return;
    }
    await page.setInputFiles(
      "#video-sources",
      inputs.map((file, i) => ({
        name: ["wide.webm", "tall.webm"][i],
        mimeType: "video/webm",
        buffer: Buffer.from(file),
      })),
    );
    await page.getByText("Clip 2: tall.webm", { exact: true }).waitFor();
    await page
      .locator("#video-source-list input[type=file]")
      .first()
      .setInputFiles({
        name: "captions.srt",
        mimeType: "application/x-subrip",
        buffer: Buffer.from("1\n00:00:00,000 --> 00:00:00,800\nDemo 中文\n"),
      });
    await page.getByText("1 subtitle cues", { exact: true }).waitFor();
    await page
      .locator("#video-clips .video-item")
      .last()
      .getByRole("button", { name: "Move earlier", exact: true })
      .click();
    await page
      .locator("#video-clips .video-item")
      .first()
      .getByLabel("Clip end (seconds)", { exact: true })
      .first()
      .fill("0.5");
    const waitSrt = page.waitForEvent("download");
    await page.click("#video-srt");
    const srt = await fs.readFile(await (await waitSrt).path(), "utf8");
    assert.match(srt, /00:00:00,500 --> 00:00:01,300\nDemo 中文/);
    await page.check("#video-burn");
    await page.waitForFunction(() =>
      [...document.querySelector("#video-format").options].some(
        (o) => o.value === "webm",
      ),
    );
    await page.selectOption("#video-format", "webm");
    await page.click("#video-encode");
    await page.click("#cancel-job");
    await page.waitForFunction(() =>
      document.querySelector("#tool-status").textContent.includes("Cancelled"),
    );
    await page.click("#video-encode");
    const link = page.locator("#video-download");
    await link.waitFor({ timeout: 90000 });
    const download = page.waitForEvent("download");
    await link.click();
    const bytes = await fs.readFile(await (await download).path());
    assert.equal(bytes.subarray(0, 4).toString("hex"), "1a45dfa3");
    const parsed = await page.evaluate(
      async ({ bytes, url }) => {
        const m = await import(url);
        const input = new m.Input({
          formats: [m.WEBM],
          source: new m.BlobSource(new Blob([new Uint8Array(bytes)])),
        });
        const video = await input.getPrimaryVideoTrack(),
          audio = await input.getPrimaryAudioTrack();
        const picture = new m.VideoSampleSink(video);
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        const colors = [];
        for (const t of [0.2, 0.7]) {
          const sample = await picture.getSample(t);
          sample.draw(ctx, 0, 0);
          sample.close();
          colors.push(Array.from(ctx.getImageData(640, 280, 1, 1).data));
        }
        const pcm = new m.AudioSampleSink(audio);
        const amplitudes = [];
        for (const t of [0.18, 0.8]) {
          const sample = await pcm.getSample(t);
          const data = new Float32Array(sample.numberOfFrames);
          sample.copyTo(data, { planeIndex: 0, format: "f32-planar" });
          sample.close();
          amplitudes.push(Math.max(...data.map(Math.abs)));
        }
        let white = 0;
        const image = ctx.getImageData(0, 575, 1280, 130).data;
        for (let i = 0; i < image.length; i += 4)
          if (image[i] > 210 && image[i + 1] > 210 && image[i + 2] > 210)
            white++;
        const duration = await input.computeDuration();
        input.dispose();
        return { duration, colors, amplitudes, white };
      },
      { bytes: Array.from(bytes), url: library },
    );
    assert.ok(Math.abs(parsed.duration - 1.5) < 0.05, JSON.stringify(parsed));
    assert.ok(parsed.colors[0][1] > parsed.colors[0][0] + 40);
    assert.ok(parsed.colors[1][0] > parsed.colors[1][1] + 70);
    assert.ok(parsed.amplitudes[0] < 0.015);
    assert.ok(parsed.amplitudes[1] > 0.1);
    assert.ok(parsed.white > 150, "burned caption visible");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    console.log(
      "PASS joined video, audio/silence alignment, actual downloaded WebM and burned/sidecar subtitles, cancellation/retry, mobile width",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
