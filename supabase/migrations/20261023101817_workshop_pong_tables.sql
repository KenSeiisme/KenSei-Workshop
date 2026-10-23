begin;
-- Only room lifecycle is stored. Paddle/ball traffic stays in private Broadcast.
create table workshop_private.pong_rooms (
 id uuid primary key default gen_random_uuid(),code text not null unique,
 channel_key uuid not null default gen_random_uuid(),host_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'waiting' check(status in ('waiting','playing','paused','finished','interrupted','closed')),
 round integer not null default 0,seed bigint not null default 1,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',paused_at timestamptz
);
create table workshop_private.pong_room_members (
 room_id uuid not null references workshop_private.pong_rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('host','guest')),client_id uuid not null,ready boolean not null default false,
 last_seen timestamptz not null default clock_timestamp(),primary key(room_id,user_id),unique(room_id,role)
);
create index pong_room_member_owner on workshop_private.pong_room_members(user_id,room_id);
create table workshop_private.pong_room_requests(user_id uuid not null references auth.users(id) on delete cascade,bucket timestamptz not null,creates integer not null default 0,joins integer not null default 0,primary key(user_id,bucket));
alter table workshop_private.pong_rooms enable row level security;
alter table workshop_private.pong_room_members enable row level security;
alter table workshop_private.pong_room_requests enable row level security;
revoke all on workshop_private.pong_rooms,workshop_private.pong_room_members,workshop_private.pong_room_requests from public,anon,authenticated;
commit;
