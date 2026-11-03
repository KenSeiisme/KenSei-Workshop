begin;

-- 既有 Go 記錄不改鍵值；西洋棋使用獨立時控維度。
alter table workshop_private.board_matches drop constraint board_matches_game_check;
alter table workshop_private.board_matches add constraint board_matches_game_check check(game in ('go','chess'));
alter table workshop_private.board_matches drop constraint board_matches_status_check;
alter table workshop_private.board_matches add constraint board_matches_status_check check(status in ('waiting','ready','playing','scoring','disputed','unresolved','finished','interrupted','closed'));
alter table workshop_private.board_queue add column game text not null default 'go', add column time_control text not null default '';
alter table workshop_private.board_queue drop constraint board_queue_rule_check, drop constraint board_queue_size_check;
alter table workshop_private.board_queue add constraint board_queue_rules check(
 (game='go' and rule in ('chinese','japanese','aga') and size in (9,13,19) and time_control='') or
 (game='chess' and rule='fide' and size=8 and time_control in ('5+3','10+5','15+10')));
create index board_queue_game_clock on workshop_private.board_queue(game,time_control,created_at);
alter table workshop_private.board_stats add column time_control text not null default '';
alter table workshop_private.board_stats drop constraint board_stats_pkey;
alter table workshop_private.board_stats add primary key(user_id,game,rule,size,rules_version,time_control);
create index board_stats_chess on workshop_private.board_stats(game,time_control,rules_version,wins desc,achieved_at);

