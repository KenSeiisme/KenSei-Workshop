const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  {
    chromium,
  } = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const kind = process.argv[2] || "planner",
  tableName = kind === "planner" ? "study_planners" : "whiteboards";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8798",
  A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  checks = [];
(async () => {
  const { PGlite } = await import("@electric-sql/pglite"),
    db = new PGlite();
  await db.exec(require("./db-fixture.cjs").bootstrap);
  for (const f of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + f, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [A, B]);
  const browser = await chromium.launch({ channel: "msedge", headless: true }),
    contexts = [],
    errors = [];
  let fail = false,
    loseNextSave = false,
    chain = Promise.resolve(),
    delay = 0;
  const calls = [];
  const pass = (s) => {
    checks.push(s);
    console.log("PASS " + s);
  };
  async function context(user) {
    const c = await browser.newContext();
    contexts.push(c);
    await c.addInitScript(
      ({ id, recordKind }) => {
        window.__recordKind = recordKind;
        window.__testUser = id;
        try {
          window.__testUser = sessionStorage.getItem("qa-user") || id;
        } catch {}
      },
      { id: user, recordKind: kind },
    );
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: `export function createClient(){let listener;window.__switchUser=id=>{window.__testUser=id;listener?.(id?"SIGNED_IN":"SIGNED_OUT",id?{user:{id}}:null);};return{auth:{getSession:async()=>({data:{session:window.__testUser?{user:{id:window.__testUser}}:null}}),onAuthStateChange:fn=>{listener=fn;}},from(){return{select(){return this;},order:async()=>({data:[]})}},rpc:async(name,args)=>{const response=await fetch("/__qa/rpc/"+name,{method:"POST",headers:{"x-test-user":window.__testUser||""},body:JSON.stringify(args)});return response.json();}}}`,
        }),
    );
    await c.route("**/__qa/rpc/*", async (r) => {
      const args = JSON.parse(r.request().postData()),
        user = r.request().headers()["x-test-user"] || null,
        name = r.request().url().split("/").at(-1);
      calls.push({ name, args, user });
      if (fail) {
        await r.fulfill({
          json: { data: null, error: { message: "Offline" } },
        });
        return;
      }
      if (delay && name === "save_private_record")
        await new Promise((resolve) => setTimeout(resolve, delay));
      chain = chain.then(async () => {
        try {
          await db.exec("set role " + (user ? "authenticated" : "anon"));
          await db.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [user || ""],
          );
          const keys = Object.keys(args),
            data = (
              await db.query(
                "select public." +
                  name +
                  "(" +
                  keys.map((k, i) => k + "=>$" + (i + 1)).join(",") +
                  ") value",
                Object.values(args),
              )
            ).rows[0].value;
          if (loseNextSave && name === "save_private_record") {
            loseNextSave = false;
            await r.fulfill({
              json: {
                data: null,
                error: { message: "ACK lost after database commit" },
              },
            });
          } else await r.fulfill({ json: { data, error: null } });
        } catch (e) {
          await r.fulfill({
            json: { data: null, error: { message: e.message } },
          });
        } finally {
          await db.exec("reset role");
        }
      });
      await chain;
    });
    c.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    return c;
  }

  const slug = kind === "planner" ? "study-planner" : "whiteboard",
    nameField = kind === "planner" ? "#planner-name" : "#board-name",
    statusField = kind === "planner" ? "#planner-save-state" : "#board-state";
  const data = (name) =>
    kind === "planner"
      ? {
          version: 1,
          name,
          timeZone: "Asia/Kuala_Lumpur",
          courses: [],
          tasks: [],
        }
      : {
          version: 1,
          name,
          elements: [],
          appState: { viewBackgroundColor: "#ffffff", gridSize: 20 },
        };
  async function mutate(id, payload, revision) {
    const result = chain.then(async () => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        A,
      ]);
      try {
        return (
          await db.query(
            "select public.save_private_record($1,$2,$3,$4,$5,false,$6) value",
            [kind, id, payload, revision, crypto.randomUUID(), A],
          )
        ).rows[0].value;
      } finally {
        await db.exec("reset role");
      }
    });
    chain = result.then(() => {});
    return result;
  }
  async function openUI(c, id) {
    const p = await c.newPage();
    await p.goto(base + "/tools/" + slug + "/" + (id ? "?id=" + id : ""));
    await p.waitForSelector('[data-ready="true"]');
    await p.evaluate(async (slug) => {
      window.actualStore = (
        await import("/tool-scripts/" + slug + ".js")
      ).store;
      await actualStore.ready();
    }, slug);
    return p;
  }
  const settled = (p) =>
    p.waitForFunction(
      ({ statusField, nameField }) => {
        const v = document.querySelector(statusField).textContent,
          id = new URLSearchParams(location.search).get("id");
        return (
          v.includes("Synced") &&
          !v.includes("Unsaved") &&
          !v.includes("Saving edits") &&
          actualStore
            .rows()
            .some(
              (r) =>
                r.id === id &&
                r.data.name === document.querySelector(nameField).value,
            )
        );
      },
      { statusField, nameField },
    );
  try {
    const id = crypto.randomUUID();
    await mutate(id, data("UI initial"), 0);
    const c = await context(A),
      other = await context(A),
      p = await openUI(c, id),
      q = await openUI(other, id);
    await p.waitForFunction(
      (s) => document.querySelector(s).value === "UI initial",
      nameField,
    );
    await settled(p);
    await settled(q);
    await q.fill(nameField, "UI remote edit");
    await settled(q);
    await p.evaluate(() => actualStore.load(true));
    await p.waitForFunction(
      (s) => document.querySelector(s).value === "UI remote edit",
      nameField,
    );
    pass(kind + " actual editor refreshes a remote revision while idle");
    await p.fill(nameField, "UI dirty local");
    await chain;
    const row = (
      await db.query(
        "select * from public." + tableName + " where user_id=$1 and id=$2",
        [A, id],
      )
    ).rows[0];
    await mutate(id, { ...row.data, name: "UI newer remote" }, row.revision);
    await p.evaluate(() => actualStore.load(true));
    await settled(p);
    await chain;
    assert.equal(
      (
        await db.query(
          "select data->>'name' name from public." +
            tableName +
            " where user_id=$1 and id=$2",
          [A, id],
        )
      ).rows[0].name,
      "UI newer remote",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public." +
            tableName +
            " where user_id=$1 and data->>'name' like 'UI dirty local%'",
          [A],
        )
      ).rows[0].n,
      1,
    );
    pass(
      kind +
        " dirty editor retains its original revision and creates a conflict copy",
    );
    const guest = await context(null),
      g = await openUI(guest);
    await g.click(kind === "planner" ? "#planner-new" : "#board-new");
    await g.fill(nameField, "Explicit guest copy");
    await g.waitForTimeout(800);
    await Promise.all([
      g.waitForEvent("framenavigated"),
      g.evaluate((id) => {
        sessionStorage.setItem("qa-user", id);
        window.__switchUser(id);
      }, A),
    ]);
    await g.waitForSelector('[data-ready="true"]');
    await g.evaluate(async (slug) => {
      window.actualStore = (
        await import("/tool-scripts/" + slug + ".js")
      ).store;
      await actualStore.ready();
    }, slug);
    if (kind === "planner") {
      await g.locator("#planner-guest-copy summary").click();
      await g.selectOption("#planner-guest-plan", {
        label: "Explicit guest copy",
      });
      await g.click("#planner-copy-account");
    } else {
      await g.click("#board-guests");
      await g
        .locator("#board-guest-list button")
        .filter({ hasText: "Explicit guest copy" })
        .click();
    }
    await g.waitForFunction(
      (s) => document.querySelector(s).value.includes("Explicit guest copy"),
      nameField,
    );
    await settled(g);
    await chain;
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public." +
            tableName +
            " where user_id=$1 and data->>'name' like 'Explicit guest copy%'",
          [A],
        )
      ).rows[0].n,
      1,
    );
    pass(
      kind +
        " guest history uploads only through the actual Copy to account control",
    );
    assert.deepEqual(errors, []);
  } finally {
    for (const c of contexts) await c.close();
    await browser.close();
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
