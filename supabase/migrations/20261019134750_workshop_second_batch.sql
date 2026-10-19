-- Apply as project database owner. Existing workspace_items is untouched.
begin;
create table if not exists public.answer_history (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, data jsonb not null, revision bigint not null default 1,
 deleted boolean not null default false, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), primary key(user_id,id),
 check(octet_length(data::text)<=12000)
);
create table if not exists public.decision_schemes (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, data jsonb not null, revision bigint not null default 1,
 deleted boolean not null default false, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), primary key(user_id,id),
 check(octet_length(data::text)<=100000)
);
create index if not exists answer_history_page on public.answer_history(user_id,created_at desc,id desc);
create index if not exists decision_schemes_page on public.decision_schemes(user_id,created_at desc,id desc);
alter table public.answer_history enable row level security;
alter table public.decision_schemes enable row level security;
create policy answer_owner on public.answer_history for select to authenticated using(user_id=auth.uid());
create policy decision_owner on public.decision_schemes for select to authenticated using(user_id=auth.uid());
revoke all on public.answer_history, public.decision_schemes from anon,authenticated;
grant select on public.answer_history, public.decision_schemes to authenticated;
create table public.workshop_mutations (
 user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(user_id,operation_id)
);
alter table public.workshop_mutations enable row level security;
revoke all on public.workshop_mutations from anon,authenticated;

create function public.save_private_record(kind text, record_id uuid, payload jsonb, base_revision bigint, operation_id uuid, remove_record boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); table_name text; previous record; saved record; result_value jsonb; destination uuid:=record_id;
begin
 if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
 if kind is null or kind not in ('answer','decision') or record_id is null or operation_id is null or base_revision is null or base_revision<0 then raise exception 'Invalid record'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select result into result_value from public.workshop_mutations m where m.user_id=owner_id and m.operation_id=save_private_record.operation_id;
 if found then return result_value; end if;
 table_name:=case when kind='answer' then 'answer_history' else 'decision_schemes' end;
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
 insert into public.workshop_mutations values(owner_id,operation_id,result_value,clock_timestamp());
 -- Keep idempotency receipts for a bounded retry window; records remain permanently idempotent by ID.
 delete from public.workshop_mutations where user_id=owner_id and created_at<now()-interval '30 days';
 return result_value;
end $$;

create function public.clear_private_records(kind text, operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); result_value jsonb; table_name text;
begin
 if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
 if kind not in ('answer','decision') or operation_id is null then raise exception 'Invalid request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select result into result_value from public.workshop_mutations m where m.user_id=owner_id and m.operation_id=clear_private_records.operation_id;
 if found then return result_value; end if;
 table_name:=case when kind='answer' then 'answer_history' else 'decision_schemes' end;
 execute format('update public.%I set data=''{}''::jsonb,deleted=true,revision=revision+1,updated_at=clock_timestamp() where user_id=$1 and not deleted',table_name) using owner_id;
 result_value:=jsonb_build_object('cleared',true);
 insert into public.workshop_mutations values(owner_id,operation_id,result_value,clock_timestamp());
 return result_value;
end $$;

create function public.get_private_records(kind text, before_time timestamptz default null, before_id uuid default null, page_size integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); result_value jsonb; table_name text;
begin
 if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
 if kind not in ('answer','decision') then raise exception 'Invalid request'; end if;
 table_name:=case when kind='answer' then 'answer_history' else 'decision_schemes' end;
 execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from (select * from public.%I where user_id=$1 and ($2 is null or (created_at,id)<($2,$3)) order by created_at desc,id desc limit $4) r',table_name)
 into result_value using owner_id,before_time,before_id,greatest(1,least(coalesce(page_size,25),100));
 return result_value;
end $$;

