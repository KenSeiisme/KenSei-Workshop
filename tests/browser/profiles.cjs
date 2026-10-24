const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium } = require("../support/browser.cjs");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8794";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const sdk = `export function createClient(){const initial=window.__qaUser,actor=()=>{const x=localStorage.getItem('__qa_actor');return x==='guest'?null:x||initial;};let listener;const headers=()=>({'x-test-user':actor()||''});return {auth:{getSession:async()=>({data:{session:actor()?{user:{id:actor(),email:'secret@example.invalid'}}:null}}),exchangeCodeForSession:async()=>{sessionStorage.setItem('exchanges',String(+(sessionStorage.getItem('exchanges')||0)+1));return{error:null};},signInWithOAuth:async opts=>{window.__oauth=opts;return{error:null};},onAuthStateChange:fn=>listener=fn,signOut:async()=>{localStorage.setItem('__qa_actor','guest');listener?.('SIGNED_OUT',null);return{error:null};}},from(){return{select(){return this;},order:async()=>({data:[],error:null})}},rpc:async(name,args)=>{const r=await fetch('/__qa/rpc/'+name,{method:'POST',headers:headers(),body:JSON.stringify(args)});return r.json();},storage:{from(){return{upload:async(path,blob)=>{const r=await fetch('/__qa/storage/upload?path='+encodeURIComponent(path),{method:'POST',headers:{...headers(),'content-type':'image/webp'},body:blob});return r.json();},remove:async(paths)=>{const r=await fetch('/__qa/storage/remove',{method:'POST',headers:headers(),body:JSON.stringify(paths)});return r.json();}};}}};}`;
(async () => {
  const { PGlite } = await import("@electric-sql/pglite"),
    db = new PGlite();
  await db.exec(require("../support/db-fixture.cjs").bootstrap);
  for (const file of fs.readdirSync("supabase/migrations").sort())
    await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
  await db.query("insert into auth.users values($1,$2),($3,$4)", [
    A,
    {
      full_name: "Google 王明",
      avatar_url: "https://lh3.googleusercontent.com/a/test",
    },
    B,
    { full_name: "Google 王明" },
  ]);
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "msedge",
      headless: true,
    }),
    contexts = [],
    errors = [],
    checks = [],
    blobs = new Map();
  let failUpdate = false,
    failEnsure = false,
    chain = Promise.resolve();
  async function sqlAs(id, fn) {
    await db.exec(
      `set role ${id ? "authenticated" : "anon"};select set_config('request.jwt.claim.sub','${id || ""}',false);`,
    );
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }
  async function context(id = null) {
    const c = await browser.newContext({ reducedMotion: "reduce" });
    contexts.push(c);
    await c.addInitScript((id) => (window.__qaUser = id), id);
    await c.route(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
      (r) =>
        r.fulfill({
          contentType: "application/javascript",
          body: sdk,
          headers: { "access-control-allow-origin": "*" },
        }),
    );
    await c.route("https://*.googleusercontent.com/**", (r) =>
      r.fulfill({ status: 404, body: "Unavailable" }),
    );
    await c.route("**/storage/v1/object/public/avatars/**", (r) => {
      const path = decodeURIComponent(r.request().url().split("/avatars/")[1]);
      return blobs.has(path)
        ? r.fulfill({ contentType: "image/webp", body: blobs.get(path) })
        : r.fulfill({ status: 404, body: "Not found" });
    });
    await c.route("**/__qa/**", async (r) => {
      const req = r.request(),
        id = req.headers()["x-test-user"] || null,
        url = new URL(req.url());
      chain = chain.then(async () => {
        try {
          if (url.pathname.startsWith("/__qa/rpc/")) {
            const name = url.pathname.split("/").at(-1),
              args = JSON.parse(req.postData());
            if (
              (name === "update_my_profile" && failUpdate) ||
              (name === "ensure_my_profile" && failEnsure)
            )
              throw new Error("Profile connection unavailable");
            const keys = Object.keys(args),
              query = `select public.${name}(${keys.map((k, i) => '"' + k + '"=>$' + (i + 1)).join(",")}) value`;
            const data = await sqlAs(
              id,
              async () =>
                (await db.query(query, Object.values(args))).rows[0].value,
            );
            await r.fulfill({ json: { data, error: null } });
          } else if (url.pathname.endsWith("/upload")) {
            const path = url.searchParams.get("path"),
              bytes = req.postDataBuffer();
            assert(bytes.length <= 2097152);
            await sqlAs(id, () =>
              db.query(
                "insert into storage.objects(bucket_id,name,owner_id) values('avatars',$1,$2)",
                [path, id],
              ),
            );
            blobs.set(path, bytes);
            await r.fulfill({ json: { data: { path }, error: null } });
          } else {
            const paths = JSON.parse(req.postData());
            for (const path of paths) {
              const rows = await sqlAs(id, () =>
                db.query(
                  "delete from storage.objects where name=$1 returning name",
                  [path],
                ),
              );
              if (rows.rows.length) blobs.delete(path);
            }
            await r.fulfill({ json: { data: [], error: null } });
          }
        } catch (e) {
          await r.fulfill({
            json: { data: null, error: { message: e.message } },
          });
        }
      });
      await chain;
    });
    c.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    return c;
  }
  async function page(c, path) {
    const p = await c.newPage();
    await p.bringToFront();
    await p.goto(base + path, { waitUntil: "domcontentloaded" });
    return p;
  }
  async function check(name, fn) {
    await fn();
    checks.push(name);
    console.log("PASS " + name);
  }
  try {
    const guest = await context(),
      typing = await page(guest, "/tools/typing-sprint/");
    await typing.waitForSelector('[data-ready="true"]');
    await check(
      "Public default, guest login return and no automatic countdown",
      async () => {
        assert.equal(
          await typing.locator("#typing-mode").inputValue(),
          "ranked",
        );
        await typing.locator("#typing-start").click();
        assert(await typing.locator("#auth-dialog").isVisible());
        await typing.locator("#google-login").click();
        assert.equal(
          await typing.evaluate(
            () =>
              JSON.parse(sessionStorage.getItem("kensei-workshop:auth-return"))
                .path,
          ),
          "/tools/typing-sprint/",
        );
        await typing.evaluate(
          (id) => localStorage.setItem("__qa_actor", id),
          A,
        );
        await typing.goto(base + "/auth/callback/?code=mock-google");
        await typing.waitForURL(base + "/tools/typing-sprint/");
        await typing.waitForFunction(() =>
          document
            .querySelector("#typing-player")
            .textContent.includes("Google 王明"),
        );
        assert.equal(await typing.locator("#typing-time").textContent(), "60");
        assert(await typing.locator("#typing-input").isDisabled());
        assert.equal(
          await typing.evaluate(() => sessionStorage.getItem("exchanges")),
          "1",
        );
        assert.equal(
          (
            await db.query(
              "select * from public.typing_profiles where user_id=$1",
              [A],
            )
          ).rows.length,
          1,
        );
      },
    );
    const edit = await page(guest, "/profile/");
    await edit.waitForSelector("#profile-form:not([hidden])");
    let publicId, firstPath;
    await check(
      "profile fields, text safety, public link and stable identity",
      async () => {
        assert.equal(
          await edit.locator("#profile-name").inputValue(),
          "Google 王明",
        );
        await edit.locator("#profile-name").fill("Alex 王明 O'Connor");
        await edit
          .locator("#profile-bio")
          .fill("<script>alert(1)</script> A new story.");
        await edit.locator("#profile-save").click();
        await edit.waitForFunction(() =>
          document
            .querySelector("#profile-status")
            .textContent.startsWith("Profile saved"),
        );
        publicId = new URL(
          await edit.locator("#profile-view-public").getAttribute("href"),
          base,
        ).searchParams.get("id");
        const view = await page(await context(), "/profile/?id=" + publicId);
        await view.waitForSelector("#public-profile:not([hidden])");
        assert.equal(
          await view.locator("#public-name").textContent(),
          "Alex 王明 O'Connor",
        );
        assert.match(
          await view.locator("#public-bio").textContent(),
          /<script>/,
        );
        assert.equal(await view.locator("#public-profile script").count(), 0);
        assert(
          !(await view.locator("#public-profile").textContent()).includes(
            "secret@example.invalid",
          ),
        );
        await view.close();
      },
    );
    const image = Buffer.from(
      await edit.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 300;
        c.height = 100;
        const x = c.getContext("2d");
        x.fillStyle = "red";
        x.fillRect(0, 0, 100, 100);
        x.fillStyle = "lime";
        x.fillRect(100, 0, 100, 100);
        x.fillStyle = "blue";
        x.fillRect(200, 0, 100, 100);
        return c.toDataURL().split(",")[1];
      }),
      "base64",
    );
    await check(
      "avatar prepares locally, failed save retries without duplicate upload",
      async () => {
        await edit.locator("#profile-avatar-file").setInputFiles({
          name: "avatar.png",
          mimeType: "image/png",
          buffer: image,
        });
        await edit.waitForFunction(() =>
          document
            .querySelector("#profile-avatar img")
            ?.src.startsWith("blob:"),
        );
        assert.equal(blobs.size, 0);
        const pixel = await edit
          .locator("#profile-avatar img")
          .evaluate((img) => {
            const c = document.createElement("canvas");
            c.width = c.height = 512;
            const x = c.getContext("2d");
            x.drawImage(img, 0, 0);
            return {
              w: img.naturalWidth,
              h: img.naturalHeight,
              p: [...x.getImageData(256, 256, 1, 1).data],
            };
          });
        assert.equal(pixel.w, 512);
        assert.equal(pixel.h, 512);
        assert(pixel.p[1] > 240 && pixel.p[0] < 20);
        failUpdate = true;
        await edit.locator("#profile-save").click();
        await edit.waitForFunction(() =>
          document
            .querySelector("#profile-status")
            .textContent.startsWith("Save failed"),
        );
        assert.equal(blobs.size, 1);
        firstPath = [...blobs.keys()][0];
        assert.equal(
          await edit.locator("#profile-name").inputValue(),
          "Alex 王明 O'Connor",
        );
        failUpdate = false;
        await edit.locator("#profile-save").click();
        await edit.waitForFunction(() =>
          document
            .querySelector("#profile-status")
            .textContent.startsWith("Profile saved"),
        );
        assert.equal(blobs.size, 1);
        assert.equal(
          (
            await db.query(
              "select avatar_path from public.typing_profiles where user_id=$1",
              [A],
            )
          ).rows[0].avatar_path,
          firstPath,
        );
      },
    );
    await check(
      "avatar replacement, deletion, invalid input and repeated login",
      async () => {
        await edit.locator("#profile-avatar-file").setInputFiles({
          name: "new.png",
          mimeType: "image/png",
          buffer: image,
        });
        await edit.waitForFunction(() =>
          document
            .querySelector("#profile-avatar img")
            ?.src.startsWith("blob:"),
        );
        await edit.locator("#profile-save").click();
        await edit.waitForFunction(() =>
          document
            .querySelector("#profile-status")
            .textContent.startsWith("Profile saved"),
        );
        await chain;
        assert.equal(blobs.size, 1);
        assert(!blobs.has(firstPath));
        await edit.locator("#profile-avatar-file").setInputFiles({
          name: "big.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(5 * 1048576 + 1),
        });
        await edit.waitForFunction(() =>
          document
            .querySelector("#profile-status")
            .textContent.includes("up to 5 MB"),
        );
        await edit.locator("#profile-avatar-file").setInputFiles({
          name: "broken.png",
          mimeType: "image/png",
          buffer: Buffer.from("broken"),
        });
        await edit.waitForFunction(
          () =>
            document
              .querySelector("#profile-status")
              .textContent.includes("could not") ||
            document
              .querySelector("#profile-status")
              .textContent.includes("decoded"),
        );
        await edit.locator("#profile-remove-avatar").click();
        await edit.locator("#profile-save").click();
        await edit.waitForFunction(() =>
          document
            .querySelector("#profile-status")
            .textContent.startsWith("Profile saved"),
        );
        await chain;
        assert.equal(blobs.size, 0);
        await edit.reload({ waitUntil: "domcontentloaded" });
        await edit.waitForSelector("#profile-form:not([hidden])");
        assert.equal(
          await edit.locator("#profile-name").inputValue(),
          "Alex 王明 O'Connor",
        );
        assert.equal(await edit.locator("#profile-avatar img").count(), 0);
      },
    );
    await check(
      "automatic Public score, profile links, best scores and name changes",
      async () => {
        await typing.reload({ waitUntil: "domcontentloaded" });
        await typing.waitForSelector('[data-ready="true"]');
        await typing.clock.install();
        await typing.locator("#typing-start").click();
        await typing.waitForFunction(
          () => !document.querySelector("#typing-input").disabled,
        );
        await typing
          .locator("#typing-input")
          .fill("Morning light settles on the workshop desk.");
        await chain;
        await db.query(
          "update public.typing_test_sessions set started_at=clock_timestamp()-interval '61 seconds' where user_id=$1",
          [A],
        );
        await typing.clock.fastForward(60010);
        await typing.waitForFunction(() =>
          document
            .querySelector("#typing-status")
            .textContent.includes("Verified."),
        );
        await typing.waitForSelector("#leaderboard-rows a");
        assert(
          (
            await typing
              .locator("#leaderboard-rows a")
              .first()
              .getAttribute("href")
          ).includes(publicId),
        );
        await edit.locator("#profile-name").fill("Changed Name");
        await edit.locator("#profile-save").click();
        await edit.waitForFunction(() =>
          document
            .querySelector("#profile-status")
            .textContent.startsWith("Profile saved"),
        );
        const p = await page(await context(), "/profile/?id=" + publicId);
        await p.waitForSelector("#public-profile:not([hidden])");
        assert.equal(
          await p.locator("#public-name").textContent(),
          "Changed Name",
        );
        assert(
          (await p.locator("#public-best-scores").textContent()).includes(
            "100.00%",
          ),
        );
        await p.close();
      },
    );
    await check(
      "profile service failures preserve login and Practice",
      async () => {
        failEnsure = true;
        const b = await context(B),
          p = await page(b, "/tools/typing-sprint/");
        await p.waitForSelector('[data-ready="true"]');
        await p.locator("#typing-start").click();
        await p.waitForFunction(() =>
          document
            .querySelector("#typing-status")
            .textContent.includes("unavailable"),
        );
        assert(await p.locator("#typing-input").isDisabled());
        await p.locator("#typing-mode").selectOption("practice");
        await p.locator("#typing-start").click();
        assert(await p.locator("#typing-input").isEnabled());
        await p.locator("#typing-abort").click();
        failEnsure = false;
        await p.close();
      },
    );
    await check(
      "account menu and mobile, tablet and desktop profile layouts",
      async () => {
        for (const width of [360, 768, 1440]) {
          await edit.setViewportSize({ width, height: 900 });
          assert(
            await edit.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          await edit.locator("#account-toggle").click();
          assert(await edit.locator("#account-menu").isVisible());
          assert.deepEqual(
            await edit.locator("#account-menu a").allTextContents(),
            ["Workspace", "My Profile", "Public Profile"],
          );
          await edit.keyboard.press("Escape");
          assert(await edit.locator("#account-menu").isHidden());
          await edit.screenshot({
            path: "_qa/profile-" + width + ".png",
            fullPage: true,
          });
        }
        const p = await page(await context(), "/profile/");
        await p.waitForSelector("#profile-login:not([hidden])");
        assert(await p.locator("#profile-form").isHidden());
        await p.close();
      },
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "_qa/profiles-results.json",
      JSON.stringify(
        {
          base,
          checks,
          errors,
          authBoundary:
            "mock SDK with real local PostgreSQL RPC and Storage RLS",
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await browser.close();
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
