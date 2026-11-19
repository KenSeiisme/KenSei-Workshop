const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const { saveBrowserFailure } = require("../support/browser-artifacts.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8797";
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
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
    window.__captureWaitFor = null;
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
      if (
        __captureWait ||
        __captureWaitFor === (display ? "screen" : "microphone")
      )
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
  async function captureLocale() {
    const before = await page.evaluate(() =>
      __captureStreams.map((s) =>
        s.getTracks().map((t) => [t.id, t.readyState]),
      ),
    );
    await page.evaluate(() => KenseiI18n.setLocale("zh-Hant"));
    assert.deepEqual(
      await page.evaluate(() =>
        __captureStreams.map((s) =>
          s.getTracks().map((t) => [t.id, t.readyState]),
        ),
      ),
      before,
    );
    await page.evaluate(() => KenseiI18n.setLocale("en"));
  }
  try {
    await open("screen-recorder");
    assert.equal(await page.evaluate(() => __captureCalls.length), 0);
    assert.equal(await page.isChecked("#screen-microphone"), false);
    assert.equal(await page.isChecked("#screen-shared-audio"), false);
    assert.equal(await page.inputValue("#screen-resolution"), "1080");
    await page.selectOption("#screen-resolution", "1440");
    await page.selectOption("#screen-fps", "60");
    await page.selectOption("#screen-quality", "high");
    await page.click("#screen-start");
    await page.waitForFunction(
      () => !document.querySelector("#screen-stop").disabled,
    );
    assert.deepEqual(
      await page.evaluate(() => __captureCalls[0].settings.video),
      {
        width: { ideal: 2560, max: 2560 },
        height: { ideal: 1440, max: 1440 },
        frameRate: { ideal: 60, max: 60 },
      },
    );
    assert.match(
      await page.textContent("#screen-specs"),
      /Requested 2560 × 1440 at 60 fps.*640 × 360/,
    );
    await page.waitForTimeout(1200);
    await captureLocale();
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
    await page.waitForFunction(() =>
      /Recorded file: 640 × 360 · [0-9.]+ fps average/.test(
        document.querySelector("#screen-specs").textContent,
      ),
    );
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
    const subtitleWindow = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Subtitle Studio", exact: true })
      .click();
    const subtitle = await subtitleWindow;
    await subtitle.waitForFunction(() => {
      const video = document.querySelector("#sub-video");
      return (
        video?.readyState >= 1 && video.src.startsWith("blob:") && video.paused
      );
    });
    assert.doesNotMatch(subtitle.url(), /handoff=/);
    await subtitle.close();
    pass(
      "recording passed to Subtitle Studio, validated and ready for manual playback",
    );
    await page.click("#screen-discard");
    await page.check("#screen-microphone");
    await page.check("#screen-shared-audio");
    await page.click("#screen-start");
    await page.waitForFunction(
      () => !document.querySelector("#screen-stop").disabled,
    );
    await page.waitForTimeout(1200);
    await captureLocale();
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
    const priorVideo = page.locator("#screen-result"),
      priorUrl = await priorVideo.getAttribute("src");
    const preservesVideo = async () => {
      assert.equal(await priorVideo.isVisible(), true);
      assert.equal(await priorVideo.getAttribute("src"), priorUrl);
      assert.equal(await page.isDisabled("#screen-download"), false);
      assert.equal(await allStopped(), true);
    };
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
    await preservesVideo();
    pass(
      "shared/microphone audio mixing, native source ending, and a denied retry keep the finished video",
    );

    const cancelCapture = page.locator("#screen-cancel");
    await page.uncheck("#screen-microphone");
    await page.uncheck("#screen-shared-audio");
    await page.evaluate(() => {
      __captureWaitFor = "screen";
    });
    await page.click("#screen-start");
    await page.waitForFunction(() =>
      document
        .querySelector("#screen-status")
        .textContent.includes("Still waiting for a screen"),
    );
    assert.equal(await cancelCapture.textContent(), "Cancel capture");
    await captureLocale();
    await page.evaluate(() => {
      window.__previousScreenRequest = {
        resolve: __captureResolve,
        stream: __captureStreams.at(-1),
      };
      __captureWaitFor = null;
      __captureResolve = null;
    });
    await cancelCapture.click();
    assert.equal(await page.isDisabled("#screen-start"), false);
    await page.click("#screen-start");
    await page.getByRole("button", { name: "Cancel countdown" }).waitFor();
    await page.evaluate(() => __previousScreenRequest.resolve());
    await page.waitForFunction(() =>
      __previousScreenRequest.stream
        .getTracks()
        .every((track) => track.readyState === "ended"),
    );
    assert.equal(
      await page.evaluate(
        () => __captureStreams.at(-1).getVideoTracks()[0].readyState,
      ),
      "live",
    );
    await cancelCapture.click();
    await preservesVideo();

    await page.check("#screen-microphone");
    await page.evaluate(() => {
      __captureWaitFor = "microphone";
    });
    for (const shouldCancel of [true, false]) {
      await page.evaluate(() => {
        __captureResolve = null;
      });
      await page.click("#screen-start");
      await page.waitForFunction(() => typeof __captureResolve === "function");
      assert.match(
        await page.textContent("#screen-status"),
        /Allow microphone/,
      );
      if (shouldCancel) await cancelCapture.click();
      else
        await page.evaluate(() => {
          const screenTrack = __captureStreams.at(-2).getVideoTracks()[0];
          screenTrack.stop();
          screenTrack.dispatchEvent(new Event("ended"));
        });
      assert.equal(await page.isDisabled("#screen-start"), false);
      assert.equal(
        await page.evaluate(
          () => __captureStreams.at(-2).getVideoTracks()[0].readyState,
        ),
        "ended",
      );
      await page.evaluate(() => __captureResolve());
      await page.waitForFunction(() =>
        __captureStreams
          .at(-1)
          .getAudioTracks()
          .every((track) => track.readyState === "ended"),
      );
      await preservesVideo();
    }
    await page.uncheck("#screen-microphone");
    await page.evaluate(() => {
      __captureWaitFor = null;
      window.__startRecorder = MediaRecorder.prototype.start;
      MediaRecorder.prototype.start = function () {
        MediaRecorder.prototype.start = __startRecorder;
        throw Error("Recorder start failed");
      };
    });
    await page.click("#screen-start");
    await page.waitForFunction(() =>
      document
        .querySelector("#screen-status")
        .textContent.includes("Recorder start failed"),
    );
    await preservesVideo();
    assert.ok(
      await priorVideo.evaluate(async (video) => {
        await video.play();
        const playable = video.readyState >= 2 && !video.paused;
        video.pause();
        return playable;
      }),
    );
    const saved = await download(() => page.click("#screen-download"));
    assert.ok(saved.bytes.length > 1000);
    assert.deepEqual(
      saved.bytes,
      Buffer.from(
        await page.evaluate(
          async (url) => [
            ...new Uint8Array(await (await fetch(url)).arrayBuffer()),
          ],
          priorUrl,
        ),
      ),
    );
    pass(
      "screen and microphone waits, late grants, source ending and recorder failure preserve the playable download",
    );

    await open("audio-studio");
    assert.equal(await page.evaluate(() => __captureCalls.length), 0);
    await page.click("#audio-record-start");
    await page.waitForFunction(
      () => !document.querySelector("#audio-record-stop").disabled,
    );
    await page.waitForTimeout(1300);
    await captureLocale();
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
    const originalRecording = await page.getAttribute(
      "#audio-record-preview",
      "src",
    );
    await page.evaluate(() => {
      __captureDeny = true;
    });
    await page.click("#audio-record-start");
    await page.waitForFunction(() =>
      document
        .querySelector("#audio-record-status")
        .textContent.includes("browser app in system settings"),
    );
    assert.equal(await page.isDisabled("#audio-file"), false);
    assert.equal(
      await page.getAttribute("#audio-record-preview", "src"),
      originalRecording,
    );
    pass(
      "microphone denial explains site and system settings and keeps the recording",
    );

    await page.evaluate(() => {
      __captureDeny = false;
      __captureWait = true;
    });
    await page.click("#audio-record-start");
    await page.waitForFunction(() =>
      document
        .querySelector("#audio-record-status")
        .textContent.includes("Still waiting for microphone access"),
    );
    await captureLocale();
    await page.evaluate(() => {
      window.__cancelledMicrophone = {
        resolve: __captureResolve,
        stream: __captureStreams.at(-1),
      };
      __captureResolve = null;
    });
    await page.click("#audio-record-cancel");
    assert.equal(await page.isVisible("#audio-record-cancel"), false);
    assert.equal(await page.isDisabled("#audio-file"), false);
    assert.equal(
      await page.getAttribute("#audio-record-preview", "src"),
      originalRecording,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "audio-record-start",
    );

    await page.click("#audio-record-start");
    await page.waitForFunction(() => typeof __captureResolve === "function");
    await page.evaluate(() => {
      window.__nativeAudioContext = window.AudioContext;
      window.AudioContext = class extends window.AudioContext {
        get state() {
          return "suspended";
        }
        resume() {
          return new Promise(() => {});
        }
      };
      __captureResolve();
    });
    await page.waitForSelector("#audio-record-stop:enabled", { timeout: 5000 });
    await page.evaluate(() => {
      window.AudioContext = __nativeAudioContext;
      __cancelledMicrophone.resolve();
    });
    await page.waitForFunction(() =>
      __cancelledMicrophone.stream
        .getTracks()
        .every((track) => track.readyState === "ended"),
    );
    assert.equal(await page.isDisabled("#audio-record-stop"), false);
    await page.waitForTimeout(850);
    await page.click("#audio-record-stop");
    await page.waitForFunction(() =>
      document
        .querySelector("#audio-record-status")
        .textContent.includes("Recording ready in the editor"),
    );
    assert.equal(await allStopped(), true);
    pass(
      "unanswered microphone request is cancellable; late grants are released and a suspended meter never blocks retry",
    );

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
    assert.equal(
      await page.textContent("#qr-camera-stop"),
      "Cancel camera request",
    );
    await page.evaluate(() => KenseiI18n.setLocale("zh-Hant"));
    assert.equal(await page.textContent("#qr-camera-stop"), "取消相機請求");
    await page.evaluate(() => KenseiI18n.setLocale("en"));
    await page.click("#qr-camera-stop");
    await page.evaluate(() => __captureResolve());
    await page.waitForFunction(() =>
      __captureStreams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === "ended"),
      ),
    );
    await page.evaluate(() => {
      __captureWait = false;
      __captureDeny = true;
    });
    await page.click("#qr-camera-start");
    await page.waitForFunction(() =>
      document
        .querySelector("#qr-scan-status")
        .textContent.includes("system settings"),
    );
    assert.equal(await page.isDisabled("#qr-scan-file"), false);
    pass(
      "QR camera cancellation, late grant cleanup, localized guidance and image fallback",
    );
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
  } catch (error) {
    await saveBrowserFailure(context, "sixth-media");
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
