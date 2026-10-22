begin;
create table public.study_planners (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, data jsonb not null, revision bigint not null default 1,
 deleted boolean not null default false, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), primary key(user_id,id),
 check(octet_length(data::text)<=1000000)
);
create table public.whiteboards (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, data jsonb not null, revision bigint not null default 1,
 deleted boolean not null default false, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), primary key(user_id,id),
 check(octet_length(data::text)<=2000000)
);
create index study_planners_page on public.study_planners(user_id,created_at desc,id desc);
create index whiteboards_page on public.whiteboards(user_id,created_at desc,id desc);
alter table public.study_planners enable row level security;
alter table public.whiteboards enable row level security;
create policy planner_owner on public.study_planners for select to authenticated using(user_id=(select auth.uid()));
create policy whiteboard_owner on public.whiteboards for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.study_planners,public.whiteboards from public,anon,authenticated;
grant select on public.study_planners,public.whiteboards to authenticated;

-- 私有校验不作为外部 API 暴露。
create function workshop_private.validate_study_record(kind text,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c jsonb; s jsonb; t jsonb; tz text; uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
begin
 if coalesce(jsonb_typeof(payload),'')<>'object' or payload->>'version' is distinct from '1' or coalesce(jsonb_typeof(payload->'name'),'')<>'string' or coalesce(length(btrim(payload->>'name')),0) not between 1 and 100 then raise exception 'Use a valid name and record version';end if;
 if kind='planner' then
  tz:=payload->>'timeZone';
  if octet_length(payload::text)>1000000 or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) or coalesce(jsonb_typeof(payload->'courses'),'')<>'array' or coalesce(jsonb_typeof(payload->'tasks'),'')<>'array' then raise exception 'Invalid planner or size over 1 MB';end if;
  if jsonb_array_length(payload->'courses')>30 or jsonb_array_length(payload->'tasks')>300 then raise exception 'Use at most 30 courses and 300 tasks';end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(payload->'courses') x)<>jsonb_array_length(payload->'courses') or (select count(distinct x->>'id') from jsonb_array_elements(payload->'tasks') x)<>jsonb_array_length(payload->'tasks') then raise exception 'Duplicate record IDs';end if;
  for c in select value from jsonb_array_elements(payload->'courses') loop
   if coalesce(c->>'id','')!~uuid_pattern or coalesce(jsonb_typeof(c->'title'),'')<>'string' or coalesce(length(btrim(c->>'title')),0) not between 1 and 100 or coalesce(c->>'color','')!~'^#[0-9a-fA-F]{6}$' or coalesce(c->>'startDate','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(c->>'endDate','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(jsonb_typeof(c->'sessions'),'')<>'array' then raise exception 'Invalid course';end if;
   if (c->>'startDate')::date>(c->>'endDate')::date or jsonb_array_length(c->'sessions')>14 then raise exception 'Invalid course dates or sessions';end if;
   for s in select value from jsonb_array_elements(c->'sessions') loop
    if coalesce(s->>'id','')!~uuid_pattern or coalesce(s->>'day','')!~'^[1-7]$' or coalesce(s->>'start','')!~'^([01]\d|2[0-3]):[0-5]\d$' or coalesce(s->>'end','')!~'^([01]\d|2[0-3]):[0-5]\d$' or (s->>'start')>=(s->>'end') then raise exception 'Invalid weekly class time';end if;
   end loop;
  end loop;
  if (select count(*)<>count(distinct session_item->>'id') from jsonb_array_elements(payload->'courses') course_item cross join lateral jsonb_array_elements(course_item->'sessions') session_item) then raise exception 'Duplicate session IDs';end if;
  for t in select value from jsonb_array_elements(payload->'tasks') loop
   if coalesce(t->>'id','')!~uuid_pattern or coalesce(jsonb_typeof(t->'title'),'')<>'string' or coalesce(length(btrim(t->>'title')),0) not between 1 and 200 or coalesce(t->>'type','') not in ('assignment','exam') or coalesce(jsonb_typeof(t->'done'),'')<>'boolean' or coalesce(t->>'due','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' or not(t?'courseId') then raise exception 'Invalid deadline';end if;
   if t->>'courseId' is not null and not exists(select 1 from jsonb_array_elements(payload->'courses') course_item where course_item->>'id'=t->>'courseId') then raise exception 'Unknown course';end if;
   if (((t->>'due')::timestamp at time zone tz) at time zone tz)<>(t->>'due')::timestamp then raise exception 'Deadline falls in a daylight-saving gap';end if;
  end loop;
  return jsonb_build_object('version',1,'name',btrim(payload->>'name'),'timeZone',tz,'courses',payload->'courses','tasks',payload->'tasks');
 elsif kind='whiteboard' then
  if octet_length(payload::text)>2000000 or coalesce(jsonb_typeof(payload->'elements'),'')<>'array' or coalesce(jsonb_typeof(payload->'appState'),'')<>'object' or (payload?'files' and payload->'files'<>'{}'::jsonb) then raise exception 'Invalid whiteboard or size over 2 MB';end if;
  if exists(select 1 from jsonb_array_elements(payload->'elements') x where coalesce(x->>'type','') not in ('rectangle','diamond','ellipse','arrow','line','freedraw','text','frame') or coalesce(x->>'link','')<>'' or x?'fileId') then raise exception 'Whiteboards support text and vector drawing only';end if;
  return jsonb_build_object('version',1,'name',btrim(payload->>'name'),'elements',payload->'elements','appState',jsonb_build_object('viewBackgroundColor',coalesce(payload->'appState'->>'viewBackgroundColor','#111015'),'gridSize',payload->'appState'->'gridSize'));
 else raise exception 'Invalid private record kind';end if;
end $$;
revoke all on function workshop_private.validate_study_record(text,jsonb) from public,anon,authenticated;

create function workshop_private.study_record(kind text,action text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,expected_user uuid,before_time timestamptz default null,before_id uuid default null,page_size integer default 25,remove_record boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); table_name text; previous jsonb; saved jsonb; receipt jsonb; result_value jsonb; destination uuid:=record_id;
begin
 if owner_id is null or owner_id is distinct from expected_user then raise exception 'Account changed; record remains local' using errcode='28000';end if;
 table_name:=case kind when 'planner' then 'study_planners' when 'whiteboard' then 'whiteboards' else null end;
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
  return saved||jsonb_build_object('conflict',receipt->'conflict','original_id',record_id);
 end if;
 if action='clear' then
  execute format('update public.%I set data=''{}'',deleted=true,revision=revision+1,updated_at=clock_timestamp() where user_id=$1 and not deleted',table_name) using owner_id;
  insert into public.workshop_mutations values(owner_id,operation_id,jsonb_build_object('kind',kind,'action','clear'),clock_timestamp());
  return jsonb_build_object('cleared',true);
 end if;
 if not remove_record then payload:=workshop_private.validate_study_record(kind,payload);end if;
 execute format('select to_jsonb(r) from public.%I r where user_id=$1 and id=$2',table_name) into previous using owner_id,record_id;
 if not remove_record and ((previous is not null and ((previous->>'revision')::bigint<>base_revision or (previous->>'deleted')::boolean)) or (previous is null and base_revision>0)) then
  destination:=operation_id;payload:=jsonb_set(payload,'{name}',to_jsonb(left(payload->>'name',80)||' (conflict copy)'));
 end if;
 execute format('insert into public.%1$I(user_id,id,data,revision,deleted) values($1,$2,$3,1,$4) on conflict(user_id,id) do update set data=excluded.data,revision=%1$I.revision+1,deleted=excluded.deleted,updated_at=clock_timestamp() returning to_jsonb(%1$I)',table_name)
  into saved using owner_id,destination,case when remove_record then '{}'::jsonb else payload end,remove_record;
 receipt:=jsonb_build_object('kind',kind,'action','save','id',saved->>'id','original_id',record_id,'conflict',destination<>record_id);
 insert into public.workshop_mutations values(owner_id,operation_id,receipt,clock_timestamp());
 return saved||jsonb_build_object('conflict',destination<>record_id,'original_id',record_id);
end $$;
revoke all on function workshop_private.study_record(text,text,uuid,jsonb,bigint,uuid,uuid,timestamptz,uuid,integer,boolean) from public,anon,authenticated;

create or replace function public.save_private_record(kind text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,remove_record boolean,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed; record remains local' using errcode='28000';end if;
 if kind in ('planner','whiteboard') then return workshop_private.study_record(kind,'save',record_id,payload,base_revision,operation_id,expected_user,remove_record=>remove_record);end if;
 if kind='flashcard' then return workshop_private.flashcard_record('save',record_id,payload,base_revision,operation_id,expected_user,remove_record=>remove_record);end if;
 return public.save_private_record(kind,record_id,payload,base_revision,operation_id,remove_record);
end $$;
create or replace function public.clear_private_records(kind text,operation_id uuid,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 if kind in ('planner','whiteboard') then return workshop_private.study_record(kind,'clear',null,null,null,operation_id,expected_user);end if;
 if kind='flashcard' then return workshop_private.flashcard_record('clear',null,null,null,operation_id,expected_user);end if;
 return public.clear_private_records(kind,operation_id);
end $$;
create or replace function public.get_private_records(kind text,before_time timestamptz,before_id uuid,page_size integer,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 if kind in ('planner','whiteboard') then return workshop_private.study_record(kind,'list',null,null,null,null,expected_user,before_time,before_id,page_size);end if;
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
 elsif kind='flashcard' then select to_jsonb(r) into result_value from public.flashcard_decks r where user_id=(select auth.uid()) and id=record_id;
 elsif kind='answer' then select to_jsonb(r) into result_value from public.answer_history r where user_id=(select auth.uid()) and id=record_id;
 elsif kind='decision' then select to_jsonb(r) into result_value from public.decision_schemes r where user_id=(select auth.uid()) and id=record_id;
 else raise exception 'Invalid record kind';end if;
 return result_value;
end $$;
revoke all on function public.save_private_record(text,uuid,jsonb,bigint,uuid,boolean,uuid),public.clear_private_records(text,uuid,uuid),public.get_private_records(text,timestamptz,uuid,integer,uuid),public.get_private_record(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_private_record(text,uuid,jsonb,bigint,uuid,boolean,uuid),public.clear_private_records(text,uuid,uuid),public.get_private_records(text,timestamptz,uuid,integer,uuid),public.get_private_record(text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
