begin;

-- Additive compatibility. The active leaderboard is switched separately after deployment.
create or replace function workshop_private.games_admin(action text,owner uuid,body jsonb) returns jsonb
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
        or (run.game='brick-breaker' and workshop_private.game_rule_version(run.game)>=3
          and run.version<workshop_private.game_rule_version(run.game))) then
      return jsonb_build_object('code','RULES_UPDATE_REQUIRED','error','Game rules changed. Reload this page before starting Public.');
    end if;
  end if;
  return workshop_private.games_admin_before_hub(action,owner,body);
end $$;

create or replace function workshop_private.validate_game_save(kind text,payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare saved_version text := payload->'state'->>'version';
begin
  if (payload->>'game'='snake' and saved_version='2') or
     (payload->>'game'='brick-breaker' and saved_version in ('3','4')) then
    return workshop_private.validate_game_save_before_hub(kind,jsonb_set(payload,'{state,version}','1'))
      || jsonb_build_object('state',payload->'state');
  end if;
  return workshop_private.validate_game_save_before_hub(kind,payload);
end $$;

create or replace function workshop_private.game_board_version(game_slug text,difficulty_slug text,rules_version integer) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare output jsonb;
begin
 if game_slug='brick-breaker' and workshop_private.game_rule_version(game_slug)>=4
   and rules_version is distinct from workshop_private.game_rule_version(game_slug) then
   raise exception 'Invalid game or difficulty';
 end if;
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

create or replace function workshop_private.activate_arcade_upgrade() returns jsonb
language plpgsql security definer set search_path='' as $$
declare removed integer; cleared integer;
begin
  perform pg_advisory_xact_lock(9020261109);
  if workshop_private.game_rule_version('brick-breaker')>=4 then
    raise exception 'Brick Breaker has already moved beyond this release';
  end if;
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
  select coalesce(jsonb_agg(badge order by badge),'[]'::jsonb) into granted_badges
    from workshop_private.hub_badges where user_id=owner and not (badge=any(prior_badges));
  return workshop_private.hub_snapshot(owner)||jsonb_build_object('newBadges',granted_badges);
end $$;

create function workshop_private.activate_brick_v4() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  removed integer;
  closed integer;
  active integer;
begin
  -- Serialize with the start and finish RPCs, including requests replaying on Edge.
  perform pg_advisory_xact_lock(9020261109);
  active := workshop_private.game_rule_version('brick-breaker');
  if active=4 then
    return jsonb_build_object('old_scores_deleted',0,'old_sessions_closed',0,'brick-breaker',4);
  end if;
  if active<>3 then raise exception 'Expected Brick Breaker v3 before cutover'; end if;

  delete from workshop_private.game_results
    where game='brick-breaker' and version in (1,2,3);
  get diagnostics removed=row_count;
  update workshop_private.game_sessions set result=null,status='abandoned'
    where game='brick-breaker' and version in (1,2,3)
      and (result is not null or status in ('active','completed'));
  get diagnostics closed=row_count;
  update workshop_private.arcade_active_version set version=4 where game='brick-breaker';
  return jsonb_build_object('old_scores_deleted',removed,'old_sessions_closed',closed,'brick-breaker',4);
end $$;
revoke all on function workshop_private.activate_brick_v4() from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
