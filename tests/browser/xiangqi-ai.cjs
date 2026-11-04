const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await page.goto(base + "/games/xiangqi/");
    const results = await page.evaluate(async () => {
      const { createXiangqiAI, iccsMove, fairyMove } =
        await import("/game-scripts/xiangqi-ai.js");
      const { createXiangqi, applyXiangqi, XiangqiPosition } =
        await import("/game-scripts/xiangqi-engine.js");
      const commands = [],
        NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(value, ...args) {
          commands.push(value);
          return super.postMessage(value, ...args);
        }
      };
      const ai = createXiangqiAI(),
        levels = [];
      try {
        await ai.ready;
        for (let level = 1; level <= 5; level++) {
          const state =
            level % 2
              ? createXiangqi()
              : applyXiangqi(createXiangqi(), { type: "move", uci: "e3e4" });
          const started = performance.now(),
            move = await ai.move(state, level);
          const legal = new XiangqiPosition(state.fen)
            .moves()
            .some((m) => m.uci === move);
          if (!legal)
            throw Error("Illegal AI response at level " + level + ": " + move);
          levels.push({
            level,
            move,
            elapsedMs: Math.round(performance.now() - started),
          });
        }
        if (fairyMove("e9e8") !== "e10e9" || iccsMove("e10e9") !== "e9e8")
          throw Error("Rank conversion failed");
      } finally {
        ai.close();
      }
      const cancelled = createXiangqiAI();
      await cancelled.ready;
      const pending = cancelled.move(createXiangqi(), 5).then(
        () => "unexpected success",
        (e) => e.message,
      );
      setTimeout(() => cancelled.close(), 10);
      const cancellation = await pending;
      window.Worker = NativeWorker;
      return { levels, commands, cancellation, isolated: crossOriginIsolated };
    });
    assert.equal(results.isolated, true);
    assert.deepEqual(
      results.levels.map((x) => x.level),
      [1, 2, 3, 4, 5],
    );
    for (const skill of [0, 4, 8, 12, 16])
      assert.ok(
        results.commands.includes("setoption name Skill Level value " + skill),
      );
    for (const budget of [200, 400, 800, 1500, 2500])
      assert.ok(results.commands.includes("go movetime " + budget));
    assert.equal(results.cancellation, "Search cancelled.");
    assert.ok(results.commands.includes("setoption name Threads value 1"));
    assert.ok(results.commands.includes("setoption name Hash value 16"));
    assert.ok(results.commands.includes("setoption name Use NNUE value false"));
    await page.goto(base + "/");
    const unsupported = await page.evaluate(async () => {
      const { createXiangqiAI } = await import("/game-scripts/xiangqi-ai.js");
      const ai = createXiangqiAI();
      try {
        await ai.ready;
        return "unexpected success";
      } catch (e) {
        return e.message;
      } finally {
        ai.close();
      }
    });
    assert.match(unsupported, /cannot run/);
    await page.route("**/fairy-stockfish/stockfish.wasm", (r) => r.abort());
    await page.goto(base + "/games/xiangqi/");
    const failed = await page.evaluate(async () => {
      const { createXiangqiAI } = await import("/game-scripts/xiangqi-ai.js");
      const ai = createXiangqiAI();
      try {
        await ai.ready;
        return "unexpected success";
      } catch (e) {
        return e.message;
      } finally {
        ai.close();
      }
    });
    assert.match(failed, /could not load|timed out/);
    await page.unroute("**/fairy-stockfish/stockfish.wasm");
    const retried = await page.evaluate(async () => {
      const { createXiangqiAI } = await import("/game-scripts/xiangqi-ai.js");
      const ai = createXiangqiAI();
      try {
        await ai.ready;
        return true;
      } finally {
        ai.close();
      }
    });
    assert.equal(retried, true);
    const engine = process.env.WORKSHOP_BROWSER_ENGINE || "chromium";
    await fs.mkdir("_qa/xiangqi/" + engine, { recursive: true });
    await fs.writeFile(
      "_qa/xiangqi/" + engine + "/ai-report.json",
      JSON.stringify({ ...results, unsupported, failed, retried }, null, 2),
    );
    console.log(
      "PASS five real Fairy-Stockfish levels, red/black rank conversion, classical one-thread settings, cancellation, missing-isolation fallback and download failure/retry.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
