begin;
create or replace function workshop_private.whiteboard_room(action text,body jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
  perform workshop_private.shared_board_notify(room,r.channel_key);
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
end $$;

revoke all on function workshop_private.whiteboard_room(text,jsonb) from public,anon,authenticated;
commit;