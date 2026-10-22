begin;
create or replace function workshop_private.study_record(kind text,action text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,expected_user uuid,before_time timestamptz default null,before_id uuid default null,page_size integer default 25,remove_record boolean default false)
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
  return saved||jsonb_build_object('ack_revision',coalesce((receipt->>'revision')::bigint,(saved->>'revision')::bigint),'conflict',receipt->'conflict','original_id',record_id);
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
 receipt:=jsonb_build_object('kind',kind,'action','save','id',saved->>'id','original_id',record_id,'conflict',destination<>record_id,'revision',(saved->>'revision')::bigint);
 insert into public.workshop_mutations values(owner_id,operation_id,receipt,clock_timestamp());
 return saved||jsonb_build_object('ack_revision',(saved->>'revision')::bigint,'conflict',destination<>record_id,'original_id',record_id);
end $$;
revoke all on function workshop_private.study_record(text,text,uuid,jsonb,bigint,uuid,uuid,timestamptz,uuid,integer,boolean) from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
