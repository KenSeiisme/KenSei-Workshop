begin;
-- An in-flight request must not cross into a newly signed-in account.
create function public.save_private_record(kind text,record_id uuid,payload jsonb,base_revision bigint,operation_id uuid,remove_record boolean,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed; record remains local' using errcode='28000';end if;
 return public.save_private_record(kind,record_id,payload,base_revision,operation_id,remove_record);
end $$;
create function public.clear_private_records(kind text,operation_id uuid,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed; record remains local' using errcode='28000';end if;
 return public.clear_private_records(kind,operation_id);
end $$;
create function public.get_private_records(kind text,before_time timestamptz,before_id uuid,page_size integer,expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from expected_user then raise exception 'Account changed' using errcode='28000';end if;
 return public.get_private_records(kind,before_time,before_id,page_size);
end $$;
revoke all on function public.save_private_record(text,uuid,jsonb,bigint,uuid,boolean),public.clear_private_records(text,uuid),public.get_private_records(text,timestamptz,uuid,integer) from authenticated;
revoke all on function public.save_private_record(text,uuid,jsonb,bigint,uuid,boolean,uuid),public.clear_private_records(text,uuid,uuid),public.get_private_records(text,timestamptz,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.save_private_record(text,uuid,jsonb,bigint,uuid,boolean,uuid),public.clear_private_records(text,uuid,uuid),public.get_private_records(text,timestamptz,uuid,integer,uuid) to authenticated;
alter table public.decision_schemes drop constraint decision_schemes_data_check;
alter table public.decision_schemes add constraint decision_schemes_data_check check(octet_length(data::text)<=200000);
notify pgrst,'reload schema';
commit;
