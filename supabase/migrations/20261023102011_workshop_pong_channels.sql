begin;
-- Realtime's managed schema is left intact; only supported message policies are added.
create function workshop_private.pong_channel_access(topic text,publish boolean) returns boolean language plpgsql security definer stable set search_path='' as $$
declare parts text[]:=string_to_array(topic,':');allowed boolean;
begin
 if auth.uid() is null or array_length(parts,1)<>4 or parts[1]<>'pong' or parts[2]!~'^[0-9a-fA-F-]{36}$' or parts[3]!~'^[0-9a-fA-F-]{36}$' or parts[4] not in ('host','guest') then return false;end if;
 select exists(select 1 from workshop_private.pong_rooms r join workshop_private.pong_room_members m on m.room_id=r.id where r.id=parts[2]::uuid and r.channel_key=parts[3]::uuid and m.user_id=auth.uid() and r.status not in ('closed','interrupted') and r.expires_at>clock_timestamp() and (not publish or m.role=parts[4])) into allowed;
 return allowed;
end $$;
revoke all on function workshop_private.pong_channel_access(text,boolean) from public,anon,authenticated;
grant execute on function workshop_private.pong_channel_access(text,boolean) to authenticated;
create policy pong_room_receive on realtime.messages for select to authenticated using(extension='broadcast' and workshop_private.pong_channel_access((select realtime.topic()),false));
create policy pong_room_publish on realtime.messages for insert to authenticated with check(extension='broadcast' and workshop_private.pong_channel_access((select realtime.topic()),true));
notify pgrst,'reload schema';
commit;
