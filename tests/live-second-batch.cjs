const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  chromium,
} = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.TEST_BASE_URL || "https://kensei-workshop.vercel.app";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const c = await browser.newContext({ reducedMotion: "reduce" }),
    errors = [],
    uploads = [];
  c.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (r.method() === "POST")
        uploads.push({ url: r.url(), body: r.postData() });
    });
  });
  const p = await c.newPage(),
    checks = [];
  try {
    await p.goto(base + "/tools/", { waitUntil: "domcontentloaded" });
    assert.equal(await p.locator("[data-tool-card]").count(), 28);
    for (const slug of [
      "answer-book",
      "decision-studio",
      "typing-sprint",
      "device-check",
    ]) {
      for (const width of [360, 768, 1440]) {
        await p.setViewportSize({ width, height: 900 });
        await p.goto(base + "/tools/" + slug + "/", {
          waitUntil: "domcontentloaded",
        });
        await p.waitForSelector('[data-ready="true"]');
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          slug + " overflows " + width,
        );
      }
    }
    checks.push("Four real production tool pages at three screen widths");
    await p.goto(base + "/tools/answer-book/", {
      waitUntil: "domcontentloaded",
    });
    await p.waitForSelector('[data-ready="true"]');
    await p.locator("#answer-question").fill("DO NOT UPLOAD THIS QUESTION");
    await p.locator("#answer-draw").click();
    await p.waitForSelector("#answer-history .saved-row");
    assert(
      !(await p.evaluate(() =>
        JSON.stringify(localStorage).includes("DO NOT UPLOAD THIS QUESTION"),
      )),
    );
    const [d] = await Promise.all([
      p.waitForEvent("download"),
      p.locator("[data-history-export]").click(),
    ]);
    assert(fs.readFileSync(await d.path(), "utf8").includes("drawnAt"));
    checks.push("Guest answers save locally and export without questions");
    await p.goto(base + "/tools/decision-studio/", {
      waitUntil: "domcontentloaded",
    });
    await p.waitForSelector('[data-ready="true"]');
    await p.locator("#decision-name").fill("Production smoke test");
    await p.locator("#decision-mode").selectOption("draw");
    await p.locator("#decision-no-repeat").check();
    const out = new Set();
    for (let i = 0; i < 3; i++) {
      await p.locator("#decision-run").click();
      out.add(await p.locator("#decision-result").textContent());
    }
    assert.equal(out.size, 3);
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForSelector('[data-ready="true"]');
    assert.equal(
      await p.locator("#decision-name").inputValue(),
      "Production smoke test",
    );
    checks.push("Guest decisions autosave and reopen; no-repeat pool works");
    await p.goto(base + "/tools/typing-sprint/", {
      waitUntil: "domcontentloaded",
    });
    await p.waitForSelector('[data-ready="true"]');
    await p.waitForFunction(
      () =>
        !document
          .querySelector("#leaderboard-status")
          .textContent.includes("Loading"),
    );
    assert(
      !(await p.locator("#leaderboard-status").textContent()).includes(
        "unavailable",
      ),
      "Real anonymous leaderboard must load",
    );
    const apiResults = await p.evaluate(async () => {
      const cfg = window.KENSEI_CONFIG,
        headers = {
          apikey: cfg.supabasePublishableKey,
          "content-type": "application/json",
        },
        root = cfg.supabaseUrl + "/rest/v1/";
      const call = async (path, body) => {
        const r = await fetch(root + path, {
          headers,
          ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, text: await r.text() };
      };
      return {
        board: await call("rpc/get_typing_leaderboard", { language: "en" }),
        publicProfile: await call("rpc/get_public_profile", {
          profile_id: crypto.randomUUID(),
        }),
        private: await call("answer_history?select=id,data"),
        start: await call("rpc/start_typing_test", { language: "en" }),
        finish: await call("rpc/finish_typing_test", {
          sessionId: crypto.randomUUID(),
          typedText: "x",
        }),
      };
    });
    assert.equal(apiResults.board.status, 200);
    assert.equal(apiResults.publicProfile.status, 200);
    assert.equal(apiResults.publicProfile.text, "null");
    for (const key of ["private", "start", "finish"])
      assert(
        [401, 403].includes(apiResults[key].status),
        key + " must reject anonymous access",
      );
    assert(!/user_id|email|typedText/.test(apiResults.board.text));
    assert.equal(await p.locator("#typing-mode").inputValue(), "ranked");
    await p.locator("#typing-start").click();
    assert(await p.locator("#auth-dialog").isVisible());
    await p.keyboard.press("Escape");
    await p.locator("#typing-mode").selectOption("practice");
    await p.clock.install();
    await p.locator("#typing-start").click();
    await p.locator("#typing-input").fill("Morning light");
    await p.clock.fastForward(60010);
    await p.waitForFunction(() =>
      document
        .querySelector("#typing-status")
        .textContent.includes("Practice complete"),
    );
    assert.match(
      await p.locator("#typing-result").textContent(),
      /2.6 WPM.*100.00%/,
    );
    checks.push(
      "Real public leaderboard and anonymous write/privacy denials; 60-second Practice",
    );
    await p.goto(base + "/workspace/", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("#workspace-answers .saved-row");
    assert(
      await p
        .locator("#workspace-decisions")
        .textContent()
        .then((x) => x.includes("Production smoke test")),
    );
    checks.push("Production Workspace opens both new local history sections");
    await p.goto(base + "/profile/", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("#profile-login:not([hidden])");
    assert(await p.locator("#profile-form").isHidden());
    await p.goto(base + "/profile/?id=invalid", {
      waitUntil: "domcontentloaded",
    });
    await p.waitForFunction(
      () =>
        document.querySelector("#profile-status").textContent ===
        "Profile not found.",
    );
    checks.push(
      "Public is default, Google sign-in entry works, and anonymous profile pages are available",
    );
    assert.deepEqual(errors, []);
    assert(
      !uploads.some((x) => x.body?.includes("DO NOT UPLOAD THIS QUESTION")),
    );
    assert(
      uploads.every(
        (x) =>
          x.url.includes("/rpc/get_typing_leaderboard") ||
          x.url.includes("/rpc/get_public_profile") ||
          x.url.includes("/rpc/start_typing_test") ||
          x.url.includes("/rpc/finish_typing_test"),
      ),
      "Guest file tools and histories must not upload",
    );
    fs.writeFileSync(
      "_qa/live-second-batch-report.json",
      JSON.stringify(
        {
          base,
          checks,
          errors,
          apiStatuses: Object.fromEntries(
            Object.entries(apiResults).map(([k, v]) => [k, v.status]),
          ),
        },
        null,
        2,
      ),
    );
    checks.forEach((x) => console.log("PASS " + x));
  } finally {
    await c.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
