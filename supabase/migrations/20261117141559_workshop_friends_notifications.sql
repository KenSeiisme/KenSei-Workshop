begin;

create table workshop_private.friendships (
  low_id uuid not null references auth.users(id) on delete cascade,
  high_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null default gen_random_uuid() unique,
  requester uuid not null references auth.users(id) on delete cascade,
  accepted_at timestamptz,
  primary key (low_id,high_id),
  check (low_id < high_id and requester in (low_id,high_id))
);
create index friendships_high on workshop_private.friendships(high_id,low_id);
create index friendships_requester on workshop_private.friendships(requester);

create table workshop_private.friend_blocks (
  owner_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  primary key (owner_id,target_id),
  check (owner_id <> target_id)
);
create index friend_blocks_target on workshop_private.friend_blocks(target_id);

create table workshop_private.friend_game_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('go','chess','xiangqi','pong')),
  room_id uuid not null,
  unique (sender_id,recipient_id,game,room_id),
  check (sender_id <> recipient_id)
);
create index friend_game_invites_recipient on workshop_private.friend_game_invites(recipient_id,sender_id);

create table workshop_private.site_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('friend_request','friend_accepted','game_invite','reward')),
  source text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique (owner_id,source)
);
create index site_notifications_feed on workshop_private.site_notifications(owner_id,created_at desc,id desc);
create index site_notifications_unread on workshop_private.site_notifications(owner_id) where read_at is null;
create index site_notifications_actor on workshop_private.site_notifications(actor_id);
create index social_profile_name_prefix on public.typing_profiles ((lower(nickname)) text_pattern_ops);

alter table workshop_private.friendships enable row level security;
alter table workshop_private.friend_blocks enable row level security;
alter table workshop_private.friend_game_invites enable row level security;
alter table workshop_private.site_notifications enable row level security;
revoke all on workshop_private.friendships,workshop_private.friend_blocks,
  workshop_private.friend_game_invites,workshop_private.site_notifications from public,anon,authenticated;

create function workshop_private.social_actor(expected_user uuid) returns uuid
language plpgsql stable set search_path='' as $$
begin
  if auth.uid() is null or auth.uid() is distinct from expected_user then
    raise exception 'Account changed. Please sign in again.' using errcode='28000';
  end if;
  return auth.uid();
end $$;

create function workshop_private.friend_view(owner uuid,target uuid) returns jsonb
language sql stable set search_path='' as $$
  select case
    when owner=target then jsonb_build_object('state','self')
    when exists(select 1 from workshop_private.friend_blocks b where (b.owner_id,b.target_id)=(owner,target)) then jsonb_build_object('state','blocked')
    when exists(select 1 from workshop_private.friend_blocks b where (b.owner_id,b.target_id)=(target,owner)) then jsonb_build_object('state','unavailable')
    else coalesce((
      select jsonb_build_object('id',f.request_id,'state',
        case when f.accepted_at is not null then 'friend'
        when f.requester=owner then 'outgoing' else 'incoming' end)
      from workshop_private.friendships f where (f.low_id,f.high_id)=(least(owner,target),greatest(owner,target))
    ),jsonb_build_object('state','none'))
  end
$$;

create function workshop_private.search_friend_profiles(expected_user uuid, query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); term text;
begin
  if length(query)>128 then return '[]'::jsonb; end if;
  term:=lower(workshop_private.profile_name(query));
  if length(term)<2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(item order by exact desc,name,public_id) from (
    select workshop_private.profile_json(p)-'bio'||workshop_private.friend_view(owner,p.user_id) item,
      lower(p.nickname)=term exact,lower(p.nickname) name,p.public_id
    from public.typing_profiles p
    where p.profile_initialized and p.user_id<>owner and starts_with(lower(p.nickname),term)
      and not exists(select 1 from workshop_private.friend_blocks b
        where (b.owner_id,b.target_id) in ((owner,p.user_id),(p.user_id,owner)))
    order by exact desc,name,p.public_id limit 16
  ) matched),'[]'::jsonb);
end $$;

create function workshop_private.get_friendship(expected_user uuid,target_profile uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); target uuid;
begin
  select p.user_id into target from public.typing_profiles p where p.public_id=target_profile;
  if target is null then return jsonb_build_object('state','unavailable'); end if;
  return workshop_private.friend_view(owner,target);
