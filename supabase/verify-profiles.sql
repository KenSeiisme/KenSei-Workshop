-- Only temporary fixtures; all writes are rolled back.
begin;
create temporary table qa_profiles(label text,id uuid default gen_random_uuid(),data jsonb);
insert into qa_profiles(label) values('a'),('b');
insert into auth.users(id,raw_user_meta_data) select id,jsonb_build_object('full_name','QAUser '||(select left(id::text,8) from qa_profiles where label='a'),'avatar_url','https://lh3.googleusercontent.com/a/qa') from qa_profiles;
grant select,update on qa_profiles to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from qa_profiles where label='a'),true);
update qa_profiles set data=public.ensure_my_profile(id) where label='a';
select set_config('request.jwt.claim.sub',(select id::text from qa_profiles where label='b'),true);
update qa_profiles set data=public.ensure_my_profile(id) where label='b';
do $$begin
 if (select data->>'nickname' from qa_profiles where label='b')!~'_[A-F0-9]{4}$' then raise exception 'Missing collision suffix';end if;
 if exists(select 1 from public.typing_profiles where user_id=(select id from qa_profiles where label='a')) then raise exception 'Profile RLS leak';end if;
 begin perform public.update_my_profile('{"bio":"wrong account"}',(select id from qa_profiles where label='a'));raise exception 'Cross-account edit accepted';exception when invalid_authorization_specification then null;end;
 begin insert into storage.objects(bucket_id,name,owner_id) values('avatars',(select data->>'public_id' from qa_profiles where label='a')||'/'||gen_random_uuid()::text||'.webp',(select id::text from qa_profiles where label='b'));raise exception 'Cross-account avatar upload accepted';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from qa_profiles where label='a'),true);
update qa_profiles set data=public.update_my_profile(jsonb_build_object('nickname','QA edit '||left(id::text,8),'bio','A public test biography','avatar_kind','none'),id) where label='a';
do $$declare saved jsonb;begin
 saved:=public.ensure_my_profile((select id from qa_profiles where label='a'));
 if saved->>'avatar_kind'<>'none' or saved->>'nickname' not like 'QA edit %' then raise exception 'Login overwrote edits';end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
-- The public identifier is obtained from the temporary fixture by the owner below.
reset role;
grant select on qa_profiles to anon;
set local role anon;
do $$declare result_value jsonb;begin
 result_value:=public.get_public_profile((select (data->>'public_id')::uuid from qa_profiles where label='a'));
 if result_value->>'bio'<>'A public test biography' or result_value->>'google_avatar_url' is not null or result_value::text~'user_id|email|raw_user|profile_initialized' then raise exception 'Unsafe public profile';end if;
 begin perform public.ensure_my_profile(gen_random_uuid());raise exception 'Anonymous profile edit accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if not exists(select 1 from storage.buckets where id='avatars' and public and file_size_limit=2097152 and allowed_mime_types=array['image/webp']) then raise exception 'Incorrect avatar bucket limits';end if;
end $$;
select 'PASS: production profile initialization, collisions, repeated login, public-field filtering, account RLS and avatar bucket/policies' as validation;
rollback;
