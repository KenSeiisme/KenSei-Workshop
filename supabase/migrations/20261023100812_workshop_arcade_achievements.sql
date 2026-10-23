begin;
-- Append verified metadata; never accept achievements or final scores from a browser.
alter table workshop_private.game_results add column summary jsonb not null default '{}'::jsonb check(jsonb_typeof(summary)='object' and octet_length(summary::text)<=512);
update workshop_private.game_results r set summary=jsonb_build_object('won',s.result->'won') from workshop_private.game_sessions s where s.id=r.session_id and jsonb_typeof(s.result->'won')='boolean';
create table workshop_private.game_achievement_rules(id text primary key,game text,field text not null,target integer not null check(target>0),mode text);
create table workshop_private.game_achievement_unlocks(user_id uuid not null references auth.users(id) on delete cascade,achievement_id text not null references workshop_private.game_achievement_rules(id),unlocked_at timestamptz not null,primary key(user_id,achievement_id));
alter table workshop_private.game_achievement_rules enable row level security;
alter table workshop_private.game_achievement_unlocks enable row level security;
revoke all on workshop_private.game_achievement_rules,workshop_private.game_achievement_unlocks from public,anon,authenticated;
insert into workshop_private.game_achievement_rules(id,game,field,target,mode) values
('2048-1','2048','max_tile',256,null),
('2048-2','2048','max_tile',1024,null),
('2048-3','2048','max_tile',2048,null),
('minesweeper-1','minesweeper','mode',1,'beginner'),
('minesweeper-2','minesweeper','mode',1,'intermediate'),
('minesweeper-3','minesweeper','mode',1,'expert'),
('snake-1','snake','score',100,null),
('snake-2','snake','score',300,null),
('snake-3','snake','score',600,null),
('memory-match-1','memory-match','mode',1,'easy'),
('memory-match-2','memory-match','mode',1,'normal'),
('memory-match-3','memory-match','mode',1,'hard'),
('sudoku-1','sudoku','mode',1,'easy'),
('sudoku-2','sudoku','mode',1,'normal'),
('sudoku-3','sudoku','mode',1,'hard'),
('nonogram-1','nonogram','mode',1,'easy'),
('nonogram-2','nonogram','mode',1,'normal'),
('nonogram-3','nonogram','mode',1,'hard'),
('block-puzzle-1','block-puzzle','score',250,null),
('block-puzzle-2','block-puzzle','score',750,null),
('block-puzzle-3','block-puzzle','score',1500,null),
('brick-breaker-1','brick-breaker','score',400,null),
('brick-breaker-2','brick-breaker','score',800,null),
('brick-breaker-3','brick-breaker','won',1,null),
('block-drop-1','block-drop','lines',10,'classic'),
('block-drop-2','block-drop','lines',40,'classic'),
('block-drop-3','block-drop','won',1,'sprint'),
('public-first',null,'results',1,null),
('public-ten',null,'results',10,null),
('public-three-games',null,'games',3,null);
create function workshop_private.achievement_progress(owner uuid)
returns table(achievement_id text,unlocked_at timestamptz,progress bigint)
language sql stable set search_path='' as $$
 with ordinary as (
  select c.id,c.target,coalesce(max(v.amount),0)::bigint as progress,min(r.achieved_at) filter(where v.amount>=c.target) as unlocked_at
  from workshop_private.game_achievement_rules c
  left join workshop_private.game_results r on r.user_id=owner and r.game=c.game and (c.mode is null or c.mode=r.difficulty)
  left join lateral (select case c.field
   when 'max_tile' then r.max_tile when 'score' then r.score
   when 'lines' then coalesce((r.summary->>'lines')::bigint,0)
   when 'mode' then case when r.session_id is not null then 1 else 0 end
   when 'won' then case when r.summary->>'won'='true' then 1 else 0 end
   else 0 end as amount) v on true
  where c.game is not null group by c.id,c.target
 ), totals as (
  select count(*)::bigint as results,count(distinct game)::bigint as games,array_agg(achieved_at order by achieved_at,session_id) as dates from workshop_private.game_results where user_id=owner
 ), game_dates as (
  select array_agg(first_date order by first_date,game) as dates from (select game,min(achieved_at) as first_date from workshop_private.game_results where user_id=owner group by game) x
 )
 select id,unlocked_at,progress from ordinary
 union all select c.id,case when c.field='results' then t.dates[c.target] else g.dates[c.target] end,case when c.field='results' then t.results else t.games end
 from workshop_private.game_achievement_rules c cross join totals t cross join game_dates g where c.game is null
$$;
create function workshop_private.grant_game_achievements(owner uuid) returns jsonb language plpgsql set search_path='' as $$
declare added jsonb;
begin
 with inserted as (insert into workshop_private.game_achievement_unlocks(user_id,achievement_id,unlocked_at)
  select owner,p.achievement_id,p.unlocked_at from workshop_private.achievement_progress(owner) p where p.unlocked_at is not null on conflict do nothing returning achievement_id,unlocked_at)
 select coalesce(jsonb_agg(to_jsonb(x) order by unlocked_at,achievement_id),'[]'::jsonb) into added from inserted x;
 return added;
end $$;
create function workshop_private.public_game_achievements(owner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('achievement_id',achievement_id,'unlocked_at',unlocked_at) order by unlocked_at desc,achievement_id),'[]'::jsonb) from workshop_private.game_achievement_unlocks where user_id=owner
$$;
create function workshop_private.my_game_progress() returns jsonb language plpgsql security definer stable set search_path='' as $$
declare owner uuid:=auth.uid(); data jsonb;
begin
 if owner is null then raise exception 'Sign in to view your verified progress' using errcode='28000';end if;
 select jsonb_build_object('result_count',count(*),'game_count',count(distinct game),'unlocks',workshop_private.public_game_achievements(owner),'progress',(select jsonb_object_agg(achievement_id,progress) from workshop_private.achievement_progress(owner))) into data from workshop_private.game_results where user_id=owner;
 return data;
