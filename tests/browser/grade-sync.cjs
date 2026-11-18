const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";

(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const database = new PGlite();
  const account = randomUUID(),
    stranger = randomUUID();
  await database.exec(require("../support/db-fixture.cjs").bootstrap);
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await database.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await database.query("insert into auth.users(id) values($1),($2)", [
    account,
    stranger,
  ]);
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
  });
  const url = base + "/tools/grade-planner/";
  const state = (page) => page.locator("#grade-sync");
  const field = (page) => page.locator("#grade-name");
  let queue = Promise.resolve(),
    offline = false,
    loseReceipt = false;
  const operations = [];
  async function device(user) {
    const context = await browser.newContext();
    await context.route("**/config.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "window.KENSEI_CONFIG={supabaseUrl:'https://fake.invalid',supabasePublishableKey:'test'};",
      }),
    );
    await context.route("**/vendor/supabase-2.119.0.js*", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `export function createClient(){return {
        auth:{getSession:async()=>({data:{session:{user:{id:"${user}"}}}}),onAuthStateChange(){}},
        from(){return{select(){return this;},order:async()=>({data:[]})}},
        rpc:(name,args)=>fetch("/__qa/grade/"+name,{method:"POST",body:JSON.stringify(args)}).then(res=>res.json())
      }}`,
      }),
    );
    await context.route("**/__qa/grade/*", async (route) => {
      const name = route.request().url().split("/").at(-1);
      const args = route.request().postDataJSON();
      if (
        ![
          "get_private_records",
          "get_private_record",
          "save_private_record",
        ].includes(name)
      )
        return route.fulfill({ json: { data: null, error: null } });
      queue = queue.then(async () => {
        if (offline && name === "save_private_record") {
          await route.fulfill({
            json: { data: null, error: { message: "Offline" } },
          });
          return;
        }
        await database.exec("set role authenticated");
        try {
          await database.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [user],
          );
          const parameters = Object.keys(args)
            .map((key, i) => key + "=>$" + (i + 1))
            .join(",");
          const reply = (
            await database.query(
              "select public." + name + "(" + parameters + ") value",
              Object.values(args),
            )
          ).rows[0].value;
          if (name === "save_private_record")
            operations.push(args.operation_id);
          if (loseReceipt && name === "save_private_record") {
            loseReceipt = false;
            await route.fulfill({
              json: {
                data: null,
                error: { message: "Lost the save acknowledgement" },
              },
            });
          } else await route.fulfill({ json: { data: reply, error: null } });
        } catch (error) {
          await route.fulfill({
            json: { data: null, error: { message: error.message } },
          });
        } finally {
          await database.exec("reset role");
        }
      });
      await queue;
    });
    return await context.newPage();
  }
  const sync = (page) =>
    state(page).getByText("Saved · Synced", { exact: true }).waitFor();
  const waitName = (page, name) =>
    page.waitForFunction(
      (expected) => document.querySelector("#grade-name").value === expected,
      name,
    );
  const nameAndSave = async (page, name) => {
    await field(page).fill(name);
    await page.locator("#grade-save").click();
  };
  try {
    const a = await device(account),
      b = await device(account),
      other = await device(stranger);
    await a.goto(url);
    await a.locator("#grade-copy").waitFor({ state: "attached" });
    await a.waitForFunction(
      () =>
        !document.querySelector("#grade-copy").hidden &&
        document.querySelector("[data-ready=true]"),
    );
    await a.locator("#grade-new").click();
    await nameAndSave(a, "First save");
    await a.waitForURL(/\?id=/);
    const id = new URL(a.url()).searchParams.get("id");
    await sync(a);
    await nameAndSave(a, "Same device, second save");
    await sync(a);
    assert.equal(new URL(a.url()).searchParams.get("id"), id);
    await b.goto(url + "?id=" + id);
    await waitName(b, "Same device, second save");
    await field(b).fill("Second device conflict");

    offline = true;
    await nameAndSave(a, "Saved locally while offline");
    await state(a)
      .getByText(/Sync failed/)
      .waitFor();
    offline = false;
    loseReceipt = true;
    await a.locator("#grade-retry").click();
    await a.waitForTimeout(150);
    await a.locator("#grade-retry").click();
    await sync(a);
    assert.equal(operations.at(-1), operations.at(-2));
    assert.equal(new URL(a.url()).searchParams.get("id"), id);
    await b.locator("#grade-save").click();
    await sync(b);
    assert.notEqual(new URL(b.url()).searchParams.get("id"), id);
    assert.equal(await field(b).inputValue(), "Second device conflict");
    await a.reload();
    await waitName(a, "Saved locally while offline");
    await other.goto(url + "?id=" + id);
    await other.waitForFunction(
      () => !document.querySelector("#grade-copy").hidden,
    );
    await other.locator("#grade-retry").click();
    await other.waitForLoadState("networkidle");
    assert.equal(await other.locator("#grade-editor").isVisible(), false);
    assert.equal(await other.locator("#grade-saved button").count(), 0);
    console.log(
      "PASS two browser devices with PGlite, repeated saves, offline retry with the same receipt ID, conflicts and account isolation",
    );
  } finally {
    await browser.close();
    await database.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
