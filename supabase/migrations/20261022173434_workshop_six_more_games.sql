begin;
-- Extend existing private saves and verified rankings; do not reset version-1 results.
create or replace function workshop_private.game_mode(game text,difficulty text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(case
 when game='2048' then difficulty='classic'
 when game='minesweeper' then difficulty in ('beginner','intermediate','expert')
 when game='snake' then difficulty in ('slow','normal','fast')
 when game in ('memory-match','sudoku','nonogram') then difficulty in ('easy','normal','hard')
 when game in ('block-puzzle','brick-breaker') then difficulty='classic'
 when game in ('connect-four','reversi') then difficulty in ('ai-easy','ai-normal','ai-hard','local')
 else false end,false)
$$;
create or replace function workshop_private.ranked_game(game text) returns boolean language sql immutable set search_path='' as $$
 select game in ('2048','minesweeper','snake','memory-match','sudoku','nonogram','block-puzzle','brick-breaker')
$$;
create or replace function workshop_private.game_order_1(game text,score bigint,moves integer,elapsed_ms bigint) returns bigint language sql immutable set search_path='' as $$
 select case when game in ('2048','snake','block-puzzle','brick-breaker') then -score when game='memory-match' then moves::bigint else elapsed_ms end
$$;
create or replace function workshop_private.game_order_2(game text,max_tile bigint,elapsed_ms bigint) returns bigint language sql immutable set search_path='' as $$
 select case when game='2048' then -max_tile when game in ('memory-match','brick-breaker') then elapsed_ms else 0::bigint end
$$;
revoke all on function workshop_private.ranked_game(text),workshop_private.game_order_1(text,bigint,integer,bigint),workshop_private.game_order_2(text,bigint,bigint) from public,anon,authenticated;

create or replace function workshop_private.games_admin(action text,owner uuid,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s workshop_private.game_sessions; elapsed bigint; r jsonb; qualifies boolean;
begin
 if owner is null or not exists(select 1 from auth.users where id=owner) then raise exception 'Invalid account';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,19));
 if action='start' then
  if not workshop_private.ranked_game(body->>'game') or not workshop_private.game_mode(body->>'game',body->>'difficulty') or (body->>'seed')::bigint not between 1 and 4294967295 then raise exception 'Invalid game';end if;
  if (select count(*) from workshop_private.game_sessions where user_id=owner and started_at>clock_timestamp()-interval '1 minute')>=12 then raise exception 'Too many starts. Wait a minute and try again';end if;
  update workshop_private.game_sessions set status='abandoned' where user_id=owner and status='active';
  insert into workshop_private.game_sessions(user_id,game,difficulty,seed) values(owner,body->>'game',body->>'difficulty',(body->>'seed')::bigint) returning * into s;
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
 qualifies:=s.game not in ('minesweeper','memory-match','sudoku','nonogram') or (body->'metrics'->>'won')::boolean;
 r:=body->'metrics'||jsonb_build_object('elapsed_ms',elapsed,'qualified',qualifies,'game',s.game,'difficulty',s.difficulty,'version',s.version);
 if qualifies then
  insert into workshop_private.game_results(session_id,user_id,game,difficulty,version,score,max_tile,moves,elapsed_ms) values(s.id,owner,s.game,s.difficulty,s.version,(r->>'score')::bigint,(r->>'max_tile')::bigint,(r->>'moves')::integer,elapsed);
 else r:=r||jsonb_build_object('reason','Only completed wins qualify for this game. Your private result is saved.');end if;
 update workshop_private.game_sessions set status='completed',result=r where id=s.id returning * into s;
 return to_jsonb(s);
end $$;
create or replace function workshop_private.game_board(game_slug text,difficulty_slug text) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare output jsonb;
begin
 if not workshop_private.ranked_game(game_slug) or not workshop_private.game_mode(game_slug,difficulty_slug) then raise exception 'Invalid game or difficulty';end if;
 with candidates as (
  select r.*,workshop_private.game_order_1(r.game,r.score,r.moves,r.elapsed_ms) as k1,
  workshop_private.game_order_2(r.game,r.max_tile,r.elapsed_ms) as k2
  from workshop_private.game_results r where r.game=game_slug and r.difficulty=difficulty_slug and r.version=1
 ), best as (select distinct on(user_id) * from candidates order by user_id,k1,k2,achieved_at,session_id),
 ranked as (select *,row_number() over(order by k1,k2,achieved_at,user_id) as rank from best),
 safe as (select r.rank,p.public_id,p.nickname,workshop_private.profile_json(p)-'bio' as profile,r.score,r.max_tile,r.moves,r.elapsed_ms,r.achieved_at,r.user_id=auth.uid() as is_me from ranked r join public.typing_profiles p on p.user_id=r.user_id)
 select jsonb_build_object('version',1,'top',coalesce((select jsonb_agg(to_jsonb(s)-'is_me' order by rank) from safe s where rank<=50),'[]'::jsonb),'me',(select to_jsonb(s)-'is_me' from safe s where is_me)) into output;
 return output;
end $$;
create or replace function workshop_private.game_bests(owner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select distinct on(r.game,r.difficulty) r.game,r.difficulty,r.version,r.score,r.max_tile,r.moves,r.elapsed_ms,r.achieved_at from workshop_private.game_results r where r.user_id=owner and r.version=1 and workshop_private.ranked_game(r.game)
  order by r.game,r.difficulty,workshop_private.game_order_1(r.game,r.score,r.moves,r.elapsed_ms),
  workshop_private.game_order_2(r.game,r.max_tile,r.elapsed_ms),r.achieved_at,r.session_id
 ) x
$$;
commit;
