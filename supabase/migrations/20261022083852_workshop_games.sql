begin;
create table public.game_saves (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, data jsonb not null, revision bigint not null default 1,
 deleted boolean not null default false, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), primary key(user_id,id), check(octet_length(data::text)<=256000)
);
create index game_saves_page on public.game_saves(user_id,created_at desc,id desc);
alter table public.game_saves enable row level security;
create policy game_save_owner on public.game_saves for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.game_saves from public,anon,authenticated;
grant select on public.game_saves to authenticated;
grant usage on schema workshop_private to authenticated,anon,service_role;

create function workshop_private.game_mode(game text,difficulty text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(case game when '2048' then difficulty='classic' when 'minesweeper' then difficulty in ('beginner','intermediate','expert') when 'snake' then difficulty in ('slow','normal','fast') when 'memory-match' then difficulty in ('easy','normal','hard') else false end,false)
$$;
revoke all on function workshop_private.game_mode(text,text) from public,anon,authenticated;

create function workshop_private.validate_game_save(kind text,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 if kind is distinct from 'game' or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>256000 or not workshop_private.game_mode(payload->>'game',payload->>'difficulty') or jsonb_typeof(payload->'state') is distinct from 'object' or payload->'state'->>'version' is distinct from '1' or payload->'state'->>'game' is distinct from payload->>'game' or payload->'state'->>'difficulty' is distinct from payload->>'difficulty' or jsonb_typeof(payload->'elapsed') is distinct from 'number' or (payload->>'elapsed')::numeric<0 or length(coalesce(payload->>'name','')) not between 1 and 120 then raise exception 'Invalid game save or size over 256 KB';end if;
 return jsonb_build_object('game',payload->'game','difficulty',payload->'difficulty','state',payload->'state','elapsed',payload->'elapsed','best',payload->'best','name',payload->'name');
end $$;
revoke all on function workshop_private.validate_game_save(text,jsonb) from public,anon,authenticated;

create or replace function workshop_private.game_record(kind text,action text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,expected_user uuid,before_time timestamptz default null,before_id uuid default null,page_size integer default 25,remove_record boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); table_name text; previous jsonb; saved jsonb; receipt jsonb; result_value jsonb; destination uuid:=record_id;
begin
 if owner_id is null or owner_id is distinct from expected_user then raise exception 'Account changed; record remains local' using errcode='28000';end if;
 table_name:=case kind when 'game' then 'game_saves' else null end;
 if table_name is null then raise exception 'Invalid record kind';end if;
 if action='list' then
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from (select * from public.%I where user_id=$1 and ($2 is null or (created_at,id)<($2,$3)) order by created_at desc,id desc limit $4) r',table_name)
   into result_value using owner_id,before_time,before_id,greatest(1,least(coalesce(page_size,25),25));
  return result_value;
 end if;
 if action not in ('save','clear') or operation_id is null then raise exception 'Invalid private operation';end if;
 if action='save' and (record_id is null or base_revision is null or base_revision<0 or remove_record is null) then raise exception 'Invalid private record';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select result into receipt from public.workshop_mutations m where m.user_id=owner_id and m.operation_id=game_record.operation_id;
 if found then
  if receipt->>'kind' is distinct from kind or receipt->>'action' is distinct from action then raise exception 'Operation ID already used';end if;
  if action='clear' then return jsonb_build_object('cleared',true);end if;
  if receipt->>'original_id' is distinct from record_id::text then raise exception 'Operation ID already used';end if;
  execute format('select to_jsonb(r) from public.%I r where user_id=$1 and id=$2',table_name) into saved using owner_id,(receipt->>'id')::uuid;
  return saved||jsonb_build_object('ack_revision',coalesce((receipt->>'revision')::bigint,(saved->>'revision')::bigint),'conflict',receipt->'conflict','original_id',record_id);
 end if;
 if action='clear' then
  execute format('update public.%I set data=''{}'',deleted=true,revision=revision+1,updated_at=clock_timestamp() where user_id=$1 and not deleted',table_name) using owner_id;
  insert into public.workshop_mutations values(owner_id,operation_id,jsonb_build_object('kind',kind,'action','clear'),clock_timestamp());
  return jsonb_build_object('cleared',true);
 end if;
 if not remove_record then payload:=workshop_private.validate_game_save(kind,payload);end if;
 execute format('select to_jsonb(r) from public.%I r where user_id=$1 and id=$2',table_name) into previous using owner_id,record_id;
 if not remove_record and ((previous is not null and ((previous->>'revision')::bigint<>base_revision or (previous->>'deleted')::boolean)) or (previous is null and base_revision>0)) then
  destination:=operation_id;payload:=jsonb_set(payload,'{name}',to_jsonb(left(payload->>'name',80)||' (conflict copy)'));
 end if;
 execute format('insert into public.%1$I(user_id,id,data,revision,deleted) values($1,$2,$3,1,$4) on conflict(user_id,id) do update set data=excluded.data,revision=%1$I.revision+1,deleted=excluded.deleted,updated_at=clock_timestamp() returning to_jsonb(%1$I)',table_name)
  into saved using owner_id,destination,case when remove_record then '{}'::jsonb else payload end,remove_record;
 receipt:=jsonb_build_object('kind',kind,'action','save','id',saved->>'id','original_id',record_id,'conflict',destination<>record_id,'revision',(saved->>'revision')::bigint);
 insert into public.workshop_mutations values(owner_id,operation_id,receipt,clock_timestamp());
 return saved||jsonb_build_object('ack_revision',(saved->>'revision')::bigint,'conflict',destination<>record_id,'original_id',record_id);
end $$;
revoke all on function workshop_private.game_record(text,text,uuid,jsonb,bigint,uuid,uuid,timestamptz,uuid,integer,boolean) from public,anon,authenticated;


create function public.get_game_saves(kind text,before_time timestamptz,before_id uuid,page_size integer,expected_user uuid) returns jsonb language sql security invoker set search_path='' as $$
 select workshop_private.game_record(kind,'list',null,null,null,null,expected_user,before_time,before_id,page_size)
$$;
create function public.save_game_save(kind text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,remove_record boolean,expected_user uuid) returns jsonb language sql security invoker set search_path='' as $$
 select workshop_private.game_record(kind,'save',record_id,payload,base_revision,operation_id,expected_user,remove_record=>remove_record)
$$;
create function public.clear_game_saves(kind text,operation_id uuid,expected_user uuid) returns jsonb language sql security invoker set search_path='' as $$
 select workshop_private.game_record(kind,'clear',null,null,null,operation_id,expected_user)
$$;
create function workshop_private.game_read(record_id uuid,expected_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 return (select to_jsonb(s) from public.game_saves s where user_id=auth.uid() and id=record_id);
end $$;
create function public.get_game_save(kind text,record_id uuid,expected_user uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if kind is distinct from 'game' then raise exception 'Invalid record kind';end if;
 return workshop_private.game_read(record_id,expected_user);
end $$;
revoke all on function workshop_private.game_read(uuid,uuid),public.get_game_saves(text,timestamptz,uuid,integer,uuid),public.save_game_save(text,uuid,jsonb,bigint,uuid,boolean,uuid),public.clear_game_saves(text,uuid,uuid),public.get_game_save(text,uuid,uuid) from public,anon,authenticated;
grant execute on function workshop_private.game_record(text,text,uuid,jsonb,bigint,uuid,uuid,timestamptz,uuid,integer,boolean),workshop_private.game_read(uuid,uuid),public.get_game_saves(text,timestamptz,uuid,integer,uuid),public.save_game_save(text,uuid,jsonb,bigint,uuid,boolean,uuid),public.clear_game_saves(text,uuid,uuid),public.get_game_save(text,uuid,uuid) to authenticated;

create table workshop_private.game_sessions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 game text not null,difficulty text not null,version integer not null default 1,seed bigint not null check(seed between 1 and 4294967295),
 status text not null default 'active' check(status in ('active','abandoned','completed')),
 started_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '2 hours',
 verification_attempts integer not null default 0,result jsonb,
 check(workshop_private.game_mode(game,difficulty))
);
create index game_sessions_owner_time on workshop_private.game_sessions(user_id,started_at desc);
create unique index game_one_active_session on workshop_private.game_sessions(user_id) where status='active';
create table workshop_private.game_results (
 session_id uuid primary key references workshop_private.game_sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,game text not null,difficulty text not null,version integer not null,
 score bigint not null check(score>=0),max_tile bigint not null check(max_tile>=0),moves integer not null check(moves>=0),elapsed_ms bigint not null check(elapsed_ms>0),achieved_at timestamptz not null default clock_timestamp()
);
create index game_results_board on workshop_private.game_results(game,difficulty,version,user_id);
create index game_results_owner on workshop_private.game_results(user_id);
alter table workshop_private.game_sessions enable row level security;
alter table workshop_private.game_results enable row level security;
revoke all on workshop_private.game_sessions,workshop_private.game_results from public,anon,authenticated;

-- 仅服务端可调用；owner 来自 Edge 对真实用户 JWT 的校验。
create function workshop_private.games_admin(action text,owner uuid,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s workshop_private.game_sessions; elapsed bigint; r jsonb; qualifies boolean;
begin
 if owner is null or not exists(select 1 from auth.users where id=owner) then raise exception 'Invalid account';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,19));
 if action='start' then
  if not workshop_private.game_mode(body->>'game',body->>'difficulty') or (body->>'seed')::bigint not between 1 and 4294967295 then raise exception 'Invalid game';end if;
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
 qualifies:=s.game not in ('minesweeper','memory-match') or (body->'metrics'->>'won')::boolean;
 r:=body->'metrics'||jsonb_build_object('elapsed_ms',elapsed,'qualified',qualifies,'game',s.game,'difficulty',s.difficulty,'version',s.version);
 if qualifies then
  insert into workshop_private.game_results(session_id,user_id,game,difficulty,version,score,max_tile,moves,elapsed_ms) values(s.id,owner,s.game,s.difficulty,s.version,(r->>'score')::bigint,(r->>'max_tile')::bigint,(r->>'moves')::integer,elapsed);
 else r:=r||jsonb_build_object('reason','Only completed wins qualify for this game. Your private result is saved.');end if;
 update workshop_private.game_sessions set status='completed',result=r where id=s.id returning * into s;
 return to_jsonb(s);
end $$;
create function public.games_admin(action text,owner uuid,body jsonb) returns jsonb language sql security invoker set search_path='' as $$ select workshop_private.games_admin(action,owner,body) $$;
revoke all on function workshop_private.games_admin(text,uuid,jsonb),public.games_admin(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function workshop_private.games_admin(text,uuid,jsonb),public.games_admin(text,uuid,jsonb) to service_role;

create function workshop_private.game_board(game_slug text,difficulty_slug text) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare output jsonb;
begin
 if not workshop_private.game_mode(game_slug,difficulty_slug) then raise exception 'Invalid game or difficulty';end if;
 with candidates as (
  select r.*,case when r.game in ('2048','snake') then -r.score when r.game='memory-match' then r.moves else r.elapsed_ms end as k1,
  case when r.game='2048' then -r.max_tile when r.game='memory-match' then r.elapsed_ms else 0 end as k2
  from workshop_private.game_results r where r.game=game_slug and r.difficulty=difficulty_slug and r.version=1
 ), best as (select distinct on(user_id) * from candidates order by user_id,k1,k2,achieved_at,session_id),
 ranked as (select *,row_number() over(order by k1,k2,achieved_at,user_id) as rank from best),
 safe as (select r.rank,p.public_id,p.nickname,workshop_private.profile_json(p)-'bio' as profile,r.score,r.max_tile,r.moves,r.elapsed_ms,r.achieved_at,r.user_id=auth.uid() as is_me from ranked r join public.typing_profiles p on p.user_id=r.user_id)
 select jsonb_build_object('version',1,'top',coalesce((select jsonb_agg(to_jsonb(s)-'is_me' order by rank) from safe s where rank<=50),'[]'::jsonb),'me',(select to_jsonb(s)-'is_me' from safe s where is_me)) into output;
 return output;
end $$;
create function public.get_game_leaderboard(game text,difficulty text) returns jsonb language sql security invoker stable set search_path='' as $$ select workshop_private.game_board(game,difficulty) $$;
revoke all on function workshop_private.game_board(text,text),public.get_game_leaderboard(text,text) from public,anon,authenticated;
grant execute on function workshop_private.game_board(text,text),public.get_game_leaderboard(text,text) to anon,authenticated;

create function workshop_private.game_bests(owner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select distinct on(r.game,r.difficulty) r.game,r.difficulty,r.version,r.score,r.max_tile,r.moves,r.elapsed_ms,r.achieved_at from workshop_private.game_results r where r.user_id=owner and r.version=1
  order by r.game,r.difficulty,case when r.game in ('2048','snake') then -r.score when r.game='memory-match' then r.moves else r.elapsed_ms end,
  case when r.game='2048' then -r.max_tile when r.game='memory-match' then r.elapsed_ms else 0 end,r.achieved_at,r.session_id
 ) x
$$;
revoke all on function workshop_private.game_bests(uuid) from public,anon,authenticated;

create or replace function public.get_public_profile(profile_id uuid) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare p public.typing_profiles; result_value jsonb; best jsonb;
begin
 select * into p from public.typing_profiles where public_id=profile_id;
 if not found then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into best from (
  select distinct on(r.language) r.language,r.version,r.speed,r.accuracy,r.achieved_at from public.typing_results r join public.typing_passages t on t.language=r.language and t.version=r.version and t.active
  where r.user_id=p.user_id and r.accuracy>=95 order by r.language,r.speed desc,r.accuracy desc,r.achieved_at,r.session_id
 ) s;
 return workshop_private.profile_json(p)||jsonb_build_object('best_scores',best,'game_best_scores',workshop_private.game_bests(p.user_id));
end $$;


notify pgrst,'reload schema';
commit;
