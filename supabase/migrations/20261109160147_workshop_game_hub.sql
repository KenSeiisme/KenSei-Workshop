begin;

create table workshop_private.hub_runs (
  user_id uuid not null references auth.users on delete cascade,
  run_id text not null,
  game text not null,
  active_ms bigint not null default 0 check (active_ms between 0 and 86400000),
  started boolean not null default true,
  finished_day date,
  primary key (user_id, run_id)
);
create index hub_runs_daily on workshop_private.hub_runs(user_id, finished_day);
create table workshop_private.hub_run_segments (
  user_id uuid not null,
  run_id text not null,
  segment_id uuid not null,
  active_ms bigint not null check (active_ms between 0 and 86400000),
  primary key (user_id, run_id, segment_id),
  foreign key (user_id, run_id) references workshop_private.hub_runs on delete cascade
);
create table workshop_private.hub_ledger (
  user_id uuid not null references auth.users on delete cascade,
  reference text not null,
  day date not null,
  amount integer not null,
  primary key (user_id, reference)
);
create index hub_ledger_daily on workshop_private.hub_ledger(user_id, day);
create table workshop_private.hub_equipped (
  user_id uuid primary key references auth.users on delete cascade,
  skin text not null
);
create table workshop_private.hub_badges (
  user_id uuid not null references auth.users on delete cascade,
  badge text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge)
);
alter table workshop_private.hub_runs enable row level security;
alter table workshop_private.hub_run_segments enable row level security;
alter table workshop_private.hub_ledger enable row level security;
alter table workshop_private.hub_equipped enable row level security;
alter table workshop_private.hub_badges enable row level security;
revoke all on workshop_private.hub_runs, workshop_private.hub_run_segments, workshop_private.hub_ledger,
  workshop_private.hub_equipped, workshop_private.hub_badges from public, anon, authenticated;

create function workshop_private.hub_games() returns text[]
language sql immutable set search_path='' as $$
  select array['2048','minesweeper','snake','memory-match','sudoku','nonogram',
    'block-puzzle','brick-breaker','connect-four','reversi','block-drop','go','chess','xiangqi','pong'];
$$;
create function workshop_private.hub_day() returns date
language sql stable set search_path='' as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date;
$$;
create function workshop_private.hub_pick(day date) returns text
language sql immutable set search_path='' as $$
  select (workshop_private.hub_games())[1 + mod(mod(day - date '2026-01-01', 14) + 14, 14)];
$$;
create function workshop_private.hub_snapshot(owner uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'generatedAt', extract(epoch from clock_timestamp()),
    'day', workshop_private.hub_day(),
    'featured', workshop_private.hub_pick(workshop_private.hub_day()),
    'balance', coalesce((select sum(amount) from workshop_private.hub_ledger where user_id=owner),0),
    'skin', coalesce((select skin from workshop_private.hub_equipped where user_id=owner),'classic'),
    'owned', jsonb_build_array('classic') || coalesce((select jsonb_agg(substr(reference,6) order by reference)
      from workshop_private.hub_ledger where user_id=owner and reference like 'skin:%'),'[]'::jsonb),
    'badges', coalesce((select jsonb_agg(badge order by badge)
      from workshop_private.hub_badges where user_id=owner),'[]'::jsonb),
    'today', coalesce((select jsonb_agg(distinct game)
      from workshop_private.hub_runs where user_id=owner and finished_day=workshop_private.hub_day()),'[]'::jsonb),
    'stats', coalesce((select jsonb_object_agg(game,jsonb_build_object('plays',plays,'activeMs',elapsed)) from (
      select game,count(*) filter (where started) plays,sum(active_ms) elapsed
      from workshop_private.hub_runs where user_id=owner group by game
    ) totals),'{}'::jsonb)
  );
$$;

create function public.game_hub_snapshot() returns jsonb
language plpgsql security definer stable set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to sync progress' using errcode='42501'; end if;
  return workshop_private.hub_snapshot(auth.uid());
end $$;

