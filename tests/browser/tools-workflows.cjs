const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769",
  output = process.env.TOOLS_AUDIT_OUTPUT || "_qa/tools-workflows",
  checks = [];
const sdk = `export function createClient(){let current={id:sessionStorage.getItem('qa-actor')||'qa-draft-owner'},listener;return {auth:{getSession:async()=>({data:{session:{user:current}}}),onAuthStateChange(fn){listener=fn;window.__changeActor=id=>{sessionStorage.setItem('qa-actor',id);current={id};listener('SIGNED_IN',{user:current})}}},rpc:async name=>({data:name==='ensure_my_profile'?{nickname:'Acceptance User',public_id:'11111111-1111-4111-8111-111111111111'}:null,error:null}),from(){let pending;return {select(){return this},eq(){return this},order:async()=>({data:[],error:null}),maybeSingle:async()=>({data:null,error:null}),upsert(row){pending=row;return this},single:async()=>{window.__savedPayload=structuredClone(pending);await new Promise(r=>window.__finishSave=r);return {data:{...pending,updated_at:new Date().toISOString()},error:null}}}}}}`;
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  context.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method()))
      requests.push(new URL(r.url()).hostname);
  });
  await context.route("**/config.js", (r) =>
    r.fulfill({
      body: "window.KENSEI_CONFIG={supabaseUrl:'https://acceptance.invalid',supabasePublishableKey:'fixture'};",
      contentType: "application/javascript",
    }),
  );
  await context.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (r) =>
      r.fulfill({
        body: sdk,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
      }),
  );
  page.on("dialog", (d) =>
    d.type() === "beforeunload" ? d.accept() : d.dismiss(),
  );
  async function open(slug) {
    await page.goto(base + "/tools/" + slug + "/");
    await page.waitForSelector('[data-ready="true"]');
    await page.waitForFunction(() => window.KenseiWorkspace.ready);
  }
  async function check(id, fn) {
    try {
      await fn();
      checks.push({ id, status: "pass" });
      console.log("PASS", id);
    } catch (e) {
      checks.push({ id, status: "fail", error: e.message });
      console.error("FAIL", id, e.message);
      await page
        .screenshot({ path: path.join(output, id + ".png") })
        .catch(() => {});
    }
    fs.writeFileSync(
      path.join(output, "workflows.json"),
      JSON.stringify({ checks }, null, 2),
    );
  }
  try {
    for (const [slug, selector] of [
      ["text-toolkit", "#text-input"],
      ["markdown-studio", "#markdown-input"],
      ["image-to-text", "#ocr-output"],
    ]) {
      await check(slug + "-save-edit-race", async () => {
        await open(slug);
        // OCR 的文字區在有結果時顯示；人工修正文字不需要啟動 OCR。
        if (slug === "image-to-text")
          await page.evaluate(() => {
            const n = document.querySelector("#ocr-output");
            n.closest("[hidden]")?.removeAttribute("hidden");
            n.disabled = false;
          });
        await page.locator(selector).fill("Version one · 第一版");
        await page.fill("#draft-name", "Acceptance draft");
        await page.click("#save-draft");
        await page.waitForFunction(
          () => typeof window.__finishSave === "function",
        );
        assert.equal(
          await page.evaluate(() => __savedPayload.data.text),
          "Version one · 第一版",
        );
        await page.locator(selector).fill("Version two · 尚未儲存");
        await page.evaluate(() => {
          __finishSave();
          window.__finishSave = null;
        });
        await page.waitForFunction(
          () => !document.querySelector("#save-draft").disabled,
        );
        assert.match(
          await page.locator("#draft-state").innerText(),
          /Unsaved changes/,
          "Editing during a save must remain unsaved",
        );
        assert.equal(await page.inputValue(selector), "Version two · 尚未儲存");
        assert.equal(
          await page.evaluate(
            () => window.KenseiWorkspace.items("draft").at(-1).data.text,
          ),
          "Version one · 第一版",
        );
        await page.click("#save-draft");
        await page.waitForFunction(
          () => typeof window.__finishSave === "function",
        );
        await page.evaluate(() => {
          __finishSave();
          window.__finishSave = null;
        });
        await page.waitForFunction(
          () => !document.querySelector("#save-draft").disabled,
        );
        assert.equal(
          await page.evaluate(
            () => window.KenseiWorkspace.items("draft").length,
          ),
          1,
          "Saving again updates the same draft",
        );
        assert.equal(
          await page.evaluate(
            () => window.KenseiWorkspace.items("draft")[0].data.text,
          ),
          "Version two · 尚未儲存",
        );
        await page.locator(selector).fill("Older save in flight");
        await page.click("#save-draft");
        await page.waitForFunction(
          () => typeof window.__finishSave === "function",
        );
        await page.locator(selector).evaluate((n) => {
          n.value = "Recovered local copy";
          window.dispatchEvent(new Event("tool-recovery-restored"));
        });
        await page.evaluate(() => {
          __finishSave();
          window.__finishSave = null;
        });
        await page.waitForFunction(
          () => !document.querySelector("#save-draft").disabled,
        );
        assert.match(await page.locator("#draft-state").innerText(), /Unsaved/);
        await page.click("#save-draft");
        await page.waitForFunction(
          () => typeof window.__finishSave === "function",
        );
        await page.evaluate(() => {
          __finishSave();
          window.__finishSave = null;
        });
        await page.waitForFunction(
          () => !document.querySelector("#save-draft").disabled,
        );
        assert.equal(
          await page.evaluate(
            () => window.KenseiWorkspace.items("draft").length,
          ),
          2,
          "A restored local copy must become a separate Workspace draft",
        );
      });
    }
    await check("recipe-account-change-and-double-save", async () => {
      await open("markdown-studio");
      await page.locator(".studio-recipes summary").click();
      await page
        .getByRole("button", { name: "Save as new", exact: true })
        .click();
      await page.waitForFunction(
        () => typeof window.__finishSave === "function",
      );
      const pending = page.getByRole("button", {
        name: "Save as new",
        exact: true,
      });
      assert(
        await pending.isDisabled(),
        "Recipe save must prevent duplicate concurrent writes",
      );
      await page.evaluate(() => __changeActor("qa-other-owner"));
      await page.waitForFunction(
        () => window.KenseiWorkspace.user?.id === "qa-other-owner",
      );
      await page.waitForSelector('[data-ready="true"]');
      assert.equal(
        await page.evaluate(
          () => window.KenseiWorkspace.items("preset").length,
        ),
        0,
        "Old-account preset must not enter the new account cache",
      );
    });
    // 真实核心流程已在批次回归中覆盖；这里补独立参考值和共享流程的回归。
    await check("checksum-independent-reference", async () => {
      await open("file-check");
      const bytes = Buffer.from("驗收樣本\nleading zero 00123\n");
      await page.setInputFiles("#check-files", {
        name: "校驗.txt",
        mimeType: "text/plain",
        buffer: bytes,
      });
      await page.click("#check-run");
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      await page.waitForFunction(
        (hash) =>
          [...document.querySelectorAll("#check-results textarea")].some(
            (n) => n.value === hash,
          ),
        hash,
      );
    });
    await check("csv-multiline-edit-retains-newlines", async () => {
      await open("data-studio");
      await page.fill("#data-csv", 'code,note\n00123,"line one\nline two"');
      await page.click("#data-csv-preview");
      await page.waitForSelector("#data-table td textarea");
      const cell = page.locator("#data-table td textarea");
      assert.equal(await cell.inputValue(), "line one\nline two");
      await cell.fill("line one\nmodified line two");
      await cell.dispatchEvent("change");
      assert.match(await page.inputValue("#data-csv"), /00123/);
      assert.match(
        await page.inputValue("#data-csv"),
        /line one\nmodified line two/,
      );
    });
    await check("search-words-and-qr-scan-workspace", async () => {
      await page.goto(base + "/tools/");
      await page.fill("#tool-search", "batch compress");
      assert.equal(await page.locator("[data-tool-card]:visible").count(), 1);
      await page.fill("#tool-search", "compress batch");
      assert.equal(await page.locator("[data-tool-card]:visible").count(), 1);
      await open("qr-studio");
      await page.getByRole("tab", { name: "Scan", exact: true }).click();
      assert(
        await page
          .getByPlaceholder("One text or URL per line; up to 50")
          .isHidden(),
        "Generation controls must not stay in the Scan workspace",
      );
      await page.getByRole("tab", { name: "Generate", exact: true }).click();
      assert(
        await page
          .getByPlaceholder("One text or URL per line; up to 50")
          .isVisible(),
      );
    });
    await check("cancel-help-keeps-editor-and-language", async () => {
      await open("markdown-studio");
      await page.fill("#markdown-input", "# Keep this · 保留\n\n00123");
      await page.evaluate(() => {
        window.__originalEditor = document.querySelector("#markdown-input");
        __originalEditor.focus();
        __originalEditor.setSelectionRange(2, 6);
      });
      await page.locator("[data-open-help]").click();
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.KenseiI18n.setLocale("zh-Hant"));
      assert.equal(
        await page.inputValue("#markdown-input"),
        "# Keep this · 保留\n\n00123",
      );
      assert(
        await page.evaluate(
          () => __originalEditor === document.querySelector("#markdown-input"),
        ),
      );
      await page.evaluate(() => window.KenseiI18n.setLocale("en"));
      assert.equal(
        await page.inputValue("#markdown-input"),
        "# Keep this · 保留\n\n00123",
      );
    });
    await check("password-modes-share-the-settings-panel", async () => {
      await open("password-generator");
      const mode = page.getByLabel(/^Generator mode/);
      assert(await mode.evaluate((n) => !!n.closest(".panel")));
      assert(await page.getByLabel(/^Word count/).isHidden());
      await mode.selectOption("words");
      assert(await page.getByLabel(/^Word count/).isVisible());
      assert(await page.locator("#password-length").isHidden());
      await page.click("#password-generate");
      await page.waitForFunction(
        () =>
          document.querySelector("#password-output").value.split("-").length ===
          6,
      );
      await page.getByLabel(/^Word count/).selectOption("7");
      assert.equal(await page.inputValue("#password-output"), "");
      assert(await page.locator("#password-copy").isDisabled());
      await mode.selectOption("password");
      assert(await page.locator("#password-length").isVisible());
      assert(await page.getByLabel(/^Word count/).isHidden());
    });
    await check("startup-failure-has-persistent-retry", async () => {
      await context.route("**/tool-scripts/advanced-text-compare.js", (r) =>
        r.abort("failed"),
      );
      await page.goto(base + "/tools/text-compare/");
      await page.waitForSelector("[data-load-error]");
      assert(
        await page
          .getByRole("button", { name: "Reload page", exact: true })
          .isVisible(),
      );
      await page.fill("#compare-left", "Keep input while the error is shown");
      assert.equal(
        await page.inputValue("#compare-left"),
        "Keep input while the error is shown",
      );
      assert.match(
        await page.locator(".tool-state-message").innerText(),
        /Save or download current work/,
      );
      await page.evaluate(() => window.KenseiI18n.setLocale("zh-Hant"));
      assert(await page.locator(".tool-feedback button").isVisible());
      for (const width of [320, 360, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        assert(await page.locator(".tool-feedback button").isVisible());
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      }
      await page.evaluate(() => window.KenseiI18n.setLocale("en"));
      await context.unroute("**/tool-scripts/advanced-text-compare.js");
      await page
        .getByRole("button", { name: "Reload page", exact: true })
        .click();
      await page.waitForSelector('[data-ready="true"]');
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    assert(
      checks.every((c) => c.status === "pass"),
      "Workflow failures: see workflows.json",
    );
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