create or replace function workshop_private.board_settle(room uuid,result_value jsonb,effective_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare r workshop_private.board_matches; m workshop_private.board_members; win integer; lose integer; draw integer; inserted uuid;
begin
 select * into r from workshop_private.board_matches where id=room for update;
 if r.started_at is null or exists(select 1 from workshop_private.board_settlements where match_id=room) then return;end if;
 -- 未決先釋放容量，不能消耗最終結算回執；之後仍可雙方同意和棋。
 if r.game='chess' and result_value->>'reason'='unresolved' then
  update workshop_private.board_matches set status='unresolved',state=jsonb_set(jsonb_set(state,'{result}',result_value),'{phase}','"finished"'),ended_at=effective_at,revision=revision+1,updated_at=clock_timestamp() where id=room;
  perform workshop_private.board_notify(room);return;
 end if;
 insert into workshop_private.board_settlements(match_id,result,ranked,settled_at) values(room,result_value,r.ranked,effective_at) on conflict do nothing returning match_id into inserted;
 if inserted is null then return;end if;
 update workshop_private.board_matches set status=case when result_value->>'reason'='interrupted' then 'interrupted' else 'finished' end,
 state=jsonb_set(jsonb_set(state,'{result}',result_value),'{phase}','"finished"'),ended_at=effective_at,revision=revision+1,updated_at=clock_timestamp() where id=room;
 if r.ranked and result_value->>'reason' not in ('interrupted','no-result','unresolved') and (result_value->>'winner' in ('1','-1','0') or result_value->>'reason'='both-lose') then
  for m in select * from workshop_private.board_members where match_id=room loop
   win:=case when result_value->>'winner'=m.color::text then 1 else 0 end;
   draw:=case when result_value->>'winner'='0' and result_value->>'reason'<>'both-lose' then 1 else 0 end;lose:=1-win-draw;
   insert into workshop_private.board_stats(user_id,game,rule,size,rules_version,time_control,wins,losses,draws,achieved_at)
   values(m.user_id,r.game,r.config->>'rule',(r.config->>'size')::integer,r.rules_version,case when r.game='chess' then r.config->>'clock' else '' end,win,lose,draw,effective_at)
   on conflict(user_id,game,rule,size,rules_version,time_control) do update set wins=board_stats.wins+excluded.wins,losses=board_stats.losses+excluded.losses,draws=board_stats.draws+excluded.draws,achieved_at=excluded.achieved_at;
  end loop;
 end if;
 perform workshop_private.board_notify(room);
end $$;

alter function workshop_private.board_expire_one(uuid) rename to board_expire_one_before_chess;
create function workshop_private.board_expire_one(room uuid) returns void language plpgsql security definer set search_path='' as $$
declare r workshop_private.board_matches; deadline timestamptz; disconnect_at timestamptz; absent integer; disconnected_color integer; turn integer; verdict jsonb;
begin
 select * into r from workshop_private.board_matches where id=room for update;
 if r.game='go' then perform workshop_private.board_expire_one_before_chess(room);return;end if;
 if r.status in ('finished','interrupted','closed','unresolved') then return;end if;
 if r.status in ('waiting','ready') then
  if (r.status='waiting' and r.expires_at<=clock_timestamp()) or (r.status='ready' and r.ready_deadline<=clock_timestamp()) then update workshop_private.board_matches set status='closed',revision=revision+1,updated_at=clock_timestamp() where id=room;perform workshop_private.board_notify(room);end if;return;
 end if;
 select count(*) filter(where last_seen<=clock_timestamp()-interval '25 seconds'),min(last_seen+interval '120 seconds'),min(color) filter(where last_seen<=clock_timestamp()-interval '120 seconds') into absent,disconnect_at,disconnected_color from workshop_private.board_members where match_id=room;
 turn:=(r.state->>'turn')::integer;
 deadline:=to_timestamp(((r.clock->>'anchor')::numeric+(r.clock->'remaining'->>turn::text)::numeric)/1000);
 if deadline<=clock_timestamp() and (disconnect_at>clock_timestamp() or deadline<=disconnect_at) then
  if (select count(*) from workshop_private.board_members where match_id=room and last_seen<=deadline-interval '25 seconds')=2 then verdict:=jsonb_build_object('winner',null,'reason','interrupted');
  else verdict:=coalesce(r.state->'timeout'->turn::text,jsonb_build_object('winner',null,'reason','unresolved'));end if;
  perform workshop_private.board_settle(room,verdict,deadline);return;
 end if;
 if disconnect_at<=clock_timestamp() and disconnected_color is not null then
  perform workshop_private.board_settle(room,case when absent=2 then jsonb_build_object('winner',null,'reason','interrupted') else jsonb_build_object('winner',-disconnected_color,'reason','disconnect') end,disconnect_at);
 end if;
end $$;
create or replace function workshop_private.board_sweep() returns void language plpgsql security definer set search_path='' as $$
declare room uuid;begin
 for room in select id from workshop_private.board_matches where status in ('waiting','ready','playing','scoring','disputed') for update skip locked loop perform workshop_private.board_expire_one(room);end loop;
 delete from workshop_private.board_queue where last_seen<clock_timestamp()-interval '60 seconds';
 delete from workshop_private.board_requests where bucket<clock_timestamp()-interval '1 day';
end $$;

-- 僅由驗證 JWT 的 Edge 呼叫；規則推演在 Edge，CAS、時鐘、成員及統計在同一資料庫交易。
create function workshop_private.chess_admin(action text,owner uuid,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r workshop_private.board_matches; m workshop_private.board_members; other workshop_private.board_queue; q workshop_private.board_queue;
 client uuid; room uuid; request uuid; counter integer; old_receipt workshop_private.board_actions; color integer; now_ms bigint; clock_value jsonb; elapsed numeric; remaining numeric; increment_ms integer; main_ms integer; new_state jsonb; active_room uuid;
begin
 if owner is null or not exists(select 1 from auth.users where id=owner) or jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>2100000 or action not in ('create','join','queue','cancel','get','ready','prepare','commit','heartbeat','takeover','leave') then raise exception 'Invalid board request.';end if;
 client:=(body->>'client_id')::uuid;if client is null then raise exception 'A browser identity is required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('workshop-live-rooms',0));perform workshop_private.board_sweep();
 if action in ('create','join','queue','ready','prepare','commit','takeover') then
  insert into workshop_private.board_requests(user_id,bucket) values(owner,date_trunc('minute',clock_timestamp())) on conflict(user_id,bucket) do update set count=board_requests.count+1 returning count into counter;
  if counter>180 then return jsonb_build_object('error','Too many board requests. Wait a minute and retry.');end if;
 end if;
 if action='cancel' then
  delete from workshop_private.board_queue where user_id=owner and game='chess';
  for room in update workshop_private.board_matches x set status='closed',revision=revision+1,updated_at=clock_timestamp() where x.game='chess' and x.origin='random' and x.started_at is null and x.status='ready' and exists(select 1 from workshop_private.board_members b where b.match_id=x.id and b.user_id=owner) returning id loop perform workshop_private.board_notify(room);end loop;
  return jsonb_build_object('cancelled',true);
 end if;
 select x.id into active_room from workshop_private.board_matches x join workshop_private.board_members b on b.match_id=x.id where b.user_id=owner and x.status in ('waiting','ready','playing','scoring','disputed') limit 1;
 if active_room is not null and (select game from workshop_private.board_matches where id=active_room)<>'chess' then return jsonb_build_object('error','Another board game is active. Open that game first.','code','OTHER_GAME_ACTIVE');end if;
 if action in ('create','join','queue') then
  if not exists(select 1 from public.typing_profiles where user_id=owner) then return jsonb_build_object('error','Your profile is not ready. Retry sign-in.');end if;
  if active_room is not null then return workshop_private.board_snapshot(active_room,owner,client);end if;
 end if;
 if action in ('create','queue') then
  if body->'config'->>'clock' not in ('5+3','10+5','15+10') or body->'config'->>'rule' is distinct from 'fide' or body->'config'->>'size' is distinct from '8' or body->'state'->>'game' is distinct from 'chess' or body->'state'->'config' is distinct from body->'config' or jsonb_array_length(body->'state'->'log')<>0 then raise exception 'Invalid standard chess configuration.';end if;
 end if;
 if action='create' then
  if workshop_private.board_capacity()>=2 then return jsonb_build_object('error','Online capacity is busy. Close a live room or retry later.');end if;
  delete from workshop_private.board_queue where user_id=owner;
  insert into workshop_private.board_matches(game,config,state,origin,ranked) values('chess',body->'config',body->'state','invite',true) returning * into r;
  color:=case when body->>'preferred_color' in ('1','-1') then (body->>'preferred_color')::integer when substr(gen_random_uuid()::text,1,1) in ('0','1','2','3','4','5','6','7') then 1 else -1 end;
  insert into workshop_private.board_members(match_id,user_id,color,client_id) values(r.id,owner,color,client);return workshop_private.board_snapshot(r.id,owner,client);
 elsif action='queue' then
  insert into workshop_private.board_queue(user_id,game,rule,size,time_control,client_id) values(owner,'chess','fide',8,body->'config'->>'clock',client)
  on conflict(user_id) do update set game=excluded.game,rule=excluded.rule,size=excluded.size,time_control=excluded.time_control,client_id=excluded.client_id,last_seen=clock_timestamp(),created_at=case when board_queue.game=excluded.game and board_queue.time_control=excluded.time_control then board_queue.created_at else clock_timestamp() end returning * into q;
  if workshop_private.board_capacity()>=2 then return jsonb_build_object('waiting',true,'capacity',true);end if;
  select * into other from workshop_private.board_queue x where x.user_id<>owner and x.game='chess' and x.time_control=q.time_control order by x.created_at,x.user_id limit 1 for update skip locked;
  if not found then return jsonb_build_object('waiting',true,'capacity',false);end if;
  insert into workshop_private.board_matches(game,config,state,origin,status,ranked,ready_deadline) values('chess',body->'config',body->'state','random','ready',true,clock_timestamp()+interval '30 seconds') returning * into r;
  color:=case when substr(gen_random_uuid()::text,1,1) in ('0','1','2','3','4','5','6','7') then 1 else -1 end;
  insert into workshop_private.board_members(match_id,user_id,color,client_id) values(r.id,owner,color,client),(r.id,other.user_id,-color,other.client_id);
  delete from workshop_private.board_queue where user_id in (owner,other.user_id);return workshop_private.board_snapshot(r.id,owner,client);
 elsif action='join' then
  select * into r from workshop_private.board_matches where code=upper(btrim(body->>'code')) and game='chess' for update;
  if r.id is null or r.status<>'waiting' or r.origin<>'invite' then return jsonb_build_object('error','That room is unavailable or already full.');end if;
  insert into workshop_private.board_members(match_id,user_id,color,client_id) select r.id,owner,-b.color,client from workshop_private.board_members b where match_id=r.id;
  update workshop_private.board_matches set status='ready',ready_deadline=r.expires_at,revision=revision+1 where id=r.id;
  delete from workshop_private.board_queue where user_id=owner;perform workshop_private.board_notify(r.id);return workshop_private.board_snapshot(r.id,owner,client);
 end if;
 room:=coalesce((body->>'match_id')::uuid,active_room);
 if room is null then return jsonb_build_object('match',null);end if;
 select * into r from workshop_private.board_matches where id=room and game='chess' for update;
 select * into m from workshop_private.board_members where match_id=r.id and user_id=owner;
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
  update workshop_private.board_members set ready=true where match_id=room and user_id=owner;
  if (select count(*) from workshop_private.board_members where match_id=room and ready)=2 then
   now_ms:=floor(extract(epoch from clock_timestamp())*1000);main_ms:=case r.config->>'clock' when '5+3' then 300000 when '10+5' then 600000 else 900000 end;
   update workshop_private.board_matches set status='playing',started_at=clock_timestamp(),clock=jsonb_build_object('preset',r.config->>'clock','remaining',jsonb_build_object('1',main_ms,'-1',main_ms),'anchor',now_ms),revision=revision+1 where id=room;
  end if;
  perform workshop_private.board_notify(room);return workshop_private.board_snapshot(room,owner,client);
 elsif action='leave' then
  if r.started_at is not null and r.status='playing' then perform workshop_private.board_settle(room,jsonb_build_object('winner',-m.color,'reason','resignation'),clock_timestamp());
  elsif r.started_at is null then update workshop_private.board_matches set status='closed',revision=revision+1 where id=room;perform workshop_private.board_notify(room);end if;
  return workshop_private.board_snapshot(room,owner,client);
 end if;
 request:=(body->>'request_id')::uuid;if request is null then raise exception 'A request identity is required.';end if;
 select * into old_receipt from workshop_private.board_actions where match_id=room and request_id=request;
 if found then
  if old_receipt.user_id<>owner or old_receipt.action is distinct from body->'action' then raise exception 'Request identity was used for another action.';end if;
  return old_receipt.receipt||jsonb_build_object('duplicate',true,'snapshot',workshop_private.board_snapshot(room,owner,client));
 end if;
 if r.status not in ('playing','unresolved') then return jsonb_build_object('error','This match is not accepting moves.','snapshot',workshop_private.board_snapshot(room,owner,client));end if;
 if r.status='unresolved' and body->'action'->>'type' not in ('offer-draw','accept-draw','decline-draw') then raise exception 'Unresolved positions only allow a mutual draw agreement.';end if;
 if r.revision<>(body->>'expected_version')::bigint then return jsonb_build_object('error','The board changed. Read the latest position and retry.','code','VERSION_CONFLICT','snapshot',workshop_private.board_snapshot(room,owner,client));end if;
 if action='prepare' then return workshop_private.board_snapshot(room,owner,client);end if;
 if action='commit' then
  new_state:=body->'state';
  if new_state->>'game' is distinct from 'chess' or new_state->'config' is distinct from r.config or new_state->>'version' is distinct from '1' or jsonb_array_length(new_state->'log')<>jsonb_array_length(r.state->'log')+1 or new_state->>'phase' not in ('playing','finished') then raise exception 'Invalid canonical board transition.';end if;
  if body->'action'->>'type' in ('move','claim-draw') and (r.status<>'playing' or (r.state->>'turn')::integer<>m.color) then raise exception 'Wait for your turn.';end if;
  clock_value:=r.clock;now_ms:=floor(extract(epoch from clock_timestamp())*1000);
  if r.status='playing' then
   color:=(r.state->>'turn')::integer;elapsed:=greatest(0,now_ms-(clock_value->>'anchor')::numeric);remaining:=(clock_value->'remaining'->>color::text)::numeric;
   if elapsed>=remaining then
    perform workshop_private.board_expire_one(room);
    return jsonb_build_object('error','The clock has expired.','snapshot',workshop_private.board_snapshot(room,owner,client));
   end if;
   increment_ms:=case r.config->>'clock' when '5+3' then 3000 when '10+5' then 5000 else 10000 end;
   clock_value:=jsonb_set(clock_value,array['remaining',color::text],to_jsonb(greatest(0,remaining-elapsed)+case when body->'action'->>'type'='move' then increment_ms else 0 end));
   clock_value:=jsonb_set(clock_value,'{anchor}',to_jsonb(now_ms));
  end if;
  update workshop_private.board_matches set state=new_state,clock=clock_value,revision=revision+1,updated_at=clock_timestamp() where id=room;
  if new_state->>'phase'='finished' then perform workshop_private.board_settle(room,new_state->'result',clock_timestamp());end if;
  insert into workshop_private.board_actions(match_id,request_id,user_id,action,receipt) values(room,request,owner,body->'action',jsonb_build_object('request_id',request,'accepted',true));
  perform workshop_private.board_notify(room);return workshop_private.board_snapshot(room,owner,client);
 end if;
 raise exception 'Unknown board operation.';
end $$;

alter function public.board_admin(text,uuid,jsonb) rename to board_admin_before_chess;
revoke all on function public.board_admin_before_chess(text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.board_admin(action text,owner uuid,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare game_name text:=coalesce(body->>'game','go'); stored_game text; active_game text;
begin
 perform pg_advisory_xact_lock(hashtextextended('workshop-live-rooms',0));
 perform workshop_private.board_sweep();
 if game_name not in ('go','chess') then raise exception 'Unknown board game.';end if;
 if body->>'match_id' is not null then select game into stored_game from workshop_private.board_matches where id=(body->>'match_id')::uuid;
 elsif action='join' then select game into stored_game from workshop_private.board_matches where code=upper(btrim(body->>'code'));end if;
 if stored_game is not null and stored_game<>game_name then return jsonb_build_object('error','This room belongs to another board game.','code','OTHER_GAME');end if;
 select r.game into active_game from workshop_private.board_matches r join workshop_private.board_members m on m.match_id=r.id where m.user_id=owner and r.status in ('waiting','ready','playing','scoring','disputed') limit 1;
 if active_game is not null and active_game<>game_name then return jsonb_build_object('error','Another board game is active. Open that game first.','code','OTHER_GAME_ACTIVE');end if;
 if game_name='chess' then return workshop_private.chess_admin(action,owner,body);end if;
 if exists(select 1 from workshop_private.board_queue where user_id=owner and game<>'go') then
  if action in ('create','join','queue') then delete from workshop_private.board_queue where user_id=owner;else return jsonb_build_object('match',null);end if;
 end if;
 return public.board_admin_before_chess(action,owner,body);
end $$;
revoke all on function public.board_admin(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.board_admin(text,uuid,jsonb) to service_role;

create function public.get_chess_leaderboard(time_control text default '10+5',sort_by text default 'wins',rules_version integer default 1) returns jsonb language sql stable security definer set search_path='' as $$
 with ranked as (
 select p.public_id,p.nickname,p.avatar_kind,p.avatar_path,p.google_avatar_url,s.wins,s.losses,s.draws,s.wins+s.losses+s.draws played,
 s.wins::numeric/nullif(s.wins+s.losses+s.draws,0) win_rate,s.achieved_at,s.user_id,
 row_number() over(order by case when sort_by='rate' then s.wins::numeric/nullif(s.wins+s.losses+s.draws,0) else s.wins::numeric end desc,s.wins::numeric/nullif(s.wins+s.losses+s.draws,0) desc,s.achieved_at,s.user_id) rank
 from workshop_private.board_stats s join public.typing_profiles p on p.user_id=s.user_id
 where s.game='chess' and s.time_control=get_chess_leaderboard.time_control and s.rules_version=get_chess_leaderboard.rules_version and sort_by in ('wins','rate') and (sort_by<>'rate' or s.wins+s.losses+s.draws>=10)
 ), clean as (select to_jsonb(r)-'user_id' value,rank,user_id from ranked r)
 select jsonb_build_object('top',coalesce((select jsonb_agg(value order by rank) from clean where rank<=50),'[]'::jsonb),'me',(select value from clean where user_id=(select auth.uid())),'minimum_games',case sort_by when 'rate' then 10 else 0 end)
$$;
revoke all on function public.get_chess_leaderboard(text,text,integer) from public;
grant execute on function public.get_chess_leaderboard(text,text,integer) to anon,authenticated;
create or replace function workshop_private.board_public_stats(owner uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('game',game,'rule',rule,'size',size,'rules_version',rules_version,'wins',wins,'losses',losses,'draws',draws,'played',wins+losses+draws,'win_rate',wins::numeric/nullif(wins+losses+draws,0),'achieved_at',achieved_at) order by rule,size),'[]'::jsonb) from workshop_private.board_stats where user_id=owner and game='go'
$$;
alter function public.get_public_profile(uuid) rename to get_public_profile_before_chess;
revoke all on function public.get_public_profile_before_chess(uuid) from public,anon,authenticated;
create function public.get_public_profile(profile_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select public.get_public_profile_before_chess(profile_id)||jsonb_build_object('chess_stats',coalesce((select jsonb_agg(jsonb_build_object('game',s.game,'time_control',s.time_control,'rules_version',s.rules_version,'wins',s.wins,'losses',s.losses,'draws',s.draws,'played',s.wins+s.losses+s.draws,'win_rate',s.wins::numeric/nullif(s.wins+s.losses+s.draws,0),'achieved_at',s.achieved_at) order by s.time_control) from workshop_private.board_stats s join public.typing_profiles p on p.user_id=s.user_id where p.public_id=profile_id and s.game='chess'),'[]'::jsonb))
$$;
grant execute on function public.get_public_profile(uuid) to anon,authenticated;
revoke all on function public.get_public_profile(uuid) from public;

alter function workshop_private.validate_game_save(text,jsonb) rename to validate_game_save_before_chess;
create function workshop_private.validate_game_save(kind text,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 if payload->>'game' is distinct from 'chess' then return workshop_private.validate_game_save_before_chess(kind,payload);end if;
 if kind is distinct from 'game' or octet_length(payload::text)>256000 or jsonb_typeof(payload->'state') is distinct from 'object' or jsonb_typeof(payload->'state'->'log') is distinct from 'array' or jsonb_array_length(payload->'state'->'log')>4096 or payload->'state'->>'version' is distinct from '1' or payload->'state'->>'game' is distinct from 'chess' or payload->>'mode' not in ('local','ai') or payload->'state'->'config'->>'clock' not in ('none','5+3','10+5','15+10') or length(coalesce(payload->>'name','')) not between 1 and 120 then raise exception 'Invalid chess save or size over 256 KB.';end if;
 return payload;
end $$;
revoke all on function workshop_private.chess_admin(text,uuid,jsonb),workshop_private.board_expire_one_before_chess(uuid),workshop_private.validate_game_save(text,jsonb),workshop_private.board_public_stats(uuid) from public,anon,authenticated;
revoke all on function workshop_private.board_expire_one(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
