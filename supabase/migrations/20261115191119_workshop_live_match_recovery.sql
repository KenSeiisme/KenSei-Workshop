begin;

alter table workshop_private.pong_rooms
 add column protocol_version smallint not null default 1 check (protocol_version in (1,2)),
 add column generation integer not null default 0,
 add column revision bigint not null default 0,
 add column score_host smallint not null default 0 check (score_host between 0 and 7),
 add column score_guest smallint not null default 0 check (score_guest between 0 and 7),
 add column ticks integer not null default 0 check (ticks between 0 and 72000),
 add column restart_serve boolean not null default false;

create function workshop_private.pong_deadline(
 room workshop_private.pong_rooms, oldest_seen timestamptz
) returns timestamptz language sql immutable set search_path='' as $$
 select least(room.expires_at, case
  when room.protocol_version=1 then least(oldest_seen+interval '25 seconds',room.paused_at+interval '60 seconds')
  when room.status='paused' then room.paused_at+interval '60 seconds'
  else oldest_seen+interval '75 seconds'
 end)
$$;

create function workshop_private.pong_live_count() returns integer
language sql stable set search_path='' as $$
 select count(*)::integer from workshop_private.pong_rooms p
 where p.status in ('waiting','playing','paused','finished')
 and workshop_private.pong_deadline(p,(
  select min(m.last_seen) from workshop_private.pong_room_members m where m.room_id=p.id
 ))>statement_timestamp()
$$;

create or replace function workshop_private.board_capacity() returns integer
language sql stable security definer set search_path='' as $$
 select workshop_private.board_live_count()+workshop_private.pong_live_count()
 +(select count(distinct room_id)::integer from workshop_private.shared_whiteboard_members where lease_until>clock_timestamp())
$$;

-- Keep the old client protocol for rooms already open during rollout.
alter function workshop_private.pong_room(text,jsonb) rename to pong_room_legacy;
revoke all on function workshop_private.pong_room_legacy(text,jsonb) from public,anon,authenticated;
do $$
declare definition text; old text;
begin
 definition:=pg_get_functiondef('workshop_private.pong_room_legacy(text,jsonb)'::regprocedure);
 old:=definition;
 definition:=replace(definition,
  'where x.status not in (''closed'',''interrupted'')',
  'where x.protocol_version=1 and x.status not in (''closed'',''interrupted'')');
 definition:=replace(definition,
  'where x.status in (''waiting'',''playing'',''paused'',''finished'')',
  'where x.protocol_version=1 and x.status in (''waiting'',''playing'',''paused'',''finished'')');
 definition:=replace(definition,
  '(select count(*) from workshop_private.pong_rooms where status in (''waiting'',''playing'',''paused'',''finished''))+(select count(distinct room_id) from workshop_private.shared_whiteboard_members where lease_until>clock_timestamp())+workshop_private.board_live_count()',
  'workshop_private.board_capacity()');
 if definition=old or strpos(definition,'workshop_private.board_capacity()')=0 then
  raise exception 'Legacy Pong capacity definition changed';
 end if;
 execute definition;

 definition:=pg_get_functiondef('workshop_private.whiteboard_room(text,jsonb)'::regprocedure);
 old:=definition;
 definition:=replace(definition,
  '(select count(*) from workshop_private.pong_rooms p where p.status in (''waiting'',''playing'',''paused'',''finished'') and p.expires_at>clock_timestamp() and not exists(select 1 from workshop_private.pong_room_members pm where pm.room_id=p.id and pm.last_seen<clock_timestamp()-interval ''25 seconds''))',
  'workshop_private.pong_live_count()');
 if definition=old then raise exception 'Whiteboard capacity definition changed';end if;
 execute definition;
end $$;

