begin;
-- Only Brick Breaker advances to v2. Existing results and saves are retained.
create function workshop_private.game_rule_version(game text) returns integer language sql immutable set search_path='' as $$ select case when game='brick-breaker' then 2 else 1 end $$;
revoke all on function workshop_private.game_rule_version(text) from public,anon,authenticated;
create or replace function workshop_private.validate_game_save(kind text,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 if kind is distinct from 'game' or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>256000 or not workshop_private.game_mode(payload->>'game',payload->>'difficulty') or jsonb_typeof(payload->'state') is distinct from 'object' or (payload->'state'->>'version' is distinct from '1' and (payload->>'game' is distinct from 'brick-breaker' or payload->'state'->>'version' is distinct from '2')) or payload->'state'->>'game' is distinct from payload->>'game' or payload->'state'->>'difficulty' is distinct from payload->>'difficulty' or jsonb_typeof(payload->'elapsed') is distinct from 'number' or (payload->>'elapsed')::numeric<0 or length(coalesce(payload->>'name','')) not between 1 and 120 then raise exception 'Invalid game save or size over 256 KB';end if;
 return jsonb_build_object('game',payload->'game','difficulty',payload->'difficulty','state',payload->'state','elapsed',payload->'elapsed','best',payload->'best','name',payload->'name');
end $$;
create or replace function workshop_private.games_admin(action text,owner uuid,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s workshop_private.game_sessions; elapsed bigint; r jsonb; qualifies boolean;
begin
 if owner is null or not exists(select 1 from auth.users where id=owner) then raise exception 'Invalid account';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,19));
 if action='start' then
  if not workshop_private.ranked_game(body->>'game') or not workshop_private.game_mode(body->>'game',body->>'difficulty') or (body->>'seed')::bigint not between 1 and 4294967295 then raise exception 'Invalid game';end if;
  if (select count(*) from workshop_private.game_sessions where user_id=owner and started_at>clock_timestamp()-interval '1 minute')>=12 then raise exception 'Too many starts. Wait a minute and try again';end if;
  update workshop_private.game_sessions set status='abandoned' where user_id=owner and status='active';
  insert into workshop_private.game_sessions(user_id,game,difficulty,seed,version) values(owner,body->>'game',body->>'difficulty',(body->>'seed')::bigint,workshop_private.game_rule_version(body->>'game')) returning * into s;
  return jsonb_build_object('id',s.id,'game',s.game,'difficulty',s.difficulty,'version',s.version,'seed',s.seed,'started_at',s.started_at,'expires_at',s.expires_at);
 end if;
 select * into s from workshop_private.game_sessions where id=(body->>'session_id')::uuid and user_id=owner for update;
 if not found then raise exception 'Game session not found';end if;
 if action='abandon' then
  update workshop_private.game_sessions set status='abandoned' where id=s.id and status='active';return jsonb_build_object('abandoned',true);
 end if;
 if action not in ('read','finish') then raise exception 'Unknown game operation';end if;
 if s.status='completed' then return to_jsonb(s);end if;
 if s.status<>'active' or s.expires_at<clock_timestamp() then raise exception 'This Public session expired or was interrupted';end if;
 if action='read' then
  if s.verification_attempts>=12 then raise exception 'Too many verification attempts';end if;
  update workshop_private.game_sessions set verification_attempts=verification_attempts+1 where id=s.id;
  return to_jsonb(s);
 end if;
 elapsed:=greatest(1,floor(extract(epoch from(clock_timestamp()-s.started_at))*1000)::bigint);
 if jsonb_typeof(body->'metrics') is distinct from 'object' or (body->'metrics'->>'score')::bigint not between 0 and 2147483647 or (body->'metrics'->>'moves')::integer not between 0 and 20000 or (body->'metrics'->>'max_tile')::bigint not between 0 and 2147483647 or jsonb_typeof(body->'metrics'->'won') is distinct from 'boolean' then raise exception 'Invalid verified result';end if;
 qualifies:=(s.game not in ('minesweeper','memory-match','sudoku','nonogram') and not(s.game='block-drop' and s.difficulty='sprint')) or (body->'metrics'->>'won')::boolean;
 if s.game='block-drop' and (coalesce(jsonb_typeof(body->'metrics'->'lines'),'')<>'number' or (body->'metrics'->>'lines')::numeric not between 0 and 80000 or trunc((body->'metrics'->>'lines')::numeric)<>(body->'metrics'->>'lines')::numeric) then raise exception 'Invalid verified line count';end if;
 r:=body->'metrics'||jsonb_build_object('elapsed_ms',elapsed,'qualified',qualifies,'game',s.game,'difficulty',s.difficulty,'version',s.version);
 if qualifies then
  insert into workshop_private.game_results(session_id,user_id,game,difficulty,version,score,max_tile,moves,elapsed_ms,summary) values(s.id,owner,s.game,s.difficulty,s.version,(r->>'score')::bigint,(r->>'max_tile')::bigint,(r->>'moves')::integer,elapsed,jsonb_build_object('won',(r->>'won')::boolean)||case when s.game='block-drop' then jsonb_build_object('lines',(r->>'lines')::integer) else '{}'::jsonb end);
  r:=r||jsonb_build_object('new_achievements',workshop_private.grant_game_achievements(owner));
 else r:=r||jsonb_build_object('reason','Only completed wins qualify for this game. Your private result is saved.');end if;
 update workshop_private.game_sessions set status='completed',result=r where id=s.id returning * into s;
 return to_jsonb(s);
