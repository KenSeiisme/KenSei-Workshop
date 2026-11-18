const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";

// 真實 OfflineAudioContext 渲染音訊圖；只替代硬體輸出及權限恢復時機。
function offlineOutput() {
  const Audio = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  window.__audioCreated = 0;
  window.__audioStarts = 0;
  window.__audioRendererAvailable = !!Audio;
  if (!Audio) {
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
    return;
  }
  window.AudioContext = function () {
    const ctx = new Audio(1, 44100 * 2, 44100);
    window.__offline = ctx;
    window.__audioCreated++;
    let state = "suspended";
    return new Proxy(ctx, {
      get(target, key) {
        if (key === "state") return state;
        if (key === "resume")
          return async () => {
            if (window.__blockAudio) throw Error("Blocked by test browser");
            if (window.__holdAudio)
              await new Promise((resolve) => (window.__resumeAudio = resolve));
            state = "running";
          };
        if (key === "suspend")
          return async () => {
            state = "suspended";
          };
        if (key === "createOscillator")
          return () => {
            const oscillator = ctx.createOscillator();
            const start = oscillator.start.bind(oscillator);
            oscillator.start = (...args) => {
              window.__audioStarts++;
              start(...args);
            };
            return oscillator;
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 320, height: 740 },
      hasTouch: true,
    });
    await context.addInitScript(offlineOutput);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const load = async () => {
      await page.goto(base + "/friends/");
      await page.locator("[data-open-notices]:not([hidden])").waitFor();
    };
    await load();
    assert.equal(
      await page.evaluate(() => window.__audioCreated),
      0,
      "No audio on page load",
    );
    const measured = [];
    const renderSupported = await page.evaluate(
      () => window.__audioRendererAvailable,
    );
    let burst = null;
    if (renderSupported) {
      for (const volume of [0, 25, 50, 75, 100]) {
        await load();
        const sample = await page.evaluate(async (value) => {
          window.KenseiNoticeSettings.set(value);
          const result = await window.KenseiNoticeSettings.preview("reward");
          if (!window.__offline) new window.AudioContext();
          const buffer = await window.__offline.startRendering();
          const data = buffer.getChannelData(0);
          let energy = 0,
            peak = 0,
            delta = 0;
          for (let i = 0; i < data.length; i++) {
            energy += data[i] ** 2;
            peak = Math.max(peak, Math.abs(data[i]));
            if (i) delta = Math.max(delta, Math.abs(data[i] - data[i - 1]));
          }
          return {
            volume: value,
            rms: Math.sqrt(energy / data.length),
            peak,
            delta,
            ok: result.ok,
          };
        }, volume);
        measured.push(sample);
      }
      assert.equal(measured[0].peak, 0);
      for (let i = 1; i < measured.length; i++) {
        assert(
          measured[i].rms > measured[i - 1].rms * 1.25,
          "Actual rendered loudness must increase",
        );
        assert(
          measured[i].peak < 0.98 && measured[i].delta < 0.08,
          "No clipping or sharp discontinuities",
        );
      }
      assert(measured.at(-1).peak > 0.12, "100% must have usable output");
      await load();
      burst = await page.evaluate(async () => {
        window.KenseiNoticeSettings.set(100);
        for (let i = 0; i < 15; i++)
          await window.KenseiNoticeSettings.preview("reward");
        const samples = (
          await window.__offline.startRendering()
        ).getChannelData(0);
        return Math.max(...samples.map(Math.abs));
      });
      assert(burst < 0.98, "Repeated previews must replace the previous cue");

      await load();
      await page.evaluate(() => {
        window.__holdAudio = true;
        window.__preview = window.KenseiNoticeSettings.preview();
      });
      await page.waitForFunction(() => !!window.__resumeAudio);
      assert.equal(
        await page.evaluate(() => window.__audioStarts),
        0,
        "Wait for audio resume before playing",
      );
      await page.evaluate(async () => {
        window.__holdAudio = false;
        window.__resumeAudio();
        return window.__preview;
      });
      assert.equal(
        await page.evaluate(() => window.__audioStarts),
        2,
        "First preview plays once after resume",
      );

      await load();
      await page.evaluate(() => {
        window.__blockAudio = true;
      });
      await page.locator("[data-open-notices]").click();
      await page.locator(".notice-settings summary").click();
      await page.locator("[data-test-notice-sound]").click();
      await page
        .getByText("Sound could not start. Tap Test sound to retry.", {
          exact: true,
        })
        .waitFor();
      await page.evaluate(() => {
        window.__blockAudio = false;
      });
      await page.locator("[data-test-notice-sound]").click();
      await page.getByText("Playing test sound.", { exact: true }).waitFor();
    } else {
      console.log(
        "LIMITATION: this Playwright WebKit build has no OfflineAudioContext; waveform checks are unavailable. Testing native unsupported-audio feedback and all volume controls.",
      );
      await page.locator("[data-open-notices]").click();
      await page.locator(".notice-settings summary").click();
      await page.locator("[data-test-notice-sound]").click();
      await page
        .getByText("This browser does not support notification sound.", {
          exact: true,
        })
        .waitFor();
    }
    const slider = page.locator("[data-notice-volume]");
    await page.evaluate(() => window.KenseiNoticeSettings.set(25));
    const savedBeforeGesture = await page.evaluate(() =>
      localStorage.getItem("kensei-notice-volume-v1"),
    );
    await slider.evaluate((input) => {
      input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      input.value = "90";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(
      await page.evaluate(() => window.KenseiNoticeSettings.volume),
      90,
      "Input updates actual audio before release",
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("kensei-notice-volume-v1"),
      ),
      savedBeforeGesture,
      "Draft is not saved per pixel",
    );
    const second = await context.newPage();
    await second.goto(base + "/friends/");
    await second.waitForFunction(() => !!window.KenseiNoticeSettings);
    await second.evaluate(() => window.KenseiNoticeSettings.set(40));
    await page.bringToFront();
    assert.equal(
      await slider.inputValue(),
      "90",
      "Cross-tab settings cannot interrupt a drag",
    );
    await slider.dispatchEvent("change");
    await second.waitForFunction(
      () => window.KenseiNoticeSettings.volume === 90,
    );
    await second.close();
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("kensei-notice-volume-v1"),
      ),
      "90",
    );
    const bounds = await slider.boundingBox();
    const persistedBeforePointer = await page.evaluate(() => {
      window.__volumeWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "kensei-notice-volume-v1") window.__volumeWrites++;
        return original.call(this, key, value);
      };
      return localStorage.getItem("kensei-notice-volume-v1");
    });
    await page.mouse.move(
      bounds.x + bounds.width * 0.4,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * 0.75,
      bounds.y + bounds.height / 2,
      { steps: 5 },
    );
    const duringDrag = await page.evaluate(
      () => window.KenseiNoticeSettings.volume,
    );
    assert(
      duringDrag >= 65 && duringDrag <= 85,
      "Real pointer drag updates audio before release",
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("kensei-notice-volume-v1"),
      ),
      persistedBeforePointer,
    );
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.__volumeWrites),
      1,
      "One persistent write per completed gesture",
    );
    await page.touchscreen.tap(
      bounds.x + bounds.width * 0.55,
      bounds.y + bounds.height / 2,
    );
    assert.equal(
      await slider.inputValue(),
      String(await page.evaluate(() => window.KenseiNoticeSettings.volume)),
      "Touch position, label and audio stay aligned",
    );
    assert(
      bounds.width >= 150 && bounds.height >= 44,
      "Slider fills usable width and has a 44px target",
    );
    await slider.focus();
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() => window.KenseiNoticeSettings.volume),
      0,
    );
    await page.keyboard.press("End");
    assert.equal(
      await page.evaluate(() => window.KenseiNoticeSettings.volume),
      100,
    );
    await page.evaluate(() => {
      window.__volumeWrites = 0;
    });
    for (let i = 0; i < 5; i++) await page.keyboard.down("ArrowLeft");
    assert.equal(
      await page.evaluate(() => window.__volumeWrites),
      0,
      "Held keyboard adjustments stay in draft",
    );
    assert.equal(
      await page.evaluate(() => window.KenseiNoticeSettings.volume),
      95,
    );
    await page.keyboard.up("ArrowLeft");
    assert.equal(
      await page.evaluate(() => window.__volumeWrites),
      1,
      "Key release commits one final volume",
    );
    await page.keyboard.press("End");
    await page.locator("[data-mute-notices]").click();
    await load();
    await page.locator("[data-open-notices]").click();
    await page.locator(".notice-settings summary").click();
    assert.equal(await slider.inputValue(), "0");
    await page.locator("[data-mute-notices]").click();
    assert.equal(
      await slider.inputValue(),
      "100",
      "Unmute restores last nonzero volume after reload",
    );
    await page.locator("[data-test-notice-sound]").click();
    await page
      .getByText(
        renderSupported
          ? "Playing test sound."
          : "This browser does not support notification sound.",
        { exact: true },
      )
      .waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
    const out = path.resolve(
      process.env.ACCEPTANCE_OUTPUT ||
        (process.env.WORKSHOP_BROWSER_ARTIFACTS
          ? path.join(process.env.WORKSHOP_BROWSER_ARTIFACTS, "notice-audio")
          : "_qa/notice-audio"),
    );
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(
      path.join(
        out,
        "rendered-" +
          (process.env.WORKSHOP_BROWSER_ENGINE || "chromium") +
          ".json",
      ),
      JSON.stringify({ renderSupported, measured, burstPeak: burst }, null, 2),
    );
    await page.screenshot({
      path: path.join(
        out,
        "slider-" +
          (process.env.WORKSHOP_BROWSER_ENGINE || "chromium") +
          ".png",
      ),
    });
    console.log(
      renderSupported
        ? "PASS notice audio: real rendered levels, peaks, first-resume, blocked retry, immediate slider, cross-tab gesture, keyboard and mute persistence"
        : "PASS notice controls and unsupported-audio feedback (waveform render not available in this engine)",
      measured,
    );
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
