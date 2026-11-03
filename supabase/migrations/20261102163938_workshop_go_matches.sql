begin;

-- 独立棋类对局；客户端没有胜者、时钟或统计的直接写权限。
create table workshop_private.board_matches (
 id uuid primary key default gen_random_uuid(), game text not null default 'go' check(game='go'),
 rules_version integer not null default 1 check(rules_version=1), config jsonb not null,
 code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
 channel_key uuid not null default gen_random_uuid(), origin text not null check(origin in ('invite','random')),
 status text not null default 'waiting' check(status in ('waiting','ready','playing','scoring','disputed','finished','interrupted','closed')),
 revision bigint not null default 1, state jsonb not null, clock jsonb,
 ranked boolean not null default false, created_at timestamptz not null default clock_timestamp(),
 started_at timestamptz, ended_at timestamptz, expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
 ready_deadline timestamptz, updated_at timestamptz not null default clock_timestamp()
);
create table workshop_private.board_members (
 match_id uuid not null references workshop_private.board_matches on delete cascade,
 user_id uuid not null references auth.users on delete cascade, color smallint not null check(color in (1,-1)),
 client_id uuid not null, ready boolean not null default false, accepted_training boolean not null default false,
 last_seen timestamptz not null default clock_timestamp(), primary key(match_id,user_id), unique(match_id,color)
);
create index board_members_owner on workshop_private.board_members(user_id,match_id);
create index board_matches_live on workshop_private.board_matches(status) where status not in ('finished','interrupted','closed');
create table workshop_private.board_actions (
 match_id uuid not null references workshop_private.board_matches on delete cascade,
 request_id uuid not null, user_id uuid not null references auth.users on delete cascade,
 action jsonb not null, receipt jsonb not null, created_at timestamptz not null default clock_timestamp(), primary key(match_id,request_id)
);
create table workshop_private.board_queue (
 user_id uuid primary key references auth.users on delete cascade, rule text not null check(rule in ('chinese','japanese','aga')),
 size integer not null check(size in (9,13,19)), client_id uuid not null,
 created_at timestamptz not null default clock_timestamp(), last_seen timestamptz not null default clock_timestamp()
);
create index board_actions_owner on workshop_private.board_actions(user_id);
create index board_queue_pair on workshop_private.board_queue(rule,size,created_at);
create table workshop_private.board_settlements (
 match_id uuid primary key references workshop_private.board_matches on delete cascade,
 result jsonb not null, ranked boolean not null, settled_at timestamptz not null
);
create table workshop_private.board_stats (
 user_id uuid not null references auth.users on delete cascade, game text not null default 'go', rule text not null,
 size integer not null, rules_version integer not null, wins integer not null default 0, losses integer not null default 0,
 draws integer not null default 0, achieved_at timestamptz not null,
 primary key(user_id,game,rule,size,rules_version)
);
create index board_stats_wins on workshop_private.board_stats(game,rule,size,rules_version,wins desc,achieved_at);
create table workshop_private.board_requests (user_id uuid not null references auth.users on delete cascade, bucket timestamptz not null, count integer not null default 1, primary key(user_id,bucket));
do $$ declare t text; begin
 foreach t in array array['board_matches','board_members','board_actions','board_queue','board_settlements','board_stats','board_requests'] loop
  execute format('alter table workshop_private.%I enable row level security',t);
  execute format('revoke all on workshop_private.%I from public,anon,authenticated',t);
 end loop;
end $$;

create function workshop_private.board_live_count() returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from workshop_private.board_matches where status in ('waiting','ready','playing','scoring','disputed') and (started_at is not null or expires_at>clock_timestamp())
$$;
create function workshop_private.board_capacity() returns integer language sql stable security definer set search_path='' as $$
 select workshop_private.board_live_count()
 +(select count(*)::integer from workshop_private.pong_rooms p where p.status in ('waiting','playing','paused','finished') and p.expires_at>clock_timestamp() and not exists(select 1 from workshop_private.pong_room_members m where m.room_id=p.id and m.last_seen<clock_timestamp()-interval '25 seconds'))
 +(select count(distinct room_id)::integer from workshop_private.shared_whiteboard_members where lease_until>clock_timestamp())
