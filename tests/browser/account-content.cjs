const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("../support/browser.cjs");
const {
  sdk,
  peer,
  publicId,
  requestId,
} = require("../support/social-fixture.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    await context.route("**/vendor/supabase-2.119.0.js*", (route) =>
      route.fulfill({ contentType: "application/javascript", body: sdk }),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const go = async (path) => {
      await page.goto(base + path);
      if (path.includes("profile"))
        await page.waitForFunction(
          () =>
            document.querySelector("#profile-page")?.dataset.ready === "true",
        );
      else if (path.includes("workspace"))
        await page.locator("[data-workspace-recent-list] a").first().waitFor();
      else await page.locator("[data-friends-content]").waitFor();
    };
    await go("/friends/");
    await page.evaluate(
      ({ peer, requestId }) => {
        localStorage.setItem("fixture:state", '"friend"');
        localStorage.setItem(
          "fixture:profile",
          JSON.stringify({
            nickname: "Tester · 長名稱與中文",
            appearance: {
              cover: "aurora",
              accent: "ice",
              featured: ["2048-1", "2048-2", "snake-1"],
            },
          }),
        );
        const actor = {
          public_id: peer,
          nickname: "Second Player · 長名稱",
          avatar_kind: "google",
          google_avatar_url: location.origin + "/assets/missing-avatar.png",
        };
        const rows = [
          {
            kind: "friend_request",
            source: "request:" + requestId,
            actor,
            payload: {},
          },
          {
            kind: "game_invite",
            actor,
            payload: { game: "chess", status: "expired" },
          },
          { kind: "reward", payload: { type: "achievement", id: "snake-1" } },
          {
            kind: "reward",
            payload: {
              type: "daily",
              task_id: "explorer",
              task_day: "2026-11-18",
              amount: 10,
            },
          },
        ].map((row, i) => ({
          ...row,
          id: String(i),
          created_at: "2026-11-18T00:00:00Z",
          read_at: null,
        }));
        localStorage.setItem("fixture:noticeRows", JSON.stringify(rows));
      },
      { peer, requestId },
    );
    await go("/friends/");
    await page.locator('[data-friend-list="friend"] button').first().waitFor();
    assert.equal(
      await page
        .locator('[data-friend-list="friend"] .friend-presence svg')
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator('[data-friend-section-count="incoming"]')
        .textContent(),
      "0",
    );
    await page
      .locator('[data-friend-list="friend"]')
      .getByRole("button", { name: "Invite to game" })
      .click();
    assert.equal(
      await page.locator(".friend-game-card .content-game-art").count(),
      4,
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".friend-game-card img")].every(
        (img) => img.complete && img.naturalWidth,
      ),
    );
    await page.keyboard.press("Escape");
    await page.locator("[data-open-notices]").click();
    await page.locator(".notice-row").nth(3).waitFor();
    assert.equal(
      await page
        .locator('.notice-row[data-kind="game_invite"] .content-game-art')
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator(
          '.notice-row[data-kind="reward"] .content-medal[data-game="snake"]',
        )
        .count(),
      1,
    );
    assert.equal(
      await page.locator(".notice-reward-amount").textContent(),
      "+10 coins",
    );
    await page
      .getByText("This invitation has expired.", { exact: true })
      .waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".notice-actor img")].every(
        (img) => !img.isConnected || img.complete,
      ),
    );
    const output = path.resolve(
      process.env.ACCEPTANCE_OUTPUT ||
        (process.env.WORKSHOP_BROWSER_ARTIFACTS
          ? path.join(process.env.WORKSHOP_BROWSER_ARTIFACTS, "account-content")
          : "_qa/account-content"),
    );
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({
      path: path.join(
        output,
        "notifications-" +
          (process.env.WORKSHOP_BROWSER_ENGINE || "chromium") +
          ".png",
      ),
    });
    await page.keyboard.press("Escape");
    await go("/profile/");
    assert.equal(await page.locator("[data-cover-choices] input").count(), 6);
    assert.equal(await page.locator("[data-accent-choices] input").count(), 5);
    await page.locator(".profile-milestone-choice").first().waitFor();
    assert.equal(
      await page.locator(".profile-milestone-choice .content-medal").count(),
      4,
    );
    assert.equal(
      await page.locator("[data-featured-count]").textContent(),
      "3 / 3 selected",
    );
    assert.equal(
      await page.locator("[data-preview-featured] .content-medal").count(),
      3,
    );
    await page.screenshot({
      path: path.join(
        output,
        "editor-" +
          (process.env.WORKSHOP_BROWSER_ENGINE || "chromium") +
          ".png",
      ),
      fullPage: true,
    });
    await go("/profile/?id=" + publicId);
    assert.equal(await page.locator(".board-stat-cards").count(), 3);
    assert.equal(
      await page
        .locator('#public-chess-records [data-stat="win"] strong')
        .textContent(),
      "5",
    );
    assert.equal(
      await page
        .locator('#public-go-records [data-stat="stats"] strong')
        .textContent(),
      "58.3%",
    );
    await page.screenshot({
      path: path.join(
        output,
        "public-" +
          (process.env.WORKSHOP_BROWSER_ENGINE || "chromium") +
          ".png",
      ),
      fullPage: true,
    });

    // 同一份實際頁面在不同版面上驗證；模擬後端不接觸真實私人資料。
    for (const locale of ["", "/zh-hant"])
      for (const theme of ["dark", "light"]) {
        await page.evaluate(
          (value) => localStorage.setItem("kensei-game-hub-theme", value),
          theme,
        );
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          for (const route of [
            "/friends/",
            "/profile/",
            "/profile/?id=" + publicId,
            "/workspace/",
          ]) {
            await go(locale + route);
            assert(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              locale + route + " " + theme + " " + width,
            );
            if (route === "/workspace/") {
              assert.equal(
                await page
                  .locator(
                    "[data-workspace-recent-list] .workspace-type-label svg",
                  )
                  .count(),
                4,
              );
              assert.equal(
                await page
                  .locator(
                    "[data-workspace-recent-list] .workspace-save-state svg",
                  )
                  .count(),
                4,
              );
            }
          }
        }
      }
    assert.deepEqual(errors, []);
    console.log(
      "PASS account content: visual game invitations, reward medals/coins, appearance choices, real board stats, record icons; EN/zh-Hant dark/light at 320/390/768/1440px",
    );
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
