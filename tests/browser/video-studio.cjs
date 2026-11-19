const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const library = "/vendor/mediabunny-video-1.66.1.mjs";
const container = process.env.WORKSHOP_VIDEO_FORMAT || "webm";

function tone(name, hz, seconds = 1.5) {
  const rate = 48000,
    samples = Math.round(rate * seconds);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
      Math.round(9000 * Math.sin((2 * Math.PI * i * hz) / rate)),
      44 + i * 2,
    );
  return { name, mimeType: "audio/wav", buffer: wav };
}
async function verifyMix(page, inputs) {
  await page.goto(base + "/tools/video-studio/");
  await page.waitForSelector('[data-ready="true"]');
  await page.setInputFiles(
    "#video-sources",
    inputs.map((bytes, i) => ({
      name: i ? "silent.webm" : "original.webm",
      mimeType: "video/webm",
      buffer: Buffer.from(bytes),
    })),
  );
  const videoLane = page.locator("#video-lane .video-track-clip");
  await videoLane.last().waitFor();
  assert.equal(await videoLane.count(), 2);
  await page
    .locator("#video-audio-files")
    .setInputFiles([tone("music.wav", 800), tone("voice.wav", 1200)]);
  const first = page.locator("#video-audio-lane-1 [data-audio-clip]");
  const second = page.locator("#video-audio-lane-2 [data-audio-clip]");
  await first.waitFor();
  await second.waitFor();
  await page.locator("#video-selected-audio-track").selectOption("1");
  await page
    .getByText("Clips on the same audio track cannot overlap.", { exact: true })
    .waitFor();
  assert.equal(await second.count(), 1);
  await page.getByLabel("Position (seconds)", { exact: true }).fill("0.3");
  await page.getByLabel("Position (seconds)", { exact: true }).press("Tab");
  assert.equal(
    await page.getByLabel("Position (seconds)", { exact: true }).inputValue(),
    "0.3",
  );
  await first.locator(".video-clip-body").focus();
  await first.locator(".video-clip-body").press("Enter");
  const setEnd = page
    .locator("#video-audio-properties")
    .getByLabel("Clip end (seconds)", { exact: true });
  await setEnd.fill("0.1");
  await setEnd.press("Tab");
  const snapRuler = page.locator("#video-ruler");
  await snapRuler.press("Home");
  for (let i = 0; i < 9; i++) await snapRuler.press("ArrowRight");
  const voice = second.locator(".video-grip");
  await voice.scrollIntoViewIfNeeded();
  const from = await voice.boundingBox(),
    to = await page.locator("#video-audio-lane-1").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, {
    steps: 4,
  });
  assert.equal(await page.locator("#video-snap-line").isVisible(), true);
  await page.mouse.up();
  assert.equal(await first.count(), 2);
  await page.locator("#video-undo").click();
  assert.equal(await second.count(), 1);
  await page.locator("#video-undo").click();
  await page.getByLabel("Clip volume (%)", { exact: true }).fill("50");
  await page.getByLabel("Clip volume (%)", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  assert.equal(
    await page.getByLabel("Clip volume (%)", { exact: true }).inputValue(),
    "100",
  );
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  assert.equal(
    await page.getByLabel("Clip volume (%)", { exact: true }).inputValue(),
    "50",
  );
  const mixer = page.locator("#video-track-mixer");
  await page.getByText("Track mixer", { exact: true }).click();
  await mixer
    .getByRole("button", { name: "Mute Audio 2", exact: true })
    .last()
    .click();
  assert.equal(
    await mixer
      .getByRole("button", { name: "Unmute Audio 2", exact: true })
      .count(),
    1,
  );
  await page.locator("#video-undo").click();
  await page.locator("#video-monitor-mute").click();
  assert.equal(
    await page.locator("#video-monitor-mute").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#video-play").click();
  const ruler = page.locator("#video-ruler");
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector("#video-ruler").getAttribute("aria-valuenow"),
      ) > 15,
  );
  await page.locator("#video-play").click();
  await ruler.press("Home");
  for (let i = 0; i < 15; i++) await ruler.press("ArrowRight");
  await ruler.press("s");
  assert.equal(await first.count(), 2);
  await ruler.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  assert.equal(await first.count(), 1);
  await page.waitForFunction(
    (selected) =>
      [...document.querySelector("#video-format").options].some(
        (o) => o.value === selected,
      ),
    container,
  );
  await page.selectOption("#video-format", container);
  await page.locator("#video-encode").click();
  const link = page.locator("#video-download");
  await link.waitFor({ timeout: 90000 }).catch(async (error) => {
    throw Error(
      (await page.locator("#job-status").count())
        ? await page.locator("#job-status").innerText()
        : await page.locator(".video-export").innerText(),
      { cause: error },
    );
  });
  const download = page.waitForEvent("download");
  await link.click();
  const data = await fs.readFile(await (await download).path());
  if (process.env.WORKSHOP_MIX_OUTPUT)
    await fs.writeFile(process.env.WORKSHOP_MIX_OUTPUT, data);
  const levels = await page.evaluate(
    async ({ data, url, container }) => {
      const m = await import(url);
      const input = new m.Input({
        formats: [container === "mp4" ? m.MP4 : m.WEBM],
        source: new m.BlobSource(new Blob([Uint8Array.from(data)])),
      });
      try {
        const audio = await input.getPrimaryAudioTrack();
        const powers = [0, 0, 0],
          pitches = [440, 800, 1200];
        const sink = new m.AudioSampleSink(audio);
        const sums = pitches.map(() => [0, 0]);
        let count = 0;
        for await (const sample of sink.samples(0.42, 0.62)) {
          try {
            const out = new Float32Array(sample.numberOfFrames);
            sample.copyTo(out, { planeIndex: 0, format: "f32-planar" });
            for (let i = 0; i < out.length; i++) {
              const t = sample.timestamp + i / sample.sampleRate;
              if (t < 0.42 || t >= 0.62) continue;
              for (const [j, hz] of pitches.entries()) {
                const a = 2 * Math.PI * t * hz;
                sums[j][0] += out[i] * Math.sin(a);
                sums[j][1] += out[i] * Math.cos(a);
              }
              count++;
            }
          } finally {
            sample.close();
          }
        }
        for (const [i, [s, c]] of sums.entries())
          powers[i] = (2 * Math.hypot(s, c)) / count;
        return { powers, duration: await input.computeDuration() };
      } finally {
        input.dispose();
      }
    },
    { data: [...data], url: library, container },
  );
  assert.ok(
    levels.duration > 1.95 && levels.duration < 2.1,
    JSON.stringify(levels),
  );
  assert.ok(
    levels.powers[0] > 0.07 &&
      levels.powers[1] > 0.035 &&
      levels.powers[2] > 0.07,
    JSON.stringify(levels),
  );
  assert.ok(
    levels.powers[2] / levels.powers[1] > 1.75 &&
      levels.powers[2] / levels.powers[1] < 2.25,
    JSON.stringify(levels),
  );
  await videoLane.last().locator(".video-clip-body").press("Enter");
  const trim = page
    .locator("#video-clips [data-selected]")
    .getByLabel("Clip end (seconds)", { exact: true });
  await trim.fill("0.2");
  await trim.press("Tab");
  await page.locator("#video-video-end").waitFor();
  await second.locator(".video-clip-body").press("Enter");
  await page
    .getByText("Audio beyond the video end will be left out of export.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByLabel("Position (seconds)", { exact: true }).inputValue(),
    "0.3",
  );
  await page.locator("#video-undo").click();
  assert.equal(await page.locator("#video-video-end").isVisible(), false);
  await page.locator("#video-audio-files").setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("invalid"),
  });
  await page
    .getByText("Could not decode broken.wav.", { exact: true })
    .first()
    .waitFor();
  assert.equal(await second.count(), 1);
  console.log(
    "PASS two overlapping audio tracks, collision rejection, gain, undo/redo, icon controls and three measured tones in " +
      container,
  );
}

