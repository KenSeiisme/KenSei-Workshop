begin;

alter table public.typing_profiles add column appearance jsonb not null default
  '{"cover":"orchid","accent":"lavender","featured":[]}';
alter table workshop_private.friend_game_invites add column state text not null default 'pending'
  check(state in ('pending','ignored','revoked'));

create table workshop_private.social_preferences(
  user_id uuid primary key references auth.users(id) on delete cascade,
  visible boolean not null default true
);
create table workshop_private.social_activity(
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  game text check(game in ('2048','minesweeper','snake','memory-match','sudoku','nonogram','block-puzzle','brick-breaker','connect-four','reversi','block-drop','go','chess','xiangqi','pong')),
  seen_at timestamptz not null default clock_timestamp(),
  primary key(user_id,client_id)
);
alter table workshop_private.social_preferences enable row level security;
alter table workshop_private.social_activity enable row level security;
revoke all on workshop_private.social_preferences,workshop_private.social_activity from public,anon,authenticated;

create or replace function workshop_private.profile_json(p public.typing_profiles) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('public_id',p.public_id,'nickname',p.nickname,'bio',p.bio,
    'avatar_kind',p.avatar_kind,'avatar_path',case when p.avatar_kind='upload' then p.avatar_path end,
    'google_avatar_url',case when p.avatar_kind='google' then p.google_avatar_url end,'appearance',p.appearance)
$$;

alter function public.update_my_profile(jsonb,uuid) set schema workshop_private;
alter function workshop_private.update_my_profile(jsonb,uuid) rename to update_profile_before_appearance;
revoke all on function workshop_private.update_profile_before_appearance(jsonb,uuid) from public,anon,authenticated;

create function workshop_private.update_my_profile(patch jsonb,expected_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); look jsonb; p public.typing_profiles;
begin
  perform workshop_private.update_profile_before_appearance(patch-'appearance',owner);
  if patch?'appearance' then
    look:=patch->'appearance';
    if jsonb_typeof(look)<>'object' or exists(select 1 from jsonb_object_keys(look) k where k not in ('cover','accent','featured'))
      or coalesce(look->>'cover','') not in ('orchid','rose','mist','mint','dusk','aurora')
      or coalesce(look->>'accent','') not in ('lavender','rose','ice','mint','amber')
      or jsonb_typeof(look->'featured') is distinct from 'array' then raise exception 'Invalid profile appearance'; end if;
    if jsonb_array_length(look->'featured')>3
      or (select count(*)<>count(distinct x) from jsonb_array_elements(look->'featured') x)
      or exists(select 1 from jsonb_array_elements(look->'featured') x
        where jsonb_typeof(x)<>'string' or not exists(
          select 1 from workshop_private.game_achievement_unlocks a where a.user_id=owner and a.achievement_id=x#>>'{}'
        )) then raise exception 'Choose up to three unlocked verified milestones'; end if;
    update public.typing_profiles set appearance=look where user_id=owner;
  end if;
  select * into p from public.typing_profiles where user_id=owner;
  return workshop_private.profile_json(p);
end $$;

