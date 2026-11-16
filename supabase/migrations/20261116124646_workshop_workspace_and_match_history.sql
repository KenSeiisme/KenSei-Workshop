begin;

create function public.get_workspace_index(
  search_text text default '', tool_ids text[] default '{}', record_kind text default null,
  before_time timestamptz default null, before_kind text default null, before_id text default null
) returns jsonb language sql stable security invoker set search_path='' as $$
 with owner as (select auth.uid() as id),
 entries as (
  select w.id, w.type as kind,
    coalesce(nullif(w.data->>'tool',''),case w.type when 'draft' then 'text-toolkit' else 'image-studio' end) as tool,
    left(w.data->>'name',200) as name,w.updated_at
  from public.workspace_items w, owner o where w.user_id=o.id and w.type in ('draft','preset')
  union all
  select s.id::text,'decision','decision-studio',left(s.data->>'name',200),s.updated_at
  from public.decision_schemes s, owner o where s.user_id=o.id and not s.deleted
  union all
  select f.id::text,'deck','flashcards',left(f.data->>'name',200),f.updated_at
  from public.flashcard_decks f, owner o where f.user_id=o.id and not f.deleted
  union all
  select p.id::text,'planner','study-planner',left(p.data->>'name',200),p.updated_at
  from public.study_planners p, owner o where p.user_id=o.id and not p.deleted
  union all
  select w.id::text,'whiteboard','whiteboard',left(w.data->>'name',200),w.updated_at
  from public.whiteboards w, owner o where w.user_id=o.id and not w.deleted
 ), page as (
  select e.* from entries e
   where (record_kind is null or e.kind=record_kind)
     and (coalesce(search_text,'')='' or e.tool=any(tool_ids)
       or strpos(lower(coalesce(e.name,'')),lower(left(search_text,200)))>0)
     and (before_time is null or (e.updated_at,e.kind,e.id)<(before_time,before_kind,before_id))
   order by e.updated_at desc,e.kind desc,e.id desc limit 21
 )
 select coalesce(jsonb_agg(to_jsonb(page) order by updated_at desc,kind desc,id desc),'[]'::jsonb) from page
$$;

create function workshop_private.my_board_match_history(
  game_filter text, before_time timestamptz, before_id uuid
) returns jsonb language sql stable security definer set search_path='' as $$
 with page as (
  select b.id,b.game,b.status,b.ended_at,m.color,
    s.result,b.config->>'rule' as rule,b.config->'size' as size,b.config->>'clock' as clock,
    (select p.nickname from workshop_private.board_members opponent
      join public.typing_profiles p on p.user_id=opponent.user_id
      where opponent.match_id=b.id and opponent.color<>m.color) as opponent
  from workshop_private.board_members m
  join workshop_private.board_matches b on b.id=m.match_id
  join workshop_private.board_settlements s on s.match_id=b.id
  where m.user_id=(select auth.uid()) and b.started_at is not null and b.ended_at is not null
    and b.status in ('finished','interrupted','unresolved')
    and (game_filter is null or b.game=game_filter)
    and (before_time is null or (b.ended_at,b.id)<(before_time,before_id))
  order by b.ended_at desc,b.id desc limit 21
 )
 select coalesce(jsonb_agg(to_jsonb(page) order by ended_at desc,id desc),'[]'::jsonb) from page
$$;

create function workshop_private.my_board_match_review(match_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',b.id,'game',b.game,'state',b.state,
  'status',b.status,'result',s.result,'color',m.color,'ended_at',b.ended_at,
  'members',(select coalesce(jsonb_agg(jsonb_build_object('color',op.color,'nickname',p.nickname)),'[]'::jsonb)
    from workshop_private.board_members op left join public.typing_profiles p on p.user_id=op.user_id
    where op.match_id=b.id))
 from workshop_private.board_members m
 join workshop_private.board_matches b on b.id=m.match_id
 join workshop_private.board_settlements s on s.match_id=b.id
 where m.user_id=(select auth.uid()) and b.id=my_board_match_review.match_id
   and b.started_at is not null and b.ended_at is not null
   and b.status in ('finished','interrupted','unresolved')
$$;

create function public.get_my_board_match_history(
  game_filter text default null, before_time timestamptz default null, before_id uuid default null
) returns jsonb language sql stable security invoker set search_path='' as $$
 select workshop_private.my_board_match_history(game_filter,before_time,before_id)
$$;
create function public.get_my_board_match_review(match_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select workshop_private.my_board_match_review(match_id)
$$;

revoke all on function public.get_workspace_index(text,text[],text,timestamptz,text,text),
  workshop_private.my_board_match_history(text,timestamptz,uuid),workshop_private.my_board_match_review(uuid),
  public.get_my_board_match_history(text,timestamptz,uuid),public.get_my_board_match_review(uuid)
  from public,anon,authenticated;
grant execute on function public.get_workspace_index(text,text[],text,timestamptz,text,text),
  workshop_private.my_board_match_history(text,timestamptz,uuid),workshop_private.my_board_match_review(uuid),
  public.get_my_board_match_history(text,timestamptz,uuid),public.get_my_board_match_review(uuid)
  to authenticated;

commit;
