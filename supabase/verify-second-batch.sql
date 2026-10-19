-- Production smoke test. Every fixture and write is rolled back.
begin;
create temporary table qa_users(label text,id uuid default gen_random_uuid());
insert into qa_users(label) values('a'),('b');
insert into auth.users(id) select id from qa_users;
create temporary table qa_state(kind text,value jsonb);
grant select on qa_users to anon,authenticated;
grant select,insert on qa_state to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from qa_users where label='a'),true);
insert into qa_state values('answer',public.save_private_record('answer',gen_random_uuid(),'{"en":"A test answer","zh":"测试回答","question":"must never persist"}',0,gen_random_uuid(),false,auth.uid()));
select public.set_typing_nickname('QA_'||substr(replace((select id::text from qa_users where label='a'),'-',''),1,12));
insert into qa_state values('session',public.start_typing_test('en'));
do $$begin
 if exists(select 1 from public.answer_history where data?'question') then raise exception 'Question persisted'; end if;
 begin perform public.finish_typing_test((select (value->>'sessionId')::uuid from qa_state where kind='session'),'Morning light');raise exception 'Early finish accepted';exception when others then if sqlerrm not like '%too early%' then raise;end if;end;
 begin insert into public.typing_results values(null,null,null,1,10000,100,now());raise exception 'Direct scores accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.typing_test_sessions set started_at=clock_timestamp()-interval '61 seconds' where id=(select (value->>'sessionId')::uuid from qa_state where kind='session');
set local role authenticated;
insert into qa_state values('score',public.finish_typing_test((select (value->>'sessionId')::uuid from qa_state where kind='session'),'Morning light'));
do $$begin
 if (select (value->>'speed')::numeric from qa_state where kind='score')<>2.6 then raise exception 'Incorrect server score';end if;
 begin perform public.finish_typing_test((select (value->>'sessionId')::uuid from qa_state where kind='session'),'Morning light');raise exception 'Replay accepted';exception when others then if sqlerrm not like '%already finished%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from qa_users where label='b'),true);
do $$begin
 if exists(select 1 from public.answer_history) then raise exception 'RLS leaked another account';end if;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$declare board jsonb;begin
 begin perform * from public.answer_history;raise exception 'Anonymous history access';exception when insufficient_privilege then null;end;
 begin perform public.start_typing_test('en');raise exception 'Anonymous Ranked access';exception when insufficient_privilege then null;end;
 board:=public.get_typing_leaderboard('en');
 if board::text ~ 'user_id|email|google|typedText' then raise exception 'Public board exposed private fields';end if;
end $$;
reset role;
select 'PASS: production RLS, private question filtering, server scoring, early finish, replay, direct writes and anonymous board permissions' as validation;
rollback;
