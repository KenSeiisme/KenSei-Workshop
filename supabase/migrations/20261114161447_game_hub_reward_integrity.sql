begin;

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
  prior_badges text[];
  granted_badges jsonb;
begin
  if owner is null or expected_user is distinct from owner then
    raise exception 'Account changed' using errcode='42501';
  end if;
  if jsonb_typeof(runs) is distinct from 'array' or octet_length(runs::text)>32000
    or jsonb_array_length(runs)>30 then raise exception 'Invalid activity batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,42));
  today := workshop_private.hub_day();
  select coalesce(array_agg(badge),'{}'::text[]) into prior_badges
    from workshop_private.hub_badges where user_id=owner;
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
    -- A resumed segment can complete a run whose start was already recorded.
    -- Imported or pre-start activity alone does not qualify for wallet rewards.
    if completed and recorded.started and recorded.finished_day is null
      and recorded.active_ms >= 1000 then
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
  select coalesce(jsonb_agg(badge order by badge),'[]'::jsonb) into granted_badges
    from workshop_private.hub_badges where user_id=owner and not (badge=any(prior_badges));
  return workshop_private.hub_snapshot(owner)||jsonb_build_object('newBadges',granted_badges);
end $$;

commit;