create function public.sync_game_activity(expected_user uuid, runs jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  owner uuid := auth.uid();
  today date := workshop_private.hub_day();
  item jsonb;
  recorded workshop_private.hub_runs;
  id text;
  slug text;
  elapsed bigint;
  prior_elapsed bigint;
  segment uuid;
  completed boolean;
  distinct_today integer;
  task text;
begin
  if owner is null or expected_user is distinct from owner then
    raise exception 'Account changed' using errcode='42501';
  end if;
  if jsonb_typeof(runs) is distinct from 'array' or octet_length(runs::text)>32000
    or jsonb_array_length(runs)>30 then raise exception 'Invalid activity batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,42));
  for item in select value from jsonb_array_elements(runs) loop
    id := item->>'id';
    slug := item->>'game';
    if coalesce(id,'') !~ '^[a-zA-Z0-9:-]{36,96}$'
      or not coalesce(slug=any(workshop_private.hub_games()),false)
      or coalesce(item->>'segmentId','') !~ '^[0-9a-f-]{36}$'
      or coalesce(item->>'activeMs','') !~ '^[0-9]{1,8}$'
      or jsonb_typeof(item->'started') is distinct from 'boolean'
      or jsonb_typeof(item->'finished') is distinct from 'boolean' then
      raise exception 'Invalid game activity';
    end if;
    elapsed := (item->>'activeMs')::bigint;
    segment := (item->>'segmentId')::uuid;
    completed := (item->>'finished')::boolean;
    insert into workshop_private.hub_runs(user_id,run_id,game,active_ms,started)
      values(owner,id,slug,0,(item->>'started')::boolean)
    on conflict(user_id,run_id) do update
      set started=hub_runs.started or excluded.started
      where hub_runs.game=excluded.game
    returning * into recorded;
    if not found then raise exception 'Game activity identity changed'; end if;
    select active_ms into prior_elapsed from workshop_private.hub_run_segments
      where user_id=owner and run_id=id and segment_id=segment;
    if elapsed>coalesce(prior_elapsed,0) then
      insert into workshop_private.hub_run_segments values(owner,id,segment,elapsed)
      on conflict(user_id,run_id,segment_id) do update set active_ms=excluded.active_ms;
      update workshop_private.hub_runs set active_ms=least(86400000,active_ms+elapsed-coalesce(prior_elapsed,0))
        where user_id=owner and run_id=id returning * into recorded;
    end if;
    if completed and recorded.finished_day is null and recorded.active_ms>0 then
      update workshop_private.hub_runs set finished_day=today where user_id=owner and run_id=id;
      if (select count(*) from workshop_private.hub_ledger
        where user_id=owner and day=today and reference like 'run:%') < 10 then
        insert into workshop_private.hub_ledger values(owner,'run:'||id,today,5)
        on conflict do nothing;
      end if;
      insert into workshop_private.hub_badges(user_id,badge) values(owner,'first-finish')
        on conflict do nothing;
      if (slug in ('2048','snake','brick-breaker','block-puzzle') or
          (slug='block-drop' and item->>'mode'='classic')) and
          coalesce(item->>'score','') ~ '^[0-9]{1,10}$' then
        if (item->>'score')::bigint>1000 then
          insert into workshop_private.hub_badges(user_id,badge) values(owner,'score-1000')
            on conflict do nothing;
        end if;
      end if;
    end if;
  end loop;
  select count(distinct game) into distinct_today from workshop_private.hub_runs
    where user_id=owner and finished_day=today;
  for task in select unnest(array[
    case when distinct_today>=1 then 'warm-up' end,
    case when distinct_today>=2 then 'explorer' end,
    case when exists(select 1 from workshop_private.hub_runs where user_id=owner
      and finished_day=today and game=workshop_private.hub_pick(today)) then 'featured' end
  ]) loop
    if task is not null then
      insert into workshop_private.hub_ledger values(owner,'day:'||today::text||':'||task,today,10)
      on conflict do nothing;
    end if;
  end loop;
  if (select count(*) from workshop_private.hub_ledger
    where user_id=owner and day between today-6 and today and reference like 'day:%')=21 then
    insert into workshop_private.hub_badges(user_id,badge) values(owner,'seven-days')
      on conflict do nothing;
  end if;
  return workshop_private.hub_snapshot(owner);
end $$;

create function public.buy_game_skin(expected_user uuid, skin_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  owner uuid := auth.uid();
  price integer := case skin_id when 'neon' then 40 when 'amber' then 80 when 'ice' then 120 end;
begin
  if owner is null or expected_user is distinct from owner then
    raise exception 'Account changed' using errcode='42501';
  end if;
  if price is null then raise exception 'Unknown skin'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,42));
  if not exists(select 1 from workshop_private.hub_ledger where user_id=owner and reference='skin:'||skin_id) then
    if (select coalesce(sum(amount),0) from workshop_private.hub_ledger where user_id=owner)<price then
      raise exception 'Not enough coins';
    end if;
    insert into workshop_private.hub_ledger values(owner,'skin:'||skin_id,workshop_private.hub_day(),-price);
  end if;
  return workshop_private.hub_snapshot(owner);
end $$;

create function public.equip_game_skin(expected_user uuid, skin_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid := auth.uid();
begin
  if owner is null or expected_user is distinct from owner then
    raise exception 'Account changed' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,42));
  if skin_id is distinct from 'classic' and not exists(select 1 from workshop_private.hub_ledger
    where user_id=owner and reference='skin:'||skin_id) then raise exception 'Skin is locked'; end if;
  insert into workshop_private.hub_equipped values(owner,skin_id)
    on conflict(user_id) do update set skin=excluded.skin;
  return workshop_private.hub_snapshot(owner);
