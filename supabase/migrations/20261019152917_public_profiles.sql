begin;
create schema if not exists workshop_private;
revoke all on schema workshop_private from public,anon,authenticated;
alter table public.typing_profiles drop constraint typing_profiles_nickname_check;
alter table public.typing_profiles add constraint typing_profiles_nickname_check check(length(nickname) between 2 and 32 and nickname=btrim(nickname) and nickname!~'[[:cntrl:]]');
alter table public.typing_profiles
 add column public_id uuid not null default gen_random_uuid() unique,
 add column bio text not null default '' check(length(bio)<=300),
 add column avatar_kind text not null default 'none' check(avatar_kind in ('none','google','upload')),
 add column avatar_path text,
 add column google_avatar_url text,
 add column profile_initialized boolean not null default false,
 add column updated_at timestamptz not null default now();

create function workshop_private.profile_json(p public.typing_profiles) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('public_id',p.public_id,'nickname',p.nickname,'bio',p.bio,'avatar_kind',p.avatar_kind,'avatar_path',case when p.avatar_kind='upload' then p.avatar_path else null end,'google_avatar_url',case when p.avatar_kind='google' then p.google_avatar_url else null end)
$$;
create function workshop_private.profile_name(value text) returns text language sql immutable set search_path='' as $$
 select btrim(regexp_replace(normalize(coalesce(value,''),NFC),'[[:space:]]+',' ','g'))
$$;
revoke all on function workshop_private.profile_json(public.typing_profiles),workshop_private.profile_name(text) from public,anon,authenticated;

create function public.ensure_my_profile(expected_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); p public.typing_profiles; google_name text; photo text; candidate text; suffix text;
begin
 if owner_id is null or owner_id is distinct from expected_user then raise exception 'Account changed. Please sign in again.' using errcode='28000';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,2));
 select * into p from public.typing_profiles where user_id=owner_id for update;
 if found and p.profile_initialized then return workshop_private.profile_json(p);end if;
 -- Google metadata is used only for display, never for account ownership or permissions.
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),nullif(raw_user_meta_data->>'name','')),coalesce(nullif(raw_user_meta_data->>'avatar_url',''),nullif(raw_user_meta_data->>'picture','')) into google_name,photo from auth.users where id=owner_id;
 if photo is null or length(photo)>2000 or photo!~'^https://([a-zA-Z0-9-]+\.)*googleusercontent\.com/[^[:cntrl:]]*$' then photo:=null;end if;
 if p.user_id is not null then
  update public.typing_profiles set google_avatar_url=photo,avatar_kind=case when photo is null then 'none' else 'google' end,profile_initialized=true,updated_at=clock_timestamp() where user_id=owner_id returning * into p;
  return workshop_private.profile_json(p);
 end if;
 google_name:=left(workshop_private.profile_name(google_name),32);
 if google_name='' or google_name~'[[:cntrl:]]' then google_name:='Member_'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));end if;
 candidate:=google_name;
 if length(candidate)<2 then candidate:=candidate||'_'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));end if;
 loop
  begin
   insert into public.typing_profiles(user_id,nickname,google_avatar_url,avatar_kind,profile_initialized) values(owner_id,candidate,photo,case when photo is null then 'none' else 'google' end,true) returning * into p;
   return workshop_private.profile_json(p);
  exception when unique_violation then
   suffix:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));candidate:=left(google_name,27)||'_'||suffix;
  end;
 end loop;
end $$;

create function public.update_my_profile(patch jsonb,expected_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); p public.typing_profiles; chosen text; description text; kind text; object_path text;
begin
 if owner_id is null or owner_id is distinct from expected_user then raise exception 'Account changed. Please sign in again.' using errcode='28000';end if;
 if coalesce(jsonb_typeof(patch),'')<>'object' or octet_length(patch::text)>10000 or exists(select 1 from jsonb_object_keys(patch) k where k not in ('nickname','bio','avatar_kind','avatar_path')) then raise exception 'Invalid profile changes';end if;
 perform public.ensure_my_profile(owner_id);
 select * into p from public.typing_profiles where user_id=owner_id for update;
 chosen:=case when patch?'nickname' then workshop_private.profile_name(patch->>'nickname') else p.nickname end;
 description:=case when patch?'bio' then patch->>'bio' else p.bio end;
 kind:=case when patch?'avatar_kind' then patch->>'avatar_kind' else p.avatar_kind end;
 object_path:=case when patch?'avatar_path' then patch->>'avatar_path' else p.avatar_path end;
 if length(chosen) not between 2 and 32 or chosen~'[[:cntrl:]]' then raise exception 'Use a public name of 2-32 characters.';end if;
 if description is null or length(description)>300 or kind is null or kind not in ('none','google','upload') then raise exception 'Use a biography of at most 300 characters and a valid avatar.';end if;
 if kind='upload' then
  if object_path is null or object_path!~('^'||p.public_id::text||'/[0-9a-fA-F-]{36}\.webp$') or not exists(select 1 from storage.objects o where o.bucket_id='avatars' and o.name=object_path and o.owner_id=auth.uid()::text) then raise exception 'Upload an avatar to your own profile first.';end if;
 elsif kind='google' and p.google_avatar_url is null then raise exception 'No Google avatar is available.';
 else object_path:=null;
 end if;
 update public.typing_profiles set nickname=chosen,bio=description,avatar_kind=kind,avatar_path=object_path,updated_at=clock_timestamp() where user_id=owner_id returning * into p;
 return workshop_private.profile_json(p);
