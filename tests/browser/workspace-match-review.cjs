const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("../support/browser.cjs");

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const id = "5a493584-c7a2-4d3d-9011-35da2d403f7e";
const sdk = `
export function createClient() {
  const id = "${id}";
  const user = { id: "owner-a", email: "owner@example.invalid" };
  const date = "2026-11-16T12:00:00Z";
  const preset = {
    id: "new-recipe",
    type: "preset",
    data: { tool: "data-studio", name: "Analysis recipe", recipe: { version: 1, settings: {} } },
    updated_at: date
  };
  const old = { id: "old-draft", kind: "draft", tool: "text-toolkit", name: "Old draft", updated_at: date };
  window.__rpc = [];
  let listener;
  window.__endSession = () => listener("SIGNED_OUT", null);
  async function boardMatch() {
    const game = location.pathname.split("/").filter(Boolean).at(-1);
    let state;
    if (game === "go") {
      const { createGo, applyGo } = await import("/game-scripts/go-engine.js");
      state = createGo({ rule: "chinese", size: 9 });
      state = applyGo(state, { type: "move", index: 40 }, 1);
    } else if (game === "chess") {
      const { createChess, applyChess } = await import("/game-scripts/chess-engine.js");
      state = applyChess(createChess({ clock: "10+5" }), { type: "move", uci: "e2e4" }, 1);
    } else {
      const { createXiangqi, applyXiangqi } = await import("/game-scripts/xiangqi-engine.js");
      state = applyXiangqi(createXiangqi({ clock: "10+5" }), { type: "move", uci: "b2e2" }, 1);
    }
    state.phase = "finished";
    state.result = { winner: 1, reason: "resignation" };
    return { id, state, game, result: state.result, color: 1, ended_at: date, members: [{ color: -1, nickname: "Rival" }] };
  }
  return {
    auth: {
      getSession: async () => ({ data: { session: sessionStorage.guest ? null : { user } } }),
      onAuthStateChange: (fn) => { listener = (event, session) => {
        sessionStorage.guest = "1";
        fn(event, session);
      }; },
    },
    from: () => ({
      select() { return this; },
      eq() { return this; },
      order: async () => ({ data: [preset] }),
      maybeSingle: async () => ({
        data: { ...old, type: "draft", data: { name: old.name, tool: old.tool, text: "An older saved draft." } },
      }),
    }),
    rpc: async (name, args = {}) => {
      window.__rpc.push(name);
      if (name === "get_workspace_index") {
        if (args.search_text) {
          return { data: args.search_text === "Old" || args.tool_ids?.includes("text-toolkit") ? [old] : [] };
        }
        if (args.before_id) return { data: [old] };
        const records = Array.from({ length: 20 }, (_, i) => ({ ...old, id: "draft-" + i, name: "Draft " + i }));
        return { data: [{ ...preset, kind: "preset", name: preset.data.name, tool: "data-studio" }, ...records] };
      }
      if (name === "get_my_board_match_history")
        return { data: [{ id, game: args.game_filter || "go", color: 1, result: { winner: 1 }, rule: "chinese", size: 9, clock: args.game_filter && args.game_filter !== "go" ? "10+5" : "9", opponent: "Rival", ended_at: date }] };
      if (name === "get_my_board_match_review") return { data: args.match_id === id ? await boardMatch() : null };
      if (name === "ensure_my_profile") return { data: null };
      if (name === "get_my_live_games") return { data: { matches: [{ id, game: "chess", status: "playing", clock: "10+5" }] } };
      return { data: [] };
    },
    functions: { invoke() { throw Error("Archive must not invoke the live game"); } }
  };
}`;
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/vendor/supabase-2.119.0.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: sdk }),
  );
  try {
    await page.goto(base + "/workspace/");
    const results = page.locator("[data-workspace-index-list]");
    await page
      .locator("[data-workspace-recent-list]")
      .getByText("Analysis recipe")
      .waitFor();
    assert.equal(await results.locator(".saved-row").count(), 16);
    assert.equal(
      await page.locator("[data-workspace-recent-list] .saved-row").count(),
      4,
    );
    assert.match(
      await page.locator("#saved-presets").textContent(),
      /Analysis recipe/,
    );
    await page.locator("[data-workspace-index-more]").click();
    await results.getByText("Old draft").waitFor();
    await page.locator("[data-workspace-query]").fill("文字");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-workspace-index-list]").children
          .length === 1,
    );
    await results.getByRole("link", { name: "Open" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector("#text-input").value === "An older saved draft.",
    );

    await page.goto(base + "/zh-hant/games/");
    await page.locator("#hub-recent-title").click();
    await page.locator("[data-recent-list] a").waitFor();
    assert.match(
      await page.locator("[data-hub-recent] summary").textContent(),
      /近期對局/,
    );
    await page.locator("[data-live-game-list] a").waitFor();
    assert.match(
      await page.locator("[data-recent-list]").textContent(),
      /5 分鐘.*20 秒/,
    );
    for (const [game, pattern] of [
      ["go", /;B\[ee\]/],
      ["chess", /e4/],
      ["xiangqi", /b2e2/],
    ]) {
      await page.goto(base + "/zh-hant/games/" + game + "/?review=" + id);
      await page.locator("[data-review-download]").waitFor();
      assert.match(
        await page.locator(".board-review-heading h1").textContent(),
        /對局復盤/,
      );
      assert.match(
        await page.locator("[data-review-number]").textContent(),
        /1／1/,
      );
      await page.locator("[data-review-prev]").click();
      assert.match(
        await page.locator("[data-review-number]").textContent(),
        /0／1/,
      );
      await page.locator("[data-review-board]").press("ArrowRight");
      assert.match(
        await page.locator("[data-review-number]").textContent(),
        /1／1/,
      );
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("[data-review-download]").click(),
      ]);
      assert.match(await fs.readFile(await download.path(), "utf8"), pattern);
      assert(!(await page.evaluate(() => __rpc.includes("get_my_live_games"))));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        360,
      );
    }
    await page.goto(
      base + "/games/chess/?review=7e55de80-b9f7-4ba6-8e67-6f282e22db5d",
    );
    await page.getByText("This match is unavailable.").waitFor();
    assert(await page.locator("[data-review-content]").isHidden());

    await page.goto(base + "/workspace/");
    await results.getByText("Analysis recipe").waitFor();
    await page.evaluate(() => __endSession());
    await page.getByText("On this device", { exact: true }).waitFor();
    assert(!(await results.textContent()).includes("Analysis recipe"));
    assert.deepEqual(errors, []);
    console.log(
      "Workspace search, account isolation, archived board navigation and three game downloads passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