end
$$;

create function workshop_private.list_friendships(expected_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user);
begin
  return coalesce((select jsonb_agg(workshop_private.profile_json(p)-'bio'||workshop_private.friend_view(owner,p.user_id)
      order by lower(p.nickname),p.public_id)
    from public.typing_profiles p join (
      select f.high_id id from workshop_private.friendships f where f.low_id=owner
      union
      select f.low_id from workshop_private.friendships f where f.high_id=owner
      union
      select b.target_id from workshop_private.friend_blocks b where b.owner_id=owner
    ) peers on peers.id=p.user_id),'[]'::jsonb);
end $$;

create function workshop_private.change_friendship(expected_user uuid,target_profile uuid,action text,request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); target uuid;
  low uuid; high uuid; f workshop_private.friendships; relation jsonb;
begin
  select p.user_id into target from public.typing_profiles p where p.public_id=target_profile;
  if target is null or target=owner then return jsonb_build_object('state','unavailable'); end if;
  low:=least(owner,target); high:=greatest(owner,target);
  perform pg_advisory_xact_lock(hashtextextended(low::text||':'||high::text,871));
  relation:=workshop_private.friend_view(owner,target);
  select * into f from workshop_private.friendships where (low_id,high_id)=(low,high);
  if action='block' then
    insert into workshop_private.friend_blocks values(owner,target) on conflict do nothing;
    delete from workshop_private.friendships where (low_id,high_id)=(low,high);
  elsif action='unblock' then
    delete from workshop_private.friend_blocks where (owner_id,target_id)=(owner,target);
  elsif action='request' and relation->>'state'='none'
    and exists(select 1 from public.typing_profiles p where p.user_id=owner and p.profile_initialized) then
    insert into workshop_private.friendships(low_id,high_id,requester) values(low,high,owner) returning * into f;
    insert into workshop_private.site_notifications(owner_id,actor_id,kind,source)
      values(target,owner,'friend_request','request:'||f.request_id);
  elsif action='accept' and relation->>'state'='incoming' and f.request_id=request then
    update workshop_private.friendships set accepted_at=clock_timestamp() where request_id=request;
    insert into workshop_private.site_notifications(owner_id,actor_id,kind,source)
      values(target,owner,'friend_accepted','accepted:'||f.request_id);
    update workshop_private.site_notifications set read_at=coalesce(read_at,clock_timestamp())
      where owner_id=owner and source='request:'||f.request_id;
  elsif f.request_id=request and
    ((action='decline' and relation->>'state'='incoming') or
     (action='cancel' and relation->>'state'='outgoing') or
     (action='remove' and relation->>'state'='friend')) then
    delete from workshop_private.friendships where request_id=request;
  end if;
  if action='block' or (action='remove' and f.request_id=request and f.accepted_at is not null) then
    delete from workshop_private.friend_game_invites
      where (sender_id,recipient_id) in ((owner,target),(target,owner));
  end if;
  return workshop_private.friend_view(owner,target);
end $$;

