const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  chromium,
} = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const sdk = `
export function createClient(url, key, options) {
  window.__sdkOptions = options;
  window.__sdkProject = url;
  let listener;
  const mode = window.__authScenario;
  const signed = () => ['success', 'cloud-error'].includes(mode) && !sessionStorage.getItem('mock-signed-out');
  const session = () => signed() ? { user: { id: 'mock-user', email: 'test@example.invalid' } } : null;
  window.__expireSession = () => { sessionStorage.setItem('mock-signed-out','1'); listener?.('SIGNED_OUT',null); };
  return {
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      exchangeCodeForSession: async code => {
        sessionStorage.setItem('exchange-count', String(+(sessionStorage.getItem('exchange-count') || 0) + 1));
        if (options.auth.detectSessionInUrl !== false) throw new Error('Automatic exchange must be disabled');
        return { error: mode === 'exchange-error' ? new Error('Used or invalid code') : null };
      },
      signInWithOAuth: async opts => { window.__oauthOptions = opts; if (mode === 'oauth-error') throw new Error('Network failed'); return { error: null }; },
      onAuthStateChange: fn => { listener = fn; },
      signOut: async () => { window.__expireSession(); return {error:null}; }
    },
    from: table => ({
      select() { return this; },
      async order() {
        return { data: mode === 'cloud-error' ? null : [{ id: 'cloud-draft', type: 'draft', data: { name: 'Cloud draft', text: 'A synced thought.' }, updated_at: '2026-10-19T00:00:00Z' }], error: mode === 'cloud-error' ? new Error('Permission denied') : null };
      }
    })
  };
}`;
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
  const results = [];
  async function scenario(mode, route, check) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addInitScript((value) => {
      window.__authScenario = value;
    }, mode);
    await context.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) =>
        mode === "sdk-error"
          ? r.fulfill({
              status: 503,
              body: "Unavailable",
              headers: { "access-control-allow-origin": "*" },
            })
          : r.fulfill({
              contentType: "application/javascript",
              body: sdk,
              headers: { "access-control-allow-origin": "*" },
            }),
    );
    try {
      await page.goto(base + route);
      await check(page);
      assert.deepEqual(errors, []);
      results.push(mode);
      console.log("PASS auth " + mode);
    } finally {
      await context.close();
    }
  }
  try {
    await scenario("guest", "/", async (p) => {
      await p.waitForFunction(
        () => !document.querySelector("#google-login").disabled,
      );
      assert.equal(
        await p.evaluate(() => window.__sdkProject),
        "https://psikamavostoyeuccxqr.supabase.co",
      );
      assert.equal(
        await p.evaluate(() => window.__sdkOptions.auth.detectSessionInUrl),
        false,
      );
      await p.locator("[data-sign-in]").first().click();
      await p.locator("#google-login").click();
      assert.deepEqual(await p.evaluate(() => window.__oauthOptions), {
        provider: "google",
        options: { redirectTo: base + "/auth/callback/" },
      });
    });
    await scenario(
      "success",
      "/auth/callback/?code=single-use-example",
      async (p) => {
        await p.waitForURL(base + "/workspace/");
        await p.waitForFunction(
          () => document.querySelector("#draft-count").textContent === "1",
        );
        assert.equal(
          await p.evaluate(() => sessionStorage.getItem("exchange-count")),
          "1",
        );
        assert(
          (await p.locator("#saved-drafts").textContent()).includes(
            "Cloud draft",
          ),
        );
        assert(!p.url().includes("code="));
        await p.evaluate(() =>
          localStorage.setItem(
            "kensei-workshop:v1:guest",
            JSON.stringify({
              items: [
                {
                  id: "guest-backup",
                  type: "draft",
                  data: {
                    name: "Guest backup",
                    text: "Private to this browser",
                  },
                },
              ],
            }),
          ),
        );
        await p.evaluate(() => window.__expireSession());
        await p.waitForFunction(() =>
          document
            .querySelector("#workspace-account")
            .textContent.includes("On this device"),
        );
        assert.equal(
          await p.evaluate(() =>
            localStorage.getItem("kensei-workshop:v1:mock-user"),
          ),
          null,
        );
        assert(
          !(await p.locator("#saved-drafts").textContent()).includes(
            "Cloud draft",
          ),
        );
        assert(
          (await p.locator("#saved-drafts").textContent()).includes(
            "Guest backup",
          ),
        );
      },
    );
    await scenario(
      "exchange-error",
      "/auth/callback/?code=invalid-example",
      async (p) => {
        await p.waitForFunction(() =>
          document
            .querySelector("#callback-status")
            .textContent.includes("could not"),
        );
        assert.equal(
          await p.evaluate(() => sessionStorage.getItem("exchange-count")),
          "1",
        );
        assert(!p.url().includes("code="));
        await p.locator("[data-sign-in]").first().click();
        assert(await p.locator("#google-login").isEnabled());
      },
    );
    await scenario(
      "guest",
      "/auth/callback/?error=access_denied",
      async (p) => {
        await p.waitForFunction(() =>
          document
            .querySelector("#callback-status")
            .textContent.includes("could not"),
        );
        assert.equal(
          await p.evaluate(() => sessionStorage.getItem("exchange-count")),
          null,
        );
        assert(!p.url().includes("error="));
      },
    );
    await scenario("oauth-error", "/", async (p) => {
      await p.waitForFunction(
        () => !document.querySelector("#google-login").disabled,
      );
      await p.locator("[data-sign-in]").first().click();
      await p.locator("#google-login").click();
      await p.waitForFunction(() =>
        document
          .querySelector("#auth-note")
          .textContent.includes("Could not open"),
      );
      assert(await p.locator("#google-login").isEnabled());
    });
    await scenario("cloud-error", "/workspace/", async (p) => {
      await p.waitForFunction(() =>
        document
          .querySelector("#workspace-account")
          .textContent.includes("Sync unavailable"),
      );
      assert(
        (await p.locator("[data-auth-label]").textContent()).includes(
          "Account",
        ),
      );
      await p.locator("#account-toggle").click();
      assert(
        await p.locator('#account-menu a[href="/workspace/"]').isVisible(),
      );
      await p.keyboard.press("Escape");
      assert(
        !(await p.locator("#workspace-account").textContent()).includes(
          "Cloud saves enabled",
        ),
      );
    });
    await scenario("sdk-error", "/tools/text-toolkit/", async (p) => {
      await p.waitForFunction(() =>
        document
          .querySelector("#auth-note")
          .textContent.includes("unavailable"),
      );
      await p.locator("#text-input").fill("Still works locally.");
      assert.equal(await p.locator("#stat-words").textContent(), "3");
      await p.locator("[data-sign-in]").first().click();
      assert(await p.locator("#google-login").isDisabled());
    });
    fs.mkdirSync("_qa", { recursive: true });
    fs.writeFileSync(
      "_qa/auth-results.json",
      JSON.stringify(
        { mockedScenarios: results, realUserLoginTested: false },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