exception when unique_violation then raise exception 'This public name is already taken.';
end $$;

create or replace function public.set_typing_nickname(nickname text) returns text language plpgsql security definer set search_path='' as $$
begin
 return public.update_my_profile(jsonb_build_object('nickname',nickname),auth.uid())->>'nickname';
end $$;

create function public.get_public_profile(profile_id uuid) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare p public.typing_profiles; result_value jsonb; best jsonb;
begin
 select * into p from public.typing_profiles where public_id=profile_id;
 if not found then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into best from (
  select distinct on(r.language) r.language,r.version,r.speed,r.accuracy,r.achieved_at from public.typing_results r join public.typing_passages t on t.language=r.language and t.version=r.version and t.active
  where r.user_id=p.user_id and r.accuracy>=95 order by r.language,r.speed desc,r.accuracy desc,r.achieved_at,r.session_id
 ) s;
 return workshop_private.profile_json(p)||jsonb_build_object('best_scores',best);
end $$;

create or replace function public.get_typing_leaderboard(language text) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare result_value jsonb; active_version integer;
begin
 if language not in ('en','zh') then raise exception 'Invalid language';end if;
 select version into active_version from public.typing_passages p where p.language=get_typing_leaderboard.language and active;
 with best as (
  select distinct on(r.user_id) r.user_id,p.public_id,p.nickname,r.speed,r.accuracy,r.achieved_at from public.typing_results r join public.typing_profiles p on p.user_id=r.user_id
  where r.language=get_typing_leaderboard.language and r.version=active_version and r.accuracy>=95 order by r.user_id,r.speed desc,r.accuracy desc,r.achieved_at,r.session_id
 ), ranked as (select *,row_number() over(order by speed desc,accuracy desc,achieved_at,user_id) as rank from best), safe as (select rank,public_id,nickname,speed,accuracy,achieved_at,(user_id=auth.uid()) is_me from ranked)
 select jsonb_build_object('version',active_version,'top',coalesce((select jsonb_agg(to_jsonb(s)-'is_me' order by rank) from safe s where rank<=50),'[]'::jsonb),'me',(select to_jsonb(s)-'is_me' from safe s where is_me)) into result_value;
 return result_value;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('avatars','avatars',true,2097152,array['image/webp']);
create policy avatar_owner_select on storage.objects for select to authenticated using(bucket_id='avatars' and exists(select 1 from public.typing_profiles p where p.user_id=(select auth.uid()) and p.public_id::text=split_part(name,'/',1)));
create policy avatar_owner_insert on storage.objects for insert to authenticated with check(bucket_id='avatars' and owner_id=(select auth.uid())::text and exists(select 1 from public.typing_profiles p where p.user_id=(select auth.uid()) and p.public_id::text=split_part(name,'/',1)));
create policy avatar_owner_update on storage.objects for update to authenticated using(bucket_id='avatars' and exists(select 1 from public.typing_profiles p where p.user_id=(select auth.uid()) and p.public_id::text=split_part(name,'/',1))) with check(bucket_id='avatars' and owner_id=(select auth.uid())::text and exists(select 1 from public.typing_profiles p where p.user_id=(select auth.uid()) and p.public_id::text=split_part(name,'/',1)));
create policy avatar_owner_delete on storage.objects for delete to authenticated using(bucket_id='avatars' and exists(select 1 from public.typing_profiles p where p.user_id=(select auth.uid()) and p.public_id::text=split_part(name,'/',1)));
revoke all on function public.ensure_my_profile(uuid),public.update_my_profile(jsonb,uuid),public.get_public_profile(uuid) from public,anon,authenticated;
grant execute on function public.ensure_my_profile(uuid),public.update_my_profile(jsonb,uuid) to authenticated;
grant execute on function public.get_public_profile(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
