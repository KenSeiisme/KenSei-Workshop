const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const sdk = `export function createClient(){return {
  auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},
  rpc:async(name)=>({data:name.includes("leaderboard")?{version:4,top:[],me:null}:null,error:null})
}}`;

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
  });
  try {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    await context.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (route) => route.fulfill({ contentType: "text/javascript", body: sdk }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const open = (prefix, path) => page.goto(base + prefix + path);
    async function noOverflow() {
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        page.url(),
      );
    }
    for (const prefix of ["", "/zh-hant"]) {
      for (const theme of ["dark", "light"]) {
        await open(prefix, "/");
        await page.evaluate((value) => {
          localStorage.setItem("kensei-game-hub-theme", value);
        }, theme);
        await page.reload();
        for (const [width, height] of [
          [320, 640],
          [390, 844],
          [768, 1024],
          [1366, 900],
        ]) {
          await page.setViewportSize({ width, height });
          await noOverflow();
          const links = page.locator(".home-portal");
          assert.equal(await links.count(), 3);
          for (const link of await links.all()) {
            const box = await link.boundingBox();
            assert(
              box && box.y + box.height <= height,
              `shortcut below fold at ${width} ${prefix} ${theme}`,
            );
            const anchor = await link.getAttribute("href");
            assert(["#toolbox", "#games", "#projects"].includes(anchor));
            assert.equal(await page.locator(anchor).count(), 1);
          }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await open(prefix, "/games/");
        await page.waitForSelector('[data-games-directory][data-ready="true"]');
        const search = page.locator("#games-library #game-search");
        await page.locator(".hub-library-jump").click();
        await search.fill(prefix ? "西洋棋" : "western chess");
        const card = page.locator('#games-library [data-game-theme="chess"]');
        const match = card.locator(".game-card-link");
        assert.equal(await card.locator("a").count(), 1);
        assert(await card.locator(".game-cover").isVisible());
        assert.equal(await card.locator(".preview-chess img").count(), 3);
        assert(await card.locator(".game-card-play").isVisible());
        await match.waitFor();
        assert.equal(
          await page.locator("#hub-game-count").textContent(),
          prefix ? "找到 1 款遊戲" : "1 game found",
        );
        const searchBox = await search.boundingBox();
        const headerBox = await page.locator("body > .header").boundingBox();
        assert(searchBox.y >= headerBox.height);
        assert.equal(
          await match.getAttribute("href"),
          prefix + "/games/chess/",
        );
        await search.press("Enter");
        assert(await match.evaluate((node) => node === document.activeElement));
        await search.fill("no-match-123");
        assert(await page.locator("#games-empty").isVisible());
        await page.click("#hub-game-clear");
        assert(
          await search.evaluate((node) => node === document.activeElement),
        );
        assert.equal(await page.locator("#hub-game-clear").isVisible(), false);
        assert.equal(
          await page.locator("#games-library [data-game-card]:visible").count(),
          15,
        );
        await page.click('[data-game-filter="board"]');
        assert.equal(
          await page
            .locator("#game-library-grid [data-game-card]:visible")
            .count(),
          5,
        );
        assert.equal(
          await page.locator("#game-library-grid .game-cover:visible").count(),
          5,
        );
        await search.fill(prefix ? "西洋棋" : "western chess");
        assert.equal(
          await page
            .locator("#game-library-grid [data-game-card]:visible")
            .count(),
          1,
        );
        await card.locator(".game-card-play").click();
        await page.waitForURL("**" + prefix + "/games/chess/");
        await noOverflow();
        await open(prefix, "/tools/");
        const previews = page.locator(".tool-card-preview");
        assert.equal(await previews.count(), 28);
        assert.equal(
          new Set(
            await previews.evaluateAll((nodes) =>
              nodes.map((node) => node.dataset.toolPreview),
            ),
          ).size,
          28,
        );
        assert(
          (await page.locator(".tool-card").first().boundingBox()).y <= 420,
        );

        await page.locator("#tool-search").fill("no-match-123");
        assert(await page.locator("#tool-search-clear").isVisible());
        assert.match(
          await page.locator("#tool-result-count").textContent(),
          /0/,
        );
        await page.click("#tool-search-clear");
        assert.equal(
          await page.locator("[data-tool-card]:visible").count(),
          28,
        );
        assert(
          await page
            .locator("#tool-search")
            .evaluate((node) => node === document.activeElement),
        );
        await noOverflow();
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await open("", "/tools/image-studio/");
    await page.waitForSelector('[data-tool][data-ready="true"]');
    const buffer = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 24;
        return canvas.toDataURL("image/png").split(",")[1];
      }),
      "base64",
    );
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.click("#image-pick"),
    ]);
    await chooser.setFiles(
      ["first.png", "second.png"].map((name) => ({
        name,
        mimeType: "image/png",
        buffer,
      })),
    );
    await page.waitForSelector("#image-selection li:nth-child(2)");
    assert.match(
      await page.locator("#image-info").textContent(),
      /2 images selected/,
    );
    await page.locator("#image-width").fill("20");
    await page.getByRole("button", { name: "Remove first.png" }).click();
    await page.waitForFunction(() =>
      document
        .querySelector("#image-info")
        .textContent.includes("1 image selected"),
    );
    assert.equal(await page.locator("#image-width").inputValue(), "20");
    assert.match(
      await page.locator("#image-selection").textContent(),
      /second\.png/,
    );
    await page.click("#image-process");
    await page.waitForSelector("#image-download:not([hidden])");
    await page.getByRole("button", { name: "Remove second.png" }).click();
    assert(await page.locator("#image-process").isDisabled());
    assert(await page.locator("#image-pick").isVisible());
    assert(!(await page.locator("#image-download").isVisible()));

    await open("/zh-hant", "/games/brick-breaker/");
    await page.waitForSelector('[data-game][data-ready="true"]');
    await page.waitForSelector('#game-rank-panel[data-rank-state="empty"]');
    assert.equal(
      await page.locator("#game-eligibility-note").isVisible(),
      false,
    );
    assert(await page.locator("#game-sign-in").isVisible());
    assert((await page.locator("#game-rank-panel").boundingBox()).height < 230);
    await page.click("#game-start");
    await page.locator(".brick-canvas").waitFor();

    await open("/zh-hant", "/workspace/");
    const favorites = page.locator("#workspace-favorites details");
    const drafts = page.locator("#workspace-drafts details");
    await favorites.waitFor();
    assert.equal(await favorites.getAttribute("open"), null);
    await page.locator('a[href="#workspace-drafts"]').click();
    assert.equal(new URL(page.url()).hash, "#workspace-drafts");
    await drafts.locator("summary").press("Enter");
    assert.notEqual(await drafts.getAttribute("open"), null);
    await page.evaluate(() => {
      localStorage.setItem(
        "kensei-workshop:v1:guest",
        JSON.stringify({
          items: [
            {
              id: "favorite-fixture",
              type: "favorite",
              data: { slug: "image-studio" },
            },
          ],
        }),
      );
    });
    await page.reload();
    await favorites.locator(".tool-card").waitFor();
    assert.equal(await drafts.getAttribute("open"), null);
    assert.deepEqual(errors, []);
    console.log(
      "PASS bilingual shortcuts and filters in both themes, selected image removal, compact leaderboard, and workspace disclosures",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
