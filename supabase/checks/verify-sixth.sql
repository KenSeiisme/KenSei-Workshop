begin;
insert into auth.users(id) values('cf4e8dc3-a2ed-47a9-9102-de3afbbdf901'),('bfbaab84-1965-44c1-857a-6d911bf30ed7');
do $$
declare a uuid:='cf4e8dc3-a2ed-47a9-9102-de3afbbdf901';b uuid:='bfbaab84-1965-44c1-857a-6d911bf30ed7';record_id uuid:=gen_random_uuid();operation_id uuid:=gen_random_uuid();payload jsonb;row jsonb;
begin
 payload:='{"version":1,"name":"Migration check","timeZone":"Asia/Kuala_Lumpur","courses":[],"tasks":[]}'::jsonb;
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',a::text,true);
 row:=public.save_private_record('planner',record_id,payload,0,operation_id,false,a);
 if (row->>'revision')::int<>1 or row->'data'->>'name'<>'Migration check' then raise exception 'Save failed';end if;
 row:=public.save_private_record('planner',record_id,payload,0,operation_id,false,a);
 if (row->>'revision')::int<>1 then raise exception 'Retry duplicated a mutation';end if;
 if public.get_private_record('planner',record_id,a) is null then raise exception 'Owner read failed';end if;
 row:=public.save_private_record('whiteboard',gen_random_uuid(),'{"version":1,"name":"Board migration check","elements":[],"appState":{"viewBackgroundColor":"#111015","gridSize":null}}'::jsonb,0,gen_random_uuid(),false,a);
 if row->'data'->>'name'<>'Board migration check' then raise exception 'Whiteboard save failed';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 if public.get_private_record('planner',record_id,b) is not null or exists(select 1 from public.study_planners where user_id=a) then raise exception 'Cross-account read allowed';end if;
 begin
  perform public.save_private_record('planner',record_id,payload,0,gen_random_uuid(),false,a);
  raise exception 'Account guard did not reject';
 exception when sqlstate '28000' then null;
 end;
 execute 'reset role';
 if has_function_privilege('anon','public.get_private_record(text,uuid,uuid)','execute') or has_table_privilege('authenticated','public.study_planners','insert') then raise exception 'Unexpected public access';end if;
end $$;
select 'PASS private save/read, idempotent retry, cross-account RLS, account guard and anonymous/direct-write denial' result;
rollback;
