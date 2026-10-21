begin;
insert into auth.users(id) values('66f0a36d-80df-4f10-912e-d9ecc7184f87'),('afdd2639-aab5-4d7e-b5cd-9db3c8493b53');
do $$
declare a uuid:='66f0a36d-80df-4f10-912e-d9ecc7184f87';b uuid:='afdd2639-aab5-4d7e-b5cd-9db3c8493b53';record_id uuid:=gen_random_uuid();operation_id uuid:=gen_random_uuid();payload jsonb;row jsonb;
begin
 payload:=jsonb_build_object('name','Migration check','cards',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'front','Question','back','Answer','known',false)));
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',a::text,true);
 row:=public.save_private_record('flashcard',record_id,payload,0,operation_id,false,a);
 if (row->>'revision')::int<>1 or row->'data'->>'name'<>'Migration check' then raise exception 'Save failed';end if;
 row:=public.save_private_record('flashcard',record_id,payload,0,operation_id,false,a);
 if (row->>'revision')::int<>1 then raise exception 'Retry duplicated a mutation';end if;
 if public.get_private_record('flashcard',record_id,a) is null then raise exception 'Owner read failed';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 if public.get_private_record('flashcard',record_id,b) is not null or exists(select 1 from public.flashcard_decks where user_id=a) then raise exception 'Cross-account read allowed';end if;
 begin
  perform public.save_private_record('flashcard',record_id,payload,0,gen_random_uuid(),false,a);
  raise exception 'Account guard did not reject';
 exception when sqlstate '28000' then null;
 end;
 execute 'reset role';
 if has_function_privilege('anon','public.get_private_record(text,uuid,uuid)','execute') or has_table_privilege('authenticated','public.flashcard_decks','insert') then raise exception 'Unexpected public access';end if;
end $$;
select 'PASS private save/read, idempotent retry, cross-account RLS, account guard and anonymous/direct-write denial' result;
rollback;