create function workshop_private.friend_room(game_key text,target_room uuid,host uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare room_state text; room_code text; expires timestamptz; members integer;
begin
  if game_key='pong' then
    select r.status,r.code,r.expires_at,(select count(*) from workshop_private.pong_room_members m where m.room_id=r.id)
      into room_state,room_code,expires,members from workshop_private.pong_rooms r
      where r.id=target_room and r.host_id=host
        and exists(select 1 from workshop_private.pong_room_members m where m.room_id=r.id and m.user_id=host and m.role='host');
  elsif game_key in ('go','chess','xiangqi') then
    select r.status,r.code,r.expires_at,(select count(*) from workshop_private.board_members m where m.match_id=r.id)
      into room_state,room_code,expires,members from workshop_private.board_matches r
      where r.id=target_room and r.game=game_key and r.origin='invite'
        and exists(select 1 from workshop_private.board_members m where m.match_id=r.id and m.user_id=host);
  end if;
  if room_state is null or room_state in ('closed','finished','interrupted','unresolved') then
    return jsonb_build_object('status','closed');
  elsif room_state='waiting' and expires<=statement_timestamp() then
    return jsonb_build_object('status','expired');
  elsif members>=2 then return jsonb_build_object('status','full');
  elsif room_state<>'waiting' or members<>1 then return jsonb_build_object('status','closed');
  end if;
  return jsonb_build_object('status','available','game',game_key,'code',room_code);
end $$;

create function workshop_private.send_friend_game_invite(expected_user uuid,target_profile uuid,game_key text,target_room uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); target uuid; status text; sent uuid;
begin
  select p.user_id into target from public.typing_profiles p where p.public_id=target_profile;
  if target is null or owner=target then return jsonb_build_object('status','unavailable'); end if;
  perform pg_advisory_xact_lock(hashtextextended(least(owner,target)::text||':'||greatest(owner,target)::text,871));
  if workshop_private.friend_view(owner,target)->>'state'<>'friend' then return jsonb_build_object('status','unavailable'); end if;
  status:=workshop_private.friend_room(game_key,target_room,owner)->>'status';
  if status<>'available' then return jsonb_build_object('status',status); end if;
  insert into workshop_private.friend_game_invites(sender_id,recipient_id,game,room_id)
    values(owner,target,game_key,target_room) on conflict do nothing returning id into sent;
  if sent is not null then
    insert into workshop_private.site_notifications(owner_id,actor_id,kind,source,payload)
      values(target,owner,'game_invite','invite:'||sent,jsonb_build_object('id',sent,'game',game_key));
  end if;
  return jsonb_build_object('status','sent');
end $$;

create function workshop_private.open_friend_game_invite(expected_user uuid,invitation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); i workshop_private.friend_game_invites;
begin
  select * into i from workshop_private.friend_game_invites where id=invitation and recipient_id=owner;
  if not found or workshop_private.friend_view(owner,i.sender_id)->>'state'<>'friend' then
    return jsonb_build_object('status','unavailable');
  end if;
  return workshop_private.friend_room(i.game,i.room_id,i.sender_id);
end $$;

create function workshop_private.get_site_notifications(expected_user uuid,before_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user); cutoff timestamptz;
begin
  if before_id is not null then
    select n.created_at into cutoff from workshop_private.site_notifications n where n.id=before_id and n.owner_id=owner;
    if cutoff is null then return jsonb_build_object('rows','[]'::jsonb); end if;
  end if;
  return jsonb_build_object(
    'unread',(select count(*) from workshop_private.site_notifications n where n.owner_id=owner and n.read_at is null),
    'rows',coalesce((select jsonb_agg(item order by created_at desc,id desc) from (
      select n.created_at,n.id,jsonb_build_object('id',n.id,'kind',n.kind,'payload',n.payload,'created_at',n.created_at,
        'read_at',n.read_at,'source',n.source,'actor',case when p.user_id is not null then workshop_private.profile_json(p)-'bio' end) item
      from workshop_private.site_notifications n left join public.typing_profiles p on p.user_id=n.actor_id
      where n.owner_id=owner and (before_id is null or (n.created_at,n.id)<(cutoff,before_id))
      order by n.created_at desc,n.id desc limit 21
    ) page),'[]'::jsonb)
  );
end $$;

create function workshop_private.read_site_notifications(expected_user uuid,notification uuid,read_all boolean) returns integer
language plpgsql security definer set search_path='' as $$
declare owner uuid:=workshop_private.social_actor(expected_user);
begin
  update workshop_private.site_notifications n set read_at=clock_timestamp()
    where n.owner_id=owner and n.read_at is null and (read_all is true or n.id=notification);
  return (select count(*) from workshop_private.site_notifications n where n.owner_id=owner and n.read_at is null);
end $$;

create function workshop_private.social_reward_notice() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=to_jsonb(new); event_key text; detail jsonb;
begin
  if tg_table_name='hub_ledger' then
    if new.amount<=0 or new.reference not like 'day:%' then return new; end if;
    event_key:=new.reference; detail:=jsonb_build_object('type','daily','amount',new.amount);
  elsif tg_table_name='hub_badges' then
    event_key:='badge:'||(row_data->>'badge'); detail:=jsonb_build_object('type','badge','id',row_data->>'badge');
  else
    event_key:='milestone:'||(row_data->>'achievement_id'); detail:=jsonb_build_object('type','milestone','id',row_data->>'achievement_id');
  end if;
  insert into workshop_private.site_notifications(owner_id,kind,source,payload)
    values(new.user_id,'reward',event_key,detail) on conflict do nothing;
  return new;
end $$;

create trigger hub_ledger_social_notice after insert on workshop_private.hub_ledger
for each row execute function workshop_private.social_reward_notice();
create trigger hub_badge_social_notice after insert on workshop_private.hub_badges
for each row execute function workshop_private.social_reward_notice();
create trigger milestone_social_notice after insert on workshop_private.game_achievement_unlocks
for each row execute function workshop_private.social_reward_notice();

revoke all on function workshop_private.social_actor(uuid),workshop_private.friend_view(uuid,uuid),
  workshop_private.friend_room(text,uuid,uuid),workshop_private.social_reward_notice() from public,anon,authenticated;

create function public.search_friend_profiles(expected_user uuid,query text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select workshop_private.search_friend_profiles(expected_user,query)
$$;
revoke all on function workshop_private.search_friend_profiles(uuid,text),public.search_friend_profiles(uuid,text) from public,anon,authenticated;
grant execute on function workshop_private.search_friend_profiles(uuid,text),public.search_friend_profiles(uuid,text) to authenticated;

create function public.get_friendship(expected_user uuid,target_profile uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select workshop_private.get_friendship(expected_user,target_profile)
$$;
revoke all on function workshop_private.get_friendship(uuid,uuid),public.get_friendship(uuid,uuid) from public,anon,authenticated;
grant execute on function workshop_private.get_friendship(uuid,uuid),public.get_friendship(uuid,uuid) to authenticated;

create function public.list_friendships(expected_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select workshop_private.list_friendships(expected_user)
$$;
revoke all on function workshop_private.list_friendships(uuid),public.list_friendships(uuid) from public,anon,authenticated;
grant execute on function workshop_private.list_friendships(uuid),public.list_friendships(uuid) to authenticated;

create function public.change_friendship(expected_user uuid,target_profile uuid,action text,request uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select workshop_private.change_friendship(expected_user,target_profile,action,request)
$$;
revoke all on function workshop_private.change_friendship(uuid,uuid,text,uuid),public.change_friendship(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function workshop_private.change_friendship(uuid,uuid,text,uuid),public.change_friendship(uuid,uuid,text,uuid) to authenticated;

create function public.send_friend_game_invite(expected_user uuid,target_profile uuid,game_key text,target_room uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select workshop_private.send_friend_game_invite(expected_user,target_profile,game_key,target_room)
$$;
revoke all on function workshop_private.send_friend_game_invite(uuid,uuid,text,uuid),public.send_friend_game_invite(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function workshop_private.send_friend_game_invite(uuid,uuid,text,uuid),public.send_friend_game_invite(uuid,uuid,text,uuid) to authenticated;

create function public.open_friend_game_invite(expected_user uuid,invitation uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select workshop_private.open_friend_game_invite(expected_user,invitation)
$$;
revoke all on function workshop_private.open_friend_game_invite(uuid,uuid),public.open_friend_game_invite(uuid,uuid) from public,anon,authenticated;
grant execute on function workshop_private.open_friend_game_invite(uuid,uuid),public.open_friend_game_invite(uuid,uuid) to authenticated;

create function public.get_site_notifications(expected_user uuid,before_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select workshop_private.get_site_notifications(expected_user,before_id)
$$;
revoke all on function workshop_private.get_site_notifications(uuid,uuid),public.get_site_notifications(uuid,uuid) from public,anon,authenticated;
grant execute on function workshop_private.get_site_notifications(uuid,uuid),public.get_site_notifications(uuid,uuid) to authenticated;

create function public.read_site_notifications(expected_user uuid,notification uuid,read_all boolean) returns integer
language sql volatile security invoker set search_path='' as $$
  select workshop_private.read_site_notifications(expected_user,notification,read_all)
$$;
revoke all on function workshop_private.read_site_notifications(uuid,uuid,boolean),public.read_site_notifications(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function workshop_private.read_site_notifications(uuid,uuid,boolean),public.read_site_notifications(uuid,uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
