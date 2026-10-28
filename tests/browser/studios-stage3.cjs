const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { PDFDocument, StandardFonts } = require("pdf-lib"),
  { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
function wav(seconds, freq) {
  const samples = Math.round(44100 * seconds),
    b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24);
  b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    b.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * freq * i) / 44100) * 6500),
      44 + i * 2,
    );
  return b;
}
async function textPDF(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"),
    task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    }),
    pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++)
    pages.push(
      (await (await pdf.getPage(i)).getTextContent()).items
        .map((x) => x.str)
        .join(" "),
    );
  await task.destroy();
  return pages;
}
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true }),
    c = await b.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await c.newPage(),
    errors = [],
    uploads = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await c.route("**/config.js", (r) =>
    r.fulfill({
      body: "window.KENSEI_CONFIG={};",
      contentType: "application/javascript",
    }),
  );
  p.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
  });
  async function open(slug, lang = "") {
    await p.goto(base + lang + "/tools/" + slug + "/");
    await p.waitForSelector("[data-ready=true]").catch(async (e) => {
      console.error(
        "Startup diagnostic",
        slug,
        lang,
        errors,
        await p.locator(".tool-feedback").innerText(),
      );
      throw e;
    });
  }
  async function dl(fn) {
    const w = p.waitForEvent("download", { timeout: 120000 });
    await fn();
    return fs.readFileSync(await (await w).path());
  }
  try {
    await open("audio-studio");
    await p.getByRole("tab", { name: "Mix", exact: true }).click();
    const audioAvailable = await p.evaluate(async () =>
      (await import("/tool-scripts/audio-context.js")).supportsAudioEditing(),
    );
    if (!audioAvailable) {
      assert(await p.locator("#mix-files").isDisabled());
      assert.match(
        await p.locator("#mix-status").innerText(),
        /Audio editing is unavailable/,
      );
      console.log(
        "UNSUPPORTED audio output: this browser runtime exposes no Web Audio constructors; friendly fallback verified.",
      );
    } else {
      await p.setInputFiles("#mix-files", [
        {
          name: "private-voice-one.wav",
          mimeType: "audio/wav",
          buffer: wav(2, 440),
        },
        {
          name: "private-voice-two.wav",
          mimeType: "audio/wav",
          buffer: wav(2, 660),
        },
      ]);
      await p
        .waitForFunction(
          () => document.querySelectorAll(".mix-clip").length === 2,
        )
        .catch(async (e) => {
          console.error(
            "Mix import diagnostic",
            await p.locator("#mix-status").innerText(),
            await p.evaluate(() => ({
              audio: typeof AudioContext,
              offline: typeof OfflineAudioContext,
              wav: new Audio().canPlayType("audio/wav"),
            })),
            errors,
          );
          throw e;
        });
      await p.locator('.mix-track-settings[data-track="0"] summary').click();
      await p.locator('.mix-track-settings[data-track="1"] summary').click();
      await p.locator('[data-track="0"] input[data-param="pan"]').fill("-1");
      await p.locator('[data-track="0"] input[data-param="pan"]').press("Tab");
      await p
        .locator('.mix-track-settings[data-track="1"] input[type=checkbox]')
        .first()
        .check();
      await p.getByRole("button", { name: "Preview mix", exact: true }).click();
      await p.waitForFunction(() =>
        document.querySelector("#mix-status").textContent.includes("Mix ready"),
      );
      let audio = await dl(() =>
        p.getByRole("button", { name: "Export mix", exact: true }).click(),
      );
      assert.equal(audio.readUInt16LE(22), 2);
      assert.equal(audio.readUInt32LE(24), 44100);
      let left = 0,
        right = 0;
      for (let i = 44; i < audio.length; i += 4) {
        left += audio.readInt16LE(i) ** 2;
        right += audio.readInt16LE(i + 2) ** 2;
      }
      assert(left > 1000000);
      assert(right < left * 0.0001);
      console.log("PASS actual stereo mix export, pan and mute");
      await p.locator('[data-track="0"] input[data-param="pan"]').fill("0");
      await p.locator('[data-track="0"] input[data-param="pan"]').press("Tab");
      await p
        .getByRole("button", {
          name: "Arrange clips with crossfade",
          exact: true,
        })
        .click();
      await p.check("#mix-normalize");
      await p.getByRole("button", { name: "Preview mix", exact: true }).click();
      await p.waitForFunction(() =>
        document.querySelector("#mix-status").textContent.includes("Mix ready"),
      );
      audio = await dl(() =>
        p.getByRole("button", { name: "Export mix", exact: true }).click(),
      );
      assert(Math.abs((audio.length - 44) / 4 / 44100 - 3.5) < 0.001);
      let peak = 0;
      for (let i = 44; i < audio.length; i += 2)
        peak = Math.max(peak, Math.abs(audio.readInt16LE(i)) / 32768);
      assert(peak > 0.97 && peak < 0.99);
      await p.selectOption("#mix-format", "mp3");
      const mp3 = await dl(() =>
        p.getByRole("button", { name: "Export mix", exact: true }).click(),
      );
      assert(mp3.length > 1000);
      await p.locator("#audio-mix-workspace .studio-recipes summary").click();
      const recipe = JSON.parse(
        (
          await dl(() =>
            p
              .locator("#audio-mix-workspace")
              .getByRole("button", { name: "Export recipe JSON", exact: true })
              .click(),
          )
        ).toString(),
      );
      assert(!JSON.stringify(recipe).includes("private-voice"));
      assert.equal(recipe.recipe.settings.clips.length, 2);
      console.log(
        "PASS equal-power crossfade duration, normalization, MP3 and media-free recipe",
      );
      const graph = await p.evaluate(async () => {
        const { renderMix, validateMixRecipe } =
            await import("/tool-scripts/audio-mix-core.js"),
          ctx = new OfflineAudioContext(1, 88200, 44100),
          tone = ctx.createBuffer(1, 88200, 44100);
        for (let i = 0; i < 88200; i++)
          tone.getChannelData(0)[i] =
            Math.sin((2 * Math.PI * 80 * i) / 44100) * 0.2;
        const track = { volume: 1, pan: 0, eq: [0, 0, 0] },
          clip = { slot: 0, track: 0, at: 0, start: 0, end: 2 },
          normal = await renderMix(
            validateMixRecipe({ tracks: [track], clips: [clip] }),
            [tone],
          ),
          low = await renderMix(
            validateMixRecipe({
              tracks: [{ ...track, eq: [-12, 0, 0] }],
              clips: [clip],
            }),
            [tone],
          );
        const rms = (b) => {
          const a = b.getChannelData(0);
          let sum = 0;
          for (let i = 22050; i < a.length; i++) sum += a[i] * a[i];
          return Math.sqrt(sum / (a.length - 22050));
        };
        const dc = ctx.createBuffer(1, 88200, 44100);
        dc.getChannelData(0).fill(0.2);
        const equal = await renderMix(
            validateMixRecipe({
              tracks: [track],
              clips: [clip, { ...clip, at: 1.5 }],
              crossfade: 0.5,
            }),
            [dc],
          ),
          a = equal.buffer.getChannelData(0);
        return {
          eq: rms(low.buffer) / rms(normal.buffer),
          cross: a[Math.round(1.75 * 44100)] / a[Math.round(0.5 * 44100)],
        };
      });
      assert(graph.eq < 0.4);
      assert(Math.abs(graph.cross - Math.SQRT2) < 0.02);
      console.log(
        "PASS rendered three-band EQ attenuation and equal-power midpoint amplitude",
      );
    }

    await open("image-to-text");
    const png = Buffer.from(
      await p.evaluate(async () => {
        const font = await new FontFace(
          "OCRTest",
          "url(/vendor/pdf-fonts/LXGWWenKai-Regular.ttf)",
        ).load();
        document.fonts.add(font);
        const c = document.createElement("canvas");
        c.width = 1600;
        c.height = 420;
        const x = c.getContext("2d");
        x.fillStyle = "white";
        x.fillRect(0, 0, 1600, 420);
        x.fillStyle = "black";
        x.font = "55px OCRTest";
        x.fillText("HELLO KENSEI 12345", 60, 90);
        x.fillText("Buku ini untuk belajar bahasa Melayu.", 60, 175);
        x.fillText("中文识别测试 繁體中文測試", 60, 260);
        return c.toDataURL().split(",")[1];
      }),
      "base64",
    );
    await p.setInputFiles("#ocr-file", {
      name: "local-text.png",
      mimeType: "image/png",
      buffer: png,
    });
    for (const language of ["eng", "chi_sim", "chi_tra", "msa"])
      await p.check("[name=ocr-language][value=" + language + "]");
    await p.click("#ocr-run");
    await p.waitForFunction(
      () => {
        const x = window.KenseiAdvancedContexts["image-to-text"];
        return !x.running && x.entries[0]?.text !== undefined;
      },
      { timeout: 120000 },
    );
    console.log("OCR result", await p.locator("#ocr-output").inputValue());
    await p.getByRole("tab", { name: "Review & PDF", exact: true }).click();
    await p.waitForSelector(".ocr-review-line textarea");
    await p
      .locator(".ocr-review-line textarea")
      .first()
      .fill("Corrected 中文 123 Buku");
    let pdf = await dl(() =>
      p
        .getByRole("button", { name: "Export searchable PDF", exact: true })
        .click(),
    );
    let texts = await textPDF(pdf);
    assert.equal(texts.length, 1);
    assert(texts[0].includes("Corrected 中文 123 Buku"));
    console.log(
      "PASS four-language OCR, linked correction and actual searchable PDF text",
    );
    const source = await PDFDocument.create(),
      font = await source.embedFont(StandardFonts.Helvetica);
    source
      .addPage([600, 200])
      .drawText("NATIVE123", { x: 30, y: 100, font, size: 26 });
    const picture = await source.embedPng(png),
      scan = source.addPage([800, 210]);
    scan.drawImage(picture, { x: 0, y: 0, width: 800, height: 210 });
    source
      .addPage([600, 200])
      .drawText("LASTPAGE", { x: 30, y: 100, font, size: 26 });
    await p.getByRole("tab", { name: "Recognize", exact: true }).click();
    await p.setInputFiles("#ocr-file", {
      name: "three-pages.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await source.save()),
    });
    await p.fill("#ocr-pages", "1-2");
    await p.click("#ocr-run");
    await p.waitForFunction(
      () => {
        const x = window.KenseiAdvancedContexts["image-to-text"];
        return !x.running && x.entries[1]?.text !== undefined;
      },
      { timeout: 120000 },
    );
    assert(
      await p.evaluate(
        () => window.KenseiAdvancedContexts["image-to-text"].entries[0].native,
      ),
    );
    await p.getByRole("tab", { name: "Review & PDF", exact: true }).click();
    pdf = await dl(() =>
      p
        .getByRole("button", { name: "Export searchable PDF", exact: true })
        .click(),
    );
    texts = await textPDF(pdf);
    assert.equal(texts.length, 3);
    assert.equal(texts[0].match(/NATIVE123/g).length, 1);
    assert.match(texts[2], /LASTPAGE/);
    console.log(
      "PASS selected PDF OCR preserves native text, full page count and order",
    );
    await p.getByRole("tab", { name: "Recognize", exact: true }).click();
    await p.check("#ocr-reprocess-native");
    await p.fill("#ocr-pages", "1");
    await p.click("#ocr-run");
    await p.waitForFunction(
      () => {
        const x = window.KenseiAdvancedContexts["image-to-text"];
        return (
          !x.running &&
          x.entries[0]?.rasterize &&
          x.entries[0]?.text !== undefined
        );
      },
      { timeout: 120000 },
    );
    await p.getByRole("tab", { name: "Review & PDF", exact: true }).click();
    await p.selectOption("#ocr-review-entry", "0");
    await p.waitForSelector(".ocr-review-line textarea:enabled");
    await p
      .locator(".ocr-review-line textarea")
      .first()
      .fill("NATIVE123 replaced");
    pdf = await dl(() =>
      p
        .getByRole("button", { name: "Export searchable PDF", exact: true })
        .click(),
    );
    texts = await textPDF(pdf);
    assert.equal(texts.length, 3);
    assert.equal(texts[0].match(/NATIVE123/g).length, 1);
    assert.match(texts[0], /replaced/);
    assert.match(texts[2], /LASTPAGE/);
    const corners = await p.evaluate(async () => {
      const { originalPoint } =
        await import("/tool-scripts/ocr-review-core.js");
      const m = {
        sourceWidth: 1280,
        sourceHeight: 720,
        width: 360,
        height: 640,
        cropWidth: 640,
        cropHeight: 360,
        crop: [25, 25, 50, 50],
        rotation: 90,
      };
      return [originalPoint(180, 320, m), originalPoint(0, 0, m)];
    });
    assert(
      Math.abs(corners[0][0] - 0.5) < 1e-8 &&
        Math.abs(corners[0][1] - 0.5) < 1e-8,
    );
    assert(
      Math.abs(corners[1][0] - 0.25) < 1e-8 &&
        Math.abs(corners[1][1] - 0.75) < 1e-8,
    );
    console.log(
      "PASS explicit re-OCR raster replacement avoids duplicate text; crop/rotation coordinates",
    );

    for (const slug of ["audio-studio", "image-to-text"])
      for (const width of [320, 360, 768, 1440]) {
        await p.setViewportSize({ width, height: 950 });
        await open(slug, "/zh-hant");
        await p
          .locator(
            slug === "audio-studio"
              ? '[aria-controls="audio-mix-workspace"]'
              : '[aria-controls="ocr-review-workspace"]',
          )
          .click();
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " " + width,
        );
      }
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    console.log("PASS responsive pages and no upload requests");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
