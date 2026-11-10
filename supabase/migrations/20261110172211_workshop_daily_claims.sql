begin;

-- Evaluate the Malaysia day after the wallet lock is acquired.
create or replace function workshop_private.hub_day() returns date
language sql volatile set search_path='' as $$
  select (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
$$;

create or replace function workshop_private.hub_snapshot(owner uuid) returns jsonb
language sql volatile set search_path='' as $$
  with stamp as materialized (
    select workshop_private.hub_day() as day, clock_timestamp() as generated
  )
  select jsonb_build_object(
    'generatedAt', extract(epoch from stamp.generated),
    'day', stamp.day,
    'manualClaims', true,
    'resetAt', extract(epoch from ((stamp.day + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')) * 1000,
    'claimedTasks', coalesce((select jsonb_agg(split_part(reference,':',3) order by reference)
      from workshop_private.hub_ledger
      where user_id=owner and day=stamp.day and reference like 'day:%'),'[]'::jsonb),
    'featured', workshop_private.hub_pick(stamp.day),
    'balance', coalesce((select sum(amount) from workshop_private.hub_ledger where user_id=owner),0),
    'skin', coalesce((select skin from workshop_private.hub_equipped where user_id=owner),'classic'),
    'owned', jsonb_build_array('classic') || coalesce((select jsonb_agg(substr(reference,6) order by reference)
      from workshop_private.hub_ledger where user_id=owner and reference like 'skin:%'),'[]'::jsonb),
    'badges', coalesce((select jsonb_agg(badge order by badge)
      from workshop_private.hub_badges where user_id=owner),'[]'::jsonb),
    'today', coalesce((select jsonb_agg(distinct game)
      from workshop_private.hub_runs where user_id=owner and finished_day=stamp.day),'[]'::jsonb),
    'stats', coalesce((select jsonb_object_agg(game,jsonb_build_object('plays',plays,'activeMs',elapsed)) from (
      select game,count(*) filter (where started) plays,sum(active_ms) elapsed
      from workshop_private.hub_runs where user_id=owner group by game
    ) totals),'{}'::jsonb)
  ) from stamp;
$$;

create or replace function public.sync_game_activity(expected_user uuid, runs jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  owner uuid := auth.uid();
  today date;
  item jsonb;
  recorded workshop_private.hub_runs;
  id text;
  slug text;
  elapsed bigint;
  prior_elapsed bigint;
  segment uuid;
  completed boolean;
begin
  if owner is null or expected_user is distinct from owner then
    raise exception 'Account changed' using errcode='42501';
  end if;
  if jsonb_typeof(runs) is distinct from 'array' or octet_length(runs::text)>32000
    or jsonb_array_length(runs)>30 then raise exception 'Invalid activity batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,42));
  today := workshop_private.hub_day();
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
  if (select count(*) from (
    select finished_day from workshop_private.hub_runs
    where user_id=owner and finished_day between today-6 and today
    group by finished_day
    having count(distinct game)>=2 and bool_or(game=workshop_private.hub_pick(finished_day))
  ) completed_days)=7 then
    insert into workshop_private.hub_badges(user_id,badge) values(owner,'seven-days')
      on conflict do nothing;
  end if;
  return workshop_private.hub_snapshot(owner);
end $$;

create function workshop_private.claim_game_hub_reward(expected_user uuid, task_day date, task_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner uuid := auth.uid();
  today date;
  receipt text;
  completed boolean;
begin
  if owner is null or expected_user is distinct from owner then
    raise exception 'Account changed' using errcode='42501';
  end if;
  if task_day is null or task_id is null or task_id not in ('warm-up','explorer','featured') then
    raise exception 'Invalid daily reward.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(owner::text,42));
  today := workshop_private.hub_day();
  receipt := 'day:' || task_day::text || ':' || task_id;

  -- A successful request can be retried after midnight without issuing a new reward.
  if exists (select 1 from workshop_private.hub_ledger where user_id=owner and reference=receipt) then
    return workshop_private.hub_snapshot(owner);
  end if;
  if task_day <> today then
    raise exception 'This daily reward has expired.' using errcode='22023';
  end if;

  select case task_id
    when 'warm-up' then count(*) >= 1
    when 'explorer' then count(distinct game) >= 2
    when 'featured' then coalesce(bool_or(game=workshop_private.hub_pick(today)),false)
  end into completed
  from workshop_private.hub_runs where user_id=owner and finished_day=today;
  if not completed then
    raise exception 'Complete this task before claiming its reward.' using errcode='22023';
  end if;

  insert into workshop_private.hub_ledger(user_id,reference,day,amount)
    values(owner,receipt,today,10)
    on conflict do nothing;
  return workshop_private.hub_snapshot(owner);
end $$;

create function public.claim_game_hub_reward(expected_user uuid, task_day date, task_id text)
returns jsonb language sql security invoker set search_path='' as $$
  select workshop_private.claim_game_hub_reward(expected_user,task_day,task_id);
$$;
revoke all on function workshop_private.claim_game_hub_reward(uuid,date,text),
  public.claim_game_hub_reward(uuid,date,text) from public, anon, authenticated;
grant execute on function workshop_private.claim_game_hub_reward(uuid,date,text),
  public.claim_game_hub_reward(uuid,date,text) to authenticated;
notify pgrst,'reload schema';
commit;