async function verifyCustomTracks(page, inputs) {
  await page.goto(base + "/tools/video-studio/");
  await page.waitForSelector('[data-ready="true"]');
  await page.setInputFiles(
    "#video-sources",
    inputs.map((bytes, i) => ({
      name: i ? "foreground.webm" : "background.webm",
      mimeType: "video/webm",
      buffer: Buffer.from(bytes),
    })),
  );
  const baseClips = page.locator("#video-lane .video-track-clip");
  await baseClips.nth(1).locator(".video-clip-body").press("Enter");
  await page.locator("#video-delete").click();
  await baseClips.first().locator(".video-clip-body").press("Enter");
  const end = page
    .locator("#video-clips [data-selected]")
    .getByLabel("Clip end (seconds)", { exact: true });
  await end.fill("1");
  await end.press("Enter");
  const ruler = page.locator("#video-ruler");
  await ruler.press("Home");
  await page.locator("#video-track-controls summary").click();
  const management = page.locator("#video-track-management");
  await management
    .getByRole("button", { name: "Add video layer", exact: true })
    .click();
  await page.locator("[data-add-overlay]").last().click();
  const overlays = page.locator("#video-video-lane-v1 .video-track-clip");
  await overlays.waitFor();
  await page.locator('video[data-layer="v1"][data-front]').waitFor();
  const width = await page
    .locator('video[data-layer="v1"][data-front]')
    .evaluate((v) => v.style.width);
  assert.equal(width, "31%");
  const handle = page.locator(".video-layer-outline");
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  const x = box.x + box.width / 4,
    y = box.y + box.height / 4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 36, y - 16, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      parseFloat(document.querySelector(".video-layer-outline").style.left) <
      64,
  );
  const moved = page
    .locator("#video-audio-properties")
    .getByLabel("Horizontal position (%)");
  assert.ok(Number(await moved.inputValue()) < 64);
  await page.locator("#video-undo").click();
  assert.equal(await moved.inputValue(), "65");
  await page
    .locator("#video-audio-properties")
    .getByLabel("Full frame")
    .check();
  await page.waitForFunction(
    () =>
      document.querySelector('video[data-layer="v1"][data-front]').style
        .width === "100%",
  );
  await page.locator("#video-undo").click();
  await management
    .getByRole("button", { name: "Add audio track", exact: true })
    .click();
  await page.locator("#video-audio-lane-3").waitFor();
  await page.locator('[data-track-command="3-remove"]').click();
  assert.equal(await page.locator("#video-audio-lane-3").count(), 0);
  await page.locator("#video-undo").click();
  await page.locator("#video-audio-lane-3").waitFor();
  const subtitles = () =>
    management.getByRole("button", { name: "Add subtitle track", exact: true });
  await subtitles().click();
  await subtitles().click();
  const importers = management.getByLabel("Import SRT or VTT");
  for (let i = 0; i < 2; i++) {
    await importers.nth(i).setInputFiles({
      name: "layer.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:00,900\n" +
          (i ? "雙語字幕" : "English captions") +
          "\n",
      ),
    });
    await page
      .locator("#video-captions-lane-s" + (i + 1) + " .video-track-clip")
      .waitFor();
  }
  await page.locator(".video-preview-captions summary").click();
  await page
    .locator("#video-caption-preview-options select")
    .nth(0)
    .selectOption("s1");
  await page
    .locator("#video-caption-preview-options select")
    .nth(1)
    .selectOption("s2");
  await ruler.press("Home");
  await page.waitForFunction(
    () =>
      document.querySelector("#video-caption").textContent ===
      "English captions\n雙語字幕",
  );
  await page.selectOption("#video-caption-download", "s2");
  const vtt = page.waitForEvent("download");
  await page.locator("#video-vtt").click();
  assert.match(await fs.readFile(await (await vtt).path(), "utf8"), /雙語字幕/);
  await page.locator("#video-burn").check();
  await page
    .locator("#video-caption-export-options select")
    .nth(0)
    .selectOption("s1");
  await page
    .locator("#video-caption-export-options select")
    .nth(1)
    .selectOption("s2");
  await ruler.press("Home");
  await ruler.press("ArrowRight");
  assert.equal(Number(await ruler.getAttribute("aria-valuenow")), 1);
  await page.selectOption("#video-fps", "60");
  assert.equal(Number(await ruler.getAttribute("aria-valuenow")), 1);
  await ruler.press("ArrowRight");
  assert.equal(Number(await ruler.getAttribute("aria-valuenow")), 1.5);
  const wanted = process.env.WORKSHOP_VIDEO_RESOLUTION || "720";
  await page.selectOption("#video-resolution", wanted);
  await page.waitForFunction(
    () =>
      document.querySelector("#video-availability").textContent !==
      "Checking video encoders…",
  );
  const available = await page
    .locator("#video-format option")
    .evaluateAll((opts) => opts.map((o) => o.value));
  if (!available.includes(container)) {
    assert.ok(
      !process.env.REQUIRE_VIDEO_EXPORT,
      [container, wanted, available].join(" "),
    );
    console.log(
      "PASS layered editing and bilingual subtitles; " +
        wanted +
        "p60 " +
        container +
        " unavailable in this browser",
    );
    return;
  }
  await page.selectOption("#video-format", container);
  await page.locator("#video-encode").click();
  const link = page.locator("#video-download");
  await link.waitFor({ timeout: 90000 }).catch(async (error) => {
    throw Error(
      (await page.locator("#job-status").count())
        ? await page.locator("#job-status").innerText()
        : await page.locator(".video-export").innerText(),
      { cause: error },
    );
  });
  const output = page.waitForEvent("download");
  await link.click();
  const data = await fs.readFile(await (await output).path());
  if (process.env.WORKSHOP_LAYERED_OUTPUT)
    await fs.writeFile(process.env.WORKSHOP_LAYERED_OUTPUT, data);
  const check = await page.evaluate(
    async ({ bytes, url }) => {
      const m = await import(url);
      const input = new m.Input({
        formats: [m.MP4, m.WEBM],
        source: new m.BufferSource(new Uint8Array(bytes)),
      });
      try {
        const video = await input.getPrimaryVideoTrack();
        const stats = await video.computePacketStats();
        const width = await video.getDisplayWidth(),
          height = await video.getDisplayHeight();
        const sample = await new m.VideoSampleSink(video).getSample(0.4);
        if (!sample) throw Error("No decoded layered frame");
        const canvas = new OffscreenCanvas(width, height),
          ctx = canvas.getContext("2d");
        sample.draw(ctx, 0, 0, width, height);
        sample.close();
        const pixel = (x, y) =>
          Array.from(
            ctx.getImageData(
              Math.floor(x * width),
              Math.floor(y * height),
              1,
              1,
            ).data,
          );
        const brightBetween = (top, bottom) => {
          const rgba = ctx.getImageData(
            0,
            Math.floor(top * height),
            width,
            Math.floor((bottom - top) * height),
          ).data;
          let total = 0;
          for (let i = 0; i < rgba.length; i += 4)
            if (rgba[i] > 225 && rgba[i + 1] > 225 && rgba[i + 2] > 225)
              total++;
          return total;
        };
        return {
          width,
          height,
          frames: stats.packetCount,
          rate: stats.averagePacketRate,
          upper: brightBetween(0.04, 0.22),
          lower: brightBetween(0.78, 0.96),
          base: pixel(0.25, 0.4),
          overlay: pixel(0.805, 0.8),
        };
      } finally {
        input.dispose();
      }
    },
    { bytes: [...data], url: library },
  );
  assert.equal(check.height, +wanted, JSON.stringify(check));
  assert.equal(check.frames, 60, JSON.stringify(check));
  assert.ok(check.upper > 50 && check.lower > 50, JSON.stringify(check));
  assert.ok(check.rate > 59.8 && check.rate < 60.2, JSON.stringify(check));
  assert.ok(
    check.base[0] > check.base[1] + 60 &&
      check.overlay[1] > check.overlay[0] + 40,
    JSON.stringify(check),
  );
  console.log(
    "PASS configurable tracks, PiP, bilingual subtitles, stable 30/60 switching and real " +
      wanted +
      "p60 " +
      container +
      " export",
  );
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 920 },
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
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Import video", exact: true })
      .click();
    assert.equal(
      await (await (await chooser).element()).getAttribute("id"),
      "video-sources",
    );
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
      await page
        .locator(".video-sources-panel")
        .evaluate((el) => (el.open = true));
      await page.locator("#video-source-list input[type=file]").setInputFiles({
        name: "fixture.srt",
        mimeType: "application/x-subrip",
        buffer: Buffer.from("1\n00:00:00,000 --> 00:00:00,800\n字幕\n"),
      });
      await page.getByText("1 subtitle cues", { exact: true }).waitFor();
      await page
        .locator("#video-audio-files")
        .setInputFiles([tone("music.wav", 800), tone("voice.wav", 1200)]);
      await page.locator("#video-audio-lane-1 [data-audio-clip]").waitFor();
      await page.locator("#video-audio-lane-2 [data-audio-clip]").waitFor();
      await page.locator('[data-video-lane="0"]').click();
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
      () =>
        document.querySelector("#video-play").getAttribute("aria-label") ===
        "Play preview",
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
    await cards
      .first()
      .getByRole("button", { name: "Move clip later", exact: true })
      .press("Enter");
    await cards
      .last()
      .getByRole("button", { name: "Move clip earlier", exact: true })
      .press("Enter");
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
    await page.locator(".video-export").evaluate((el) => (el.open = true));
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
    await link.waitFor({ timeout: 90000 }).catch(async (error) => {
      throw Error(
        (await page.locator("#job-status").count())
          ? await page.locator("#job-status").innerText()
          : await page.locator(".video-export").innerText(),
        { cause: error },
      );
    });
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
      1280,
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
    assert.equal(await link.isVisible(), true);
    assert.equal(
      await page.locator("#video-result-previous").isVisible(),
      true,
    );
    const newSidecar = page.waitForEvent("download");
    await page.locator("#video-vtt").click();
    assert.match(
      await fs.readFile(await (await newSidecar).path(), "utf8"),
      /00:00:01\.500 --> 00:00:02\.000/,
    );
    await page.locator("#video-encode").click();
    await link.waitFor({ timeout: 90000 }).catch(async (error) => {
      throw Error(
        (await page.locator("#job-status").count())
          ? await page.locator("#job-status").innerText()
          : await page.locator(".video-export").innerText(),
        { cause: error },
      );
    });
    await page
      .locator("#video-result-previous")
      .waitFor({ state: "hidden", timeout: 90000 });
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
      1280,
    );
    await verifyMix(page, inputs);
    await verifyCustomTracks(page, inputs);
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
        assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
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