create function public.update_my_profile(patch jsonb,expected_user uuid) returns jsonb
language sql security invoker set search_path='' as $$select workshop_private.update_my_profile(patch,expected_user)$$;
revoke all on function public.update_my_profile(jsonb,uuid),workshop_private.update_my_profile(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.update_my_profile(jsonb,uuid),workshop_private.update_my_profile(jsonb,uuid) to authenticated;

create function workshop_private.get_social_preferences(expected_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user);
begin return jsonb_build_object('visible',coalesce((select visible from workshop_private.social_preferences where user_id=owner),true)); end
$$;

create function workshop_private.set_social_visibility(expected_user uuid,visible boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user);
begin
  if visible is null then raise exception 'Choose a visibility'; end if;
  insert into workshop_private.social_preferences values(owner,visible)
    on conflict(user_id) do update set visible=excluded.visible;
  return workshop_private.get_social_preferences(owner);
end $$;

create function workshop_private.touch_social_activity(expected_user uuid,client_id uuid,game_key text,active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user);
begin
  if client_id is null or active is null then raise exception 'Invalid activity'; end if;
  delete from workshop_private.social_activity where user_id=owner and seen_at<statement_timestamp()-interval '1 day';
  if active then
    insert into workshop_private.social_activity values(owner,client_id,game_key,clock_timestamp())
      on conflict on constraint social_activity_pkey do update set game=excluded.game,seen_at=excluded.seen_at;
  else delete from workshop_private.social_activity a where a.user_id=owner and a.client_id=touch_social_activity.client_id;
  end if;
  return workshop_private.get_social_preferences(owner);
end $$;

create function workshop_private.friend_presence(owner uuid,target uuid) returns jsonb
language sql stable set search_path='' as $$
  select coalesce((
    select jsonb_build_object('status',case when a.game is null then 'online' else 'playing' end,'game',a.game)
    from workshop_private.social_activity a
    where a.user_id=target and a.seen_at>statement_timestamp()-interval '120 seconds'
      and coalesce((select p.visible from workshop_private.social_preferences p where p.user_id=target),true)
      and exists(select 1 from workshop_private.friendships f where f.low_id=least(owner,target) and f.high_id=greatest(owner,target) and f.accepted_at is not null)
      and not exists(select 1 from workshop_private.friend_blocks b where (b.owner_id,b.target_id) in ((owner,target),(target,owner)))
    order by (a.game is not null) desc,a.seen_at desc limit 1
  ),'{"status":"offline","game":null}'::jsonb)
$$;

alter function workshop_private.friend_view(uuid,uuid) rename to friend_view_before_presence;
create function workshop_private.friend_view(owner uuid,target uuid) returns jsonb
language sql stable set search_path='' as $$
  select r||case when r->>'state'='friend' then jsonb_build_object('presence',workshop_private.friend_presence(owner,target)) else '{}'::jsonb end
  from (select workshop_private.friend_view_before_presence(owner,target) r) s
$$;

create function workshop_private.change_friend_game_invite(expected_user uuid,invitation uuid,action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); i workshop_private.friend_game_invites;
begin
  select * into i from workshop_private.friend_game_invites where id=invitation for update;
  if not found or not ((action='ignore' and i.recipient_id=owner) or (action='revoke' and i.sender_id=owner)) then
    return jsonb_build_object('status','unavailable');
  end if;
  if i.state='pending' then
    update workshop_private.friend_game_invites set state=case when action='ignore' then 'ignored' else 'revoked' end where id=i.id returning * into i;
  end if;
  if owner=i.recipient_id then
    update workshop_private.site_notifications set read_at=coalesce(read_at,clock_timestamp()) where owner_id=owner and source='invite:'||i.id;
  end if;
  return jsonb_build_object('status',i.state);
end $$;

create or replace function workshop_private.open_friend_game_invite(expected_user uuid,invitation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); i workshop_private.friend_game_invites;
begin
  select * into i from workshop_private.friend_game_invites where id=invitation and recipient_id=owner;
  if not found or workshop_private.friend_view(owner,i.sender_id)->>'state'<>'friend' then return jsonb_build_object('status','unavailable'); end if;
  if i.state<>'pending' then return jsonb_build_object('status',i.state); end if;
  return workshop_private.friend_room(i.game,i.room_id,i.sender_id);
end $$;

alter function workshop_private.send_friend_game_invite(uuid,uuid,text,uuid) rename to send_friend_invite_before_state;
create function workshop_private.send_friend_game_invite(expected_user uuid,target_profile uuid,game_key text,target_room uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); result jsonb; i workshop_private.friend_game_invites;
begin
  result:=workshop_private.send_friend_invite_before_state(owner,target_profile,game_key,target_room);
  if result->>'status'<>'sent' then return result; end if;
  select f.* into i from workshop_private.friend_game_invites f join public.typing_profiles p on p.user_id=f.recipient_id
    where f.sender_id=owner and f.room_id=target_room and f.game=game_key and p.public_id=target_profile;
  return jsonb_build_object('status',case when i.state='pending' then 'sent' else i.state end,'id',i.id);
end $$;

create function workshop_private.get_room_friend_invites(expected_user uuid,game_key text,target_room uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',case when i.state='pending' then
    workshop_private.friend_room(i.game,i.room_id,owner)->>'status' else i.state end,
    'profile',workshop_private.profile_json(p)-'bio'))
    from workshop_private.friend_game_invites i join public.typing_profiles p on p.user_id=i.recipient_id
    where i.sender_id=owner and i.game=game_key and i.room_id=target_room),'[]'::jsonb);
end $$;

create function workshop_private.notice_detail(owner uuid,n workshop_private.site_notifications) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb; relation jsonb; i workshop_private.friend_game_invites; detail jsonb:=n.payload;
begin
  if n.kind='friend_request' then
    relation:=workshop_private.friend_view(owner,n.actor_id);
    detail:=detail||jsonb_build_object('relationship',relation);
  elsif n.kind='game_invite' then
    detail:=detail||(workshop_private.open_friend_game_invite(owner,(n.payload->>'id')::uuid)-'code');
  elsif n.kind='reward' and n.payload->>'type'='daily' then
    detail:=detail||jsonb_build_object('task_day',split_part(n.source,':',2),'task_id',split_part(n.source,':',3));
  end if;
  select workshop_private.profile_json(p)-'bio' into result from public.typing_profiles p where p.user_id=n.actor_id;
  return jsonb_build_object('id',n.id,'kind',n.kind,'source',n.source,'payload',detail,
    'actor',result,'created_at',n.created_at,'read_at',n.read_at);
