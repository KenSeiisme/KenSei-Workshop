begin;
create function workshop_private.shared_board_channel(topic text,publish boolean) returns boolean language plpgsql security definer stable set search_path='' as $$
declare parts text[]:=string_to_array(topic,':');
begin
 if auth.uid() is null or array_length(parts,1)<>4 or parts[1]<>'whiteboard' or parts[2]!~'^[0-9a-fA-F-]{36}$' or parts[3]!~'^[0-9a-fA-F-]{36}$' then return false;end if;
 return exists(select 1 from workshop_private.shared_whiteboards r join workshop_private.shared_whiteboard_members m on m.room_id=r.id where r.id=parts[2]::uuid and r.channel_key=parts[3]::uuid and m.user_id=auth.uid()
 and ((not publish and (parts[4]='control' or exists(select 1 from workshop_private.shared_whiteboard_members sender where sender.room_id=r.id and sender.user_id::text=parts[4])))
 or (publish and parts[4]=auth.uid()::text and m.lease_until>clock_timestamp())));
end $$;

create function public.whiteboard_room(action text,body jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); req workshop_private.shared_whiteboard_requests;
begin
 if owner is null then raise exception 'Sign in to use shared whiteboards.' using errcode='28000';end if;
 if action is null or jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>2100000 then raise exception 'Invalid shared whiteboard request.';end if;
 delete from workshop_private.shared_whiteboard_requests where bucket<clock_timestamp()-interval '1 day';
 delete from workshop_private.shared_whiteboard_mutations where created_at<clock_timestamp()-interval '1 day';
 insert into workshop_private.shared_whiteboard_requests(user_id,bucket,calls,creates,joins)
 values(owner,date_trunc('minute',clock_timestamp()),1,case when action='create' then 1 else 0 end,case when action='join' then 1 else 0 end)
 on conflict(user_id,bucket) do update set calls=shared_whiteboard_requests.calls+1,creates=shared_whiteboard_requests.creates+excluded.creates,joins=shared_whiteboard_requests.joins+excluded.joins returning * into req;
 if req.calls>120 or req.creates>3 or req.joins>10 then return jsonb_build_object('error','Too many room requests. Wait a moment and retry.');end if;

 begin return workshop_private.whiteboard_room(action,body);
 exception when others then return jsonb_build_object('error',sqlerrm);end;
end $$;
revoke all on function workshop_private.whiteboard_room(text,jsonb),workshop_private.shared_board_scene(uuid,uuid,boolean),workshop_private.shared_board_validate(jsonb),workshop_private.shared_board_merge(uuid,jsonb),workshop_private.shared_board_settings(jsonb),workshop_private.shared_board_channel(text,boolean),public.whiteboard_room(text,jsonb) from public,anon,authenticated;
grant execute on function public.whiteboard_room(text,jsonb),workshop_private.shared_board_channel(text,boolean) to authenticated;
create policy shared_board_receive on realtime.messages for select to authenticated using(extension in ('broadcast','presence') and workshop_private.shared_board_channel((select realtime.topic()),false));
create policy shared_board_publish on realtime.messages for insert to authenticated with check(extension in ('broadcast','presence') and workshop_private.shared_board_channel((select realtime.topic()),true));

notify pgrst, 'reload schema';
commit;