-- Called under the common live-room lock, including when neither player is online.
create function workshop_private.pong_sweep() returns void
language plpgsql set search_path='' as $$
declare candidate record; now_at timestamptz:=clock_timestamp();
begin
 for candidate in
  select p.*, p as room_row, (select min(m.last_seen) from workshop_private.pong_room_members m where m.room_id=p.id) as oldest_seen
  from workshop_private.pong_rooms p where p.protocol_version=2 and p.status in ('waiting','playing','paused','finished')
 loop
  if workshop_private.pong_deadline(candidate.room_row,candidate.oldest_seen)<=now_at then
   update workshop_private.pong_rooms set
    status=case when candidate.status='waiting' and candidate.expires_at<=now_at then 'closed' else 'interrupted' end,
    revision=revision+1,updated_at=now_at where id=candidate.id;
  elsif candidate.status='playing' and candidate.oldest_seen+interval '15 seconds'<=now_at then
   update workshop_private.pong_rooms set status='paused',paused_at=candidate.oldest_seen+interval '15 seconds',
    restart_serve=true,revision=revision+1,updated_at=now_at where id=candidate.id;
   update workshop_private.pong_room_members set ready=false where room_id=candidate.id;
  end if;
 end loop;
 delete from workshop_private.pong_rooms where status in ('closed','interrupted') and updated_at<now_at-interval '1 day';
end $$;

create function workshop_private.pong_snapshot(room uuid, owner uuid, client uuid) returns jsonb
language sql stable set search_path='' as $$
 select (case when m.client_id=client then workshop_private.pong_room_json(room,owner)
  else workshop_private.pong_room_json(room,owner)-'channel_key'-'code' end)
 || jsonb_build_object(
  'protocol_version',r.protocol_version,'controller',m.client_id=client,
  'generation',r.generation,'revision',r.revision,'restart_serve',r.restart_serve,
  'score',jsonb_build_array(r.score_host,r.score_guest),'ticks',r.ticks,
  'server_now',floor(extract(epoch from statement_timestamp())*1000),
  'resume_until',case when r.status='paused' then least(r.expires_at,r.paused_at+interval '60 seconds') end)
 from workshop_private.pong_rooms r join workshop_private.pong_room_members m
 on m.room_id=r.id and m.user_id=owner where r.id=room
$$;

