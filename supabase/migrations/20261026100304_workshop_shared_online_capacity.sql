begin;
create or replace function workshop_private.pong_room(action text,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid();r workshop_private.pong_rooms;m workshop_private.pong_room_members;client uuid;room uuid;minute timestamptz:=date_trunc('minute',clock_timestamp());counter workshop_private.pong_room_requests;invitation text;
begin
 if owner is null then raise exception 'Sign in with Google to play online' using errcode='28000';end if;
 if jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>2048 or action not in ('create','join','get','ready','pause','heartbeat','finish','leave','interrupt') then raise exception 'Invalid room request';end if;
 if coalesce(body->>'client_id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Invalid browser identity';end if;
 client:=(body->>'client_id')::uuid;
 if not exists(select 1 from public.typing_profiles where user_id=owner) then return jsonb_build_object('error','Your profile is not ready. Retry sign-in.');end if;
 perform pg_advisory_xact_lock(hashtextextended('workshop-live-rooms',0));
 perform pg_advisory_xact_lock(hashtextextended('workshop-pong-rooms',0));
 update workshop_private.pong_rooms x set status='closed',updated_at=clock_timestamp() where x.status not in ('closed','interrupted') and (x.expires_at<clock_timestamp() or x.status='paused' and x.paused_at<clock_timestamp()-interval '60 seconds');
 update workshop_private.pong_rooms x set status='interrupted',updated_at=clock_timestamp() where x.status in ('waiting','playing','paused','finished') and exists(select 1 from workshop_private.pong_room_members pm where pm.room_id=x.id and pm.last_seen<clock_timestamp()-interval '25 seconds');
 delete from workshop_private.pong_rooms where status in ('closed','interrupted') and updated_at<clock_timestamp()-interval '1 day';
 delete from workshop_private.pong_room_requests where bucket<clock_timestamp()-interval '1 day';
 if action in ('create','join') then
  insert into workshop_private.pong_room_requests(user_id,bucket,creates,joins) values(owner,minute,case when action='create' then 1 else 0 end,case when action='join' then 1 else 0 end)
   on conflict(user_id,bucket) do update set creates=pong_room_requests.creates+excluded.creates,joins=pong_room_requests.joins+excluded.joins returning * into counter;
  if counter.creates>3 or counter.joins>10 then return jsonb_build_object('error','Too many room attempts. Wait a minute and try again.');end if;
 end if;
 if action='create' then
  if exists(select 1 from workshop_private.pong_room_members pm join workshop_private.pong_rooms pr on pr.id=pm.room_id where pm.user_id=owner and pr.status in ('waiting','playing','paused','finished') and pr.expires_at>clock_timestamp()) then return jsonb_build_object('error','You already have an open room. Leave it before creating another.');end if;
  if (select count(*) from workshop_private.pong_rooms where status in ('waiting','playing','paused','finished'))+(select count(distinct room_id) from workshop_private.shared_whiteboard_members where lease_until>clock_timestamp())>=2 then return jsonb_build_object('error','Online capacity is busy. Close a live room or retry later.');end if;
  loop
   invitation:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
   begin insert into workshop_private.pong_rooms(code,host_id) values(invitation,owner) returning * into r;exit;exception when unique_violation then null;end;
  end loop;
  insert into workshop_private.pong_room_members(room_id,user_id,role,client_id) values(r.id,owner,'host',client);
  return workshop_private.pong_room_json(r.id,owner);
 end if;
 if action='join' then
  invitation:=upper(trim(coalesce(body->>'code','')));
  if invitation !~ '^[A-F0-9]{8}$' then return jsonb_build_object('error','Enter the eight-character room code.');end if;
  select * into r from workshop_private.pong_rooms where code=invitation and status in ('waiting','playing','paused','finished') and expires_at>clock_timestamp() for update;
  if not found then return jsonb_build_object('error','Room not found or expired. Ask your friend for a new invitation.');end if;
  select * into m from workshop_private.pong_room_members where room_id=r.id and user_id=owner;
  if found then
   if m.client_id<>client then return jsonb_build_object('error','This account is already playing in another tab or device.');end if;
   update workshop_private.pong_room_members set last_seen=clock_timestamp() where room_id=r.id and user_id=owner;
   return workshop_private.pong_room_json(r.id,owner);
  end if;
  if r.status<>'waiting' or (select count(*) from workshop_private.pong_room_members where room_id=r.id)>=2 then return jsonb_build_object('error','That room already has two players.');end if;
  if exists(select 1 from workshop_private.pong_room_members pm join workshop_private.pong_rooms pr on pr.id=pm.room_id where pm.user_id=owner and pr.status in ('waiting','playing','paused','finished') and pr.expires_at>clock_timestamp()) then return jsonb_build_object('error','Leave your current room before joining another.');end if;
  insert into workshop_private.pong_room_members(room_id,user_id,role,client_id) values(r.id,owner,'guest',client);
  return workshop_private.pong_room_json(r.id,owner);
 end if;
 if coalesce(body->>'room_id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Invalid room identifier';end if;
 room:=(body->>'room_id')::uuid;
 select * into r from workshop_private.pong_rooms where id=room for update;
 select * into m from workshop_private.pong_room_members where room_id=room and user_id=owner and client_id=client;
 if r.id is null or m.user_id is null then raise exception 'This room is private or belongs to another browser' using errcode='42501';end if;
 if action in ('get','heartbeat') then
  update workshop_private.pong_room_members set last_seen=clock_timestamp() where room_id=room and user_id=owner;
  return workshop_private.pong_room_json(room,owner);
 end if;
 if r.status in ('closed','interrupted') then return workshop_private.pong_room_json(room,owner);end if;
 if action in ('pause','finish','ready') and coalesce((body->>'round')::integer,-1)<>r.round then return jsonb_build_object('error','The match changed. Refresh the room and retry.');end if;
 if action='ready' then
  if r.status not in ('waiting','paused','finished') then return workshop_private.pong_room_json(room,owner);end if;
  update workshop_private.pong_room_members set ready=true,last_seen=clock_timestamp() where room_id=room and user_id=owner;
  if (select count(*) from workshop_private.pong_room_members where room_id=room and ready)=2 then
   update workshop_private.pong_rooms set status='playing',round=case when r.status='paused' then r.round else r.round+1 end,seed=case when r.status='paused' then r.seed else (('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint%4294967295)+1 end,paused_at=null,expires_at=clock_timestamp()+interval '30 minutes',updated_at=clock_timestamp() where id=room;
  end if;
 elsif action='pause' and r.status='playing' then
  update workshop_private.pong_rooms set status='paused',paused_at=clock_timestamp(),updated_at=clock_timestamp() where id=room;
  update workshop_private.pong_room_members set ready=false where room_id=room;
 elsif action='finish' then
  if m.role<>'host' then raise exception 'Only the room host can complete this casual match' using errcode='42501';end if;
  if r.status='playing' then update workshop_private.pong_rooms set status='finished',updated_at=clock_timestamp() where id=room;update workshop_private.pong_room_members set ready=false where room_id=room;end if;
 elsif action in ('leave','interrupt') then
  update workshop_private.pong_rooms set status=case when action='interrupt' then 'interrupted' else 'closed' end,updated_at=clock_timestamp() where id=room;
 end if;
 return workshop_private.pong_room_json(room,owner);
end $$;
notify pgrst,'reload schema';
commit;
