begin;
create table public.flashcard_decks (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, data jsonb not null, revision bigint not null default 1,
 deleted boolean not null default false, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), primary key(user_id,id),
 check(octet_length(data::text)<=1000000)
);
create index flashcard_decks_page on public.flashcard_decks(user_id,created_at desc,id desc);
alter table public.flashcard_decks enable row level security;
create policy flashcard_owner on public.flashcard_decks for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.flashcard_decks from public,anon,authenticated;
grant select on public.flashcard_decks to authenticated;
create schema if not exists workshop_private;
revoke all on schema workshop_private from public,anon,authenticated;

-- Only authenticated public wrappers can reach this privileged implementation.
create function workshop_private.flashcard_record(action text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,expected_user uuid,before_time timestamptz default null,before_id uuid default null,page_size integer default 25,remove_record boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); previous public.flashcard_decks; saved public.flashcard_decks; receipt jsonb; result_value jsonb; destination uuid:=record_id;
begin
 if owner_id is null or owner_id is distinct from expected_user then raise exception 'Account changed; record remains local' using errcode='28000';end if;
 if action='list' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result_value from
   (select * from public.flashcard_decks where user_id=owner_id and (before_time is null or (created_at,id)<(before_time,before_id)) order by created_at desc,id desc limit greatest(1,least(coalesce(page_size,25),25))) r;
  return result_value;
 end if;
 if action not in ('save','clear') or operation_id is null then raise exception 'Invalid flashcard operation';end if;
 if action='save' and (record_id is null or base_revision is null or base_revision<0 or remove_record is null) then raise exception 'Invalid flashcard record';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select result into receipt from public.workshop_mutations m where m.user_id=owner_id and m.operation_id=flashcard_record.operation_id;
 if found then
  if receipt->>'kind' is distinct from 'flashcard' or receipt->>'action' is distinct from action then raise exception 'Operation ID already used';end if;
  if action='clear' then return jsonb_build_object('cleared',true);end if;
  if receipt->>'original_id' is distinct from record_id::text then raise exception 'Operation ID already used';end if;
  select * into saved from public.flashcard_decks where user_id=owner_id and id=(receipt->>'id')::uuid;
  return to_jsonb(saved)||jsonb_build_object('conflict',receipt->'conflict','original_id',record_id);
 end if;
 if action='clear' then
  update public.flashcard_decks set data='{}',deleted=true,revision=revision+1,updated_at=clock_timestamp() where user_id=owner_id and not deleted;
  insert into public.workshop_mutations values(owner_id,operation_id,jsonb_build_object('kind','flashcard','action','clear'),clock_timestamp());
  return jsonb_build_object('cleared',true);
 end if;
 if not remove_record then
  if coalesce(jsonb_typeof(payload),'')<>'object' or octet_length(payload::text)>1000000 or coalesce(length(btrim(payload->>'name')),0) not between 1 and 100 or coalesce(jsonb_typeof(payload->'cards'),'')<>'array' then raise exception 'Invalid deck: use a name, cards and at most 1 MB';end if;
  if jsonb_array_length(payload->'cards')>200 then raise exception 'Use at most 200 cards';end if;
  if exists(select 1 from jsonb_array_elements(payload->'cards') c where jsonb_typeof(c)<>'object' or coalesce(c->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(jsonb_typeof(c->'front'),'')<>'string' or coalesce(jsonb_typeof(c->'back'),'')<>'string' or coalesce(length(btrim(c->>'front')),0) not between 1 and 1000 or coalesce(length(btrim(c->>'back')),0) not between 1 and 1000 or coalesce(jsonb_typeof(c->'known'),'')<>'boolean') then raise exception 'Invalid card';end if;
  if (select count(distinct c->>'id') from jsonb_array_elements(payload->'cards') c)<>jsonb_array_length(payload->'cards') then raise exception 'Duplicate card IDs';end if;
  select jsonb_build_object('version',1,'name',btrim(payload->>'name'),'cards',coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','front',c->>'front','back',c->>'back','known',(c->>'known')::boolean)),'[]'::jsonb)) into payload from jsonb_array_elements(payload->'cards') c;
 end if;
 select * into previous from public.flashcard_decks where user_id=owner_id and id=record_id;
 if not remove_record and ((previous.id is not null and (previous.revision<>base_revision or previous.deleted)) or (previous.id is null and base_revision>0)) then
  destination:=operation_id;payload:=jsonb_set(payload,'{name}',to_jsonb(left(payload->>'name',80)||' (conflict copy)'));
 end if;
 insert into public.flashcard_decks(user_id,id,data,revision,deleted) values(owner_id,destination,case when remove_record then '{}'::jsonb else payload end,1,remove_record)
 on conflict(user_id,id) do update set data=excluded.data,revision=flashcard_decks.revision+1,deleted=excluded.deleted,updated_at=clock_timestamp() returning * into saved;
 receipt:=jsonb_build_object('kind','flashcard','action','save','id',saved.id,'original_id',record_id,'conflict',destination<>record_id);
 insert into public.workshop_mutations values(owner_id,operation_id,receipt,clock_timestamp());
 return to_jsonb(saved)||jsonb_build_object('conflict',destination<>record_id,'original_id',record_id);
end $$;
revoke all on function workshop_private.flashcard_record(text,uuid,jsonb,bigint,uuid,uuid,timestamptz,uuid,integer,boolean) from public,anon,authenticated;

create or replace function public.save_private_record(kind text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,remove_record boolean,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed; record remains local' using errcode='28000';end if;
 if kind='flashcard' then return workshop_private.flashcard_record('save',record_id,payload,base_revision,operation_id,expected_user,remove_record=>remove_record);end if;
 return public.save_private_record(kind,record_id,payload,base_revision,operation_id,remove_record);
end $$;
create or replace function public.clear_private_records(kind text,operation_id uuid,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 if kind='flashcard' then return workshop_private.flashcard_record('clear',null,null,null,operation_id,expected_user);end if;
 return public.clear_private_records(kind,operation_id);
end $$;
create or replace function public.get_private_records(kind text,before_time timestamptz,before_id uuid,page_size integer,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 if kind='flashcard' then return workshop_private.flashcard_record('list',null,null,null,null,expected_user,before_time,before_id,page_size);end if;
 return public.get_private_records(kind,before_time,before_id,page_size);
end $$;
create function public.get_private_record(kind text,record_id uuid,expected_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result_value jsonb;
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 if kind='flashcard' then select to_jsonb(r) into result_value from public.flashcard_decks r where user_id=auth.uid() and id=record_id;
 elsif kind='answer' then select to_jsonb(r) into result_value from public.answer_history r where user_id=auth.uid() and id=record_id;
 elsif kind='decision' then select to_jsonb(r) into result_value from public.decision_schemes r where user_id=auth.uid() and id=record_id;
 else raise exception 'Invalid record kind';end if;
 return result_value;
end $$;
revoke all on function public.get_private_record(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_private_record(text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
