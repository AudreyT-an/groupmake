-- ============================================================
-- GroupMate 数据库（v2）
-- 用法：Supabase Dashboard → SQL Editor → 新建查询 → 粘贴全文 → Run
-- 本文件可以重复执行，不会删除已有数据；
-- 如果数据库里已经有旧版表，也会自动补上 v2 需要的字段。
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- 基础表 ----------
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
  -- owner = 组长，member = 组员
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key(project_id,user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  -- 兼容旧字段：assignee_id 保存第一位负责人
  assignee_id uuid references auth.users(id) on delete set null,
  -- 需求2：一条任务可以有多个负责人
  assignee_ids uuid[] not null default '{}',
  due_date date,
  priority text not null default 'medium' check(priority in ('low','medium','high')),
  status text not null default 'todo' check(status in ('todo','doing','done')),
  -- 需求5：状态改变时自动写入开始 / 结束时间
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- v2 升级：给旧数据库补字段（表已存在时也不会报错） ----------
alter table public.tasks add column if not exists assignee_ids uuid[] not null default '{}';
alter table public.tasks add column if not exists started_at timestamptz;
alter table public.tasks add column if not exists completed_at timestamptz;

-- 把旧的单个负责人迁移到数组里
update public.tasks
   set assignee_ids = array[assignee_id]
 where assignee_id is not null
   and coalesce(array_length(assignee_ids,1),0) = 0;

create index if not exists tasks_project_idx on public.tasks(project_id);
create index if not exists tasks_due_idx on public.tasks(project_id, due_date);

-- ---------- 需求5：状态时间戳触发器 ----------
create or replace function public.tasks_stamp_status()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'doing' then
      new.started_at := coalesce(new.started_at, now());
    elsif new.status = 'done' then
      new.started_at := coalesce(new.started_at, now());
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'doing' then
      new.started_at := coalesce(new.started_at, now());
      new.completed_at := null;                       -- 从已完成退回进行中
    elsif new.status = 'done' then
      new.started_at := coalesce(new.started_at, now());
      new.completed_at := now();                      -- 完成时间
    else
      new.started_at := null;                         -- 退回待处理，重新计时
      new.completed_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_stamp_status on public.tasks;
create trigger tasks_stamp_status
  before insert or update on public.tasks
  for each row execute procedure public.tasks_stamp_status();

-- ---------- 权限判断函数 ----------
create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.project_members where project_id=p_project_id and user_id=auth.uid());
$$;

-- ---------- 业务函数 ----------
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

-- 需求6：组长把「组长」身份转给另一位成员（同一时间只有一位组长）
create or replace function public.set_project_leader(p_project_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if not exists(select 1 from public.project_members where project_id=p_project_id and user_id=auth.uid() and role='owner') then
    raise exception '只有组长可以调整组长';
  end if;
  if not exists(select 1 from public.project_members where project_id=p_project_id and user_id=p_user_id) then
    raise exception '该成员不在项目中';
  end if;
  update public.project_members set role='member' where project_id=p_project_id;
  update public.project_members set role='owner' where project_id=p_project_id and user_id=p_user_id;
end; $$;

-- ---------- 注册后自动建 profile ----------
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

-- ---------- 行级权限 ----------
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
grant execute on function public.set_project_leader(uuid,uuid) to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;

-- ---------- 实时更新 ----------
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; when undefined_object then null;
end $$;