$$;

create function workshop_private.board_notify(room uuid) returns void language plpgsql security definer set search_path='' as $$
declare r workshop_private.board_matches;
begin
 select * into r from workshop_private.board_matches where id=room;
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
  execute 'select realtime.send($1,$2,$3,true)' using jsonb_build_object('revision',r.revision),'version','board:'||r.id||':'||r.channel_key;
 end if;
end $$;
create function workshop_private.board_channel_access(topic text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from workshop_private.board_matches r join workshop_private.board_members m on m.match_id=r.id where m.user_id=(select auth.uid()) and topic='board:'||r.id||':'||r.channel_key)
$$;
grant execute on function workshop_private.board_channel_access(text) to authenticated;
revoke all on function workshop_private.board_channel_access(text) from public,anon;
create policy board_member_receive on realtime.messages for select to authenticated using(extension='broadcast' and workshop_private.board_channel_access(realtime.topic()));

create function workshop_private.board_snapshot(room uuid, owner uuid, client uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'code',r.code,'game',r.game,'rules_version',r.rules_version,'config',r.config,'origin',r.origin,'status',r.status,'revision',r.revision,'state',r.state,'clock',r.clock,'ranked',r.ranked,'channel_key',r.channel_key,'ready_deadline',r.ready_deadline,'server_now',floor(extract(epoch from clock_timestamp())*1000),'started_at',r.started_at,'ended_at',r.ended_at,'color',mine.color,'controller',mine.client_id=client,
 'members',(select jsonb_agg(jsonb_build_object('color',m.color,'ready',m.ready,'accepted_training',m.accepted_training,'last_seen',m.last_seen,'public_id',p.public_id,'nickname',p.nickname,'avatar_kind',p.avatar_kind,'avatar_path',p.avatar_path,'google_avatar_url',p.google_avatar_url) order by m.color desc) from workshop_private.board_members m left join public.typing_profiles p on p.user_id=m.user_id where m.match_id=r.id))
 from workshop_private.board_matches r join workshop_private.board_members mine on mine.match_id=r.id and mine.user_id=owner where r.id=room
$$;

