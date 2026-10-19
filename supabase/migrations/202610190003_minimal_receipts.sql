begin;
-- Private content exists only in its record, never in retry receipts.
create or replace function public.save_private_record(kind text, record_id uuid, payload jsonb, base_revision bigint, operation_id uuid, remove_record boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); table_name text; previous record; saved record; result_value jsonb; destination uuid:=record_id;
begin
 if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
 if kind is null or kind not in ('answer','decision') or record_id is null or operation_id is null or base_revision is null or base_revision<0 then raise exception 'Invalid record'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 table_name:=case when kind='answer' then 'answer_history' else 'decision_schemes' end;
 select result into result_value from public.workshop_mutations m where m.user_id=owner_id and m.operation_id=save_private_record.operation_id;
 if found then
  if result_value->>'kind' is distinct from kind then raise exception 'Operation ID was already used';end if;
  execute format('select * from public.%I where user_id=$1 and id=$2',table_name) into saved using owner_id,(result_value->>'id')::uuid;
  return to_jsonb(saved)||jsonb_build_object('conflict',result_value->'conflict','original_id',result_value->'original_id');
 end if;
 if not remove_record then
  if coalesce(jsonb_typeof(payload),'')<>'object' then raise exception 'Invalid data'; end if;
  if kind='answer' then
   -- Reconstruct permitted fields: optional user questions can never enter this table.
   payload:=jsonb_build_object('en',left(payload->>'en',1000),'zh',left(payload->>'zh',1000),'drawnAt',payload->>'drawnAt');
   if coalesce(length(payload->>'en'),0)=0 or coalesce(length(payload->>'zh'),0)=0 then raise exception 'Missing answer'; end if;
  else
   if coalesce(jsonb_typeof(payload->'options'),'')<>'array' then raise exception 'Invalid scheme'; end if;
   if jsonb_array_length(payload->'options') not between 1 and 200 or coalesce(length(payload->>'name'),0) not between 1 and 100 or coalesce(payload->>'mode','') not in ('wheel','draw','groups') then raise exception 'Invalid scheme'; end if;
   if exists(select 1 from jsonb_array_elements(payload->'options') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 200) or (select count(distinct x) from jsonb_array_elements(payload->'options') x)<>jsonb_array_length(payload->'options') then raise exception 'Invalid option'; end if;
   payload:=jsonb_build_object('name',payload->>'name','options',payload->'options','mode',payload->>'mode','noRepeat',coalesce((payload->>'noRepeat')::boolean,false),'groupCount',greatest(1,least(200,coalesce((payload->>'groupCount')::integer,2))));
  end if;
 end if;
 execute format('select * from public.%I where user_id=$1 and id=$2',table_name) into previous using owner_id,record_id;
 if previous.id is not null and not remove_record and previous.revision<>base_revision then
  destination:=operation_id;
  if kind='decision' then payload:=jsonb_set(payload,'{name}',to_jsonb(left(payload->>'name',80)||' (conflict copy)')); end if;
 elsif previous.id is null and base_revision>0 and not remove_record then
  destination:=operation_id;
  if kind='decision' then payload:=jsonb_set(payload,'{name}',to_jsonb(left(payload->>'name',80)||' (conflict copy)')); end if;
 end if;
 execute format('insert into public.%I(user_id,id,data,revision,deleted) values($1,$2,$3,1,$4) on conflict(user_id,id) do update set data=excluded.data, revision=%I.revision+1,deleted=$4,updated_at=clock_timestamp() returning *',table_name,table_name)
 into saved using owner_id,destination,case when remove_record then '{}'::jsonb else payload end,remove_record;
 result_value:=to_jsonb(saved)||jsonb_build_object('conflict',destination<>record_id,'original_id',record_id);
 insert into public.workshop_mutations values(owner_id,operation_id,(result_value-'data')||jsonb_build_object('kind',kind),clock_timestamp());
 -- Retain small receipts without record contents, so delayed retries stay idempotent.
 return result_value;
end $$;

notify pgrst,'reload schema';
commit;