end $$;

create function workshop_private.get_site_notifications_page(expected_user uuid,before_id uuid,category text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); cutoff timestamptz;
begin
  if category is null or category not in ('all','social','rewards') then raise exception 'Invalid notification filter'; end if;
  if before_id is not null then
    select n.created_at into cutoff from workshop_private.site_notifications n where n.id=before_id and n.owner_id=owner;
    if cutoff is null then return jsonb_build_object('rows','[]'::jsonb,'unread',0); end if;
  end if;
  return jsonb_build_object('unread',(select count(*) from workshop_private.site_notifications where owner_id=owner and read_at is null),
    'rows',coalesce((select jsonb_agg(item order by created_at desc,id desc) from (
      select n.created_at,n.id,workshop_private.notice_detail(owner,n) item
      from workshop_private.site_notifications n where n.owner_id=owner
        and (category='all' or (category='rewards' and n.kind='reward') or (category='social' and n.kind<>'reward'))
        and (before_id is null or (n.created_at,n.id)<(cutoff,before_id))
      order by n.created_at desc,n.id desc limit 21
    ) page),'[]'::jsonb));
end $$;
create or replace function workshop_private.get_site_notifications(expected_user uuid,before_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$ select workshop_private.get_site_notifications_page(expected_user,before_id,'all') $$;

revoke all on function workshop_private.friend_presence(uuid,uuid),workshop_private.friend_view(uuid,uuid),
  workshop_private.friend_view_before_presence(uuid,uuid),workshop_private.send_friend_invite_before_state(uuid,uuid,text,uuid),
  workshop_private.notice_detail(uuid,workshop_private.site_notifications) from public,anon,authenticated;
create function public.get_social_preferences(expected_user uuid) returns jsonb
language sql security invoker set search_path='' as $$select workshop_private.get_social_preferences(expected_user)$$;
revoke all on function public.get_social_preferences(uuid),workshop_private.get_social_preferences(uuid) from public,anon,authenticated;
grant execute on function public.get_social_preferences(uuid),workshop_private.get_social_preferences(uuid) to authenticated;
create function public.set_social_visibility(expected_user uuid,visible boolean) returns jsonb
language sql security invoker set search_path='' as $$select workshop_private.set_social_visibility(expected_user,visible)$$;
revoke all on function public.set_social_visibility(uuid,boolean),workshop_private.set_social_visibility(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_social_visibility(uuid,boolean),workshop_private.set_social_visibility(uuid,boolean) to authenticated;
create function public.touch_social_activity(expected_user uuid,client_id uuid,game_key text,active boolean) returns jsonb
language sql security invoker set search_path='' as $$select workshop_private.touch_social_activity(expected_user,client_id,game_key,active)$$;
revoke all on function public.touch_social_activity(uuid,uuid,text,boolean),workshop_private.touch_social_activity(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.touch_social_activity(uuid,uuid,text,boolean),workshop_private.touch_social_activity(uuid,uuid,text,boolean) to authenticated;
create function public.change_friend_game_invite(expected_user uuid,invitation uuid,action text) returns jsonb
language sql security invoker set search_path='' as $$select workshop_private.change_friend_game_invite(expected_user,invitation,action)$$;
revoke all on function public.change_friend_game_invite(uuid,uuid,text),workshop_private.change_friend_game_invite(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.change_friend_game_invite(uuid,uuid,text),workshop_private.change_friend_game_invite(uuid,uuid,text) to authenticated;
create function public.get_room_friend_invites(expected_user uuid,game_key text,target_room uuid) returns jsonb
language sql security invoker set search_path='' as $$select workshop_private.get_room_friend_invites(expected_user,game_key,target_room)$$;
revoke all on function public.get_room_friend_invites(uuid,text,uuid),workshop_private.get_room_friend_invites(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.get_room_friend_invites(uuid,text,uuid),workshop_private.get_room_friend_invites(uuid,text,uuid) to authenticated;
create function public.get_site_notifications_page(expected_user uuid,before_id uuid,category text) returns jsonb
language sql security invoker set search_path='' as $$select workshop_private.get_site_notifications_page(expected_user,before_id,category)$$;
revoke all on function public.get_site_notifications_page(uuid,uuid,text),workshop_private.get_site_notifications_page(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_site_notifications_page(uuid,uuid,text),workshop_private.get_site_notifications_page(uuid,uuid,text) to authenticated;
revoke all on function workshop_private.send_friend_game_invite(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function workshop_private.send_friend_game_invite(uuid,uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
