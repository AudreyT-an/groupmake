-- GroupMate database schema. Run the entire file in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(8),'hex'),1,8)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key(project_id,user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  assignee_id uuid references auth.users(id) on delete set null,
  due_date date,
  priority text not null default 'medium' check(priority in ('low','medium','high')),
  status text not null default 'todo' check(status in ('todo','doing','done')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.project_members where project_id=p_project_id and user_id=auth.uid());
$$;

create or replace function public.create_project(p_name text,p_description text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if length(trim(coalesce(p_name,'')))=0 then raise exception '项目名称不能为空'; end if;
  insert into public.projects(name,description,created_by) values(trim(p_name),coalesce(p_description,''),auth.uid()) returning id into new_id;
  insert into public.project_members(project_id,user_id,role) values(new_id,auth.uid(),'owner');
  return new_id;
end; $$;

create or replace function public.join_project(p_invite_code text)
returns uuid language plpgsql security definer set search_path=public as $$
declare found_id uuid;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  select id into found_id from public.projects where invite_code=upper(trim(p_invite_code));
  if found_id is null then raise exception '邀请码无效'; end if;
  insert into public.project_members(project_id,user_id,role) values(found_id,auth.uid(),'member') on conflict do nothing;
  return found_id;
end; $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,display_name)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)))
  on conflict(id) do update set email=excluded.email;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (id=auth.uid() or exists(select 1 from public.project_members a join public.project_members b on a.project_id=b.project_id where a.user_id=auth.uid() and b.user_id=profiles.id));
drop policy if exists "profile self update" on public.profiles;
create policy "profile self update" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());

drop policy if exists "members read projects" on public.projects;
create policy "members read projects" on public.projects for select to authenticated using(public.is_project_member(id));
drop policy if exists "owner update project" on public.projects;
create policy "owner update project" on public.projects for update to authenticated using(exists(select 1 from public.project_members where project_id=id and user_id=auth.uid() and role='owner')) with check(exists(select 1 from public.project_members where project_id=id and user_id=auth.uid() and role='owner'));

drop policy if exists "members read membership" on public.project_members;
create policy "members read membership" on public.project_members for select to authenticated using(public.is_project_member(project_id));
drop policy if exists "member leave project" on public.project_members;
create policy "member leave project" on public.project_members for delete to authenticated using(user_id=auth.uid() and role='member');

drop policy if exists "members read tasks" on public.tasks;
create policy "members read tasks" on public.tasks for select to authenticated using(public.is_project_member(project_id));
drop policy if exists "members create tasks" on public.tasks;
create policy "members create tasks" on public.tasks for insert to authenticated with check(public.is_project_member(project_id) and created_by=auth.uid());
drop policy if exists "members update tasks" on public.tasks;
create policy "members update tasks" on public.tasks for update to authenticated using(public.is_project_member(project_id)) with check(public.is_project_member(project_id));
drop policy if exists "members delete tasks" on public.tasks;
create policy "members delete tasks" on public.tasks for delete to authenticated using(public.is_project_member(project_id));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.projects to authenticated;
grant select, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant execute on function public.create_project(text,text) to authenticated;
grant execute on function public.join_project(text) to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;

-- Enable live updates for task changes.
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; when undefined_object then null;
end $$;
