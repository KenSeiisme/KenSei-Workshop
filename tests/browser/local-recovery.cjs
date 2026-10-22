const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8801";
const sdk = `export function createClient(){return {auth:{getSession:async()=>({data:{session:localStorage.getItem('qa-user')?{user:{id:localStorage.getItem('qa-user')}}:null}}),onAuthStateChange(){}},rpc:async()=>({data:null,error:null}),from(){let pending;const chain={select(){return this},eq(){return this},maybeSingle:async()=>({data:null}),order:async()=>({data:JSON.parse(localStorage.getItem('qa-rows')||'[]')}),upsert(row){pending=row;return this},single:async()=>{window.__manualWrites=(window.__manualWrites||0)+1;window.__lastSaved=pending;return {data:pending,error:null}}};return chain}}}`;
(async () => {
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    ctx = await browser.newContext(),
    errors = [],
    uploads = [];
  await ctx.route(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    (r) =>
      r.fulfill({
        body: sdk,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
      }),
  );
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.accept());
  });
  ctx.on("request", (r) => {
    if (["POST", "PUT", "PATCH"].includes(r.method())) uploads.push(r.url());
  });
  const p = await ctx.newPage();
  async function open(slug, page = p) {
    await page.goto(base + "/tools/" + slug + "/");
    await page.waitForSelector('[data-recovery-ready="true"]');
  }
  async function rows(page = p) {
    return page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("kensei-tool-recovery-v1", 1);
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction("snapshots"),
              q = tx.objectStore("snapshots").getAll();
            tx.oncomplete = () => {
              db.close();
              resolve(q.result);
            };
            tx.onerror = reject;
          };
          r.onerror = reject;
        }),
    );
  }
  async function saved(page = p) {
    await page.waitForFunction(() =>
      document
        .querySelector("[data-recovery-state]")
        .textContent.startsWith("Recovery saved locally"),
    );
  }
  try {
    await open("text-toolkit");
    assert.equal(await p.locator("#remember-on-device").isChecked(), false);
    await p.fill("#text-input", "Not saved by default");
    await p.waitForTimeout(650);
    assert.equal((await rows()).length, 0);
    await p.check("#remember-on-device");
    await p.fill("#text-input", "中文 English Bahasa Melayu");
    await p.fill("#draft-name", "Private notes");
    await saved();
    assert.deepEqual(Object.keys((await rows())[0].fields).sort(), [
      "draft-name",
      "text-input",
    ]);
    await p.reload();
    await p.waitForSelector("[data-recovery-ready]");
    assert.equal(await p.inputValue("#text-input"), "");
    await p.locator("[data-restore-recovery]").first().click();
    assert.equal(
      await p.inputValue("#text-input"),
      "中文 English Bahasa Melayu",
    );
    assert.equal(
      await p.evaluate(() => window.KenseiWorkspace.items("draft").length),
      0,
    );
    console.log(
      "PASS recovery off by default; explicit restore retains bilingual text and never saves a Workspace draft",
    );
    const second = await ctx.newPage();
    await open("text-toolkit", second);
    await second.fill("#text-input", "Independent second tab");
    await saved(second);
    await p.fill("#text-input", "Independent first tab");
    await saved();
    const texts = (await rows()).map((r) => r.fields["text-input"]);
    assert(
      texts.includes("Independent second tab") &&
        texts.includes("Independent first tab"),
    );
    assert((await rows()).length <= 3);
    await p.uncheck("#remember-on-device");
    await p.waitForFunction(() =>
      document
        .querySelector("[data-recovery-state]")
        .textContent.includes("Recovery off"),
    );
    assert.equal((await rows()).length, 0);
    assert.equal(
      await second.inputValue("#text-input"),
      "Independent second tab",
    );
    await second.waitForFunction(
      () => !document.querySelector("#remember-on-device").checked,
    );
    console.log(
      "PASS multi-tab copies are isolated, capped at three and cleared without changing active editors",
    );
    await p.check("#remember-on-device");
    await p.fill("#text-input", "Guest private copy");
    await saved();
    const A = "11111111-1111-4111-8111-111111111111",
      B = "22222222-2222-4222-8222-222222222222";
    await p.evaluate((id) => localStorage.setItem("qa-user", id), A);
    await p.reload();
    await p.waitForSelector("[data-recovery-ready]");
    assert.equal(await p.isChecked("#remember-on-device"), false);
    assert.equal(await p.locator("[data-restore-recovery]").count(), 0);
    await p.check("#remember-on-device");
    await p.fill("#text-input", "Account A private copy");
    await saved();
    await p.evaluate((id) => localStorage.setItem("qa-user", id), B);
    await p.reload();
    await p.waitForSelector("[data-recovery-ready]");
    assert.equal(await p.isChecked("#remember-on-device"), false);
    assert.equal(await p.locator("[data-restore-recovery]").count(), 0);
    await p.locator("[data-clear-recovery]").click();
    assert((await rows()).some((r) => r.scope === A));
    assert((await rows()).some((r) => r.scope === "guest"));
    console.log(
      "PASS guest history is not imported and account B cannot view or clear account A recovery",
    );
    await p.evaluate((id) => localStorage.setItem("qa-user", id), A);
    for (const [slug, selector, text] of [
      ["markdown-studio", "#markdown-input", "# 中文 recovery"],
      ["text-compare", "#compare-left", "left 中文"],
      ["image-to-text", "#ocr-output", "recognized 中文"],
      ["data-studio", "#data-json", '[{"message":"中文"}]'],
      ["calculator-studio", "#calc-expression", "sqrt(144)"],
    ]) {
      await open(slug);
      await p.check("#remember-on-device");
      await p.fill(selector, text);
      await saved();
      await p.reload();
      await p.waitForSelector("[data-recovery-ready]");
      await p.locator("[data-restore-recovery]").first().click();
      assert.equal(await p.inputValue(selector), text);
    }
    await open("subtitle-studio");
    await p.check("#remember-on-device");
    await p.fill("#sub-text", "字幕 recovery");
    await p.click("#sub-save");
    await saved();
    await p.reload();
    await p.waitForSelector("[data-recovery-ready]");
    await p.locator("[data-restore-recovery]").first().click();
    assert.match(await p.locator("#sub-list").textContent(), /字幕 recovery/);
    console.log(
      "PASS all seven recovery adapters, including editable subtitle cues",
    );
    await open("data-studio");
    await p.fill("#data-json", '{"small":true}');
    await saved();
    const previous = (await rows())
      .filter((r) => r.tool === "data-studio")
      .map((r) => JSON.stringify(r.fields));
    await p.locator("#data-json").evaluate((n) => {
      n.value = "x".repeat(2 * 1024 * 1024 + 1);
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await p.waitForFunction(() =>
      document
        .querySelector("[data-recovery-state]")
        .textContent.includes("exceeds 2 MB"),
    );
    assert.equal(
      (await p.inputValue("#data-json")).length,
      2 * 1024 * 1024 + 1,
    );
    assert.deepEqual(
      (await rows())
        .filter((r) => r.tool === "data-studio")
        .map((r) => JSON.stringify(r.fields)),
      previous,
    );
    console.log(
      "PASS oversized snapshots preserve full editor text and the correctly dated older copy",
    );
    const original = {
      id: "33333333-3333-4333-8333-333333333333",
      type: "draft",
      data: {
        tool: "markdown-studio",
        name: "Original saved draft",
        text: "Original remote content",
      },
      updated_at: "2026-10-22T01:00:00Z",
    };
    await p.evaluate(
      (row) => localStorage.setItem("qa-rows", JSON.stringify([row])),
      original,
    );
    await p.goto(base + "/tools/markdown-studio/?draft=" + original.id);
    await p.waitForSelector("[data-recovery-ready]");
    assert.equal(await p.inputValue("#markdown-input"), original.data.text);
    await p.locator("[data-restore-recovery]").first().click();
    await p.fill("#draft-name", "Recovered draft");
    await p.click("#save-draft");
    await p.waitForFunction(() => window.__manualWrites === 1);
    assert.equal(
      await p.evaluate(() => window.__lastSaved.data.tool),
      "markdown-studio",
    );
    assert.notEqual(await p.evaluate(() => window.__lastSaved.id), original.id);
    assert.equal(
      await p.evaluate(
        () => JSON.parse(localStorage.getItem("qa-rows"))[0].data.text,
      ),
      original.data.text,
    );
    await p.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "snapshots")
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    await p.fill("#markdown-input", "Keep this text after quota failure");
    await p.waitForFunction(() =>
      document
        .querySelector("[data-recovery-state]")
        .textContent.includes("could not be saved"),
    );
    assert.equal(
      await p.inputValue("#markdown-input"),
      "Keep this text after quota failure",
    );
    assert.deepEqual(uploads, []);
    assert.deepEqual(errors, []);
    const blocked = await browser.newContext();
    await blocked.route("**/config.js", (r) =>
      r.fulfill({
        body: "window.KENSEI_CONFIG={}",
        contentType: "application/javascript",
      }),
    );
    await blocked.addInitScript(() => {
      indexedDB.open = () => {
        throw Error("Storage blocked");
      };
    });
    const b = await blocked.newPage();
    await b.goto(base + "/tools/text-compare/");
    await b.waitForSelector("[data-ui-ready]");
    await b.waitForFunction(() =>
      document
        .querySelector("[data-recovery-state]")
        .textContent.includes("Storage blocked"),
    );
    await b.fill("#compare-left", "Still editable");
    assert.equal(await b.inputValue("#compare-left"), "Still editable");
    await blocked.close();
    console.log(
      "PASS blocked storage leaves tools usable; recovery makes zero upload requests and manual save remains explicit",
    );
  } finally {
    await ctx.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