create function workshop_private.pong_room(action text,body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 owner uuid:=auth.uid(); r workshop_private.pong_rooms; m workshop_private.pong_room_members;
 client uuid; room uuid; now_at timestamptz; result jsonb; protocol smallint;
 next_ticks integer; next_host integer; next_guest integer; point boolean; ends boolean;
begin
 if owner is null then raise exception 'Sign in with Google to play online' using errcode='28000';end if;
 if jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>2048
  or action not in ('create','join','get','ready','pause','heartbeat','finish','leave','interrupt','takeover','checkpoint')
  then raise exception 'Invalid room request';end if;
 client:=(body->>'client_id')::uuid;
 if client is null then raise exception 'Invalid browser identity';end if;
 protocol:=case when body->>'protocol_version'='2' then 2 else 1 end;

 perform pg_advisory_xact_lock(hashtextextended('workshop-live-rooms',0));
 perform workshop_private.pong_sweep();
 now_at:=clock_timestamp();
 if action='create' then
  result:=workshop_private.pong_room_legacy(action,body);
  if protocol=1 or result->>'id' is null then return result;end if;
  room:=(result->>'id')::uuid;
  update workshop_private.pong_rooms set protocol_version=2 where id=room;
  return workshop_private.pong_snapshot(room,owner,client);
 end if;
 if action='join' then
  select * into r from workshop_private.pong_rooms where code=upper(btrim(body->>'code'));
 else
  select * into r from workshop_private.pong_rooms where id=(body->>'room_id')::uuid;
 end if;
 if coalesce(r.protocol_version,1)=1 then return workshop_private.pong_room_legacy(action,body);end if;
 if protocol<2 then return jsonb_build_object('error','Refresh Pong to join this room.');end if;

 room:=r.id;
 select * into m from workshop_private.pong_room_members where room_id=room and user_id=owner;
 if action='join' then
  if m.user_id is null then
   result:=workshop_private.pong_room_legacy(action,body);
   if result->>'id' is null then return result;end if;
   update workshop_private.pong_rooms set revision=revision+1 where id=room;
  end if;
  return workshop_private.pong_snapshot(room,owner,client);
 end if;
 if m.user_id is null then raise exception 'This room is private or belongs to another browser' using errcode='42501';end if;
 if action='get' or r.status in ('closed','interrupted')
  or (action='heartbeat' and (m.client_id<>client or (body->>'generation')::integer is distinct from r.generation))
  then return workshop_private.pong_snapshot(room,owner,client);end if;
 if (body->>'round')::integer is distinct from r.round
  or (body->>'generation')::integer is distinct from r.generation
  then return jsonb_build_object('error','The match changed. Refresh the room and retry.');end if;

 if action='takeover' then
  if m.client_id=client then return workshop_private.pong_snapshot(room,owner,client);end if;
  update workshop_private.pong_room_members set ready=false where room_id=room;
  update workshop_private.pong_room_members set client_id=client,last_seen=now_at where room_id=room and user_id=owner;
  update workshop_private.pong_rooms set
   status=case when r.status='playing' then 'paused' else r.status end,
   paused_at=case when r.status='playing' then now_at else r.paused_at end,
   restart_serve=r.status in ('playing','paused'),
   generation=generation+1,channel_key=gen_random_uuid(),revision=revision+1,updated_at=now_at where id=room;
  return workshop_private.pong_snapshot(room,owner,client);
 end if;
 if m.client_id<>client then raise exception 'Take control in this tab before playing.' using errcode='42501';end if;
 if action in ('finish','interrupt') then raise exception 'Invalid room request';end if;
 if action='checkpoint' and m.role<>'host' then raise exception 'Only the room host can save the score' using errcode='42501';end if;
 if action='checkpoint' and not (body ? 'ticks') then return jsonb_build_object('error','Invalid Pong checkpoint.');end if;

 if m.role='host' and r.status='playing' and action in ('checkpoint','heartbeat','pause') and body ? 'ticks' then
  next_ticks:=(body->>'ticks')::integer;
  next_host:=case when action='checkpoint' then (body->>'score_host')::integer else r.score_host end;
  next_guest:=case when action='checkpoint' then (body->>'score_guest')::integer else r.score_guest end;
  if next_ticks is null or next_host is null or next_guest is null
   or next_ticks not between 0 and 72000 or next_host not between 0 and 7 or next_guest not between 0 and 7
   or next_host<r.score_host or next_guest<r.score_guest or next_host+next_guest-r.score_host-r.score_guest>1
   then return jsonb_build_object('error','Invalid Pong checkpoint.');end if;
  point:=(next_host,next_guest)<>(r.score_host,r.score_guest);
  if point and next_ticks<=r.ticks then return jsonb_build_object('error','Invalid Pong checkpoint.');end if;
  ends:=next_host=7 or next_guest=7 or next_ticks=72000;
  if (point or ends) and action<>'checkpoint' then return jsonb_build_object('error','Invalid Pong checkpoint.');end if;
  if next_ticks>r.ticks then
   update workshop_private.pong_rooms set ticks=next_ticks,score_host=next_host,score_guest=next_guest,
    status=case when ends then 'finished' else r.status end,updated_at=now_at,revision=revision+1 where id=room;
   if ends then update workshop_private.pong_room_members set ready=false where room_id=room;end if;
  end if;
 end if;

 update workshop_private.pong_room_members set last_seen=now_at where room_id=room and user_id=owner;
 if action='ready' and r.status in ('waiting','paused','finished') then
  update workshop_private.pong_room_members set ready=false where room_id=room and last_seen<=now_at-interval '15 seconds';
  update workshop_private.pong_room_members set ready=true where room_id=room and user_id=owner;
  if (select count(*) from workshop_private.pong_room_members where room_id=room and ready
   and last_seen>now_at-interval '15 seconds')=2 then
   update workshop_private.pong_rooms set status='playing',
    round=case when r.status='paused' then r.round else r.round+1 end,
    seed=case when r.status='paused' then r.seed else (('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint%4294967295)+1 end,
    score_host=case when r.status='paused' then r.score_host else 0 end,
    score_guest=case when r.status='paused' then r.score_guest else 0 end,
    ticks=case when r.status='paused' then r.ticks else 0 end,
    generation=generation+1,channel_key=gen_random_uuid(),paused_at=null,
    expires_at=case when r.status='paused' then r.expires_at else now_at+interval '30 minutes' end,
    updated_at=now_at,revision=revision+1 where id=room;
  else
   update workshop_private.pong_rooms set revision=revision+1 where id=room;
  end if;
 elsif action='pause' and r.status='playing' then
  update workshop_private.pong_rooms set status='paused',paused_at=now_at,
   restart_serve=coalesce(body->'recovery'='true'::jsonb,false),
   updated_at=now_at,revision=revision+1 where id=room;
  update workshop_private.pong_room_members set ready=false where room_id=room;
 elsif action='pause' and r.status='paused' and body->'recovery'='true'::jsonb then
  update workshop_private.pong_rooms set restart_serve=true,revision=revision+1 where id=room and not restart_serve;
 elsif action='leave' then
  update workshop_private.pong_rooms set status='closed',revision=revision+1,updated_at=now_at where id=room;
 end if;
 return workshop_private.pong_snapshot(room,owner,client);
end $$;

create or replace function public.pong_room(action text,body jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select workshop_private.pong_room(action,body) $$;
revoke all on function workshop_private.pong_room(text,jsonb) from public,anon,authenticated;
grant execute on function workshop_private.pong_room(text,jsonb) to authenticated;

create function workshop_private.my_live_games() returns jsonb
language sql stable security definer set search_path='' as $$
 with live as (
  select jsonb_build_object('id',b.id,'game',b.game,'status',b.status,
   'rule',b.config->>'rule','size',b.config->'size','clock',b.config->'clock',
   'deadline',case b.status when 'waiting' then b.expires_at when 'ready' then b.ready_deadline end) as value,
   b.updated_at
  from workshop_private.board_members m join workshop_private.board_matches b on b.id=m.match_id
  where m.user_id=(select auth.uid()) and (
   (b.status='waiting' and b.expires_at>statement_timestamp())
   or (b.status='ready' and b.ready_deadline>statement_timestamp())
   or b.status in ('playing','scoring','disputed'))
  union all
  select jsonb_build_object('id',p.id,'game','pong','status',p.status,
   'score',jsonb_build_array(p.score_host,p.score_guest),
   'deadline',case when p.status='paused' then least(p.expires_at,p.paused_at+interval '60 seconds') end),p.updated_at
  from workshop_private.pong_room_members m join workshop_private.pong_rooms p on p.id=m.room_id
  where m.user_id=(select auth.uid()) and p.protocol_version=2 and p.status in ('waiting','playing','paused')
   and workshop_private.pong_deadline(p,(
    select min(o.last_seen) from workshop_private.pong_room_members o where o.room_id=p.id
   ))>statement_timestamp()
 )
 select jsonb_build_object('server_now',floor(extract(epoch from statement_timestamp())*1000),
  'matches',coalesce((select jsonb_agg(value order by updated_at desc) from live),'[]'::jsonb))
$$;

create function public.get_my_live_games() returns jsonb
language sql stable security invoker set search_path='' as $$ select workshop_private.my_live_games() $$;

revoke all on function workshop_private.pong_deadline(workshop_private.pong_rooms,timestamptz),
 workshop_private.pong_live_count(),workshop_private.pong_snapshot(uuid,uuid,uuid),
 workshop_private.pong_sweep(),workshop_private.my_live_games(),public.get_my_live_games()
 from public,anon,authenticated;
grant execute on function workshop_private.my_live_games(),public.get_my_live_games() to authenticated;

create function workshop_private.sweep_live_games() returns void
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('workshop-live-rooms',0));
 perform workshop_private.board_sweep();
 perform workshop_private.pong_sweep();
end $$;
revoke all on function workshop_private.sweep_live_games() from public,anon,authenticated;
do $$ begin
 if to_regprocedure('cron.schedule(text,text,text)') is not null then
  execute $job$select cron.schedule('workshop-board-timeouts','15 seconds','select workshop_private.sweep_live_games()')$job$;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
