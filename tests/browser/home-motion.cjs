const assert = require("node:assert/strict");
const { chromium, firefox, webkit } = require("../support/browser.cjs");

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const recording = process.env.WORKSHOP_RECORD_HOME_MOTION === "1";
const toggle = "[data-home-motion-toggle]";
const sizes = [
  [320, 640],
  [390, 844],
  [768, 1024],
  [1366, 900],
  [844, 390],
  [683, 450],
];

async function open(context, path) {
  const page = await context.newPage();
  assert.equal(
    (await page.goto(base + path, { waitUntil: "commit" })).status(),
    200,
  );
  await page.locator(toggle).waitFor({ timeout: 12000 });
  return page;
}

function landing(page, id) {
  return page.waitForFunction((id) => {
    const rect = document.getElementById(id).getBoundingClientRect();
    return location.hash === "#" + id && rect.top >= 0 && rect.top < 140;
  }, id);
}

async function verifyLayout(page, width, height) {
  await page.setViewportSize({ width, height });
  const layout = await page.evaluate(() => ({
    target: document.querySelector(".home-portals").getBoundingClientRect()
      .bottom,
    toggleBottom: document
      .querySelector("[data-home-motion-toggle]")
      .getBoundingClientRect().bottom,
    width: document.documentElement.scrollWidth,
    bubbles: [...document.querySelectorAll(".home-bubble")].filter(
      (bubble) => getComputedStyle(bubble.parentElement).display !== "none",
    ).length,
    decorative: [...document.querySelectorAll(".home-atmosphere")].every(
      (layer) =>
        layer.getAttribute("aria-hidden") === "true" &&
        getComputedStyle(layer).pointerEvents === "none" &&
        !layer.querySelector("a, button, [tabindex]"),
    ),
  }));
  assert(layout.decorative);
  assert(
    layout.width <= width + 1,
    `horizontal overflow at ${width}x${height}: ${layout.width}`,
  );
  if (height >= 640) {
    assert(
      layout.target < height,
      `portal below fold at ${width}x${height}: ${layout.target}`,
    );
    assert(
      layout.toggleBottom <= height,
      `motion toggle below fold at ${width}x${height}`,
    );
  }
  assert.equal(layout.bubbles, width >= 1050 && height >= 700 ? 19 : 15);
  await page.waitForFunction(
    (limit) =>
      [...document.querySelectorAll(".home-bubble")].filter(
        (bubble) =>
          getComputedStyle(bubble).animationPlayState === "running" &&
          bubble.getBoundingClientRect().width > 0,
      ).length <= limit,
    width >= 1050 && height >= 700 ? 16 : 8,
  );
}

async function check(engine, name) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({
      reducedMotion: "no-preference",
    });
    await context.route("https://cdn.jsdelivr.net/**", (route) =>
      route.abort(),
    );
    if (base.includes("127.0.0.1"))
      await context.route("**/api/home-popular", (route) =>
        route.fulfill({ json: {} }),
      );
    const en = await open(context, "/");
    const errors = [];
    en.on("pageerror", (error) => errors.push(error.message));
    for (const locale of ["en", "zh-Hant"]) {
      await en.evaluate(
        (locale) => window.KenseiI18n.setLocale(locale),
        locale,
      );
      await en.waitForFunction(
        (locale) => document.documentElement.lang === locale,
        locale,
      );
      assert.equal(
        await en.locator(toggle).getAttribute("aria-label"),
        locale === "en" ? "Background motion" : "背景動效",
      );
      assert.equal(await en.locator(toggle).innerText(), "");
      assert.equal(await en.locator(toggle).locator("svg").count(), 1);
      for (const theme of ["dark", "light"]) {
        await en.evaluate(
          (value) => (document.documentElement.dataset.siteTheme = value),
          theme,
        );
        for (const [width, height] of sizes)
          await verifyLayout(en, width, height);
      }
    }
    await en.setViewportSize({ width: 1366, height: 900 });
    await en.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".home-intro .home-bubble"))
          .animationPlayState === "running",
    );
    await en.locator(".home-portal[href='#toolbox']").focus();
    await en.keyboard.press("Enter");
    await landing(en, "toolbox");
    await en.waitForFunction(() => {
      const intro = document.querySelector(".home-intro .home-bubble");
      const tools = document.querySelector("#toolbox .home-bubble");
      return (
        getComputedStyle(intro).animationPlayState === "paused" &&
        getComputedStyle(tools).animationPlayState === "running"
      );
    });
    assert(
      Math.abs(
        parseFloat(
          await en
            .locator("#toolbox")
            .evaluate((row) => row.style.getPropertyValue("--home-parallax")),
        ),
      ) <= 24,
    );
    await en.goBack();
    await en.waitForFunction(() => !location.hash && scrollY < 3);
    await en.locator(toggle).click();
    assert.equal(
      await en.locator(toggle).getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(
      await en
        .locator(".home-intro .home-bubble")
        .first()
        .evaluate((b) => b.getAnimations().length),
      0,
    );
    await en.reload({ waitUntil: "commit" });
    await en.waitForFunction(
      (toggle) =>
        document.querySelector(toggle)?.getAttribute("aria-pressed") ===
        "false",
      toggle,
    );
    await en.locator(toggle).click();
    await en.emulateMedia({ reducedMotion: "reduce" });
    await en.waitForFunction(
      (toggle) =>
        document.querySelector(toggle).getAttribute("aria-disabled") === "true",
      toggle,
    );
    assert.equal(
      await en.locator(toggle).getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(
      await en
        .locator(".home-intro .home-bubble")
        .first()
        .evaluate((b) => b.getAnimations().length),
      0,
    );
    await en.emulateMedia({ reducedMotion: "no-preference" });
    await en.waitForFunction(
      (toggle) =>
        document.querySelector(toggle).getAttribute("aria-pressed") === "true",
      toggle,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS",
      name,
      "layout, English/Traditional Chinese, light/dark, arrow/anchor, pause preference and reduced motion",
    );
  } finally {
    await browser.close();
  }
}

