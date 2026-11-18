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
        case "get_public_profile": return {data:{...(args.profile_id==="${publicId}"?{...me,...get("profile",{})}:friend),board_game_stats:[{rule:"chinese",size:9,rules_version:1,played:12,wins:7,losses:4,draws:1,win_rate:7/12}],chess_stats:[{time_control:"10+5",rules_version:1,played:10,wins:5,losses:3,draws:2,win_rate:.5}],xiangqi_stats:[{time_control:"5+3",rules_version:1,played:8,wins:3,losses:4,draws:1,win_rate:3/8}],game_achievements:["2048-1","2048-2","2048-3","snake-1"].map(achievement_id=>({achievement_id,unlocked_at:date})),best_scores:[]}};
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

module.exports = {
  owner,
  publicId,
  peer,
  requestId,
  notification,
  invite,
  sdk,
};
