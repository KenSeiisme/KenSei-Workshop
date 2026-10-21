const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  {
    chromium,
  } = require("C:/Users/haozh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
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
    await c.addInitScript((id) => {
      window.__testUser = id;
      try {
        window.__testUser = sessionStorage.getItem("qa-user") || id;
      } catch {}
    }, user);
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
          await r.fulfill({ json: { data, error: null } });
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
  async function open(c) {
    const p = await c.newPage();
    await p.goto(base + "/tools/flashcards/");
    await p.waitForSelector('[data-ready="true"]');
    await p.evaluate(async () => {
      window.cardStore = await import("/tool-scripts/flashcard-store.js");
      await cardStore.ready();
    });
    return p;
  }
  const put = (p, data, id) =>
    p.evaluate(async ({ data, id }) => (await cardStore.put(data, id)).id, {
      data,
      id,
    });
  const synced = (p) =>
    p.waitForFunction(
      () =>
        document.querySelector("#deck-save-state").textContent ===
        "Saved · Synced",
    );
  const payload = (name) => ({
    name,
    cards: [
      {
        id: crypto.randomUUID(),
        front: "问题",
        back: "Private answer",
        known: false,
      },
    ],
  });
  try {
    const c1 = await context(A),
      c2 = await context(A),
      p = await open(c1),
      q = await open(c2);
    const first = payload("Private deck"),
      id = await put(p, first);
    await synced(p);
    await q.evaluate(() => cardStore.load(true));
    assert.equal(
      await q.evaluate(() => cardStore.rows()[0].data.name),
      "Private deck",
    );
    fail = true;
    await put(p, { ...first, name: "Offline edited" }, id);
    await p.waitForFunction(() =>
      document
        .querySelector("#deck-save-state")
        .textContent.includes("Sync failed"),
    );
    await p.reload();
    await p.waitForSelector('[data-ready="true"]');
    await p.evaluate(async () => {
      window.cardStore = await import("/tool-scripts/flashcard-store.js");
      await cardStore.ready();
    });
    assert.equal(
      await p.evaluate(() => cardStore.rows()[0].data.name),
      "Offline edited",
    );
    fail = false;
    await p.evaluate(() => cardStore.flush());
    await synced(p);
    const saved = (
      await db.query(
        "select data from public.flashcard_decks where user_id=$1 and id=$2",
        [A, id],
      )
    ).rows[0].data;
    assert.equal(saved.name, "Offline edited");
    pass(
      "private two-device loading, IndexedDB persistence and idempotent offline retry",
    );
    // The second device still has revision 1. Its offline edit must become a copy.
    fail = true;
    await put(q, { ...first, name: "Other device" }, id);
    await q.waitForFunction(() =>
      document
        .querySelector("#deck-save-state")
        .textContent.includes("Sync failed"),
    );
    fail = false;
    await q.evaluate(() => cardStore.flush());
    await synced(q);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.flashcard_decks where user_id=$1 and not deleted",
          [A],
        )
      ).rows[0].n,
      2,
    );
    assert.ok(
      await q.evaluate(() =>
        cardStore
          .rows()
          .some(
            (r) =>
              r.id !== window.originalId &&
              r.data.name.includes("conflict copy"),
          ),
      ),
    );
    pass("stale device edits preserve a separate conflict deck");
    const guest = await context(null),
      g = await open(guest);
    await put(g, payload("Guest only"));
    await Promise.all([
      g.waitForEvent("framenavigated"),
      g.evaluate((id) => {
        sessionStorage.setItem("qa-user", id);
        window.__switchUser(id);
      }, B),
    ]);
    await g.waitForSelector('[data-ready="true"]');
    await g.evaluate(async () => {
      window.cardStore = await import("/tool-scripts/flashcard-store.js");
      await cardStore.ready();
    });
    await g.waitForFunction(
      () =>
        !document
          .querySelector("#deck-list")
          .textContent.includes("Guest only"),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.flashcard_decks where user_id=$1",
          [B],
        )
      ).rows[0].n,
      0,
    );
    assert.ok(
      !(await g.evaluate(() =>
        cardStore.rows().some((r) => r.data.name === "Guest only"),
      )),
    );
    pass("guest history stays separate when an account signs in");
    // Two tabs share IndexedDB; writes and acknowledgements must not overwrite other queued decks.
    const tab = await open(c1);
    fail = true;
    const [left, right] = await Promise.all([
      put(p, payload("Tab left")),
      put(tab, payload("Tab right")),
    ]);
    fail = false;
    await Promise.all([
      p.evaluate(() => cardStore.flush()),
      tab.evaluate(() => cardStore.flush()),
    ]);
    await synced(p);
    await synced(tab);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.flashcard_decks where user_id=$1 and id in ($2,$3)",
          [A, left, right],
        )
      ).rows[0].n,
      2,
    );
    pass("simultaneous tabs preserve both pending queues and deck records");
    await p.evaluate(() => cardStore.remove(cardStore.rows()[0].id));
    await p.evaluate(() => cardStore.flush());
    await q.evaluate(() => cardStore.load(true));
    const activeIds = (
      await db.query(
        "select id from public.flashcard_decks where user_id=$1 and not deleted",
        [A],
      )
    ).rows.map((x) => x.id);
    assert.ok(
      await q.evaluate(
        (ids) => cardStore.rows().every((r) => ids.includes(r.id)),
        activeIds,
      ),
    );
    pass("deletion tombstones remove stale local copies");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/fifth-sync-results.json",
      JSON.stringify({ base, checks, errors }, null, 2),
    );
  } finally {
    for (const c of contexts) await c.close();
    await browser.close();
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
