const assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const { chromium } = require("../support/browser.cjs");
const { gameClick, openSettings } = require("../support/game-shell.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";
const sdk = `export function createClient(){return{auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},from(){return{select(){return this},order:async()=>({data:[]})}},rpc:async()=>({data:{top:[],me:null},error:null})}}`;
const diagnostics = (page) =>
  page.evaluate(async () => {
    window.__gameAudio = await import("/game-scripts/audio.js");
    return window.__gameAudio.getAudioDiagnostics();
  });
async function ready(page, slug) {
  await page.goto(base + "/games/" + slug + "/");
  try {
    await page.waitForSelector("[data-ready=true]", {
      state: "attached",
      timeout: 45000,
    });
  } catch (error) {
    console.log({
      slug,
      url: page.url(),
      body: (await page.locator("body").innerText()).slice(-700),
    });
    throw error;
  }
  await page.evaluate(async () => {
    window.__gameAudio = await import("/game-scripts/audio.js");
  });
}
async function runningAudio(page) {
  try {
    await page.waitForFunction(
      () => window.__gameAudio.getAudioDiagnostics().musicPlaying,
      null,
      { timeout: 20000 },
    );
  } catch (error) {
    console.log({ url: page.url(), audio: await diagnostics(page) });
    throw error;
  }
}
async function startGo(page) {
  await page.selectOption("#go-mode", "local");
  await page.click("#go-start");
  await page.waitForSelector("[data-go-phase=playing]");
}
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const contexts = [],
    errors = [],
    requests = [];
  async function context(legacy) {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(c);
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) => r.fulfill({ contentType: "text/javascript", body: sdk }),
    );
    await c.addInitScript(
      ({ legacy }) => {
        try {
          if (legacy && !localStorage.getItem("kensei-game-audio-v2"))
            localStorage.setItem(
              "kensei-game-audio-v1",
              JSON.stringify(legacy),
            );
        } catch {}
        window.__audioCreated = 0;
        window.__audioSamples = 0;
        window.__audioOscillators = 0;
        const Native = window.AudioContext;
        if (Native)
          window.AudioContext = class extends Native {
            constructor(...args) {
              super(...args);
              window.__audioCreated++;
              this.__gainCount = 0;
            }
            createGain() {
              const gain = super.createGain();
              if (++this.__gainCount === 1) {
                const meter = super.createAnalyser(),
                  connect = gain.connect.bind(gain);
                window.__audioMeter = meter;
                gain.connect = (to, ...rest) => {
                  if (to === this.destination) {
                    connect(meter);
                    return meter.connect(to);
                  }
                  return connect(to, ...rest);
                };
              }
              return gain;
            }
            createBufferSource() {
              const source = super.createBufferSource(),
                start = source.start.bind(source);
              source.start = (...args) => {
                window.__audioSamples++;
                return start(...args);
              };
              return source;
            }
            createOscillator() {
              const source = super.createOscillator(),
                start = source.start.bind(source);
              source.start = (...args) => {
                window.__audioOscillators++;
                return start(...args);
              };
              return source;
            }
          };
      },
      { legacy },
    );
    c.on("page", (p) => {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("dialog", (d) => d.accept());
      p.on("request", (r) => {
        if (r.url().includes("/assets/game-audio/")) requests.push(r.url());
      });
    });
    return c;
  }
  try {
    const c = await context(),
      page = await c.newPage(),
      games = JSON.parse(await fs.readFile("data/games.json"));
    await ready(page, "go");
    const nativeAudio = await page.evaluate(
      () =>
        typeof window.AudioContext === "function" ||
        typeof window.webkitAudioContext === "function",
    );
    if (!nativeAudio) {
      for (const { slug } of games) {
        await ready(page, slug);
        if (slug === "pong") continue;
        if (slug === "go") await startGo(page);
        else await gameClick(page, "#game-start");
        assert.equal((await diagnostics(page)).loadError, "unsupported");
        assert.equal((await diagnostics(page)).musicPlaying, false);
      }
      assert.deepEqual(errors, []);
      assert.equal(requests.length, 0);
      const report = {
        engine: process.env.WORKSHOP_BROWSER_ENGINE || "chromium",
        games: 13,
        startedGames: 12,
        nativeAudio: false,
        unsupportedFallback:
          "passed: silent playable games, explicit unavailable state, no asset traffic",
        actualSound:
          "not testable in this browser build; physical Safari remains pending",
      };
      await fs.writeFile(
        `_qa/game-audio/browser-${report.engine}.json`,
        JSON.stringify(report, null, 2),
      );
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    for (const { slug } of games) {
      const count = requests.length;
      await ready(page, slug);
      await page.waitForTimeout(80);
      assert.equal(
        await page.evaluate(() => window.__audioCreated),
        0,
        slug + " load must not create audio",
      );
      assert.equal(requests.length, count, slug + " load must not fetch music");
      if (slug === "pong") continue;
      if (slug === "go") await startGo(page);
      else await gameClick(page, "#game-start");
      await runningAudio(page);
      const d = await diagnostics(page);
      assert.ok(
        d.decodedBytes > 0 && d.decodedBytes <= 32 * 1024 * 1024,
        slug + JSON.stringify(d),
      );
      assert.ok(d.fetchedBytes <= 2 * 1024 * 1024, slug + JSON.stringify(d));
      assert.equal(d.volume, 0.35);
      assert.equal(d.musicVolume, 0.12);
      assert.deepEqual(d.failed, []);
    }
    await ready(page, "go");
    await startGo(page);
    await runningAudio(page);
    await page.locator("#game-board").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(350);
    assert.ok(
      await page.evaluate(() => window.__audioSamples > 1),
      "real decoded samples must play",
    );
    const rms = await page.evaluate(() => {
      const a = window.__audioMeter,
        b = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(b);
      return Math.sqrt(b.reduce((n, x) => n + x * x, 0) / b.length);
    });
    assert.ok(
      rms > 0.000001,
      "the real Web Audio graph must contain nonzero output",
    );
    await page.click("#go-pause");
    assert.equal((await diagnostics(page)).musicPlaying, false);
    const offset = (await diagnostics(page)).musicOffset;
    assert.ok(offset > 0);
    await page.click("#go-pause");
    await runningAudio(page);
    assert.ok((await diagnostics(page)).musicOffset >= offset);
    const before = await page.locator("#go-turn").textContent();
    await openSettings(page);
    await page.locator("[data-music-toggle]").uncheck();
    assert.equal((await diagnostics(page)).musicPlaying, false);
    await page.locator("[data-music-toggle]").check();
    await runningAudio(page);
    await page.locator("[data-music-volume]").fill("18");
    await page.locator("[data-music-volume]").dispatchEvent("input");
    assert.equal((await diagnostics(page)).musicVolume, 0.18);
    await page.locator("[data-audio-countdown]").uncheck();
    assert.equal((await diagnostics(page)).countdown, false);
    await page.selectOption("[data-effects-select]", "off");
    await page.evaluate(async () => window.KenseiI18n.setLocale("zh-Hant"));
    assert.match(
      await page.locator("[data-music-toggle]").locator("..").textContent(),
      /背景音樂/,
    );
    assert.match(await page.locator("#go-turn").textContent(), /輪到白[方棋]/);
    assert.equal(before, "White to move");
    assert.equal((await diagnostics(page)).musicPlaying, true);
    for (const width of [320, 360, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      assert.equal(
        await page
          .locator("[data-shell-settings-dialog]")
          .evaluate((n) => n.scrollWidth > n.clientWidth + 1),
        false,
      );
      assert.ok(
        (await page
          .locator(".game-audio-toggle-row")
          .first()
          .evaluate((n) => n.getBoundingClientRect().height)) >= 44,
      );
      if (width === 360)
        await page.screenshot({ path: "_qa/game-audio/settings-360.png" });
    }
    await page
      .locator("[data-shell-settings-dialog] [data-shell-close]")
      .last()
      .click();
    await page.locator("[data-audio-toggle]").click();
    assert.equal((await diagnostics(page)).enabled, false);
    assert.equal((await diagnostics(page)).musicPlaying, false);
    await page.reload();
    await page.waitForSelector("[data-ready=true]");
    assert.equal((await diagnostics(page)).enabled, false);
    await startGo(page);
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => window.__audioCreated),
      0,
      "remembered mute must survive reload and Start",
    );
    await page.locator("[data-audio-toggle]").click();
    await runningAudio(page);
    const other = await c.newPage();
    await ready(other, "go");
    await startGo(other);
    await runningAudio(other);
    await page.waitForFunction(
      () => !window.__gameAudio.getAudioDiagnostics().focused,
    );
    assert.equal(
      (await diagnostics(page)).musicPlaying,
      false,
      "other tab owns audio",
    );
    await other.close();
    const muted = await context({ enabled: false, volume: 0.64 }),
      mutedPage = await muted.newPage();
    await ready(mutedPage, "2048");
    await gameClick(mutedPage, "#game-start");
    assert.equal((await diagnostics(mutedPage)).enabled, false);
    assert.equal((await diagnostics(mutedPage)).volume, 0.64);
    assert.equal(await mutedPage.evaluate(() => window.__audioCreated), 0);
    const failure = await context(),
      failurePage = await failure.newPage();
    await failure.route("**/assets/game-audio/*.mp3*", (r) =>
      r.fulfill({ status: 503, body: "fixture failure" }),
    );
    await ready(failurePage, "go");
    await startGo(failurePage);
    await failurePage.waitForFunction(
      () => window.__gameAudio.getAudioDiagnostics().loadError === "music",
    );
    assert.equal(
      await failurePage.locator("[data-go]").getAttribute("data-go-phase"),
      "playing",
    );
    await openSettings(failurePage);
    await failure.unroute("**/assets/game-audio/*.mp3*");
    await failurePage.locator("[data-audio-retry]").click();
    await runningAudio(failurePage);
    assert.deepEqual((await diagnostics(failurePage)).failed, []);
    const fallback = await context(),
      fallbackPage = await fallback.newPage();
    await fallback.route("**/assets/game-audio/**", (r) =>
      r.fulfill({ status: 503, body: "fixture failure" }),
    );
    await ready(fallbackPage, "go");
    await startGo(fallbackPage);
    await fallbackPage.waitForFunction(
      () => window.__gameAudio.getAudioDiagnostics().armed,
    );
    await fallbackPage.locator("#game-board").focus();
    await fallbackPage.keyboard.press("Enter");
    assert.ok(
      await fallbackPage.evaluate(() => window.__audioOscillators > 0),
      "synth fallback remains usable",
    );
    assert.deepEqual(errors, []);
    const report = {
      engine: process.env.WORKSHOP_BROWSER_ENGINE || "chromium",
      games: 13,
      startedGames: 12,
      pong: "covered by arcade-next fixture",
      realWebAudio: true,
      rms,
      checks:
        "load silence, local start music, samples, budgets, pause position, mute, legacy migration, separate levels, locale / Effects state, tab ownership, failure / retry, synth fallback",
      physicalListening: "pending",
    };
    await fs.mkdir("_qa/game-audio", { recursive: true });
    await fs.writeFile(
      `_qa/game-audio/browser-${report.engine}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const c of contexts) await c.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
