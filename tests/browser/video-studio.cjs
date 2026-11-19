const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const library = "/vendor/mediabunny-video-1.66.1.mjs";
const container = process.env.WORKSHOP_VIDEO_FORMAT || "webm";

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
      await page.setViewportSize({ width: 320, height: 820 });
      if (process.env.REQUIRE_VIDEO_EXPORT)
        throw Error("Actual video export is required in this run.");
      await page
        .locator("#video-sources")
        .setInputFiles(
          path.join(__dirname, "../support/fixtures/video-timeline.mp4"),
        );
      await page.locator("#video-lane .video-track-clip").waitFor();
      await page.locator("#video-source-list input[type=file]").setInputFiles({
        name: "fixture.srt",
        mimeType: "application/x-subrip",
        buffer: Buffer.from("1\n00:00:00,000 --> 00:00:00,800\n字幕\n"),
      });
      await page.getByText("1 subtitle cues", { exact: true }).waitFor();
      await page.locator("#video-next-frame").click();
      await page.locator("#video-split").click();
      assert.equal(
        await page.locator("#video-lane .video-track-clip").count(),
        2,
      );
      const result = page.waitForEvent("download");
      await page.locator("#video-srt").click();
      assert.match(
        await fs.readFile(await (await result).path(), "utf8"),
        /字幕/,
      );
      console.log(
        "PASS video import, frame stepping, splitting and subtitle download without WebCodecs fixture encoding.",
      );
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
    const cards = page.locator("#video-clips .video-item");
    await cards
      .last()
      .getByText("Clip 2: tall.webm", { exact: true })
      .waitFor();
    await page
      .locator("#video-source-list input[type=file]")
      .first()
      .setInputFiles({
        name: "captions.srt",
        mimeType: "application/x-subrip",
        buffer: Buffer.from("1\n00:00:00,000 --> 00:00:00,800\nDemo 中文\n"),
      });
    await page.getByText("1 subtitle cues", { exact: true }).waitFor();
    const position = () =>
      page.locator("#video-ruler").getAttribute("aria-valuenow").then(Number);
    const color = async (expected) =>
      page.waitForFunction((wanted) => {
        const video = document.querySelector(".video-stage video[data-front]");
        if (!video || video.readyState < 2) return false;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, 1, 1);
        const [r, g] = ctx.getImageData(0, 0, 1, 1).data;
        return wanted === "green" ? g > r + 40 : r > g + 60;
      }, expected);
    const ruler = page.locator("#video-ruler");
    await ruler.scrollIntoViewIfNeeded();
    const rect = await ruler.boundingBox();
    await page.mouse.move(rect.x + rect.width * 0.25, rect.y + 20);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.75, rect.y + 20);
    await page.mouse.move(rect.x + rect.width * 0.25, rect.y + 20);
    await page.mouse.up();
    await color("red");
    await page
      .locator("#video-caption")
      .getByText("Demo 中文", { exact: true })
      .waitFor();
    assert.equal(await position(), 15);
    const fullFrames = await ruler.getAttribute("aria-valuemax");
    await page.locator("#video-play").click();
    await color("green");
    await page.waitForFunction(
      (frames) =>
        document.querySelector("#video-ruler").getAttribute("aria-valuenow") ===
        frames,
      fullFrames,
    );
    await color("green");
    await page.waitForFunction(
      () => document.querySelector("#video-stop").disabled,
    );

    const blocks = page.locator("#video-lane .video-track-clip");
    const body = blocks.last().locator(".video-clip-body");
    await body.scrollIntoViewIfNeeded();
    const start = await body.boundingBox(),
      first = await blocks.first().boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + 25);
    await page.mouse.down();
    await page.mouse.move(first.x + 8, first.y + 25, { steps: 5 });
    await page.mouse.up();
    await cards
      .first()
      .getByText("Clip 1: tall.webm", { exact: true })
      .waitFor();
    const trim = blocks.first().locator(".video-trim").first();
    await trim.scrollIntoViewIfNeeded();
    const edge = await trim.boundingBox();
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 20);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 + 25, edge.y + 20, {
      steps: 4,
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(
      await cards.first().getByLabel("Clip start (seconds)").inputValue(),
      "0",
    );
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 20);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 + 25, edge.y + 20, {
      steps: 4,
    });
    await page.mouse.up();
    assert.ok(
      Number(
        await cards.first().getByLabel("Clip start (seconds)").inputValue(),
      ) > 0,
    );
    const leftInput = cards.first().getByLabel("Clip start (seconds)");
    await leftInput.fill("0");
    await leftInput.press("Enter");
    const right = blocks.first().locator(".video-trim").last();
    await right.scrollIntoViewIfNeeded();
    const rightEdge = await right.boundingBox();
    await page.mouse.move(rightEdge.x + rightEdge.width / 2, rightEdge.y + 20);
    await page.mouse.down();
    await page.mouse.move(
      rightEdge.x + rightEdge.width / 2 - (await ruler.boundingBox()).width / 4,
      rightEdge.y + 20,
      { steps: 5 },
    );
    await page.mouse.up();
    assert.equal(
      await cards.first().getByLabel("Clip end (seconds)").inputValue(),
      "0.5",
    );
    await ruler.focus();
    await ruler.press("Home");
    for (let i = 0; i < 30; i++) await ruler.press("ArrowRight");
    assert.equal(await position(), 30);
    const trimmedFrames = Number(await ruler.getAttribute("aria-valuemax"));
    await page.locator("#video-split").click();
    assert.equal(await blocks.count(), 3);
    assert.equal(
      Number(await ruler.getAttribute("aria-valuemax")),
      trimmedFrames,
    );
    const waitSrt = page.waitForEvent("download");
    await page.click("#video-srt");
    const srt = await fs.readFile(await (await waitSrt).path(), "utf8");
    assert.match(srt, /00:00:00,500 --> 00:00:01,000\nDemo 中文/);
    assert.match(srt, /00:00:01,000 --> 00:00:01,300\nDemo 中文/);
    await page.check("#video-burn");
    await page.waitForFunction(
      (selected) =>
        [...document.querySelector("#video-format").options].some(
          (o) => o.value === selected,
        ),
      container,
    );
    await page.selectOption("#video-format", container);
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
    if (container === "mp4")
      assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
    else assert.equal(bytes.subarray(0, 4).toString("hex"), "1a45dfa3");
    const parsed = await page.evaluate(
      async ({ bytes, url, container }) => {
        const m = await import(url);
        const input = new m.Input({
          formats: [container === "mp4" ? m.MP4 : m.WEBM],
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
      { bytes: Array.from(bytes), url: library, container },
    );
    assert.ok(
      Math.abs(parsed.duration - trimmedFrames / 30) < 0.06,
      JSON.stringify(parsed),
    );
    assert.ok(parsed.colors[0][1] > parsed.colors[0][0] + 40);
    assert.ok(parsed.colors[1][0] > parsed.colors[1][1] + 70);
    assert.ok(parsed.amplitudes[0] < 0.015);
    assert.ok(parsed.amplitudes[1] > 0.1);
    assert.ok(parsed.white > 150, "burned caption visible");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    await cards.first().locator(".video-clip-summary").click();
    const invalid = cards
      .first()
      .getByLabel("Clip start (seconds)", { exact: true });
    await invalid.fill("1");
    await invalid.press("Enter");
    assert.equal(await invalid.getAttribute("aria-invalid"), "true");
    assert.equal(await link.isVisible(), true);
    await invalid.press("Escape");
    await page.locator("#video-duplicate").click();
    assert.equal(await blocks.count(), 4);
    await ruler.press(process.platform === "darwin" ? "Meta+c" : "Control+c");
    await ruler.press("ArrowRight");
    await ruler.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
    assert.equal(await blocks.count(), 6);
    assert.equal(
      Number(await ruler.getAttribute("aria-valuemax")),
      trimmedFrames + 30,
    );
    assert.equal(await link.isVisible(), false);
    const newSidecar = page.waitForEvent("download");
    await page.locator("#video-vtt").click();
    assert.match(
      await fs.readFile(await (await newSidecar).path(), "utf8"),
      /00:00:01\.500 --> 00:00:02\.000/,
    );
    await page.locator("#video-encode").click();
    await link.waitFor({ timeout: 90000 });
    const edited = page.waitForEvent("download");
    await link.click();
    const newBytes = await fs.readFile(await (await edited).path());
    if (process.env.WORKSHOP_VIDEO_OUTPUT)
      await fs.writeFile(process.env.WORKSHOP_VIDEO_OUTPUT, newBytes);
    const editedDuration = await page.evaluate(
      async ({ bytes, url, container }) => {
        const m = await import(url);
        const input = new m.Input({
          formats: [container === "mp4" ? m.MP4 : m.WEBM],
          source: new m.BlobSource(new Blob([new Uint8Array(bytes)])),
        });
        try {
          return await input.computeDuration();
        } finally {
          input.dispose();
        }
      },
      { bytes: [...newBytes], url: library, container },
    );
    assert.ok(Math.abs(editedDuration - (trimmedFrames + 30) / 30) < 0.06);
    for (let i = 6; i < 12; i++) await page.locator("#video-duplicate").click();
    await page.locator("#video-duplicate").click();
    assert.equal(await blocks.count(), 12);
    await page
      .getByText("Keep between one and twelve video clips.", { exact: true })
      .first()
      .waitFor();
    // The incoming files, position and selection stay on this editor instance.
    await page.evaluate(() => window.KenseiI18n.setLocale("zh-Hant"));
    await page
      .getByRole("button", { name: "在時間針處分割", exact: true })
      .waitFor();
    assert.equal(await blocks.count(), 12);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    if (
      !process.env.WORKSHOP_BROWSER_ENGINE ||
      process.env.WORKSHOP_BROWSER_ENGINE === "chromium"
    ) {
      const mobile = await browser.newContext({
        viewport: { width: 320, height: 740 },
        hasTouch: true,
        isMobile: true,
      });
      try {
        await mobile.route("**/config.js", (route) =>
          route.fulfill({
            contentType: "text/javascript",
            body: "window.KENSEI_CONFIG={};",
          }),
        );
        const phone = await mobile.newPage();
        await phone.goto(base + "/zh-hant/tools/video-studio/");
        await phone.waitForSelector('[data-ready="true"]');
        await phone
          .locator("#video-sources")
          .setInputFiles(
            path.join(__dirname, "../support/fixtures/video-timeline.mp4"),
          );
        await phone.locator("#video-lane .video-track-clip").waitFor();
        const needle = phone.getByRole("slider", { name: "時間針" });
        await needle.tap({ position: { x: 60, y: 22 } });
        assert.ok(Number(await needle.getAttribute("aria-valuenow")) > 0);
        await phone.getByRole("button", { name: "放大", exact: true }).tap();
        const trim = phone.getByRole("button", { name: "調整片段起點" });
        await trim.scrollIntoViewIfNeeded();
        const box = await trim.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44);
        const touch = await mobile.newCDPSession(phone);
        const x = Math.round(box.x + box.width / 2),
          y = Math.round(box.y + box.height / 2);
        const gesture = async (end) => {
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y }],
          });
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: x + 58, y }],
          });
          await touch.send("Input.dispatchTouchEvent", {
            type: end,
            touchPoints: [],
          });
        };
        await gesture("touchCancel");
        const start = phone.locator('#video-clips [data-edge="start"]');
        assert.equal(await start.inputValue(), "0");
        await gesture("touchEnd");
        assert.ok(Number(await start.inputValue()) > 0);
        assert.equal(
          await phone.evaluate(() => document.documentElement.scrollWidth),
          320,
        );
        console.log(
          "PASS 320px Traditional Chinese touch scrubbing, zoom, trim and pointer cancellation",
        );
      } finally {
        await mobile.close();
      }
    }
    console.log(
      "PASS real-time scrubbing, cross-clip playback, cancelled and committed trims, reorder, split, duplicate/paste, caption/audio sync and real " +
        container +
        " output",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