end $$;
revoke all on function workshop_private.hub_games(),workshop_private.hub_day(),
  workshop_private.hub_pick(date),workshop_private.hub_snapshot(uuid),
  public.game_hub_snapshot(),public.sync_game_activity(uuid,jsonb),
  public.buy_game_skin(uuid,text),public.equip_game_skin(uuid,text) from public,anon,authenticated;
grant execute on function public.game_hub_snapshot(),public.sync_game_activity(uuid,jsonb),
  public.buy_game_skin(uuid,text),public.equip_game_skin(uuid,text) to authenticated;

-- Additive deployment. The two live versions change only when the release is activated.
create table workshop_private.arcade_active_version (game text primary key, version integer not null);
insert into workshop_private.arcade_active_version values ('snake',1),('brick-breaker',2);
alter table workshop_private.arcade_active_version enable row level security;
revoke all on workshop_private.arcade_active_version from public,anon,authenticated;
create or replace function workshop_private.game_rule_version(game text) returns integer
language sql stable set search_path='' as $$
  select coalesce((select a.version from workshop_private.arcade_active_version a where a.game=$1),1);
$$;
alter function workshop_private.games_admin(text,uuid,jsonb) rename to games_admin_before_hub;
create function workshop_private.games_admin(action text,owner uuid,body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare run workshop_private.game_sessions;
begin
  perform pg_advisory_xact_lock_shared(9020261109);
  if action='start' and body->>'game' in ('snake','brick-breaker') then
    if coalesce(body->>'rules_version',workshop_private.game_rule_version(body->>'game')::text)
      <> workshop_private.game_rule_version(body->>'game')::text
      or (body->>'game'='snake' and workshop_private.game_rule_version('snake')=2
          and body->>'difficulty' is distinct from 'normal') then
      return jsonb_build_object('code','RULES_UPDATE_REQUIRED','error','Game rules changed. Reload this page before starting Public.');
    end if;
  elsif action in ('read','finish') then
    select * into run from workshop_private.game_sessions
      where id=(body->>'session_id')::uuid and user_id=owner;
    if ((run.game='snake' and workshop_private.game_rule_version(run.game)=2 and run.version<2)
        or (run.game='brick-breaker' and workshop_private.game_rule_version(run.game)=3 and run.version<3)) then
      return jsonb_build_object('code','RULES_UPDATE_REQUIRED','error','Game rules changed. Reload this page before starting Public.');
    end if;
  end if;
  return workshop_private.games_admin_before_hub(action,owner,body);
end $$;
create or replace function public.games_admin(action text,owner uuid,body jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select workshop_private.games_admin(action,owner,body);
$$;
revoke all on function workshop_private.games_admin_before_hub(text,uuid,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function workshop_private.games_admin(text,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function workshop_private.games_admin(text,uuid,jsonb) to service_role;

alter function workshop_private.validate_game_save(text,jsonb) rename to validate_game_save_before_hub;
create function workshop_private.validate_game_save(kind text,payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare saved_version text := payload->'state'->>'version';
begin
  if (payload->>'game'='snake' and saved_version='2') or
     (payload->>'game'='brick-breaker' and saved_version='3') then
    return workshop_private.validate_game_save_before_hub(kind,jsonb_set(payload,'{state,version}','1'))
      || jsonb_build_object('state',payload->'state');
  end if;
  return workshop_private.validate_game_save_before_hub(kind,payload);
end $$;
revoke all on function workshop_private.validate_game_save(text,jsonb),
  workshop_private.validate_game_save_before_hub(text,jsonb) from public,anon,authenticated;

create function workshop_private.activate_arcade_upgrade() returns jsonb
language plpgsql security definer set search_path='' as $$
declare removed integer; cleared integer;
begin
  perform pg_advisory_xact_lock(9020261109);
  delete from workshop_private.game_results
  where (game='snake' and version=1) or (game='brick-breaker' and version in (1,2));
  get diagnostics removed=row_count;
  update workshop_private.game_sessions set result=null,status='abandoned'
  where ((game='snake' and version=1) or (game='brick-breaker' and version in (1,2)))
    and (result is not null or status in ('active','completed'));
  get diagnostics cleared=row_count;
  update workshop_private.arcade_active_version
    set version=case game when 'snake' then 2 else 3 end;
  return jsonb_build_object('old_scores_deleted',removed,'old_sessions_closed',cleared,'snake',2,'brick-breaker',3);
end $$;
revoke all on function workshop_private.activate_arcade_upgrade() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