create function workshop_private.board_settle(room uuid, result_value jsonb, effective_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare r workshop_private.board_matches; m workshop_private.board_members; win integer; lose integer; draw integer; inserted uuid;
begin
 select * into r from workshop_private.board_matches where id=room for update;
 if r.started_at is null or exists(select 1 from workshop_private.board_settlements where match_id=room) then return;end if;
 insert into workshop_private.board_settlements(match_id,result,ranked,settled_at) values(room,result_value,r.ranked,effective_at) on conflict do nothing returning match_id into inserted;
 if inserted is null then return;end if;
 update workshop_private.board_matches set status=case when result_value->>'reason'='interrupted' then 'interrupted' else 'finished' end,
 state=jsonb_set(jsonb_set(state,'{result}',result_value),'{phase}','"finished"'),ended_at=effective_at,revision=revision+1,updated_at=clock_timestamp() where id=room;
 if r.ranked and result_value->>'reason' not in ('interrupted','no-result','unresolved') and (result_value->>'winner' in ('1','-1','0') or result_value->>'reason'='both-lose') then
  for m in select * from workshop_private.board_members where match_id=room loop
   win:=case when result_value->>'winner'=m.color::text then 1 else 0 end;
   draw:=case when result_value->>'winner'='0' and result_value->>'reason'<>'both-lose' then 1 else 0 end;
   lose:=1-win-draw;
   insert into workshop_private.board_stats(user_id,rule,size,rules_version,wins,losses,draws,achieved_at)
   values(m.user_id,r.config->>'rule',(r.config->>'size')::integer,r.rules_version,win,lose,draw,effective_at)
   on conflict(user_id,game,rule,size,rules_version) do update set wins=board_stats.wins+excluded.wins,losses=board_stats.losses+excluded.losses,draws=board_stats.draws+excluded.draws,achieved_at=excluded.achieved_at;
  end loop;
 end if;
 perform workshop_private.board_notify(room);
end $$;

create function workshop_private.board_expire_one(room uuid) returns void language plpgsql security definer set search_path='' as $$
declare r workshop_private.board_matches; deadline timestamptz; disconnect_at timestamptz; absent integer; disconnected_color integer; turn integer; clocks jsonb; preset integer; period_ms integer;
begin
 select * into r from workshop_private.board_matches where id=room for update;
 if r.status in ('finished','interrupted','closed') then return;end if;
 if r.status in ('waiting','ready') then
  if (r.status='waiting' and r.expires_at<=clock_timestamp()) or (r.status='ready' and r.ready_deadline<=clock_timestamp()) then
   update workshop_private.board_matches set status='closed',revision=revision+1,updated_at=clock_timestamp() where id=room; perform workshop_private.board_notify(room);
  end if;return;
 end if;
 select count(*) filter(where last_seen<=clock_timestamp()-interval '25 seconds'),min(last_seen+interval '120 seconds'),min(color) filter(where last_seen<=clock_timestamp()-interval '120 seconds') into absent,disconnect_at,disconnected_color from workshop_private.board_members where match_id=room;
 turn:=(r.state->>'turn')::integer;
 if r.status='playing' then
  preset:=(r.clock->>'preset')::integer; period_ms:=case preset when 9 then 20000 else 30000 end;
  deadline:=to_timestamp(((r.clock->>'anchor')::numeric+(r.clock->'remaining'->>turn::text)::numeric+(r.clock->'periods'->>turn::text)::numeric*period_ms)/1000);
 end if;
 if deadline is not null and deadline<=clock_timestamp() and (disconnect_at>clock_timestamp() or deadline<=disconnect_at) then
  if (select count(*) from workshop_private.board_members where match_id=room and last_seen<=deadline-interval '25 seconds')=2 then
   perform workshop_private.board_settle(room,jsonb_build_object('winner',null,'reason','interrupted'),deadline);return;
  end if;
  perform workshop_private.board_settle(room,jsonb_build_object('winner',-turn,'reason','timeout'),deadline);return;
 end if;
 if disconnect_at<=clock_timestamp() and disconnected_color is not null then
  if absent=2 then perform workshop_private.board_settle(room,jsonb_build_object('winner',null,'reason','interrupted'),disconnect_at);return;end if;
  perform workshop_private.board_settle(room,jsonb_build_object('winner',-disconnected_color,'reason','disconnect'),disconnect_at);
 end if;
end $$;
create function workshop_private.board_sweep() returns void language plpgsql security definer set search_path='' as $$
declare room uuid;begin
 for room in select id from workshop_private.board_matches where status in ('waiting','ready','playing','scoring','disputed') for update skip locked loop perform workshop_private.board_expire_one(room);end loop;
 delete from workshop_private.board_queue where last_seen<clock_timestamp()-interval '60 seconds';
 delete from workshop_private.board_requests where bucket<clock_timestamp()-interval '1 day';
end $$;

-- 只供验证 JWT 的 Edge 调用；本函数在事务内重新核对版本、控制权和时钟。
create function public.board_admin(action text, owner uuid, body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r workshop_private.board_matches; m workshop_private.board_members; other workshop_private.board_queue; q workshop_private.board_queue;
 client uuid; room uuid; request uuid; counter integer; old_receipt workshop_private.board_actions; color integer; now_ms bigint; clock_value jsonb; elapsed numeric; remaining numeric; period_ms integer; periods integer; new_state jsonb; active_room uuid;
begin
 if owner is null or not exists(select 1 from auth.users where id=owner) or jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>2100000 or action not in ('create','join','queue','cancel','get','ready','prepare','commit','heartbeat','takeover','leave') then raise exception 'Invalid board request.';end if;
 client:=(body->>'client_id')::uuid;
 if client is null then raise exception 'A browser identity is required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('workshop-live-rooms',0));
 perform workshop_private.board_sweep();
 if action in ('create','join','queue','ready','prepare','commit','takeover') then
  insert into workshop_private.board_requests(user_id,bucket) values(owner,date_trunc('minute',clock_timestamp())) on conflict(user_id,bucket) do update set count=board_requests.count+1 returning count into counter;
  if counter>180 then return jsonb_build_object('error','Too many board requests. Wait a minute and retry.');end if;
 end if;
 if action='cancel' then
  delete from workshop_private.board_queue where user_id=owner;
  for room in update workshop_private.board_matches x set status='closed',revision=revision+1,updated_at=clock_timestamp() where x.origin='random' and x.started_at is null and x.status='ready' and exists(select 1 from workshop_private.board_members b where b.match_id=x.id and b.user_id=owner) returning id loop perform workshop_private.board_notify(room);end loop;
  return jsonb_build_object('cancelled',true);
 end if;
 select x.id into active_room from workshop_private.board_matches x join workshop_private.board_members b on b.match_id=x.id where b.user_id=owner and x.status in ('waiting','ready','playing','scoring','disputed') limit 1;
 if action in ('create','join','queue') then
  if not exists(select 1 from public.typing_profiles where user_id=owner) then return jsonb_build_object('error','Your profile is not ready. Retry sign-in.');end if;
  if active_room is not null then return workshop_private.board_snapshot(active_room,owner,client);end if;
 end if;
 if action='create' then
  if workshop_private.board_capacity()>=2 then return jsonb_build_object('error','Online capacity is busy. Close a live room or retry later.');end if;
  delete from workshop_private.board_queue where user_id=owner;
  insert into workshop_private.board_matches(config,state,origin,ranked) values(body->'config',body->'state','invite',(body->>'ranked')::boolean) returning * into r;
  color:=case when substr(gen_random_uuid()::text,1,1) in ('0','1','2','3','4','5','6','7') then 1 else -1 end;
  insert into workshop_private.board_members(match_id,user_id,color,client_id) values(r.id,owner,color,client);
  return workshop_private.board_snapshot(r.id,owner,client);
 elsif action='queue' then
  if coalesce(body->'config'->>'training','false')<>'false' or (body->'config'->>'handicap')::integer<>0 or not (body->>'ranked')::boolean then raise exception 'Only standard Go settings can enter matchmaking.';end if;
  insert into workshop_private.board_queue(user_id,rule,size,client_id) values(owner,body->'config'->>'rule',(body->'config'->>'size')::integer,client)
  on conflict(user_id) do update set last_seen=clock_timestamp(),client_id=excluded.client_id,rule=excluded.rule,size=excluded.size,
   created_at=case when board_queue.rule=excluded.rule and board_queue.size=excluded.size then board_queue.created_at else clock_timestamp() end returning * into q;
  if workshop_private.board_capacity()>=2 then return jsonb_build_object('waiting',true,'capacity',true);end if;
  select * into other from workshop_private.board_queue x where x.user_id<>owner and x.rule=q.rule and x.size=q.size order by x.created_at,x.user_id limit 1 for update skip locked;
  if not found then return jsonb_build_object('waiting',true,'capacity',false);end if;
  insert into workshop_private.board_matches(config,state,origin,status,ranked,ready_deadline) values(body->'config',body->'state','random','ready',true,clock_timestamp()+interval '30 seconds') returning * into r;
  color:=case when substr(gen_random_uuid()::text,1,1) in ('0','1','2','3','4','5','6','7') then 1 else -1 end;
  insert into workshop_private.board_members(match_id,user_id,color,client_id) values(r.id,owner,color,client),(r.id,other.user_id,-color,other.client_id);
  delete from workshop_private.board_queue where user_id in (owner,other.user_id);
  return workshop_private.board_snapshot(r.id,owner,client);
 elsif action='join' then
  select * into r from workshop_private.board_matches where code=upper(btrim(body->>'code')) for update;
  if r.id is null or r.status<>'waiting' or r.origin<>'invite' then return jsonb_build_object('error','That room is unavailable or already full.');end if;
  insert into workshop_private.board_members(match_id,user_id,color,client_id) select r.id,owner,-b.color,client from workshop_private.board_members b where match_id=r.id;
  update workshop_private.board_matches set status='ready',ready_deadline=r.expires_at,revision=revision+1 where id=r.id;
  delete from workshop_private.board_queue where user_id=owner;
  perform workshop_private.board_notify(r.id); return workshop_private.board_snapshot(r.id,owner,client);
 end if;
 room:=coalesce((body->>'match_id')::uuid,active_room);
 if room is null then return jsonb_build_object('match',null);end if;
 select * into r from workshop_private.board_matches where id=room for update;
 select * into m from workshop_private.board_members where match_id=room and user_id=owner;
 if m.user_id is null then raise exception 'This match is not available to your account.' using errcode='42501';end if;
 if action='takeover' then update workshop_private.board_members set client_id=client,last_seen=clock_timestamp() where match_id=room and user_id=owner;return workshop_private.board_snapshot(room,owner,client);end if;
 if action in ('get','heartbeat') then
  if m.client_id=client then update workshop_private.board_members set last_seen=clock_timestamp() where match_id=room and user_id=owner;end if;
  return workshop_private.board_snapshot(room,owner,client);
 end if;
 if m.client_id<>client then return jsonb_build_object('error','Another tab controls this match. Take control to play.');end if;
 update workshop_private.board_members set last_seen=clock_timestamp() where match_id=room and user_id=owner;
 if action='ready' then
  if r.status<>'ready' then return workshop_private.board_snapshot(room,owner,client);end if;
  if r.config->>'training'='true' and coalesce(body->>'accept_training','false')<>'true' then return jsonb_build_object('error','Both players must accept single-color training.');end if;
  update workshop_private.board_members set ready=true,accepted_training=coalesce((body->>'accept_training')::boolean,false) where match_id=room and user_id=owner;
  if (select count(*) from workshop_private.board_members where match_id=room and ready)=2 then
   now_ms:=floor(extract(epoch from clock_timestamp())*1000);remaining:=case (r.config->>'clock')::integer when 9 then 300000 when 13 then 600000 else 1200000 end; periods:=case (r.config->>'clock')::integer when 19 then 5 else 3 end;
   clock_value:=jsonb_build_object('preset',(r.config->>'clock')::integer,'remaining',jsonb_build_object('1',remaining,'-1',remaining),'periods',jsonb_build_object('1',periods,'-1',periods),'anchor',now_ms);
   update workshop_private.board_matches set status='playing',started_at=clock_timestamp(),clock=clock_value,revision=revision+1,updated_at=clock_timestamp() where id=room;
  end if;
  perform workshop_private.board_notify(room);return workshop_private.board_snapshot(room,owner,client);
 elsif action='leave' then
  if r.started_at is null then update workshop_private.board_matches set status='closed',revision=revision+1 where id=room;
  elsif r.status not in ('finished','interrupted','closed') then perform workshop_private.board_settle(room,jsonb_build_object('winner',-m.color,'reason','resignation'),clock_timestamp());end if;
  perform workshop_private.board_notify(room);return workshop_private.board_snapshot(room,owner,client);
 end if;
 request:=(body->>'request_id')::uuid;
 if request is null then raise exception 'An operation identity is required.';end if;
 select * into old_receipt from workshop_private.board_actions where match_id=room and request_id=request;
 if found then
  if old_receipt.user_id<>owner or old_receipt.action is distinct from body->'action' then raise exception 'Request identity was already used for another action.';end if;
  return jsonb_build_object('receipt',old_receipt.receipt,'duplicate',true,'snapshot',workshop_private.board_snapshot(room,owner,client));
 end if;
 if r.status not in ('playing','scoring','disputed') then return jsonb_build_object('error','This match is not accepting moves.','snapshot',workshop_private.board_snapshot(room,owner,client));end if;
 if r.revision<>(body->>'expected_version')::bigint then return jsonb_build_object('error','The board changed. Read the latest position and retry.','code','VERSION_CONFLICT','snapshot',workshop_private.board_snapshot(room,owner,client));end if;
 if action='prepare' then return workshop_private.board_snapshot(room,owner,client);end if;
 if action='commit' then
  new_state:=body->'state';
  if new_state->>'game'<>'go' or new_state->'config' is distinct from r.config or new_state->>'version'<>'1' or jsonb_array_length(new_state->'log')<>jsonb_array_length(r.state->'log')+1 then raise exception 'Invalid canonical board transition.';end if;
  if body->'action'->>'type' in ('move','pass') and (r.status<>'playing' or (r.state->>'turn')::integer<>m.color) then raise exception 'Wait for your turn.';end if;
  clock_value:=r.clock; now_ms:=floor(extract(epoch from clock_timestamp())*1000);
  if r.status='playing' and body->'action'->>'type'<>'peek' then
   color:=(r.state->>'turn')::integer;elapsed:=greatest(0,now_ms-(clock_value->>'anchor')::numeric); remaining:=(clock_value->'remaining'->>color::text)::numeric;
   period_ms:=case (clock_value->>'preset')::integer when 9 then 20000 else 30000 end;
   periods:=greatest(0,(clock_value->'periods'->>color::text)::integer-floor(greatest(0,elapsed-remaining)/period_ms)::integer);
   clock_value:=jsonb_set(jsonb_set(clock_value,array['remaining',color::text],to_jsonb(greatest(0,remaining-elapsed))),array['periods',color::text],to_jsonb(periods));
  end if;
  if body->'action'->>'type'<>'peek' then clock_value:=jsonb_set(clock_value,'{anchor}',to_jsonb(now_ms));end if;
  update workshop_private.board_matches set state=new_state,status=case when new_state->>'phase'='finished' then status else new_state->>'phase' end,clock=clock_value,revision=revision+1,updated_at=clock_timestamp() where id=room returning * into r;
  if new_state->>'phase'='finished' then perform workshop_private.board_settle(room,new_state->'result',clock_timestamp());end if;
  insert into workshop_private.board_actions(match_id,request_id,user_id,action,receipt) values(room,request,owner,body->'action',jsonb_build_object('request_id',request,'revision',r.revision,'accepted',true));
  perform workshop_private.board_notify(room);return workshop_private.board_snapshot(room,owner,client);
 end if;
 raise exception 'Unknown board operation.';
end $$;
revoke all on function public.board_admin(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.board_admin(text,uuid,jsonb) to service_role;

create function public.get_board_game_leaderboard(game_name text default 'go',rule_name text default 'chinese',board_size integer default 9,sort_by text default 'wins',rules_version integer default 1) returns jsonb language sql stable security definer set search_path='' as $$
 with ranked as (
 select p.public_id,p.nickname,p.avatar_kind,p.avatar_path,p.google_avatar_url,s.wins,s.losses,s.draws,s.wins+s.losses+s.draws played,
  s.wins::numeric/nullif(s.wins+s.losses+s.draws,0) win_rate,s.achieved_at,s.user_id,
  row_number() over(order by case when sort_by='rate' then s.wins::numeric/nullif(s.wins+s.losses+s.draws,0) else s.wins::numeric end desc,
   s.wins::numeric/nullif(s.wins+s.losses+s.draws,0) desc,s.achieved_at,s.user_id) rank
 from workshop_private.board_stats s join public.typing_profiles p on p.user_id=s.user_id
 where s.game=game_name and s.rule=rule_name and s.size=board_size and s.rules_version=get_board_game_leaderboard.rules_version and sort_by in ('wins','rate') and (sort_by<>'rate' or s.wins+s.losses+s.draws>=10)
 ), clean as (select to_jsonb(r)-'user_id' value,rank,user_id from ranked r)
 select jsonb_build_object('top',coalesce((select jsonb_agg(value order by rank) from clean where rank<=50),'[]'::jsonb),'me',(select value from clean where user_id=(select auth.uid())),'minimum_games',case sort_by when 'rate' then 10 else 0 end)
$$;
grant execute on function public.get_board_game_leaderboard(text,text,integer,text,integer) to anon,authenticated;
create function workshop_private.board_public_stats(owner uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('game',game,'rule',rule,'size',size,'rules_version',rules_version,'wins',wins,'losses',losses,'draws',draws,'played',wins+losses+draws,'win_rate',wins::numeric/nullif(wins+losses+draws,0),'achieved_at',achieved_at) order by rule,size),'[]'::jsonb) from workshop_private.board_stats where user_id=owner
$$;
alter function public.get_public_profile(uuid) rename to get_public_profile_before_go;
revoke all on function public.get_public_profile_before_go(uuid) from public,anon,authenticated;
create function public.get_public_profile(profile_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select public.get_public_profile_before_go(profile_id)||jsonb_build_object('board_game_stats',workshop_private.board_public_stats((select user_id from public.typing_profiles where public_id=profile_id)))
$$;
grant execute on function public.get_public_profile(uuid) to anon,authenticated;

-- 兼容旧存档，Go 使用紧凑操作日志；正式成绩绝不来自私人存档。
alter function workshop_private.validate_game_save(text,jsonb) rename to validate_game_save_before_go;
create function workshop_private.validate_game_save(kind text,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 if payload->>'game' is distinct from 'go' then return workshop_private.validate_game_save_before_go(kind,payload);end if;
 if kind is distinct from 'game' or octet_length(payload::text)>256000 or jsonb_typeof(payload->'state') is distinct from 'object' or jsonb_typeof(payload->'state'->'log') is distinct from 'array' or jsonb_array_length(payload->'state'->'log')>8192 or coalesce(payload->'state'->'config'->>'rule','') not in ('chinese','japanese','aga') or coalesce(payload->'state'->'config'->>'size','') not in ('9','13','19') or payload->'state'->>'version' is distinct from '1' or payload->'state'->>'game' is distinct from 'go' or payload->>'mode' not in ('local','ai') or length(coalesce(payload->>'name','')) not between 1 and 120 then raise exception 'Invalid Go save or size over 256 KB';end if;
 return payload;
end $$;

-- 原容量检查继续使用同一把锁，只追加 Go 占用量，不改动旧房间规则。
do $$ declare name regprocedure; definition text; before_text text;begin
 foreach name in array array['workshop_private.pong_room(text,jsonb)'::regprocedure,'workshop_private.whiteboard_room(text,jsonb)'::regprocedure] loop
  definition:=pg_get_functiondef(name);
  before_text:=definition;
  definition:=replace(definition,'(select count(distinct room_id) from workshop_private.shared_whiteboard_members where lease_until>clock_timestamp())','(select count(distinct room_id) from workshop_private.shared_whiteboard_members where lease_until>clock_timestamp())+workshop_private.board_live_count()');
  if definition=before_text then raise exception 'Capacity integration requires review: %',name;end if;
  execute definition;
 end loop;
end $$;

-- pg_cron 不在 PGlite 中提供；真实 Supabase 在同一迁移中启用并安装 15 秒任务。
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  execute 'create extension if not exists pg_cron';
  execute $job$select cron.schedule('workshop-board-timeouts','15 seconds','select workshop_private.board_sweep()')$job$;
 end if;
end $$;
do $$ declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='workshop_private' and p.proname like 'board_%' and p.proname<>'board_channel_access' loop execute format('revoke all on function %s from public,anon,authenticated',fn);end loop;
end $$;
commit;