create table public.typing_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null check(length(nickname) between 3 and 24 and nickname ~ '^[A-Za-z0-9_一-龥]+$'),
 created_at timestamptz not null default now()
);
create unique index typing_nickname_unique on public.typing_profiles(lower(nickname));
alter table public.typing_profiles enable row level security;
create policy profile_owner on public.typing_profiles for select to authenticated using(user_id=auth.uid());
revoke all on public.typing_profiles from anon,authenticated;
grant select on public.typing_profiles to authenticated;
create table public.typing_passages (
 language text not null check(language in ('en','zh')), version integer not null,
 content text not null check(length(content) between 1500 and 15000), active boolean not null default false,
 primary key(language,version)
);
create unique index one_active_typing_version on public.typing_passages(language) where active;
alter table public.typing_passages enable row level security;
revoke all on public.typing_passages from anon,authenticated;
insert into public.typing_passages values
 ('en',1,repeat('Morning light settles on the workshop desk. A notebook waits beside a warm cup of tea. We start with one small task, leave room for a useful mistake, and take the next step with care. Outside, a quiet street wakes slowly. Every clear sentence and patient choice makes a little more space for a good idea. Keep a steady rhythm rather than rushing toward the last word. ',8),true),
 ('zh',1,repeat('清晨的光落在桌边，一本笔记还停在昨天的那一页。先把今天要做的小事写下来，再给新的想法留一点空间。窗外的街道慢慢醒来，远处传来熟悉的声音。我们不必一次走完所有的路，只要认真完成眼前的一步。遇到不明白的地方就停下来想一想，让每一个选择都有自己的理由。保持平稳的节奏，也记得在忙碌之间照顾自己。',12),true);
create table public.typing_test_sessions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 language text not null, version integer not null, started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz, foreign key(language,version) references public.typing_passages(language,version)
);
create index typing_session_rate on public.typing_test_sessions(user_id,started_at desc);
alter table public.typing_test_sessions enable row level security;
revoke all on public.typing_test_sessions from anon,authenticated;
create table public.typing_results (
 session_id uuid primary key references public.typing_test_sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, language text not null,version integer not null,
 speed numeric(10,2) not null, accuracy numeric(6,2) not null, achieved_at timestamptz not null,
 foreign key(language,version) references public.typing_passages(language,version)
);
create index typing_result_best on public.typing_results(language,version,user_id,speed desc,accuracy desc,achieved_at);
alter table public.typing_results enable row level security;
revoke all on public.typing_results from anon,authenticated;

create function public.set_typing_nickname(nickname text) returns text language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); chosen text:=btrim(nickname);
begin
 if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
 if length(chosen) not between 3 and 24 or chosen !~ '^[A-Za-z0-9_一-龥]+$' then raise exception 'Use 3-24 letters, Chinese characters, numbers or underscores'; end if;
 insert into public.typing_profiles(user_id,nickname) values(owner_id,chosen) on conflict(user_id) do update set nickname=excluded.nickname;
 return chosen;
exception when unique_violation then raise exception 'This nickname is already taken';
end $$;

create function public.start_typing_test(language text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); passage public.typing_passages; test public.typing_test_sessions;
begin
 if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
 if language not in ('en','zh') then raise exception 'Invalid language'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1));
 if not exists(select 1 from public.typing_profiles where user_id=owner_id) then raise exception 'Choose a public nickname first'; end if;
 if exists(select 1 from public.typing_test_sessions where user_id=owner_id and started_at>clock_timestamp()-interval '65 seconds') or (select count(*) from public.typing_test_sessions where user_id=owner_id and started_at>clock_timestamp()-interval '1 hour')>=30 then raise exception 'Please wait before starting another Ranked test'; end if;
 select * into passage from public.typing_passages p where p.language=start_typing_test.language and p.active;
 if not found then raise exception 'No active passage'; end if;
 insert into public.typing_test_sessions(user_id,language,version) values(owner_id,passage.language,passage.version) returning * into test;
 return jsonb_build_object('sessionId',test.id,'text',passage.content,'version',passage.version,'duration',60,'startedAt',test.started_at,'serverNow',clock_timestamp());