async function verifySequence(page, mobile) {
  const cards = page.locator("#toolbox .home-card");
  await page.mouse.move(0, 12);
  const scroll = async (index) => {
    await cards.nth(index).evaluate((card, index) => {
      const line = 80 + (innerHeight - 80) * 0.46;
      const small = matchMedia("(max-width: 1049px)").matches;
      const target =
        card.parentElement.getBoundingClientRect().top +
        scrollY +
        card.offsetTop +
        (!small && index === 0 ? 12 : card.offsetHeight * 0.5);
      scrollTo({ top: target - line, behavior: "instant" });
    }, index);
    await page.waitForFunction(
      (index) =>
        document
          .querySelectorAll("#toolbox .home-card")
          [index].hasAttribute("data-home-spotlight"),
      index,
    );
    assert.equal(await page.locator("[data-home-spotlight]").count(), 1);
    assert.equal(await cards.nth(index).getAttribute("tabindex"), null);
    const textOpacity = await cards
      .nth((index + 1) % 4)
      .locator(".home-card-copy")
      .evaluate((node) => getComputedStyle(node).opacity);
    assert.equal(textOpacity, "1");
    if (recording) await page.waitForTimeout(320);
  };
  for (const index of [0, 1, 2, 3, 2, 1, 0]) await scroll(index);

  if (!mobile) {
    await cards.nth(1).hover();
    await page.waitForFunction(() =>
      document
        .querySelectorAll("#toolbox .home-card")[1]
        .hasAttribute("data-home-spotlight"),
    );
    await page.mouse.move(0, 12);
    await page.keyboard.press("Tab");
    await cards.nth(2).focus();
    await cards
      .nth(2)
      .evaluate((node) =>
        node.scrollIntoView({ block: "center", behavior: "instant" }),
      );
    await page.waitForFunction(() =>
      document.activeElement?.hasAttribute("data-home-spotlight"),
    );
    await page.evaluate(() => document.activeElement.blur());
  }
}

async function exerciseMotion(mobile) {
  const viewport = mobile
    ? { width: 390, height: 844 }
    : { width: 1366, height: 900 };
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport,
    hasTouch: mobile,
    ...(recording
      ? { recordVideo: { dir: "_qa/home-motion-video", size: viewport } }
      : {}),
  });
  try {
    await context.route("https://cdn.jsdelivr.net/**", (route) =>
      route.abort(),
    );
    if (base.includes("127.0.0.1"))
      await context.route("**/api/home-popular", (route) =>
        route.fulfill({ json: {} }),
      );
    await context.addInitScript(() => {
      window.particleCount = {};
      window.sectionBursts = {};
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (
            !(record.target instanceof Element) ||
            !record.target.matches(".home-particles")
          )
            continue;
          const id = record.target.closest("section").id;
          if (
            [...record.addedNodes].some(
              (node) => node.dataset?.sectionBurst === "start",
            )
          )
            window.sectionBursts[id] = (window.sectionBursts[id] || 0) + 1;
          window.particleCount[id] =
            (window.particleCount[id] || 0) + record.addedNodes.length;
          window.peakParticles = Math.max(
            window.peakParticles || 0,
            document.querySelectorAll(".home-particle").length,
          );
        }
      });
      observer.observe(document, { subtree: true, childList: true });
    });
    const page = await open(context, "/zh-hant/");
    const portal = page.locator(".home-portal[href='#toolbox']");
    if (recording) await page.waitForTimeout(1250);
    await (mobile ? portal.tap() : portal.click());
    await landing(page, "toolbox");
    await page.waitForFunction(() => window.sectionBursts.toolbox === 1);
    const count = await page.evaluate(() => window.particleCount.toolbox);
    assert(count >= (mobile ? 9 : 16));
    await page.waitForFunction(
      () => document.querySelectorAll(".home-particle").length === 0,
    );
    await verifySequence(page, mobile);
    if (recording) await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForFunction(() => scrollY <= 1);
    await page.evaluate(() =>
      history.replaceState(null, "", location.pathname),
    );
    await (mobile ? portal.tap() : portal.click());
    await landing(page, "toolbox");
    assert.equal(await page.evaluate(() => window.sectionBursts.toolbox), 1);

    // Simulate the browser's visibility event without relying on headless tab focus.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector("#toolbox .home-bubble"))
          .animationPlayState === "paused",
    );
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector("#toolbox .home-bubble"))
          .animationPlayState === "running",
    );

    await page.evaluate(() =>
      document
        .getElementById("projects")
        .scrollIntoView({ behavior: "instant" }),
    );
    await page.waitForFunction(() => window.particleCount.projects > 0);
    assert(
      (await page.evaluate(() => window.peakParticles)) <= (mobile ? 12 : 30),
    );
    const card = page.locator("#projects [data-home-card='kensei-studio']");
    await card.focus();
    await (mobile ? card.tap() : card.click());
    await page.waitForURL("**/zh-hant/projects/kensei-studio/");
    if (recording) {
      const video = page.video();
      await page.close();
      await video.saveAs(
        `_qa/home-motion-${mobile ? "mobile" : "desktop"}.webm`,
      );
    }
    console.log(
      "PASS",
      mobile ? "touch" : "desktop",
      "particle cap, one-time entry, page visibility and link during entry",
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

(async () => {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (!process.argv[2] || process.argv[2] === name) await check(engine, name);
  }
  if (!process.argv[2] || process.argv[2] === "chromium") {
    await exerciseMotion(false);
    await exerciseMotion(true);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