end $$;
create function public.get_my_game_progress() returns jsonb language sql security invoker stable set search_path='' as $$ select workshop_private.my_game_progress() $$;
revoke all on function workshop_private.achievement_progress(uuid),workshop_private.grant_game_achievements(uuid),workshop_private.public_game_achievements(uuid),workshop_private.my_game_progress(),public.get_my_game_progress() from public,anon,authenticated;
grant execute on function workshop_private.my_game_progress(),public.get_my_game_progress() to authenticated;
-- Existing accepted results prove historical milestones; no fabricated events or replay data.
do $$ declare player uuid; begin for player in select distinct user_id from workshop_private.game_results loop perform workshop_private.grant_game_achievements(player);end loop;end $$;

-- Extend existing private saves and verified rankings; do not reset version-1 results.
create or replace function workshop_private.game_mode(game text,difficulty text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(case
 when game='2048' then difficulty='classic'
 when game='minesweeper' then difficulty in ('beginner','intermediate','expert')
 when game='snake' then difficulty in ('slow','normal','fast')
 when game in ('memory-match','sudoku','nonogram') then difficulty in ('easy','normal','hard')
 when game in ('block-puzzle','brick-breaker') then difficulty='classic'
 when game='block-drop' then difficulty in ('classic','sprint')
 when game in ('connect-four','reversi') then difficulty in ('ai-easy','ai-normal','ai-hard','local')
 else false end,false)
$$;
create or replace function workshop_private.ranked_game(game text) returns boolean language sql immutable set search_path='' as $$
 select game in ('2048','minesweeper','snake','memory-match','sudoku','nonogram','block-puzzle','brick-breaker','block-drop')
$$;
create or replace function workshop_private.game_order_1(game text,score bigint,moves integer,elapsed_ms bigint) returns bigint language sql immutable set search_path='' as $$
 select case when game in ('2048','snake','block-puzzle','brick-breaker','block-drop') then -score when game='memory-match' then moves::bigint else elapsed_ms end
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
create or replace function workshop_private.game_board(game_slug text,difficulty_slug text) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare output jsonb;
begin
 if not workshop_private.ranked_game(game_slug) or not workshop_private.game_mode(game_slug,difficulty_slug) then raise exception 'Invalid game or difficulty';end if;
 with candidates as (
  select r.*,case when r.game='block-drop' then case when r.difficulty='classic' then -r.score else r.elapsed_ms end else workshop_private.game_order_1(r.game,r.score,r.moves,r.elapsed_ms) end as k1,
  case when r.game='block-drop' and r.difficulty='classic' then -coalesce((r.summary->>'lines')::bigint,0) else workshop_private.game_order_2(r.game,r.max_tile,r.elapsed_ms) end as k2
  from workshop_private.game_results r where r.game=game_slug and r.difficulty=difficulty_slug and r.version=1
 ), best as (select distinct on(user_id) * from candidates order by user_id,k1,k2,achieved_at,session_id),
 ranked as (select *,row_number() over(order by k1,k2,achieved_at,user_id) as rank from best),
 safe as (select r.rank,p.public_id,p.nickname,workshop_private.profile_json(p)-'bio' as profile,r.score,r.max_tile,r.moves,r.elapsed_ms,r.achieved_at,r.difficulty,r.summary,coalesce((r.summary->>'lines')::integer,0) as lines,r.user_id=auth.uid() as is_me from ranked r join public.typing_profiles p on p.user_id=r.user_id)
 select jsonb_build_object('version',1,'top',coalesce((select jsonb_agg(to_jsonb(s)-'is_me' order by rank) from safe s where rank<=50),'[]'::jsonb),'me',(select to_jsonb(s)-'is_me' from safe s where is_me)) into output;
 return output;
end $$;
create or replace function workshop_private.game_bests(owner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select distinct on(r.game,r.difficulty) r.game,r.difficulty,r.version,r.score,r.max_tile,r.moves,r.elapsed_ms,r.achieved_at,r.summary,coalesce((r.summary->>'lines')::integer,0) as lines from workshop_private.game_results r where r.user_id=owner and r.version=1 and workshop_private.ranked_game(r.game)
  order by r.game,r.difficulty,case when r.game='block-drop' then case when r.difficulty='classic' then -r.score else r.elapsed_ms end else workshop_private.game_order_1(r.game,r.score,r.moves,r.elapsed_ms) end,
  case when r.game='block-drop' and r.difficulty='classic' then -coalesce((r.summary->>'lines')::bigint,0) else workshop_private.game_order_2(r.game,r.max_tile,r.elapsed_ms) end,r.achieved_at,r.session_id
 ) x
$$;

create or replace function public.get_public_profile(profile_id uuid) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare p public.typing_profiles; result_value jsonb; best jsonb;
begin
 select * into p from public.typing_profiles where public_id=profile_id;
 if not found then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into best from (
  select distinct on(r.language) r.language,r.version,r.speed,r.accuracy,r.achieved_at from public.typing_results r join public.typing_passages t on t.language=r.language and t.version=r.version and t.active
  where r.user_id=p.user_id and r.accuracy>=95 order by r.language,r.speed desc,r.accuracy desc,r.achieved_at,r.session_id
 ) s;
 return workshop_private.profile_json(p)||jsonb_build_object('best_scores',best,'game_best_scores',workshop_private.game_bests(p.user_id),'game_achievements',workshop_private.public_game_achievements(p.user_id));
end $$;



notify pgrst,'reload schema';
commit;
