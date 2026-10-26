begin;
create function workshop_private.shared_board_notify(room uuid,channel_key uuid) returns void language plpgsql set search_path='' as $$
begin
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
  perform realtime.send(jsonb_build_object('changed',true),'changed','whiteboard:'||room::text||':'||channel_key::text||':control',true);
 end if;
end $$;
revoke all on function workshop_private.shared_board_notify(uuid,uuid) from public,anon,authenticated;
create function workshop_private.shared_board_settings(value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(value) is distinct from 'object' or coalesce(value->>'viewBackgroundColor','')!~'^#[0-9a-fA-F]{3,8}$' or (value->>'gridSize' is not null and (jsonb_typeof(value->'gridSize')<>'number' or (value->>'gridSize')::numeric not between 1 and 100)) then raise exception 'Invalid shared canvas settings.';end if;
 return jsonb_build_object('viewBackgroundColor',value->>'viewBackgroundColor','gridSize',value->'gridSize');
end $$;

revoke all on function workshop_private.shared_board_scene(uuid,uuid,boolean),workshop_private.shared_board_validate(jsonb),workshop_private.shared_board_merge(uuid,jsonb),workshop_private.shared_board_settings(jsonb) from public,anon,authenticated;
commit;
