const assert = require("node:assert/strict");
const { chromium } = require("../support/browser.cjs");

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8769";
const owner = "11111111-1111-4111-8111-111111111111";
const publicId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const peer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const notification = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const invite = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const sdk = `
export function createClient() {
  const user={id:"${owner}",email:"private@example.invalid"};
  const me={public_id:"${publicId}",nickname:"Tester",bio:"Workspace test"};
  const friend={public_id:"${peer}",nickname:"Second Player",bio:"Verified description"};
  const date="2026-11-17T17:00:00.000Z";
  const get=(key,fallback)=>JSON.parse(localStorage.getItem("fixture:"+key)||JSON.stringify(fallback));
  const set=(key,value)=>localStorage.setItem("fixture:"+key,JSON.stringify(value));
  const relation=()=>get("state","none");
  window.__socialCalls=[];
  return {
    auth:{getSession:async()=>({data:{session:localStorage.getItem("fixture:guest")==="true"?null:{user}}}),onAuthStateChange(){}},
    from:()=>({select(){return this},eq(){return this},order:async()=>({data:[]})}),
    rpc:async(name,args={})=>{
      window.__socialCalls.push([name,args]);
      switch(name){
        case "ensure_my_profile": return {data:{...me,...get("profile",{})}};
        case "update_my_profile": if(get("saveFail",false))return {error:Error("Fixture save failed")};set("profile",{...get("profile",{}),...args.patch});return {data:{...me,...get("profile",{})}};
        case "get_public_profile": return {data:{...(args.profile_id==="${publicId}"?{...me,...get("profile",{})}:friend),game_achievements:["2048-1","2048-2","2048-3","snake-1"].map(achievement_id=>({achievement_id,unlocked_at:date})),best_scores:[]}};
        case "touch_social_activity":return {data:{visible:get("visible",true)}};
        case "get_social_preferences":return {data:{visible:get("visible",true)}};
        case "set_social_visibility":set("visible",args.visible);return {data:{visible:args.visible}};
        case "get_friendship": return {data:{state:relation(),id:"${requestId}"}};
        case "search_friend_profiles": return {data:[{...friend,state:relation(),id:"${requestId}"}]};
        case "list_friendships": return {data:relation()==="none"?[]:[{...friend,state:relation(),id:"${requestId}"}]};
        case "change_friendship":
          set("state",({request:"outgoing",cancel:"none",accept:"friend",decline:"none",remove:"none",block:"blocked",unblock:"none"})[args.action]);
          return {data:{state:relation(),id:"${requestId}"}};
        case "get_workspace_index":
          return {data:Array.from({length:6},(_,i)=>({id:"draft-"+i,kind:"draft",name:"Draft "+i,tool:"text-toolkit",updated_at:date}))};
        case "get_site_notifications_page":
        case "get_site_notifications":
          const read=get("read",false);
          const rawRows=get("noticeRows",[{id:"${notification}",kind:"game_invite",source:"invite:${invite}",created_at:date,read_at:read?date:null,actor:friend,payload:{game:"chess",id:"${invite}"}}]);
          const rows=rawRows.map(row=>row.kind==="friend_request"?{...row,payload:{...row.payload,relationship:{id:"${requestId}",state:relation()}}}:row);
          const response={data:{unread:read?0:rows.filter(r=>!r.read_at).length,rows:args.category==="rewards"?rows.filter(r=>r.kind==="reward"):args.category==="social"?rows.filter(r=>r.kind!=="reward"):rows}};
          if(window.__holdNextInbox){window.__holdNextInbox=false;await new Promise(resolve=>window.__resumeInbox=resolve);}
          return response;
        case "read_site_notifications":set("read",true);return {data:0};
        case "open_friend_game_invite":return {data:{status:get("expired",true)?"expired":"available",game:"chess",code:"ABCD1234"}};
        default:return {data:[]};
      }
    },
    functions:{invoke:async()=>({error:new Error("Fixture cannot publish a match")})}
  };
}`;

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 320, height: 700 },
      reducedMotion: "reduce",
    });
    await context.route("**/vendor/supabase-2.119.0.js*", (route) =>
      route.fulfill({ contentType: "application/javascript", body: sdk }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const go = (path) => page.goto(base + path);
    const noOverflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      );

    await go("/friends/");
    await page.locator("[data-friends-content]").waitFor();
    await page.locator("[data-friends-query]").fill("Second");
    const result = page.locator("[data-friends-results]");
    await result.getByText("Second Player", { exact: true }).waitFor();
    await result.locator('[data-friend-action="request"]').click();
    await result.locator('[data-friend-action="cancel"]').waitFor();
    assert(await noOverflow());
    await result.locator('[data-friend-action="cancel"]').click();
    await result.locator('[data-friend-action="request"]').waitFor();
    await page.evaluate(() =>
      localStorage.setItem("fixture:state", '"friend"'),
    );
    await go("/zh-hant/friends/");
    const row = page.locator('[data-friend-list="friend"] .friend-row');
    await row.waitFor();
    await page.locator("[data-social-visibility]").selectOption("hidden");
    await page.waitForFunction(
      () => localStorage.getItem("fixture:visible") === "false",
    );
    assert.equal(
      await page.locator("[data-social-visibility]").inputValue(),
      "hidden",
    );
    await row.getByRole("button", { name: "邀請遊戲" }).click();
    const choices = page.locator("#friend-game-choice:modal a");
    assert.equal(await choices.count(), 4);
    for (const game of ["go", "chess", "xiangqi", "pong"])
      assert.equal(
        await page
          .locator(
            '#friend-game-choice a[href$="/games/' +
              game +
              "/?friend=" +
              peer +
              '"]',
          )
          .count(),
        1,
      );
    await page.keyboard.press("Escape");

    const bell = page.locator("[data-open-notices]");
    await bell.locator("[data-notice-count]:visible").waitFor();
    assert.equal(await bell.locator("[data-notice-count]").textContent(), "1");
    await bell.click();
    const center = page.locator("#notice-center:modal");
    await center
      .locator(".notice-row")
      .getByText(/Second Player.*邀請/)
      .waitFor();
    await center.getByRole("button", { name: "開啟邀請" }).click();
    await center.locator('.toast[data-category="warning"]').waitFor();
    assert.match(await center.locator(".toast").textContent(), /過期/);
    await center.locator(".toast-close").click();
    await page.evaluate(() => localStorage.setItem("fixture:expired", "false"));
    await center.locator("[data-close-notices]").click();
    await bell.click();
    await center.getByRole("button", { name: "開啟邀請" }).click();
    await page.waitForURL("**/zh-hant/games/chess/?code=ABCD1234");
    await page.locator('[data-chess][data-ready="true"]').waitFor();
    assert.equal(await page.locator("#chess-code").inputValue(), "ABCD1234");

    await go("/profile/");
    await page.locator("#profile-preview").waitFor();
    await page.locator("#profile-name").fill("New name");
    await page.locator("#profile-cover").selectOption("aurora");
    await page.locator("#profile-accent").selectOption("ice");
    assert.equal(
      await page
        .locator(".profile-preview-card")
        .getAttribute("data-profile-cover"),
      "aurora",
    );
    await page
      .locator("[data-profile-milestone-options] input")
      .first()
      .waitFor();
    await page.locator("[data-profile-milestone-options] input").nth(0).check();
    await page.locator("[data-profile-milestone-options] input").nth(1).check();
    await page.locator("[data-profile-milestone-options] input").nth(2).check();
    await page.locator("[data-profile-milestone-options] input").nth(3).click();
    assert.equal(
      await page
        .locator("[data-profile-milestone-options] input:checked")
        .count(),
      3,
    );
    assert.equal(
      await page.locator("#profile-preview-name").textContent(),
      "New name",
    );
    await page.evaluate(() => localStorage.setItem("fixture:saveFail", "true"));
    await page.locator("#profile-save").click();
    await page.getByText(/Save failed\. Your changes are still here/).waitFor();
    assert.equal(await page.locator("#profile-name").inputValue(), "New name");
    assert.equal(await page.locator("#profile-cover").inputValue(), "aurora");
    await page.evaluate(() =>
      localStorage.setItem("fixture:saveFail", "false"),
    );
    await page.locator("#profile-save").click();
    await page
      .locator('.toast[data-category="success"]')
      .getByText("Profile saved.")
      .waitFor();
    await go("/profile/?id=" + peer);
    await page
      .locator("#public-friend-actions")
      .getByText("Friend", { exact: true })
      .waitFor();
    assert(await noOverflow());
    assert.equal(await page.locator("#profile-status").textContent(), "");
    assert.equal(await page.locator("#profile-retry").isVisible(), false);
    await go("/workspace/");
    await page.locator("[data-workspace-recent-list] a").first().waitFor();
    assert.equal(
      await page.locator("[data-workspace-recent-list] a").count(),
      4,
    );
    assert.equal(
      await page.locator("[data-workspace-index-list] a").count(),
      2,
    );
    assert(await noOverflow());
    await page.evaluate(() => localStorage.setItem("fixture:read", "false"));
    await bell.click();
    await center.locator("[data-notice-read-all]:visible").waitFor();
    await page.evaluate(() => {
      window.__holdNextInbox = true;
      window.dispatchEvent(new Event("social-change"));
    });
    await page.waitForFunction(
      () => typeof window.__resumeInbox === "function",
    );
    await center.locator("[data-notice-read-all]").click();
    await page.evaluate(() => window.__resumeInbox());
    await page.waitForFunction(
      () => document.querySelector("[data-notice-count]").hidden,
    );
    assert.equal(
      await center.locator("[data-notice-read-all]").isVisible(),
      false,
    );
    await page.evaluate(
      ({ peer, requestId }) => {
        localStorage.setItem("fixture:state", JSON.stringify("incoming"));
        localStorage.setItem("fixture:read", "false");
        localStorage.setItem(
          "fixture:noticeRows",
          JSON.stringify([
            {
              id: "dddddddd-dddd-4ddd-8ddd-000000000001",
              source: "request:" + requestId,
              kind: "friend_request",
              created_at: "2026-11-18T00:00:00Z",
              read_at: null,
              actor: { nickname: "Second Player", public_id: peer },
              payload: { relationship: { id: requestId, state: "incoming" } },
            },
          ]),
        );
        window.dispatchEvent(new Event("social-change"));
      },
      { peer, requestId },
    );
    await center.locator('[data-friend-action="accept"]').click();
    await page.waitForFunction(
      () => localStorage.getItem("fixture:state") === JSON.stringify("friend"),
    );
    await center
      .locator('[data-friend-action="accept"]')
      .waitFor({ state: "detached" });
    await center.locator("[data-notice-filter]").selectOption("rewards");
    await center.getByText("No notifications yet.", { exact: true }).waitFor();
    await center.locator("[data-close-notices]").click();
    await page.waitForFunction(
      () =>
        document.activeElement ===
        document.querySelector("[data-open-notices]"),
    );
    await page.evaluate(() => {
      const target = document.querySelector("[data-workspace-query]");
      target.focus();
      const show = window.KenseiNotify;
      for (const kind of ["success", "warning", "reward", "error"])
        show(window.KenseiI18n.msg("Notifications"), { kind, key: kind });
      show(window.KenseiI18n.msg("Notifications"), {
        kind: "info",
        key: "ignored",
      });
    });
    assert.equal(await page.locator(".toast").count(), 3);
    assert.equal(
      await page.locator('.toast[data-category="error"]').count(),
      1,
    );
    assert.equal(
      await page.locator('.toast[data-category="reward"]').count(),
      1,
    );
    assert(
      await page
        .locator("[data-workspace-query]")
        .evaluate((el) => document.activeElement === el),
      "Notice changed the active input",
    );
    await bell.click();
    await page.locator("#notice-center:modal .toast").first().waitFor();
    assert.equal(await page.locator("#notice-center .toast").count(), 3);
    await page.locator("#notice-center details summary").click();
    await page.locator("[data-mute-notices]").click();
    assert.equal(
      await page.evaluate(() => window.KenseiNoticeSettings.volume),
      0,
    );
    await page.locator("[data-close-notices]").click();
    await go("/profile/?id=invalid");
    await page.getByText("Profile not found.", { exact: true }).waitFor();
    assert.equal(await page.locator("#public-profile").isVisible(), false);
    await page.evaluate(() => localStorage.setItem("fixture:guest", "true"));
    await go("/profile/?id=" + peer);
    await page.locator("#public-name").waitFor();
    assert.equal(await page.locator("#profile-status").textContent(), "");
    await page
      .getByRole("button", { name: "Sign in to add a friend" })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS friends and invitations, localized inbox, priority toasts, profile editing, workspace recent records and 320px layout",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