end $$;
create function workshop_private.game_board_version(game_slug text,difficulty_slug text,rules_version integer) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare output jsonb;
begin
 if rules_version is null or rules_version not in (1,workshop_private.game_rule_version(game_slug)) or not workshop_private.ranked_game(game_slug) or not workshop_private.game_mode(game_slug,difficulty_slug) then raise exception 'Invalid game or difficulty';end if;
 with candidates as (
  select r.*,case when r.game='block-drop' then case when r.difficulty='classic' then -r.score else r.elapsed_ms end else workshop_private.game_order_1(r.game,r.score,r.moves,r.elapsed_ms) end as k1,
  case when r.game='block-drop' and r.difficulty='classic' then -coalesce((r.summary->>'lines')::bigint,0) else workshop_private.game_order_2(r.game,r.max_tile,r.elapsed_ms) end as k2
  from workshop_private.game_results r where r.game=game_slug and r.difficulty=difficulty_slug and r.version=rules_version
 ), best as (select distinct on(user_id) * from candidates order by user_id,k1,k2,achieved_at,session_id),
 ranked as (select *,row_number() over(order by k1,k2,achieved_at,user_id) as rank from best),
 safe as (select r.rank,p.public_id,p.nickname,workshop_private.profile_json(p)-'bio' as profile,r.score,r.max_tile,r.moves,r.elapsed_ms,r.achieved_at,r.difficulty,r.summary,coalesce((r.summary->>'lines')::integer,0) as lines,r.user_id=auth.uid() as is_me from ranked r join public.typing_profiles p on p.user_id=r.user_id)
 select jsonb_build_object('version',rules_version,'top',coalesce((select jsonb_agg(to_jsonb(s)-'is_me' order by rank) from safe s where rank<=50),'[]'::jsonb),'me',(select to_jsonb(s)-'is_me' from safe s where is_me)) into output;
 return output;
end $$;
create or replace function workshop_private.game_board(game_slug text,difficulty_slug text) returns jsonb language sql security definer stable set search_path='' as $$ select workshop_private.game_board_version(game_slug,difficulty_slug,workshop_private.game_rule_version(game_slug)) $$;
create function public.get_game_leaderboard_history(game text,difficulty text,rules_version integer) returns jsonb language sql security invoker stable set search_path='' as $$ select workshop_private.game_board_version(game,difficulty,rules_version) $$;
revoke all on function workshop_private.game_board_version(text,text,integer),public.get_game_leaderboard_history(text,text,integer) from public,anon,authenticated;
grant execute on function workshop_private.game_board_version(text,text,integer),public.get_game_leaderboard_history(text,text,integer) to anon,authenticated;

create or replace function workshop_private.game_bests(owner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select distinct on(r.game,r.difficulty) r.game,r.difficulty,r.version,r.score,r.max_tile,r.moves,r.elapsed_ms,r.achieved_at,r.summary,coalesce((r.summary->>'lines')::integer,0) as lines from workshop_private.game_results r where r.user_id=owner and r.version=workshop_private.game_rule_version(r.game) and workshop_private.ranked_game(r.game)
  order by r.game,r.difficulty,case when r.game='block-drop' then case when r.difficulty='classic' then -r.score else r.elapsed_ms end else workshop_private.game_order_1(r.game,r.score,r.moves,r.elapsed_ms) end,
  case when r.game='block-drop' and r.difficulty='classic' then -coalesce((r.summary->>'lines')::bigint,0) else workshop_private.game_order_2(r.game,r.max_tile,r.elapsed_ms) end,r.achieved_at,r.session_id
 ) x
$$;
create function workshop_private.game_legacy_bests(owner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select distinct on(r.game,r.difficulty,r.version) r.game,r.difficulty,r.version,r.score,r.max_tile,r.moves,r.elapsed_ms,r.achieved_at,r.summary,coalesce((r.summary->>'lines')::integer,0) as lines from workshop_private.game_results r where r.user_id=owner and r.version<workshop_private.game_rule_version(r.game) and workshop_private.ranked_game(r.game)
  order by r.game,r.difficulty,r.version,case when r.game='block-drop' then case when r.difficulty='classic' then -r.score else r.elapsed_ms end else workshop_private.game_order_1(r.game,r.score,r.moves,r.elapsed_ms) end,
  case when r.game='block-drop' and r.difficulty='classic' then -coalesce((r.summary->>'lines')::bigint,0) else workshop_private.game_order_2(r.game,r.max_tile,r.elapsed_ms) end,r.achieved_at,r.session_id
 ) x
$$;
revoke all on function workshop_private.game_legacy_bests(uuid) from public,anon,authenticated;
create or replace function public.get_public_profile(profile_id uuid) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare p public.typing_profiles; result_value jsonb; best jsonb;
begin
 select * into p from public.typing_profiles where public_id=profile_id;
 if not found then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into best from (
  select distinct on(r.language) r.language,r.version,r.speed,r.accuracy,r.achieved_at from public.typing_results r join public.typing_passages t on t.language=r.language and t.version=r.version and t.active
  where r.user_id=p.user_id and r.accuracy>=95 order by r.language,r.speed desc,r.accuracy desc,r.achieved_at,r.session_id
 ) s;
 return workshop_private.profile_json(p)||jsonb_build_object('best_scores',best,'game_best_scores',workshop_private.game_bests(p.user_id),'game_achievements',workshop_private.public_game_achievements(p.user_id),'game_legacy_best_scores',workshop_private.game_legacy_bests(p.user_id));
end $$;
notify pgrst,'reload schema';
commit;
