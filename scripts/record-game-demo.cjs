// 可选的固定视口录像；只使用游客 Private，不写入正式账号或排行榜。
const { chromium } = require("../tests/support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8812";
(async () => {
  const { create } = await import("../src/games/engine.js");
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    reducedMotion: "no-preference",
    recordVideo: {
      dir: "_qa/neon-videos",
      size: { width: 1280, height: 1000 },
    },
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("kensei-game-effects-v1", "auto");
    } catch {}
    const get = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (array) => {
      const result = get(array);
      if (array instanceof Uint32Array && array.length === 1) array[0] = 12345;
      return result;
    };
  });
  const page = await context.newPage(),
    video = page.video(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const open = async (slug) => {
    await page.goto(base + "/games/" + slug + "/");
    await page.waitForSelector('[data-game][data-ready="true"]');
  };
  try {
    await open("2048");
    await page.click("#game-start");
    for (const key of [
      "ArrowLeft",
      "ArrowUp",
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
      "ArrowRight",
      "ArrowDown",
    ]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(400);
    await open("memory-match");
    await page.click("#game-start");
    const memory = create("memory-match", "normal", 12345);
    for (let pair = 0; pair < 3; pair++)
      for (let i = 0; i < memory.cards.length; i++)
        if (memory.cards[i] === pair) {
          await page.click(`[data-cell="${i}"]`);
          await page.waitForTimeout(400);
        }
    const mismatches = [
      memory.cards.findIndex((v) => v === 3),
      memory.cards.findIndex((v) => v === 4),
    ];
    for (const i of mismatches) {
      await page.click(`[data-cell="${i}"]`);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(800);
    await open("connect-four");
    await page.selectOption("#game-difficulty", "local");
    await page.click("#game-start");
    for (const column of [0, 1, 0, 1, 0, 1, 0]) {
      await page.locator(`[data-drop="${column}"]`).first().click();
      await page.waitForTimeout(420);
    }
    await page.waitForTimeout(1400);
    if (errors.length) throw Error(errors.join("\n"));
  } finally {
    await context.close();
    await video.saveAs("_qa/neon-animation-demo.webm");
    await browser.close();
  }
  console.log(
    "Recorded _qa/neon-animation-demo.webm: 2048 slide/merge, Memory flips/match/mismatch, Connect Four drop/win, fixed 1280×1000 viewport.",
  );
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
