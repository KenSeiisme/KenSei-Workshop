begin;


create table public.grade_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  deleted boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id,id)
);
create index grade_plans_page on public.grade_plans(user_id,created_at desc,id desc);
create index grade_plans_workspace_page on public.grade_plans(user_id,updated_at desc,id desc) where not deleted;
alter table public.grade_plans enable row level security;
create policy grade_plans_owner on public.grade_plans for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.grade_plans from public,anon,authenticated;
grant select on public.grade_plans to authenticated;

create function workshop_private.grade_number(value jsonb, minimum numeric, maximum numeric)
returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(value)='number' then (value #>> '{}')::numeric between minimum and maximum else false end
$$;
revoke all on function workshop_private.grade_number(jsonb,numeric,numeric) from public,anon,authenticated;

create function workshop_private.validate_grade_plan(payload jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  id_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  t jsonb; c jsonb; a jsonb; b jsonb;
  scale jsonb:='[]'::jsonb;
  terms jsonb:='[]'::jsonb;
  courses jsonb;
  items jsonb;
begin
  if jsonb_typeof(payload) is distinct from 'object' or payload->'version' is distinct from '1'::jsonb
    or octet_length(payload::text)>550000
    or jsonb_typeof(payload->'name') is distinct from 'string'
    or length(btrim(payload->>'name')) not between 1 and 100
    or jsonb_typeof(payload->'scale') is distinct from 'array'
    or jsonb_typeof(payload->'terms') is distinct from 'array'
  then raise exception 'Choose a valid grade plan and name.'; end if;
  if jsonb_array_length(payload->'scale') not between 1 and 30 or jsonb_array_length(payload->'terms')>24
  then raise exception 'Invalid grade plan size.'; end if;

  for b in select value from jsonb_array_elements(payload->'scale') loop
    if not workshop_private.grade_number(b->'minimum',0,100) or not workshop_private.grade_number(b->'points',0,10)
    then raise exception 'The grading scale needs unique thresholds, including 0%%, and points from 0 to 10.'; end if;
    if exists(select 1 from jsonb_array_elements(scale) x where (x->>'minimum')::numeric=(b->>'minimum')::numeric)
    then raise exception 'The grading scale needs unique thresholds, including 0%%, and points from 0 to 10.'; end if;
    scale:=scale || jsonb_build_array(jsonb_build_object('minimum',b->'minimum','points',b->'points'));
  end loop;
  if not exists(select 1 from jsonb_array_elements(scale) x where (x->>'minimum')::numeric=0)
  then raise exception 'The grading scale needs unique thresholds, including 0%%, and points from 0 to 10.'; end if;

  for t in select value from jsonb_array_elements(payload->'terms') loop
    if coalesce(t->>'id','') !~* id_pattern or jsonb_typeof(t->'name') is distinct from 'string'
      or length(btrim(t->>'name')) not between 1 and 100 or jsonb_typeof(t->'courses') is distinct from 'array'
    then raise exception 'Use a valid semester name and up to 40 courses.'; end if;
    if jsonb_array_length(t->'courses')>40 or exists(select 1 from jsonb_array_elements(terms) x where x->>'id'=t->>'id')
    then raise exception 'Use a valid semester name and up to 40 courses.'; end if;
    courses:='[]'::jsonb;
    for c in select value from jsonb_array_elements(t->'courses') loop
      if coalesce(c->>'id','') !~* id_pattern or jsonb_typeof(c->'name') is distinct from 'string'
        or length(btrim(c->>'name')) not between 1 and 100
        or not workshop_private.grade_number(c->'credits',.01,100)
        or not workshop_private.grade_number(c->'target',0,100)
        or (c->'confirmed' is distinct from 'null'::jsonb and not workshop_private.grade_number(c->'confirmed',0,100))
        or (c->'forecast' is distinct from 'null'::jsonb and not workshop_private.grade_number(c->'forecast',0,100))
        or jsonb_typeof(c->'excluded') is distinct from 'boolean'
        or jsonb_typeof(c->'items') is distinct from 'array'
      then raise exception 'Check course credits, scores and settings.'; end if;
      if jsonb_array_length(c->'items')>30 or exists(select 1 from jsonb_array_elements(courses) x where x->>'id'=c->>'id')
      then raise exception 'Check course credits, scores and settings.'; end if;

      items:='[]'::jsonb;
      for a in select value from jsonb_array_elements(c->'items') loop
        if coalesce(a->>'id','') !~* id_pattern or jsonb_typeof(a->'name') is distinct from 'string'
          or length(btrim(a->>'name')) not between 1 and 200
          or not workshop_private.grade_number(a->'weight',0,100)
          or not workshop_private.grade_number(a->'max',.01,100000)
          or jsonb_typeof(a->'absent') is distinct from 'boolean'
          or exists(select 1 from jsonb_array_elements(items) x where x->>'id'=a->>'id')
        then raise exception 'Check each assessment name, weight, score and maximum.'; end if;
        if a->'score' is distinct from 'null'::jsonb and not workshop_private.grade_number(a->'score',0,(a->>'max')::numeric)
        then raise exception 'Check each assessment name, weight, score and maximum.'; end if;
        items:=items || jsonb_build_array(jsonb_build_object('id',a->'id','name',btrim(a->>'name'),'weight',a->'weight','max',a->'max','score',a->'score','absent',a->'absent'));
      end loop;
      courses:=courses || jsonb_build_array(jsonb_build_object('id',c->'id','name',btrim(c->>'name'),'credits',c->'credits',
        'target',c->'target','confirmed',c->'confirmed','forecast',c->'forecast','excluded',c->'excluded','items',items));
    end loop;
    terms:=terms || jsonb_build_array(jsonb_build_object('id',t->'id','name',btrim(t->>'name'),'courses',courses));
  end loop;
  return jsonb_build_object('version',1,'name',btrim(payload->>'name'),'terms',terms,'scale',scale);
end
$$;
revoke all on function workshop_private.validate_grade_plan(jsonb) from public,anon,authenticated;

create or replace function workshop_private.study_record(kind text,action text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,expected_user uuid,before_time timestamptz default null,before_id uuid default null,page_size integer default 25,remove_record boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); table_name text; previous jsonb; saved jsonb; receipt jsonb; result_value jsonb; destination uuid:=record_id;
begin
 if owner_id is null or owner_id is distinct from expected_user then raise exception 'Account changed; record remains local' using errcode='28000';end if;
 table_name:=case kind when 'planner' then 'study_planners' when 'whiteboard' then 'whiteboards' when 'grade' then 'grade_plans' else null end;
 if table_name is null then raise exception 'Invalid record kind';end if;
 if action='list' then
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from (select * from public.%I where user_id=$1 and ($2 is null or (created_at,id)<($2,$3)) order by created_at desc,id desc limit $4) r',table_name)
   into result_value using owner_id,before_time,before_id,greatest(1,least(coalesce(page_size,25),25));
  return result_value;
 end if;
 if action not in ('save','clear') or operation_id is null then raise exception 'Invalid private operation';end if;
 if action='save' and (record_id is null or base_revision is null or base_revision<0 or remove_record is null) then raise exception 'Invalid private record';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select result into receipt from public.workshop_mutations m where m.user_id=owner_id and m.operation_id=study_record.operation_id;
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
 if not remove_record then
  if kind='grade' then payload:=workshop_private.validate_grade_plan(payload);
  else payload:=workshop_private.validate_study_record(kind,payload);end if;
 end if;
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
revoke all on function workshop_private.study_record(text,text,uuid,jsonb,bigint,uuid,uuid,timestamptz,uuid,integer,boolean) from public,anon,authenticated;


create or replace function public.save_private_record(kind text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,remove_record boolean,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed; record remains local' using errcode='28000';end if;
 if kind in ('planner','whiteboard','grade') then return workshop_private.study_record(kind,'save',record_id,payload,base_revision,operation_id,expected_user,remove_record=>remove_record);end if;
 if kind='flashcard' then return workshop_private.flashcard_record('save',record_id,payload,base_revision,operation_id,expected_user,remove_record=>remove_record);end if;
 return public.save_private_record(kind,record_id,payload,base_revision,operation_id,remove_record);
end $$;
create or replace function public.clear_private_records(kind text,operation_id uuid,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 if kind in ('planner','whiteboard','grade') then return workshop_private.study_record(kind,'clear',null,null,null,operation_id,expected_user);end if;
 if kind='flashcard' then return workshop_private.flashcard_record('clear',null,null,null,operation_id,expected_user);end if;
 return public.clear_private_records(kind,operation_id);
end $$;
create or replace function public.get_private_records(kind text,before_time timestamptz,before_id uuid,page_size integer,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 if kind in ('planner','whiteboard','grade') then return workshop_private.study_record(kind,'list',null,null,null,null,expected_user,before_time,before_id,page_size);end if;
 if kind='flashcard' then return workshop_private.flashcard_record('list',null,null,null,null,expected_user,before_time,before_id,page_size);end if;
 return public.get_private_records(kind,before_time,before_id,page_size);
end $$;
create or replace function public.get_private_record(kind text,record_id uuid,expected_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result_value jsonb;
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 if kind='planner' then select to_jsonb(r) into result_value from public.study_planners r where user_id=(select auth.uid()) and id=record_id;
 elsif kind='whiteboard' then select to_jsonb(r) into result_value from public.whiteboards r where user_id=(select auth.uid()) and id=record_id;
 elsif kind='grade' then select to_jsonb(r) into result_value from public.grade_plans r where user_id=(select auth.uid()) and id=record_id;
 elsif kind='flashcard' then select to_jsonb(r) into result_value from public.flashcard_decks r where user_id=(select auth.uid()) and id=record_id;
 elsif kind='answer' then select to_jsonb(r) into result_value from public.answer_history r where user_id=(select auth.uid()) and id=record_id;
 elsif kind='decision' then select to_jsonb(r) into result_value from public.decision_schemes r where user_id=(select auth.uid()) and id=record_id;
 else raise exception 'Invalid record kind';end if;
 return result_value;
end $$;

create or replace function public.get_workspace_index(
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
  union all
  select g.id::text,'grade','grade-planner',left(g.data->>'name',200),g.updated_at
  from public.grade_plans g, owner o where g.user_id=o.id and not g.deleted
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

notify pgrst,'reload schema';
commit;
