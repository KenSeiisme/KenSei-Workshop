begin;
-- 白板擴充僅接受已知紙張與連接點；不接受任意自訂資料。
create function workshop_private.whiteboard_paper(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(value) is distinct from 'object' or value->'version' is distinct from '1'::jsonb or coalesce(value->>'type','') not in ('plain','ruled','grid','dots','graph') or value->'spacing' not in ('10'::jsonb,'20'::jsonb,'40'::jsonb) or not(value?'spacing') or exists(select 1 from jsonb_object_keys(value) k where k not in ('version','type','spacing')) then raise exception 'Invalid paper settings.';end if;
 return jsonb_build_object('version',1,'type',value->>'type','spacing',value->'spacing');
end $$;
create function workshop_private.whiteboard_ports_valid(el jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare p jsonb; v jsonb;
begin
 if el->'customData' is null or el->'customData'='null'::jsonb then return true;end if;
 if el->>'type' is distinct from 'arrow' or jsonb_typeof(el->'customData') is distinct from 'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(el->'customData'))<>1 or not(el->'customData'?'kenseiPorts') then return false;end if;
 p:=el->'customData'->'kenseiPorts';
 if jsonb_typeof(p) is distinct from 'object' or p->'version' is distinct from '1'::jsonb or not(p?'start' and p?'end') or exists(select 1 from jsonb_object_keys(p) k where k not in ('version','start','end')) then return false;end if;
 for v in select x from (values(p->'start'),(p->'end')) item(x) loop
  if v='null'::jsonb then continue;end if;
  if jsonb_typeof(v)<>'number' then return false;end if;
  if (v::text)::numeric<0 or (v::text)::numeric>11 or trunc((v::text)::numeric)<>(v::text)::numeric then return false;end if;
 end loop;
 return true;
end $$;
revoke all on function workshop_private.whiteboard_paper(jsonb),workshop_private.whiteboard_ports_valid(jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION workshop_private.shared_board_settings(value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 if jsonb_typeof(value) is distinct from 'object' or coalesce(value->>'viewBackgroundColor','')!~'^#[0-9a-fA-F]{3,8}$' or (value->>'gridSize' is not null and (jsonb_typeof(value->'gridSize')<>'number' or (value->>'gridSize')::numeric not between 1 and 100)) then raise exception 'Invalid shared canvas settings.';end if;
 return jsonb_build_object('viewBackgroundColor',value->>'viewBackgroundColor','gridSize',value->'gridSize') || case when value?'paper' then jsonb_build_object('paper',workshop_private.whiteboard_paper(value->'paper')) else '{}'::jsonb end;
end $function$
;
CREATE OR REPLACE FUNCTION workshop_private.shared_board_validate(el jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare field text;
begin
 if jsonb_typeof(el) is distinct from 'object' or coalesce(el->>'id','') !~ '^[A-Za-z0-9_-]{1,100}$'
 or coalesce(el->>'type','') not in ('rectangle','diamond','ellipse','arrow','line','freedraw','text','frame')
 or el->>'link' is not null or el->>'fileId' is not null or not workshop_private.whiteboard_ports_valid(el) then raise exception 'Use vector drawings and plain text only.';end if;
 if coalesce(el->>'version','') !~ '^[0-9]{1,10}$' or (el->>'version')::bigint not between 1 and 2147483647
 or coalesce(el->>'versionNonce','') !~ '^[0-9]{1,10}$' or (el->>'versionNonce')::bigint not between 0 and 2147483647
 or coalesce(el->>'index','') !~ '^[A-Za-z][A-Za-z0-9]{0,127}$' then raise exception 'Invalid element version or layer index.';end if;
 foreach field in array array['x','y','width','height','angle'] loop
  if jsonb_typeof(el->field) is distinct from 'number' or abs((el->>field)::numeric)>100000000 then raise exception 'Invalid element geometry.';end if;
 end loop;
 if jsonb_typeof(el->'isDeleted') is distinct from 'boolean' then raise exception 'Invalid deletion marker.';end if;
end $function$
;
CREATE OR REPLACE FUNCTION workshop_private.validate_study_record(kind text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c jsonb; s jsonb; t jsonb; tz text; uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
begin
 if coalesce(jsonb_typeof(payload),'')<>'object' or payload->>'version' is distinct from '1' or coalesce(jsonb_typeof(payload->'name'),'')<>'string' or coalesce(length(btrim(payload->>'name')),0) not between 1 and 100 then raise exception 'Use a valid name and record version';end if;
 if kind='planner' then
  tz:=payload->>'timeZone';
  if octet_length(payload::text)>1000000 or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) or coalesce(jsonb_typeof(payload->'courses'),'')<>'array' or coalesce(jsonb_typeof(payload->'tasks'),'')<>'array' then raise exception 'Invalid planner or size over 1 MB';end if;
  if jsonb_array_length(payload->'courses')>30 or jsonb_array_length(payload->'tasks')>300 then raise exception 'Use at most 30 courses and 300 tasks';end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(payload->'courses') x)<>jsonb_array_length(payload->'courses') or (select count(distinct x->>'id') from jsonb_array_elements(payload->'tasks') x)<>jsonb_array_length(payload->'tasks') then raise exception 'Duplicate record IDs';end if;
  for c in select value from jsonb_array_elements(payload->'courses') loop
   if coalesce(c->>'id','')!~uuid_pattern or coalesce(jsonb_typeof(c->'title'),'')<>'string' or coalesce(length(btrim(c->>'title')),0) not between 1 and 100 or coalesce(c->>'color','')!~'^#[0-9a-fA-F]{6}$' or coalesce(c->>'startDate','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(c->>'endDate','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(jsonb_typeof(c->'sessions'),'')<>'array' then raise exception 'Invalid course';end if;
   if (c->>'startDate')::date>(c->>'endDate')::date or jsonb_array_length(c->'sessions')>14 then raise exception 'Invalid course dates or sessions';end if;
   for s in select value from jsonb_array_elements(c->'sessions') loop
    if coalesce(s->>'id','')!~uuid_pattern or coalesce(s->>'day','')!~'^[1-7]$' or coalesce(s->>'start','')!~'^([01]\d|2[0-3]):[0-5]\d$' or coalesce(s->>'end','')!~'^([01]\d|2[0-3]):[0-5]\d$' or (s->>'start')>=(s->>'end') then raise exception 'Invalid weekly class time';end if;
   end loop;
  end loop;
  if (select count(*)<>count(distinct session_item->>'id') from jsonb_array_elements(payload->'courses') course_item cross join lateral jsonb_array_elements(course_item->'sessions') session_item) then raise exception 'Duplicate session IDs';end if;
  for t in select value from jsonb_array_elements(payload->'tasks') loop
   if coalesce(t->>'id','')!~uuid_pattern or coalesce(jsonb_typeof(t->'title'),'')<>'string' or coalesce(length(btrim(t->>'title')),0) not between 1 and 200 or coalesce(t->>'type','') not in ('assignment','exam') or coalesce(jsonb_typeof(t->'done'),'')<>'boolean' or coalesce(t->>'due','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' or not(t?'courseId') then raise exception 'Invalid deadline';end if;
   if t->>'courseId' is not null and not exists(select 1 from jsonb_array_elements(payload->'courses') course_item where course_item->>'id'=t->>'courseId') then raise exception 'Unknown course';end if;
   if (((t->>'due')::timestamp at time zone tz) at time zone tz)<>(t->>'due')::timestamp then raise exception 'Deadline falls in a daylight-saving gap';end if;
  end loop;
  return jsonb_build_object('version',1,'name',btrim(payload->>'name'),'timeZone',tz,'courses',payload->'courses','tasks',payload->'tasks');
 elsif kind='whiteboard' then
  if octet_length(payload::text)>2000000 or coalesce(jsonb_typeof(payload->'elements'),'')<>'array' or coalesce(jsonb_typeof(payload->'appState'),'')<>'object' or (payload?'files' and payload->'files'<>'{}'::jsonb) then raise exception 'Invalid whiteboard or size over 2 MB';end if;
  if jsonb_array_length(payload->'elements')>10000 then raise exception 'Use a vector whiteboard with up to 10,000 elements.';end if;
  if exists(select 1 from jsonb_array_elements(payload->'elements') x where coalesce(x->>'type','') not in ('rectangle','diamond','ellipse','arrow','line','freedraw','text','frame') or coalesce(x->>'link','')<>'' or x?'fileId' or not workshop_private.whiteboard_ports_valid(x)) then raise exception 'Whiteboards support text and vector drawing only';end if;
  return jsonb_build_object('version',1,'name',btrim(payload->>'name'),'elements',payload->'elements','appState',jsonb_build_object('viewBackgroundColor',coalesce(payload->'appState'->>'viewBackgroundColor','#111015'),'gridSize',payload->'appState'->'gridSize') || case when payload->'appState'?'paper' then jsonb_build_object('paper',workshop_private.whiteboard_paper(payload->'appState'->'paper')) else '{}'::jsonb end);
 else raise exception 'Invalid private record kind';end if;
end $function$
;
CREATE OR REPLACE FUNCTION workshop_private.whiteboard_room(action text, body jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 owner uuid:=auth.uid(); r workshop_private.shared_whiteboards; member workshop_private.shared_whiteboard_members;
 req workshop_private.shared_whiteboard_requests; room uuid;client uuid;invite text;op uuid;fingerprint text;previous workshop_private.shared_whiteboard_mutations;
 occupied integer; editing boolean:=false;state jsonb;title text;
begin
 if owner is null then raise exception 'Sign in to use shared whiteboards.' using errcode='28000';end if;
 if action is null or action not in ('list','create','join','get','activate','heartbeat','save','invite','reset_invite','remove','rename','leave','release','delete') or jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>2100000 then raise exception 'Invalid shared whiteboard request.';end if;
 perform pg_advisory_xact_lock(hashtextextended('workshop-live-rooms',0));
 if action='list' then return (select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'owner_id',b.owner_id,'updated_at',b.updated_at) order by b.updated_at desc),'[]'::jsonb) from workshop_private.shared_whiteboards b join workshop_private.shared_whiteboard_members m on m.room_id=b.id where m.user_id=owner);end if;
 if not exists(select 1 from public.typing_profiles where user_id=owner) then raise exception 'Your profile is not ready. Retry sign-in.';end if;
 if coalesce(body->>'client_id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Invalid editor identity.';end if;
 client:=(body->>'client_id')::uuid;
 if action='create' then
  title:=btrim(coalesce(body->>'name','Shared whiteboard'));
  if length(title) not between 1 and 100 then raise exception 'Use a whiteboard name of 1–100 characters.';end if;
  if (select count(*) from workshop_private.shared_whiteboards where owner_id=owner)>=100 then raise exception 'Keep up to 100 owned shared whiteboards.';end if;
  insert into workshop_private.shared_whiteboards(owner_id,name) values(owner,title) returning * into r;
  insert into workshop_private.shared_whiteboard_members(room_id,user_id) values(r.id,owner);
  perform workshop_private.shared_board_merge(r.id,coalesce(body->'elements','[]'::jsonb));
  if body?'appState' then update workshop_private.shared_whiteboards set app_state=workshop_private.shared_board_settings(body->'appState') where id=r.id;end if;
  return workshop_private.shared_board_scene(r.id,owner);
 end if;
 if action='join' then
  invite:=coalesce(body->>'token',upper(btrim(body->>'code')));
  select * into r from workshop_private.shared_whiteboards where invite_token=invite or code=invite for update;
  if not found then raise exception 'Invitation is invalid or was reset.';end if;
  if not exists(select 1 from workshop_private.shared_whiteboard_members where room_id=r.id and user_id=owner) then
   if (select count(*) from workshop_private.shared_whiteboard_members where room_id=r.id)>=4 then raise exception 'This whiteboard already has four members.';end if;
   insert into workshop_private.shared_whiteboard_members(room_id,user_id) values(r.id,owner);
  end if;
  perform workshop_private.shared_board_notify(r.id,r.channel_key);
  return workshop_private.shared_board_scene(r.id,owner);
 end if;
 if coalesce(body->>'room_id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Invalid room identity.';end if;
 room:=(body->>'room_id')::uuid;
 select * into r from workshop_private.shared_whiteboards where id=room for update;
 select * into member from workshop_private.shared_whiteboard_members where room_id=room and user_id=owner;
 if r.id is null or member.user_id is null then raise exception 'This shared whiteboard is unavailable or access was removed.' using errcode='42501';end if;
 if action in ('activate','heartbeat') then
  if member.client_id is null or member.client_id=client or member.lease_until is null or member.lease_until<clock_timestamp() then
   occupied:=(select count(*) from workshop_private.pong_rooms p where p.status in ('waiting','playing','paused','finished') and p.expires_at>clock_timestamp() and not exists(select 1 from workshop_private.pong_room_members pm where pm.room_id=p.id and pm.last_seen<clock_timestamp()-interval '25 seconds'))
    +(select count(distinct room_id) from workshop_private.shared_whiteboard_members where lease_until>clock_timestamp());
   if exists(select 1 from workshop_private.shared_whiteboard_members where room_id=room and lease_until>clock_timestamp()) or occupied<2 then
    update workshop_private.shared_whiteboard_members set client_id=client,lease_until=clock_timestamp()+interval '35 seconds' where room_id=room and user_id=owner;
    editing:=true;
   end if;
  end if;
  return workshop_private.shared_board_scene(room,owner,action='activate')||jsonb_build_object('editing',editing);
 end if;
 if action='release' then
  update workshop_private.shared_whiteboard_members set lease_until=null,client_id=null where room_id=room and user_id=owner and client_id=client;
  return jsonb_build_object('released',true);
 end if;
 if action='save' then
  if r.app_state?'paper' and (coalesce(body->>'client_version','1')<>'2' or (body?'appState' and not(body->'appState'?'paper'))) then raise exception 'Refresh Whiteboard to keep editing this newer board. Your local changes are retained.';end if;
  if member.client_id is distinct from client or member.lease_until is null or member.lease_until<clock_timestamp() then raise exception 'Your editing connection expired. Reconnect before saving.';end if;
  if body->>'channel_key' is distinct from r.channel_key::text then raise exception 'Room permissions changed. Reconnect before saving.';end if;
  if coalesce(body->>'operation_id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Invalid save identity.';end if;
  op:=(body->>'operation_id')::uuid;fingerprint:=md5(jsonb_build_object('elements',body->'elements','appState',body->'appState')::text);
  select * into previous from workshop_private.shared_whiteboard_mutations where room_id=room and user_id=owner and operation_id=op;
  if found then
   if previous.digest<>fingerprint then raise exception 'Save identity was reused with different content.';end if;
   return workshop_private.shared_board_scene(room,owner)||jsonb_build_object('saved_operation',op);
  end if;
  perform workshop_private.shared_board_merge(room,coalesce(body->'elements','[]'::jsonb));
  update workshop_private.shared_whiteboards set revision=revision+1,updated_at=clock_timestamp(),app_state=case when body?'appState' then workshop_private.shared_board_settings(body->'appState') else app_state end where id=room;
  insert into workshop_private.shared_whiteboard_mutations(room_id,user_id,operation_id,digest,revision) select room,owner,op,fingerprint,revision from workshop_private.shared_whiteboards where id=room;
  -- Durable revision notices share the throttled drawing/cursor packet; heartbeat detects missed updates.
  return workshop_private.shared_board_scene(room,owner)||jsonb_build_object('saved_operation',op);
 end if;
 if action='get' then return workshop_private.shared_board_scene(room,owner,not coalesce((body->>'metadata_only')::boolean,false));end if;
 if action='leave' then
  if r.owner_id=owner then raise exception 'The owner can delete the shared whiteboard, or close the canvas to leave it saved.';end if;
  delete from workshop_private.shared_whiteboard_members where room_id=room and user_id=owner;
  update workshop_private.shared_whiteboards set channel_key=gen_random_uuid() where id=room;
  perform workshop_private.shared_board_notify(room,r.channel_key);
  return jsonb_build_object('left',true);
 end if;
 if r.owner_id<>owner then raise exception 'Only the owner can manage this shared whiteboard.' using errcode='42501';end if;
 if action='invite' then return jsonb_build_object('code',r.code,'token',r.invite_token);end if;
 if action='reset_invite' then
  update workshop_private.shared_whiteboards set code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),invite_token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') where id=room returning * into r;
  return jsonb_build_object('code',r.code,'token',r.invite_token);
 end if;
 if action='remove' then
  if coalesce(body->>'user_id','') !~ '^[0-9a-fA-F-]{36}$' or body->>'user_id'=owner::text then raise exception 'Choose another member to remove.';end if;
  delete from workshop_private.shared_whiteboard_members where room_id=room and user_id=(body->>'user_id')::uuid;
  update workshop_private.shared_whiteboards set channel_key=gen_random_uuid(),code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),invite_token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') where id=room;
  perform workshop_private.shared_board_notify(room,r.channel_key);
  return workshop_private.shared_board_scene(room,owner);
 end if;
 if action='rename' then
  if length(btrim(coalesce(body->>'name',''))) not between 1 and 100 then raise exception 'Use a whiteboard name of 1–100 characters.';end if;
  update workshop_private.shared_whiteboards set name=btrim(body->>'name') where id=room;return workshop_private.shared_board_scene(room,owner);end if;
 if action='delete' then perform workshop_private.shared_board_notify(room,r.channel_key);delete from workshop_private.shared_whiteboards where id=room;return jsonb_build_object('deleted',true);end if;
 raise exception 'Invalid shared whiteboard request.';
end $function$
;

create function workshop_private.protect_whiteboard_features() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.data->'appState'?'paper' and not(new.data->'appState'?'paper') then raise exception 'Refresh Whiteboard to keep editing this newer board. Your local changes are retained.';end if;
 return new;
end $$;
revoke all on function workshop_private.protect_whiteboard_features() from public,anon,authenticated;
create trigger whiteboard_protect_canvas_features before update of data on public.whiteboards for each row execute function workshop_private.protect_whiteboard_features();
commit;
