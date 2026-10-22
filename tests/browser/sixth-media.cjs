const assert = require("node:assert/strict"),
  fs = require("node:fs");
const {
  chromium,
} = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8797";
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage(),
    uploads = [],
    errors = [];
  context.on("request", (request) => {
    if (["POST", "PUT", "PATCH"].includes(request.method()))
      uploads.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await context.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.KENSEI_CONFIG={};",
    }),
  );
  await context.addInitScript(() => {
    window.__captureStreams = [];
    window.__captureAudio = [];
    window.__captureCalls = [];
    window.__captureDeny = false;
    window.__captureWait = false;
    window.__captureQRImage = null;
    const camera = async (settings, display = false) => {
      __captureCalls.push({ display, settings });
      if (__captureDeny) throw new DOMException("denied", "NotAllowedError");
      let stream;
      if (display || settings.video) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d");
        let image = null,
          counter = 0;
        if (__captureQRImage) {
          image = new Image();
          image.src = __captureQRImage;
          await image.decode();
        }
        const draw = () => {
          ctx.fillStyle = "#32203f";
          ctx.fillRect(0, 0, 640, 360);
          if (image) {
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, 640, 360);
            ctx.drawImage(image, 150, 10, 340, 340);
          } else {
            ctx.fillStyle = "#ef9bb7";
            ctx.fillRect(counter++ % 400, 40, 150, 150);
            ctx.fillStyle = "white";
            ctx.fillText("Synthetic capture " + counter, 50, 300);
          }
        };
        draw();
        const timer = setInterval(draw, 40);
        stream = canvas.captureStream(25);
        stream
          .getTracks()[0]
          .addEventListener("ended", () => clearInterval(timer));
        __captureCanvas = canvas;
      } else stream = new MediaStream();
      if (settings.audio) {
        const audio = new AudioContext(),
          destination = audio.createMediaStreamDestination(),
          oscillator = audio.createOscillator(),
          gain = audio.createGain();
        gain.gain.value = 0.08;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        await audio.resume();
        destination.stream
          .getAudioTracks()
          .forEach((track) => stream.addTrack(track));
        __captureAudio.push(audio);
      }
      __captureStreams.push(stream);
      if (__captureWait)
        await new Promise((resolve) => {
          window.__captureResolve = resolve;
        });
      return stream;
    };
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: (settings) => camera(settings, true),
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: (settings) => camera(settings),
    });
  });
  const pass = (text) => console.log("PASS " + text);
  const open = async (slug) => {
    await page.goto(base + "/tools/" + slug + "/");
    await page.waitForSelector('[data-ready="true"]');
  };
  const download = async (action) => {
    const result = page.waitForEvent("download");
    await action();
    const file = await result;
    return {
      name: file.suggestedFilename(),
      bytes: fs.readFileSync(await file.path()),
    };
  };
  const allStopped = () =>
    page.evaluate(() =>
      __captureStreams
        .flatMap((stream) => stream.getTracks())
        .every((track) => track.readyState === "ended"),
    );
  try {
    await open("screen-recorder");
    assert.equal(await page.evaluate(() => __captureCalls.length), 0);
    assert.equal(await page.isChecked("#screen-microphone"), false);
    assert.equal(await page.isChecked("#screen-shared-audio"), false);
    await page.click("#screen-start");
    await page.waitForFunction(
      () => !document.querySelector("#screen-stop").disabled,
    );
    await page.waitForTimeout(1200);
    await page.click("#screen-pause");
    await page.waitForTimeout(200);
    assert.equal(await page.textContent("#screen-pause"), "Resume");
    await page.click("#screen-pause");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.isDisabled("#screen-stop"), false);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(300);
    await page.click("#screen-stop");
    await page.waitForFunction(
      () => !document.querySelector("#screen-download").disabled,
    );
    const screen = await download(() => page.click("#screen-download"));
    assert.ok(screen.bytes.length > 1000);
    assert.match(screen.name, /\.(webm|mp4)$/);
    assert.equal(await allStopped(), true);
    assert.equal(
      await page.evaluate(() => {
        let prompted = false;
        const e = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      }),
      false,
    );
    pass(
      "real canvas MediaRecorder video download, native format, pause/resume, background continuity and track release",
    );
    await page.click("#screen-discard");
    await page.check("#screen-microphone");
    await page.check("#screen-shared-audio");
    await page.click("#screen-start");
    await page.waitForFunction(
      () => !document.querySelector("#screen-stop").disabled,
    );
    await page.waitForTimeout(1200);
    assert.match(
      await page.textContent("#screen-specs"),
      /Shared audio on.*Microphone on/,
    );
    await page.evaluate(() => {
      const track = __captureStreams
        .findLast((stream) => stream.getVideoTracks().length)
        .getVideoTracks()[0];
      track.stop();
      track.dispatchEvent(new Event("ended"));
    });
    await page.waitForFunction(
      () => !document.querySelector("#screen-download").disabled,
    );
    assert.equal(await allStopped(), true);
    assert.equal(
      await page.evaluate(() => {
        const e = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      }),
      true,
    );
    await page.click("#screen-discard");
    await page.evaluate(() => {
      __captureDeny = true;
    });
    await page.click("#screen-start");
    await page.waitForFunction(() =>
      document
        .querySelector("#screen-status")
        .textContent.includes("Permission"),
    );
    assert.equal(await page.isDisabled("#screen-start"), false);
    await page.evaluate(() => {
      __captureDeny = false;
    });
    pass(
      "shared/microphone audio mixing, native source ending, unsaved warning, permission rejection/retry",
    );

    await open("audio-studio");
    assert.equal(await page.evaluate(() => __captureCalls.length), 0);
    await page.click("#audio-record-start");
    await page.waitForFunction(
      () => !document.querySelector("#audio-record-stop").disabled,
    );
    await page.waitForTimeout(1300);
    await page.click("#audio-record-pause");
    assert.equal(await page.textContent("#audio-record-pause"), "Resume");
    await page.click("#audio-record-pause");
    await page.waitForTimeout(600);
    await page.click("#audio-record-stop");
    await page.waitForFunction(
      () =>
        document
          .querySelector("#tool-status")
          .textContent.includes("Audio ready"),
      null,
      { timeout: 30000 },
    );
    assert.equal(await allStopped(), true);
    assert.ok(Number(await page.inputValue("#audio-end")) > 1);
    assert.match(await page.textContent("#audio-info"), /recording-/);
    await page.selectOption("#audio-format", "wav");
    const audio = await download(() => page.click("#audio-export"));
    assert.equal(audio.bytes.subarray(0, 4).toString(), "RIFF");
    assert.ok(audio.bytes.length > 1000);
    pass(
      "real microphone stream recording, pause/resume, WebM metadata fallback, decode/waveform and WAV export",
    );
    await page.evaluate(() => {
      __captureDeny = true;
    });
    await page.click("#audio-record-start");
    await page.waitForFunction(() =>
      document
        .querySelector("#audio-record-status")
        .textContent.includes("Permission"),
    );
    assert.equal(await page.isDisabled("#audio-file"), false);
    pass("microphone denial leaves existing audio editor usable");

    await open("qr-studio");
    await page.fill(
      "#qr-content",
      "https://kensei-workshop.vercel.app/?test=%E4%B8%AD%E6%96%87",
    );
    await page.click("#qr-generate");
    await page.waitForFunction(
      () => !document.querySelector("#qr-png").disabled,
    );
    const qr = await download(() => page.click("#qr-png"));
    await page.click("#qr-scan-tab");
    await page.setInputFiles("#qr-scan-file", {
      name: "中文.png",
      mimeType: "image/png",
      buffer: qr.bytes,
    });
    await page.waitForFunction(() =>
      document
        .querySelector("#qr-scan-result")
        .value.startsWith("https://kensei"),
    );
    assert.equal(await page.isVisible("#qr-scan-open"), true);
    assert.equal(await page.evaluate(() => __captureCalls.length), 0);
    await page.evaluate(
      (image) => {
        __captureQRImage = image;
      },
      "data:image/png;base64," + qr.bytes.toString("base64"),
    );
    await page.click("#qr-camera-start");
    await page.waitForFunction(() =>
      document
        .querySelector("#qr-scan-status")
        .textContent.startsWith("QR code read"),
    );
    await page.waitForFunction(
      () =>
        __captureStreams.length > 0 &&
        __captureStreams.every((stream) =>
          stream.getTracks().every((track) => track.readyState === "ended"),
        ),
    );
    pass(
      "QR generated PNG roundtrip, Chinese URL content, real camera-video frame scanning and automatic release",
    );
    await page.click("#qr-generate-tab");
    await page.selectOption("#qr-type", "text");
    await page.fill("#qr-content", "javascript:alert('<script>')");
    await page.click("#qr-generate");
    await page.waitForTimeout(150);
    const unsafe = await download(() => page.click("#qr-png"));
    await page.click("#qr-scan-tab");
    await page.setInputFiles("#qr-scan-file", {
      name: "plain.png",
      mimeType: "image/png",
      buffer: unsafe.bytes,
    });
    await page.waitForFunction(() =>
      document.querySelector("#qr-scan-result").value.startsWith("javascript:"),
    );
    assert.equal(await page.isVisible("#qr-scan-open"), false);
    assert.equal(
      await page.locator("#qr-scan-open").getAttribute("href"),
      null,
    );
    await page.evaluate(() => {
      __captureQRImage = null;
    });
    await page.click("#qr-camera-start");
    await page.waitForFunction(
      () => document.querySelector("#qr-camera-video").srcObject !== null,
    );
    await page.click("#qr-generate-tab");
    assert.equal(await allStopped(), true);
    pass(
      "QR hostile payload is plain text with no open action; switching panels stops camera",
    );
    await page.click("#qr-scan-tab");
    await page.click("#qr-camera-start");
    await page.waitForFunction(
      () => document.querySelector("#qr-camera-video").srcObject !== null,
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await allStopped(), true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
    });
    pass("QR camera stops while hidden");
    for (const [slug, start, text] of [
      ["screen-recorder", "#screen-start", "screen"],
      ["audio-studio", "#audio-record-start", "microphone"],
    ]) {
      await open(slug);
      await page.evaluate(() => {
        __captureWait = true;
      });
      await page.click(start);
      await page.waitForFunction(() => typeof __captureResolve === "function");
      await page.evaluate(() => {
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: true }),
        );
        __captureResolve();
      });
      await page.waitForFunction(() =>
        __captureStreams.every((stream) =>
          stream.getTracks().every((track) => track.readyState === "ended"),
        ),
      );
      pass(`late ${text} permission grant after pagehide releases every track`);
    }
    await open("qr-studio");
    await page.click("#qr-scan-tab");
    await page.evaluate(() => {
      __captureWait = true;
    });
    await page.click("#qr-camera-start");
    await page.waitForFunction(() => typeof __captureResolve === "function");
    await page.click("#qr-camera-stop");
    await page.evaluate(() => __captureResolve());
    await page.waitForFunction(() =>
      __captureStreams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === "ended"),
      ),
    );
    pass("cancelled QR permission request releases late-granted camera");
    for (const slug of ["screen-recorder", "audio-studio", "qr-studio"]) {
      await open(slug);
      for (const width of [360, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${slug}: ${width}px overflow`,
        );
        if (process.env.CAPTURE_SIXTH) {
          fs.mkdirSync("_qa/sixth-release", { recursive: true });
          await page.screenshot({
            path: `_qa/sixth-release/${slug}-${width}.png`,
            fullPage: true,
          });
        }
      }
    }
    assert.deepEqual(uploads, []);
    assert.deepEqual(errors, []);
    pass(
      "three media tools at 360/768/1440 without overflow; zero file upload requests and page errors",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