end $$;

create function public.finish_typing_test("sessionId" uuid,"typedText" text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); test public.typing_test_sessions; source text; input_text text:=normalize("typedText",NFC); correct integer:=0; counted integer:=0; n integer; i integer; speed_value numeric; accuracy_value numeric; finished timestamptz:=clock_timestamp();
begin
 if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
 if input_text is null or length(input_text) not between 1 and 15000 then raise exception 'Invalid input length'; end if;
 select * into test from public.typing_test_sessions where id="sessionId" and user_id=owner_id for update;
 if not found then raise exception 'Invalid test session'; end if;
 if test.finished_at is not null then raise exception 'This session has already finished'; end if;
 if finished<test.started_at+interval '60 seconds' then raise exception 'Test ended too early'; end if;
 if finished>test.started_at+interval '5 minutes' then raise exception 'Test session expired'; end if;
 select content into source from public.typing_passages where language=test.language and version=test.version;
 if length(input_text)>length(source) then raise exception 'Input exceeds passage'; end if;
 n:=length(input_text);
 for i in 1..n loop
  if substr(input_text,i,1)=substr(source,i,1) then
   correct:=correct+1;
   if test.language='en' or substr(input_text,i,1)!~'[[:space:]]' then counted:=counted+1; end if;
  end if;
 end loop;
 speed_value:=round(counted::numeric/case when test.language='en' then 5 else 1 end,2);
 accuracy_value:=round(correct*100.0/n,2);
 update public.typing_test_sessions set finished_at=finished where id=test.id;
 if correct*100>=95*n then insert into public.typing_results values(test.id,owner_id,test.language,test.version,speed_value,accuracy_value,finished); end if;
 return jsonb_build_object('speed',speed_value,'accuracy',accuracy_value,'qualified',correct*100>=95*n,'version',test.version);
end $$;

create function public.get_typing_leaderboard(language text) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare result_value jsonb; active_version integer;
begin
 if language not in ('en','zh') then raise exception 'Invalid language'; end if;
 select version into active_version from public.typing_passages p where p.language=get_typing_leaderboard.language and active;
 with best as (
  select distinct on(r.user_id) r.user_id,p.nickname,r.speed,r.accuracy,r.achieved_at
  from public.typing_results r join public.typing_profiles p on p.user_id=r.user_id
  where r.language=get_typing_leaderboard.language and r.version=active_version and r.accuracy>=95
  order by r.user_id,r.speed desc,r.accuracy desc,r.achieved_at,r.session_id
 ), ranked as (
  select *,row_number() over(order by speed desc,accuracy desc,achieved_at,user_id) as rank from best
 ), safe as (
  select rank,nickname,speed,accuracy,achieved_at,(user_id=auth.uid()) is_me from ranked
 ) select jsonb_build_object('version',active_version,'top',coalesce((select jsonb_agg(to_jsonb(s)-'is_me' order by rank) from safe s where rank<=50),'[]'::jsonb),'me',(select to_jsonb(s)-'is_me' from safe s where is_me)) into result_value;
 return result_value;
end $$;

-- Functions are not executable by PUBLIC: the only anonymous interface is a sanitised leaderboard.
revoke all on function public.save_private_record(text,uuid,jsonb,bigint,uuid,boolean),public.clear_private_records(text,uuid),public.get_private_records(text,timestamptz,uuid,integer),public.set_typing_nickname(text),public.start_typing_test(text),public.finish_typing_test(uuid,text),public.get_typing_leaderboard(text) from public,anon,authenticated;
grant execute on function public.save_private_record(text,uuid,jsonb,bigint,uuid,boolean),public.clear_private_records(text,uuid),public.get_private_records(text,timestamptz,uuid,integer),public.set_typing_nickname(text),public.start_typing_test(text),public.finish_typing_test(uuid,text) to authenticated;
grant execute on function public.get_typing_leaderboard(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
