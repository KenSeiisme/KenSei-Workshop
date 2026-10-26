begin;
create table workshop_private.shared_whiteboards (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100),channel_key uuid not null default gen_random_uuid(),
 invite_token text not null unique default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
 app_state jsonb not null default '{"viewBackgroundColor":"#ffffff","gridSize":null}',revision bigint not null default 0,
 updated_at timestamptz not null default clock_timestamp()
);
create table workshop_private.shared_whiteboard_members (
 room_id uuid not null references workshop_private.shared_whiteboards(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,client_id uuid,lease_until timestamptz,
 joined_at timestamptz not null default clock_timestamp(),primary key(room_id,user_id)
);
create index shared_board_member_account on workshop_private.shared_whiteboard_members(user_id,room_id);
create index shared_board_active on workshop_private.shared_whiteboard_members(lease_until,room_id) where lease_until is not null;
create index shared_board_owner on workshop_private.shared_whiteboards(owner_id);
create table workshop_private.shared_whiteboard_elements (
 room_id uuid not null references workshop_private.shared_whiteboards(id) on delete cascade,element_id text not null,
 data jsonb not null,primary key(room_id,element_id)
);
create table workshop_private.shared_whiteboard_mutations (
 room_id uuid not null references workshop_private.shared_whiteboards(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,digest text not null,revision bigint not null,created_at timestamptz not null default clock_timestamp(),
 primary key(room_id,user_id,operation_id)
);
create table workshop_private.shared_whiteboard_requests (
 user_id uuid not null references auth.users(id) on delete cascade,bucket timestamptz not null,calls integer not null default 0,
 creates integer not null default 0,joins integer not null default 0,primary key(user_id,bucket)
);
create index shared_board_mutation_user on workshop_private.shared_whiteboard_mutations(user_id);
create index shared_board_mutation_cleanup on workshop_private.shared_whiteboard_mutations(created_at);
create index shared_board_request_cleanup on workshop_private.shared_whiteboard_requests(bucket);
alter table workshop_private.shared_whiteboards enable row level security;
alter table workshop_private.shared_whiteboard_members enable row level security;
alter table workshop_private.shared_whiteboard_elements enable row level security;
alter table workshop_private.shared_whiteboard_mutations enable row level security;
alter table workshop_private.shared_whiteboard_requests enable row level security;
revoke all on workshop_private.shared_whiteboards,workshop_private.shared_whiteboard_members,workshop_private.shared_whiteboard_elements,workshop_private.shared_whiteboard_mutations,workshop_private.shared_whiteboard_requests from public,anon,authenticated;

create function workshop_private.shared_board_scene(room uuid,viewer uuid,include_scene boolean default true) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'name',r.name,'owner_id',r.owner_id,'channel_key',r.channel_key,'revision',r.revision,'appState',r.app_state,'updated_at',r.updated_at,
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'profile',workshop_private.profile_json(p)-'bio','client_id',m.client_id,'online',coalesce(m.lease_until>clock_timestamp(),false)) order by m.joined_at),'[]'::jsonb)
 from workshop_private.shared_whiteboard_members m join public.typing_profiles p on p.user_id=m.user_id where m.room_id=r.id),
 'elements',case when include_scene then (select coalesce(jsonb_agg(e.data order by e.data->>'index' collate "C",e.element_id),'[]'::jsonb) from workshop_private.shared_whiteboard_elements e where e.room_id=r.id) else null end)
 from workshop_private.shared_whiteboards r where r.id=room and exists(select 1 from workshop_private.shared_whiteboard_members where room_id=r.id and user_id=viewer)
$$;
create function workshop_private.shared_board_validate(el jsonb) returns void language plpgsql immutable set search_path='' as $$
declare field text;
begin
 if jsonb_typeof(el) is distinct from 'object' or coalesce(el->>'id','') !~ '^[A-Za-z0-9_-]{1,100}$'
 or coalesce(el->>'type','') not in ('rectangle','diamond','ellipse','arrow','line','freedraw','text','frame')
 or el->>'link' is not null or el->>'fileId' is not null or el->>'customData' is not null then raise exception 'Use vector drawings and plain text only.';end if;
 if coalesce(el->>'version','') !~ '^[0-9]{1,10}$' or (el->>'version')::bigint not between 1 and 2147483647
 or coalesce(el->>'versionNonce','') !~ '^[0-9]{1,10}$' or (el->>'versionNonce')::bigint not between 0 and 2147483647
 or coalesce(el->>'index','') !~ '^[A-Za-z][A-Za-z0-9]{0,127}$' then raise exception 'Invalid element version or layer index.';end if;
 foreach field in array array['x','y','width','height','angle'] loop
  if jsonb_typeof(el->field) is distinct from 'number' or abs((el->>field)::numeric)>100000000 then raise exception 'Invalid element geometry.';end if;
 end loop;
 if jsonb_typeof(el->'isDeleted') is distinct from 'boolean' then raise exception 'Invalid deletion marker.';end if;
end $$;
create function workshop_private.shared_board_merge(room uuid,changes jsonb) returns void language plpgsql set search_path='' as $$
declare el jsonb; n integer;
begin
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes)>10000 then raise exception 'Use up to 10,000 elements.';end if;
 for el in select value from jsonb_array_elements(changes) loop
  perform workshop_private.shared_board_validate(el);
  if (el->>'isDeleted')::boolean then select jsonb_object_agg(key,value) into el from jsonb_each(el) where key=any(array['id','type','version','versionNonce','index','isDeleted','x','y','width','height','angle']);end if;
  insert into workshop_private.shared_whiteboard_elements as stored(room_id,element_id,data) values(room,el->>'id',el)
  on conflict(room_id,element_id) do update set data=excluded.data
   where (stored.data->>'version')::bigint<(excluded.data->>'version')::bigint
   or ((stored.data->>'version')::bigint=(excluded.data->>'version')::bigint and (stored.data->>'versionNonce')::bigint>(excluded.data->>'versionNonce')::bigint);
 end loop;
 select count(*) into n from workshop_private.shared_whiteboard_elements where room_id=room;
 if n>10000 or (select coalesce(sum(octet_length(data::text)),0) from workshop_private.shared_whiteboard_elements where room_id=room)>1999000 then raise exception 'This shared whiteboard exceeds 2 MB or 10,000 elements. Export or save a private copy.';end if;
end $$;



commit;
