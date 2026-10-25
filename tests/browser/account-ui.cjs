const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8771";
const id = "11111111-1111-4111-8111-111111111111";
const picture =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><rect width="1800" height="1200" fill="#6b477c"/><circle cx="900" cy="600" r="480" fill="#edb5d7"/></svg>';
const sdk = `export function createClient(){return {auth:{getSession:async()=>({data:{session:{user:{id:'${id}'}}}}),onAuthStateChange(){}},from(){return {select(){return this},order:async()=>({data:[]})}},rpc:async(name)=>({data:name==='ensure_my_profile'?{public_id:'${id}',nickname:'Very long account name 個人資料測試使用者',bio:'',avatar_kind:'google',google_avatar_url:'https://lh3.googleusercontent.com/a/account-ui-fixture'}:name==='get_my_game_progress'?{unlocks:[],progress:{},verified_results:0,games_ranked:0}:name.startsWith('get_game_leaderboard')?{version:1,top:[],me:null}:[],error:null})}}`;
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext();
  const errors = [],
    checks = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  await context.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (route) =>
      route.fulfill({ contentType: "application/javascript", body: sdk }),
  );
  await context.route(
    "https://lh3.googleusercontent.com/a/account-ui-fixture",
    (route) => route.fulfill({ contentType: "image/svg+xml", body: picture }),
  );
  const page = await context.newPage();
  try {
    for (const width of [1440, 1024, 768, 360])
      for (const prefix of ["", "/zh-hant"])
        for (const route of [
          "/",
          "/tools/",
          "/games/",
          "/projects/",
          "/profile/",
          "/games/minesweeper/",
        ]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(base + prefix + route);
          await page.waitForFunction(() => {
            const image = document.querySelector("[data-account-avatar] img");
            return image?.complete && image.naturalWidth > 0;
          });
          if (width < 1024) await page.locator(".menu-toggle").click();
          const avatar = page.locator("[data-account-avatar]");
          const metrics = await avatar.evaluate((node) => {
            const image = node.querySelector("img");
            return {
              width: image.getBoundingClientRect().width,
              height: image.getBoundingClientRect().height,
              fit: getComputedStyle(image).objectFit,
              overflow: getComputedStyle(node).overflow,
              natural: image.naturalWidth,
            };
          });
          if (metrics.width > 32 || metrics.height > 32) {
            fs.mkdirSync("_qa", { recursive: true });
            await page.screenshot({
              path: "_qa/account-avatar-regression.png",
              fullPage: false,
            });
          }
          assert.equal(metrics.natural, 1800);
          assert(
            metrics.width > 0 && metrics.width <= 30.5,
            JSON.stringify({ width, prefix, route, ...metrics }),
          );
          assert(
            metrics.height > 0 && metrics.height <= 30.5,
            JSON.stringify(metrics),
          );
          assert.equal(metrics.fit, "cover");
          assert.equal(metrics.overflow, "hidden");
          await page.locator("#account-toggle").click();
          assert(await page.locator("#account-menu").isVisible());
          const menu = await page.locator("#account-menu").evaluate((node) => ({
            position: getComputedStyle(node).position,
            left: node.getBoundingClientRect().left,
            right: node.getBoundingClientRect().right,
            background: getComputedStyle(node).backgroundColor,
          }));
          assert.equal(menu.position, width < 1024 ? "static" : "absolute");
          assert(
            menu.left >= -1 && menu.right <= width + 1,
            JSON.stringify({ width, route, menu }),
          );
          assert.notEqual(menu.background, "rgba(0, 0, 0, 0)");
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          if (width === 1440 && prefix === "" && route === "/")
            await page.screenshot({
              path: "_qa/account-avatar-fixed.png",
              fullPage: false,
            });
          await page.keyboard.press("Escape");
          assert(await page.locator("#account-menu").isHidden());
          if (width < 1024) await page.keyboard.press("Escape");
          checks.push({ width, prefix, route, metrics, menu });
        }
    // A failed image still keeps the bounded initial instead of a broken or oversized image.
    await context.unroute(
      "https://lh3.googleusercontent.com/a/account-ui-fixture",
    );
    await context.route(
      "https://lh3.googleusercontent.com/a/account-ui-fixture",
      (route) => route.fulfill({ status: 404, body: "" }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + "/");
    await page.waitForFunction(() => window.KenseiWorkspace?.profile);
    await page.waitForFunction(() => {
      const node = document.querySelector("[data-account-avatar]");
      return node?.textContent === "V" && !node.querySelector("img");
    });
    assert.equal(
      (await page.locator("[data-account-avatar]").boundingBox()).width,
      30,
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/account-ui.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log(
      "PASS signed-in account UI: 48 route/locale/viewport cases, oversized source avatar stays 30px, styled menu, no overflow and image-error fallback",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
