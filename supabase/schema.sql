-- 在此新站专属的 Supabase 项目中运行；不连接原 KenSei 项目。
create table if not exists public.workspace_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  type text not null check (type in ('favorite','preset','draft','settings','session')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint bounded_payload check (octet_length(data::text) <= 500000)
);
alter table public.workspace_items enable row level security;
drop policy if exists "Owner reads own items" on public.workspace_items;
drop policy if exists "Owner inserts own items" on public.workspace_items;
drop policy if exists "Owner updates own items" on public.workspace_items;
drop policy if exists "Owner deletes own items" on public.workspace_items;
create policy "Owner reads own items" on public.workspace_items for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owner inserts own items" on public.workspace_items for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owner updates own items" on public.workspace_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Owner deletes own items" on public.workspace_items for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.workspace_items from anon;
grant select, insert, update, delete on public.workspace_items to authenticated;
